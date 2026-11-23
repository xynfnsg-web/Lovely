import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { parseWager, playGame } from "../src/game-rules.js";
import { settleWager } from "../src/wagers.js";
import { config } from "../src/config.js";
import { gameCommand } from "../src/games.js";
import { database } from "../src/storage.js";
import { handleCommandMessage } from "../src/commands.js";

test("wagers reject fractional, negative, zero, oversized, and ambiguous amounts", () => {
  for (const input of ["0", "-1", "1.5", "1001", "1e2", "01", "all", "10x", undefined]) {
    assert.equal(parseWager(input), null);
  }
  assert.equal(parseWager("1"), 1);
  assert.equal(parseWager("1000"), 1000);
});

test("slots cover wins, refunds, and losses with total-return multipliers", () => {
  assert.equal(playGame("slots", null, () => 0).multiplier, 10);
  let i = 0;
  assert.equal(playGame("slots", null, () => [0, 0, 1][i++]).multiplier, 1);
  i = 0;
  assert.equal(playGame("slots", null, () => [0, 1, 2][i++]).multiplier, 0);
});

test("dice and roulette correctly handle winning bets, zero, colors, and invalid choices", () => {
  assert.equal(playGame("dice", "6", () => 5).multiplier, 5);
  assert.equal(playGame("dice", "1", () => 5).multiplier, 0);
  assert.throws(() => playGame("dice", "7"));
  assert.throws(() => playGame("roulette", "37"));
  for (let n = 0; n <= 36; n++) {
    assert.equal(playGame("roulette", String(n), () => n).multiplier, 36);
  }
  assert.equal(playGame("roulette", "red", () => 0).multiplier, 0);
  assert.equal(playGame("roulette", "black", () => 0).multiplier, 0);
  const redWins = Array.from({ length: 37 }, (_, n) => playGame("roulette", "red", () => n).multiplier > 0);
  assert.equal(redWins.filter(Boolean).length, 18);
  const blackWins = Array.from({ length: 37 }, (_, n) => playGame("roulette", "black", () => n).multiplier > 0);
  assert.equal(blackWins.filter(Boolean).length, 18);
});

test("invalid settlement is rejected before accessing a database", async () => {
  await assert.rejects(settleWager({ stake: -1 }, { connect: () => assert.fail("must not connect") }));
});

test("settlement rolls back on database errors and always releases the connection", async () => {
  const queries = [];
  let released = false;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith("INSERT")) throw new Error("database unavailable");
    },
    release: () => { released = true; },
  };
  await assert.rejects(settleWager({
    messageId: "123456789012345678", guildId: "123456789012345679", userId: "123456789012345680",
    game: "slots", stake: 10, multiplier: 0,
  }, { connect: async () => client }), /database unavailable/);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(released, true);
});

