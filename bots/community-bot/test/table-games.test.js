import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { config } from "../src/config.js";
import { advanceTableGame, handValue, minesReturn, newTableGame } from "../src/table-game-rules.js";
import * as storage from "../src/table-game-store.js";
import { tableGamePayload } from "../src/table-game-view.js";
import { createTableGameHandlers } from "../src/table-games.js";

const noShuffle = (max) => max - 1;
const ids = {
  id: "223456789012345678", guildId: "223456789012345679",
  userId: "223456789012345680", channelId: "223456789012345681",
};
const now = 1_800_000_000_000;

test("blackjack ace totals, dealer soft-17, busts, pushes, and automatic stand at 21", () => {
  assert.equal(handValue([0, 13, 9]), 12);
  assert.equal(handValue([0, 13, 8]), 21);
  assert.equal(handValue([0, 13, 26, 9]), 13);
  const state = { player: [9, 8], dealer: [0, 5], deck: [22, 21], done: false };
  const win = advanceTableGame("blackjack", state, "stand", 10);
  assert.equal(win.payout, 20);
  assert.equal(win.dealer.length, 2, "dealer must stand on soft 17");
  assert.equal(state.done, false, "rules must not mutate the prior state");
  assert.equal(advanceTableGame("blackjack", { ...state, deck: [9] }, "hit", 10).payout, 0);
  assert.equal(advanceTableGame("blackjack", { ...state, dealer: [9, 8] }, "stand", 10).payout, 10);
  const twentyOne = advanceTableGame("blackjack", { ...state, deck: [1] }, "hit", 10);
  assert.equal(twentyOne.done, true);
  assert.equal(handValue(twentyOne.player), 21);
  assert.equal(twentyOne.payout, 20);
  assert.throws(() => advanceTableGame("blackjack", state, "cashout", 10));
});

test("blackjack uses one distinct 52-card deck and natural blackjack pays 3:2 rounded down", () => {
  const game = newTableGame("blackjack", 10, 3, noShuffle);
  assert.equal(new Set([...game.deck, ...game.player, ...game.dealer]).size, 52);
  const naturalRoll = (max) => ({ 52: 0, 51: 9, 50: 8, 49: 7 })[max] ?? max - 1;
  const natural = newTableGame("blackjack", 5, 3, naturalRoll);
  assert.equal(handValue(natural.player), 21);
  assert.equal(natural.payout, 12);
  const bothRoll = (max) => ({ 52: 0, 51: 9, 50: 13, 49: 22 })[max] ?? max - 1;
  assert.equal(newTableGame("blackjack", 5, 3, bothRoll).payout, 5);
});

test("mines supports safe picks, loss, exact returns, full clears, and automatic collection", () => {
  const state = { mines: [0, 1, 2], revealed: [], done: false };
  assert.equal(minesReturn(100, 3, 1), 119);
  assert.equal(minesReturn(100, 3, 13), 54320);
  assert.throws(() => advanceTableGame("mines", state, "cashout", 100));
  assert.throws(() => advanceTableGame("mines", state, "16", 100));
  const safe = advanceTableGame("mines", state, "3", 100);
  assert.deepEqual(safe.revealed, [3]);
  assert.throws(() => advanceTableGame("mines", safe, "3", 100));
  assert.equal(advanceTableGame("mines", safe, "cashout", 100).payout, 119);
  const lost = advanceTableGame("mines", safe, "0", 100);
  assert.equal(lost.payout, 0);
  assert.equal(lost.hit, 0);
  assert.equal(advanceTableGame("mines", state, "expire", 100, true).payout, 100);
  assert.equal(advanceTableGame("mines", safe, "expire", 100, true).payout, 119);
  let clear = state;
  for (let tile = 3; tile < 16; tile++) clear = advanceTableGame("mines", clear, String(tile), 100);
  assert.equal(clear.done, true);
  assert.equal(clear.payout, 54320);
  assert.deepEqual(advanceTableGame("mines", clear, "cashout", 100), clear);
  const generated = newTableGame("mines", 10, 5);
  assert.equal(new Set(generated.mines).size, 5);
});

function viewMessage() {
  return {
    guild: { id: ids.guildId, name: "Table test" },
    client: { user: { username: "Test bot", displayAvatarURL: () => "https://example.com/avatar.png" } },
  };
}

test("Discord boards hide mines/decks and stay within component and embed limits", () => {
  for (const game of ["mines", "blackjack"]) {
    const session = {
      id: ids.id, user_id: ids.userId, game, stake: 10, status: "active", version: 0,
      expires_at: now + 600000, balance_after: 90,
      state: newTableGame(game, 10, 3, noShuffle),
    };
    const payload = tableGamePayload(viewMessage(), session);
    assert.ok(payload.components.length <= 5);
    assert.ok(payload.embeds[0].toJSON().fields.length <= 25);
    assert.equal(payload.allowedMentions.repliedUser, false);
    for (const row of payload.components) {
      const data = row.toJSON();
      assert.ok(data.components.length <= 5);
      for (const button of data.components) assert.ok(button.custom_id.length <= 100);
    }
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /"deck"|"mines":/);
    if (game === "mines") {
      assert.equal(payload.components.length, 5);
      assert.equal(payload.components[4].toJSON().components[0].disabled, true);
      assert.deepEqual(payload.components[0].toJSON().components.map((b) => b.label), ["01", "02", "03", "04"]);
    } else {
      assert.match(payload.embeds[0].toJSON().fields[2].value, /Hidden/);
    }
    const done = advanceTableGame(game, session.state, game === "mines" ? "0" : "stand", 10);
    const finished = tableGamePayload(viewMessage(), { ...session, status: "finished", state: done });
    assert.ok(finished.components.every((row) => row.toJSON().components.every((b) => b.disabled)));
  }
});

