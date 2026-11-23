import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { config } from "../src/config.js";
import { createMessageReceipts } from "../src/message-receipts.js";
import { createMessageDispatcher } from "../src/message-dispatcher.js";

const message = (content = "fhelp", id = "123456789012345678") => ({
  id, content, createdTimestamp: Date.now(),
  guild: { id: "guild" }, author: { id: "member", bot: false }, member: {},
});
const defaults = {
  detectSpam: async () => false, command: async () => false, trivia: async () => false,
  chat: async () => false, award: async () => {},
};

test("every command, mention and activity message is claimed before ANY side effects", async () => {
  for (const content of [
    "fban", "fkick", "ftimeout", "funtimeout", "fwarn", "fwarnings", "fclear", "fslowmode", "flock", "funlock",
    "fhelp", "fcommands", "f8ball", "fcoinflip", "ftrivia", "frps", "fcompliment", "fjoke", "frandom", "fprofile",
    "fdaily", "fleaderboard", "fmines", "fblackjack", "fbj", "fslots", "fdice", "froulette", "fsteal",
    "fprefix", "flog", "fwelcome", "fgoodbye", "fresponse", "fannounce", "fsecurity", "fsettings",
    "fchat", "fpersonality", "<@bot> you a fat", "ordinary chat", "!customprefix",
  ]) {
    let claimed = false, runs = 0;
    const dispatch = createMessageDispatcher({
      ...defaults,
      claim: async () => { if (claimed) return false; claimed = true; return true; },
      detectSpam: async () => { assert.equal(claimed, true); return false; },
      command: async () => { runs++; return true; },
    });
    const m = message(content);
    await Promise.all(Array.from({ length: 25 }, () => dispatch(m)));
    assert.equal(runs, 1, content);
    assert.equal(await dispatch(m), false, "later sequential redelivery is also ignored");
  }
});

test("database failure prevents moderation, commands, AI and activity from running", async () => {
  let sideEffects = 0;
  const effect = async () => { sideEffects++; };
  const dispatch = createMessageDispatcher({
    claim: async () => { throw new Error("database unavailable"); },
    detectSpam: effect, command: effect, trivia: effect, chat: effect, award: effect,
  });
  await assert.rejects(dispatch(message()), /database unavailable/);
  assert.equal(sideEffects, 0);
});

test("bot messages and DMs are ignored; normal activity and AI only execute once", async () => {
  const seen = new Set();
  let rewards = 0, generations = 0;
  const dispatch = createMessageDispatcher({
    ...defaults,
    claim: async (m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; },
    chat: async (m) => { if (!m.content.startsWith("<@bot>")) return false; generations++; return true; },
    award: async () => { rewards++; },
  });
  const ordinary = message("hello");
  await Promise.all([dispatch(ordinary), dispatch(ordinary)]);
  const mention = message("<@bot> hello", "123456789012345679");
  await Promise.all([dispatch(mention), dispatch(mention)]);
  await dispatch({ ...message(), guild: null });
  await dispatch({ ...message(), author: { bot: true } });
  assert.equal(rewards, 1);
  assert.equal(generations, 1);
});

test("PostgreSQL receipts survive service recreation and suppress concurrent and failed-action replays", {
  skip: !config.databaseUrl,
}, async () => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  try {
    // This temp table shadows the real table and disappears with this connection.
    // No real bot receipts, balances or warnings are read or changed.
    await pool.query(`CREATE TEMP TABLE community_bot_message_receipts (
      message_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const claimA = createMessageReceipts({ database: pool });
    const claimB = createMessageReceipts({ database: pool });
    const m = message();
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? claimA : claimB)(m)));
    assert.equal(results.filter(Boolean).length, 1);
    const afterRestart = createMessageReceipts({ database: pool });
    assert.equal(await afterRestart(m), false);
    let actions = 0;
    const dispatch = createMessageDispatcher({
      ...defaults, claim: afterRestart,
      command: async () => { actions++; throw new Error("uncertain moderation result"); },
    });
    const failed = message("fwarn", "123456789012345679");
    await assert.rejects(dispatch(failed), /uncertain moderation result/);
    assert.equal(await dispatch(failed), false);
    assert.equal(actions, 1);
    assert.equal(await claimA({ ...message(), createdTimestamp: Date.now() - 8 * 86_400_000 }), false);
    assert.equal(await claimA({ ...message(), id: "invalid" }), false);
    const count = await pool.query("SELECT count(*)::int AS total FROM community_bot_message_receipts");
    assert.equal(count.rows[0].total, 2);
  } finally {
    await pool.end();
  }
});
