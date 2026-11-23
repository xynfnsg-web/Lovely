import test from "node:test";
import assert from "node:assert/strict";
import { database, ensureGuildSettings } from "../src/storage.js";

test("guild initialization skips empty input and never overwrites existing settings", async () => {
  const original = database.query;
  const calls = [];
  database.query = async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; };
  try {
    await ensureGuildSettings([]);
    assert.equal(calls.length, 0);
    const guildIds = ["123456789012345678", "123456789012345679"];
    await ensureGuildSettings(guildIds);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [guildIds]);
    assert.match(calls[0].sql, /ON CONFLICT \(guild_id\) DO NOTHING/);
    assert.doesNotMatch(calls[0].sql, /UPDATE|DELETE|TRUNCATE|DROP|CREATE/i);
    assert.match(calls[0].sql, /'\{\}'::jsonb/);
  } finally {
    database.query = original;
  }
});