test("button handling acknowledges promptly, restricts ownership, refreshes saved state, and isolates errors", async () => {
  const calls = [];
  let status = "forbidden";
  const session = {
    id: ids.id, user_id: ids.userId, game: "mines", stake: 10, status: "active",
    version: 1, expires_at: now + 600000, balance_after: 90,
    state: { mines: [0], revealed: [1], done: false },
  };
  const controller = createTableGameHandlers({ persistence: {
    actOnTableGame: async () => {
      calls.push("database");
      if (status === "error") throw new Error("simulated database outage");
      return { status, session: status === "updated" ? session : undefined };
    },
  } });
  const interaction = {
    isButton: () => true, customId: `play:${ids.id}:0:2`, guildId: ids.guildId, user: { id: ids.userId },
    message: viewMessage(), deferUpdate: async () => calls.push("ack"),
    followUp: async (payload) => calls.push(payload), editReply: async (payload) => calls.push(payload),
  };
  await controller.interaction(interaction);
  assert.deepEqual(calls.slice(0, 2), ["ack", "database"]);
  assert.equal(calls.at(-1).flags, 64);
  assert.match(calls.at(-1).content, /Only the player/);
  status = "updated";
  await controller.interaction(interaction);
  assert.ok(calls.at(-1).components);
  status = "error";
  await controller.interaction(interaction);
  assert.equal(calls.at(-1).flags, 64);
  assert.doesNotMatch(calls.at(-1).content, /simulated database/);
  assert.equal(await controller.interaction({ isButton: () => false }), false);
});

test("PostgreSQL table games reserve once, resume after restart, reject replays, settle once, and expire safely", {
  skip: !config.databaseUrl,
}, async () => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  const balance = async () => Number((await pool.query("SELECT points FROM community_bot_economy")).rows[0].points);
  const open = (overrides = {}) => storage.openTableGame({ ...ids, game: "mines", stake: 100, ...overrides }, pool, now);
  const act = (version, action, extra = {}) => storage.actOnTableGame({
    id: ids.id, guildId: ids.guildId, userId: ids.userId, version, action, ...extra,
  }, pool, now);
  try {
    for (const table of ["community_bot_economy", "community_bot_game_rounds", "community_bot_game_sessions"]) {
      await pool.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    assert.equal((await open()).status, "insufficient");
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM community_bot_game_rounds")).rows[0].count, 0);
    await pool.query("INSERT INTO community_bot_economy (guild_id,user_id,points) VALUES ($1,$2,1000)", [ids.guildId, ids.userId]);
    const started = await open();
    assert.equal(started.status, "opened");
    assert.equal(await balance(), 900);
    assert.equal((await open()).status, "duplicate");
    assert.equal((await open({ id: "223456789012345682", game: "blackjack" })).status, "resumed");
    assert.equal(await balance(), 900);
    assert.equal((await storage.resumeTableGame(ids.guildId, ids.userId, pool, now)).id, ids.id);
    assert.equal((await act(0, "1", { userId: "223456789012345699" })).status, "forbidden");
    assert.equal((await act(0, "1", { guildId: "223456789012345698" })).status, "missing");
    // Known board in a temporary table, never in real server data.
    await pool.query("UPDATE community_bot_game_sessions SET state = $1::jsonb", [JSON.stringify({ mines: [0, 1, 2], revealed: [], done: false })]);
    const picked = await act(0, "3");
    assert.equal(picked.session.version, 1);
    const stale = await act(0, "4");
    assert.deepEqual(stale.session.state.revealed, [3]);
    const outcomes = await Promise.all([act(1, "cashout"), act(1, "cashout")]);
    assert.ok(outcomes.every((r) => r.session.status === "finished"));
    assert.equal(await balance(), 1019);
    assert.equal((await pool.query("SELECT payout FROM community_bot_game_rounds")).rows[0].payout, 119);
    // New hand; an expired, untouched board refunds once even after worker restart.
    const secondId = "223456789012345683";
    await open({ id: secondId });
    assert.equal(await balance(), 919);
    const firstSweep = await storage.expireTableGames(pool, now + storage.TABLE_GAME_TIMEOUT + 1);
    assert.equal(firstSweep.length, 1);
    assert.equal(await balance(), 1019);
    assert.equal((await storage.expireTableGames(pool, now + storage.TABLE_GAME_TIMEOUT + 1)).length, 0);
    assert.equal(await balance(), 1019);
    // Blackjack expiration stands rather than refunding a losing hand.
    const thirdId = "223456789012345684";
    await open({ id: thirdId });
    await pool.query("UPDATE community_bot_game_sessions SET game = 'blackjack', state = $2::jsonb WHERE id = $1",
      [thirdId, JSON.stringify({ player: [9, 5], dealer: [9, 8], deck: [4, 3], done: false })]);
    await storage.expireTableGames(pool, now + storage.TABLE_GAME_TIMEOUT + 1);
    assert.equal(await balance(), 919);
    // A mined tile loses the reserved stake, never charges it a second time.
    const fourthId = "223456789012345685";
    await open({ id: fourthId });
    await pool.query("UPDATE community_bot_game_sessions SET state = $2::jsonb WHERE id = $1",
      [fourthId, JSON.stringify({ mines: [0], revealed: [], done: false })]);
    await storage.actOnTableGame({ id: fourthId, guildId: ids.guildId, userId: ids.userId, version: 0, action: "0" }, pool, now);
    assert.equal(await balance(), 819);
  } finally { await pool.end(); }
});
