import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "../src/config.js";
import { createBotLeadership } from "../src/bot-leadership.js";

function fixture({ acquired = true, setup = async () => {} } = {}) {
  const connection = new EventEmitter();
  const calls = [];
  connection.query = async (sql, params) => { calls.push({ sql, params }); return { rows: [{ acquired }] }; };
  connection.release = (discard) => calls.push({ release: discard });
  let ready = 0, standby = 0, lost = 0;
  const lease = createBotLeadership({
    pool: { connect: async () => connection }, pollMs: 10,
    onAcquired: setup, onReady: () => ready++, onStandby: () => standby++, onLost: () => lost++,
  });
  return { connection, calls, lease, counts: () => ({ ready, standby, lost }) };
}

test("only an initialized lock holder becomes active and owns one session lock", async () => {
  let release;
  const f = fixture({ setup: () => new Promise((resolve) => { release = resolve; }) });
  const starting = f.lease.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.lease.isLeader(), false);
  release();
  await starting;
  assert.equal(f.lease.isLeader(), true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.calls.filter((call) => call.sql?.includes("pg_try_advisory_lock")).length, 1, "must not reentrantly acquire the same session lock");
  await f.lease.close();
  assert.equal(f.lease.isLeader(), false);
  assert.equal(f.calls.filter((call) => call.sql?.includes("pg_advisory_unlock")).length, 1);
  await f.lease.close();
  assert.equal(f.calls.filter((call) => "release" in call).length, 1);
});

test("standby never processes events or repeatedly reports itself ready", async () => {
  const f = fixture({ acquired: false });
  await f.lease.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.lease.isLeader(), false);
  assert.deepEqual(f.counts(), { ready: 0, standby: 1, lost: 0 });
  await f.lease.close();
  assert.equal(f.calls.filter((call) => call.sql?.includes("pg_advisory_unlock")).length, 0);
});

test("lost database ownership fences the worker immediately and discards its connection", async () => {
  const f = fixture();
  await f.lease.start();
  f.connection.emit("error", new Error("connection lost"));
  assert.equal(f.lease.isLeader(), false);
  assert.equal(f.counts().lost, 1);
  await f.lease.close();
  assert.deepEqual(f.calls.at(-1), { release: true });
});

test("failed initialization releases ownership without marking the bot ready", async () => {
  const f = fixture({ setup: async () => { throw new Error("initialization failed"); } });
  await assert.rejects(f.lease.start(), /initialization failed/);
  assert.equal(f.lease.isLeader(), false);
  assert.equal(f.counts().ready, 0);
  assert.equal(f.calls.filter((call) => "release" in call).length, 1);
});

test("real PostgreSQL permits one worker and transfers leadership after the older worker stops", {
  skip: !config.databaseUrl,
}, async () => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 10000 });
  // A unique test key cannot interfere with the live bot's lock.
  const key = `community-bot-test:${randomUUID()}`;
  const first = createBotLeadership({ pool, key, pollMs: 10 });
  const second = createBotLeadership({ pool, key, pollMs: 10 });
  try {
    await first.start();
    await second.start();
    assert.equal(first.isLeader(), true);
    assert.equal(second.isLeader(), false);
    await first.close();
    for (let i = 0; i < 100 && !second.isLeader(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(first.isLeader(), false);
    assert.equal(second.isLeader(), true);
  } finally {
    await first.close();
    await second.close();
    await pool.end();
  }
});
