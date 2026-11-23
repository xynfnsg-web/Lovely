import test from "node:test";
import assert from "node:assert/strict";
import { createActivityRewards } from "../src/activity-rewards.js";
import { createMessageDispatcher } from "../src/message-dispatcher.js";

const message = { guild: { id: "g" }, author: { id: "u", bot: false }, member: {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const defaults = {
  detectSpam: async () => false, command: async () => true,
  trivia: async () => false, chat: async () => false, award: async () => {},
};

test("receipt and settings load together; no command runs before both complete", async () => {
  const started = [];
  let receiptDone, settingsDone;
  const settings = { prefix: "!" };
  const dispatch = createMessageDispatcher({
    ...defaults,
    claim: () => { started.push("receipt"); return new Promise((resolve) => { receiptDone = resolve; }); },
    prepare: () => { started.push("settings"); return new Promise((resolve) => { settingsDone = resolve; }); },
    detectSpam: async (_, prepared) => { assert.equal(prepared, settings); started.push("spam"); return false; },
    command: async (_, prepared) => { assert.equal(prepared, settings); started.push("command"); return true; },
  });
  const pending = dispatch(message);
  assert.deepEqual(started, ["receipt", "settings"]);
  settingsDone(settings);
  await tick();
  assert.deepEqual(started, ["receipt", "settings"]);
  receiptDone(true);
  assert.equal(await pending, true);
  assert.deepEqual(started, ["receipt", "settings", "spam", "command"]);
});

test("parallel preflight still fails closed on either database failure or duplicate", async () => {
  for (const kind of ["duplicate", "receipt-failure", "settings-failure"]) {
    let effects = 0;
    const dispatch = createMessageDispatcher({
      ...defaults,
      claim: async () => {
        if (kind === "receipt-failure") throw Error("receipt down");
        return kind !== "duplicate";
      },
      prepare: async () => {
        if (kind === "settings-failure") throw Error("settings down");
        return {};
      },
      detectSpam: async () => { effects++; return false; },
    });
    if (kind === "duplicate") assert.equal(await dispatch(message), false);
    else await assert.rejects(dispatch(message), /down/);
    assert.equal(effects, 0);
  }
});

test("100 activity messages after one award need only one database write", async () => {
  let time = 0, writes = 0;
  const reward = createActivityRewards({
    now: () => time, award: async () => { writes++; return true; },
  });
  assert.equal(await reward("g", "u"), true);
  for (let i = 0; i < 100; i++) assert.equal(await reward("g", "u"), false);
  assert.equal(writes, 1);
  time = 60_000;
  assert.equal(await reward("g", "u"), true);
  assert.equal(writes, 2);
});

test("simultaneous messages share an activity write and guild/member limits are isolated", async () => {
  let writes = 0;
  let finish;
  const reward = createActivityRewards({
    award: () => { writes++; return new Promise((resolve) => { finish = resolve; }); },
  });
  const pending = Array.from({ length: 50 }, () => reward("g", "u"));
  await tick();
  assert.equal(writes, 1);
  finish(true);
  await Promise.all(pending);
  for (const [guild, user] of [["other", "u"], ["g", "other"]]) {
    const next = reward(guild, user);
    await tick();
    finish(true);
    await next;
  }
  assert.equal(writes, 3);
});

test("denied and failed activity writes are retried; no balance is cached", async () => {
  let writes = 0;
  const reward = createActivityRewards({
    award: async () => {
      writes++;
      if (writes === 1) throw Error("database unavailable");
      return writes > 2;
    },
  });
  await assert.rejects(reward("g", "u"), /unavailable/);
  assert.equal(await reward("g", "u"), false);
  assert.equal(await reward("g", "u"), true);
  assert.equal(await reward("g", "u"), false);
  assert.equal(writes, 3);
});

test("activity skip entries are bounded and a fresh worker still consults PostgreSQL", async () => {
  let writes = 0;
  const award = async () => { writes++; return true; };
  const reward = createActivityRewards({ award, maxEntries: 2 });
  for (const user of ["a", "b", "c", "a"]) await reward("g", user);
  assert.equal(writes, 4);
  const restarted = createActivityRewards({ award });
  await restarted("g", "a");
  assert.equal(writes, 5);
});