test("PostgreSQL settlement prevents duplicate charges, overdrafts, and integer overflow", {
  skip: !config.databaseUrl,
}, async () => {
  // Temporary tables shadow the real tables on this one test connection.
  // No real member balance, round, or server configuration is changed.
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  const base = { guildId: "123456789012345679", userId: "123456789012345680", game: "slots", stake: 10, multiplier: 0 };
  try {
    await pool.query("CREATE TEMP TABLE community_bot_economy (LIKE public.community_bot_economy INCLUDING ALL)");
    await pool.query("CREATE TEMP TABLE community_bot_game_rounds (LIKE public.community_bot_game_rounds INCLUDING ALL)");
    await pool.query("INSERT INTO community_bot_economy (guild_id,user_id,points) VALUES ($1,$2,15)", [base.guildId, base.userId]);
    const first = { ...base, messageId: "123456789012345681" };
    const results = await Promise.all([settleWager(first, pool), settleWager(first, pool)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["duplicate", "settled"]);
    assert.equal((await pool.query("SELECT points FROM community_bot_economy")).rows[0].points, 5);
    assert.equal((await settleWager({ ...base, messageId: "123456789012345682" }, pool)).status, "insufficient");
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM community_bot_game_rounds")).rows[0].count, 1);
    // A win still requires the full stake up front.
    assert.equal((await settleWager({ ...base, multiplier: 36, messageId: "123456789012345683" }, pool)).status, "insufficient");
    await pool.query("UPDATE community_bot_economy SET points = 100");
    const win = await settleWager({ ...base, multiplier: 10, messageId: "123456789012345684" }, pool);
    assert.equal(win.balance, 190);
    assert.equal(win.net, 90);
    const refund = await settleWager({ ...base, multiplier: 1, messageId: "123456789012345685" }, pool);
    assert.equal(refund.balance, 190);
    await pool.query("UPDATE community_bot_economy SET points = 2147483647");
    assert.equal((await settleWager({ ...base, multiplier: 10, messageId: "123456789012345686" }, pool)).status, "insufficient");
  } finally {
    await pool.end();
  }
});

test("game results display the committed balance, suppress replay, and never retry after delivery failure", async () => {
  const originalConnect = database.connect;
  const replies = [];
  const message = {
    id: "123456789012345678",
    guild: { id: "123456789012345679", name: "Test server" },
    author: { id: "123456789012345680" },
    client: { user: { username: "Test bot", displayAvatarURL: () => "https://example.com/avatar.png" } },
    reply: async (payload) => { replies.push(payload); },
  };
  let settlements = 0;
  let duplicate = false;
  database.connect = async () => ({
    query: async (sql) => {
      if (sql.startsWith("INSERT")) { settlements++; return { rowCount: duplicate ? 0 : 1 }; }
      if (sql.startsWith("UPDATE community_bot_economy")) return { rowCount: 1, rows: [{ points: 80 }] };
      return { rowCount: 1 };
    },
    release() {},
  });
  try {
    await gameCommand(message, ["10"], "slots");
    assert.equal(replies.length, 1);
    assert.equal(replies[0].nonce, message.id);
    assert.equal(replies[0].enforceNonce, true);
    assert.equal(replies[0].embeds[0].toJSON().fields[3].value, "80 points");
    duplicate = true;
    await gameCommand(message, ["10"], "slots");
    assert.equal(replies.length, 1);
    duplicate = false;
    message.reply = async () => { throw new Error("simulated Discord delivery failure"); };
    await gameCommand(message, ["10"], "slots");
    assert.equal(settlements, 3);
  } finally {
    database.connect = originalConnect;
  }
});

test("new commands route with a custom prefix and games share a member cooldown", async () => {
  const original = database.query;
  database.query = async () => ({ rows: [{ settings_json: { prefix: "!" } }] });
  try {
    const replies = [];
    const base = {
      id: "123456789012345678",
      guild: { id: "123456789012345699", name: "Command test" },
      member: { permissions: { has: () => false }, roles: { cache: new Map() } },
      client: { user: { username: "Test bot", displayAvatarURL: () => "https://example.com/avatar.png" } },
      reply: async (payload) => { replies.push(payload.embeds[0].toJSON()); },
    };
    for (const [i, game] of ["slots", "dice", "roulette"].entries()) {
      const message = { ...base, author: { id: `12345678901234568${i}`, bot: false }, content: `!${game} all` };
      assert.equal(await handleCommandMessage(message), true);
      assert.match(replies.at(-1).description, new RegExp(`!${game}`));
      const count = replies.length;
      await handleCommandMessage({ ...message, content: "!dice 10 6" });
      assert.equal(replies.length, count, "switching games must not bypass the shared cooldown");
    }
    assert.equal(await handleCommandMessage({
      ...base, author: { id: "123456789012345689", bot: false }, content: "!steal <:happy:123456789012345678>",
    }), true);
    assert.match(replies.at(-1).description, /staff access/);
  } finally {
    database.query = original;
  }
});
