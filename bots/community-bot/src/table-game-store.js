import { database } from "./storage.js";
import { MAX_WAGER } from "./game-rules.js";
import { advanceTableGame, newTableGame } from "./table-game-rules.js";

export const TABLE_GAME_TIMEOUT = 10 * 60 * 1000;
const idPattern = /^\d{17,20}$/;

async function transaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function saveState(client, session, state) {
  let balance = session.balance_after;
  if (state.done) {
    const { rows } = await client.query(
      "SELECT points FROM community_bot_economy WHERE guild_id = $1 AND user_id = $2 FOR UPDATE",
      [session.guild_id, session.user_id],
    );
    if (!rows[0]) throw new Error("Game balance record is missing.");
    const credit = Math.min(state.payout, 2147483647 - Number(rows[0].points));
    if (credit !== state.payout) state.result += " Return capped at the maximum point balance.";
    state.payout = credit;
    const updated = await client.query(
      "UPDATE community_bot_economy SET points = points + $3 WHERE guild_id = $1 AND user_id = $2 RETURNING points",
      [session.guild_id, session.user_id, credit],
    );
    balance = Number(updated.rows[0].points);
    await client.query(
      "UPDATE community_bot_game_rounds SET payout = $2, balance_after = $3 WHERE message_id = $1",
      [session.id, credit, balance],
    );
  }
  const { rows } = await client.query(
    `UPDATE community_bot_game_sessions
     SET state = $2::jsonb, status = $3, version = version + 1, balance_after = $4
     WHERE id = $1 RETURNING *`,
    [session.id, JSON.stringify(state), state.done ? "finished" : "active", balance],
  );
  return rows[0];
}

export async function openTableGame({ id, guildId, userId, channelId, game, stake, mines = 3 }, pool = database, now = Date.now()) {
  if (![id, guildId, userId, channelId].every((value) => idPattern.test(value)) ||
      !["mines", "blackjack"].includes(game) ||
      !Number.isInteger(stake) || stake < 1 || stake > MAX_WAGER ||
      !Number.isInteger(mines) || mines < 1 || mines > 5) throw new Error("Invalid game.");
  return transaction(pool, async (client) => {
    // Serialize new sessions for this member across processes, without a global lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${guildId}:${userId}`]);
    const previous = await client.query("SELECT id FROM community_bot_game_sessions WHERE id = $1", [id]);
    if (previous.rowCount) return { status: "duplicate" };
    const { rows: active } = await client.query(
      "SELECT * FROM community_bot_game_sessions WHERE guild_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
      [guildId, userId],
    );
    if (active[0]) {
      if (Number(active[0].expires_at) > now) return { status: "resumed", session: active[0] };
      await saveState(client, active[0], advanceTableGame(active[0].game, active[0].state, "expire", active[0].stake, true));
    }
    const round = await client.query(
      `INSERT INTO community_bot_game_rounds
       (message_id, guild_id, user_id, game, stake, payout, balance_after, created_at)
       VALUES ($1,$2,$3,$4,$5,0,0,$6) ON CONFLICT (message_id) DO NOTHING RETURNING message_id`,
      [id, guildId, userId, game, stake, now],
    );
    if (!round.rowCount) return { status: "duplicate" };
    const debit = await client.query(
      `UPDATE community_bot_economy SET points = points - $3
       WHERE guild_id = $1 AND user_id = $2 AND points >= $3 RETURNING points`,
      [guildId, userId, stake],
    );
    if (!debit.rowCount) {
      // This uncommitted reservation has never represented a charged round.
      await client.query("DELETE FROM community_bot_game_rounds WHERE message_id = $1", [id]);
      return { status: "insufficient" };
    }
    const balance = Number(debit.rows[0].points);
    const state = newTableGame(game, stake, mines);
    const inserted = await client.query(
      `INSERT INTO community_bot_game_sessions
       (id,guild_id,user_id,channel_id,game,stake,status,version,state,expires_at,balance_after)
       VALUES ($1,$2,$3,$4,$5,$6,'active',0,$7::jsonb,$8,$9) RETURNING *`,
      [id, guildId, userId, channelId, game, stake, JSON.stringify(state), now + TABLE_GAME_TIMEOUT, balance],
    );
    await client.query("UPDATE community_bot_game_rounds SET balance_after = $2 WHERE message_id = $1", [id, balance]);
    const session = state.done ? await saveState(client, inserted.rows[0], state) : inserted.rows[0];
    return { status: "opened", session };
  });
}

export async function actOnTableGame({ id, guildId, userId, version, action }, pool = database, now = Date.now()) {
  if (![id, guildId, userId].every((value) => idPattern.test(value)) ||
      !Number.isSafeInteger(version) || version < 0) return { status: "missing" };
  return transaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM community_bot_game_sessions WHERE id = $1 FOR UPDATE", [id]);
    const session = rows[0];
    if (!session || session.guild_id !== guildId) return { status: "missing" };
    if (session.user_id !== userId) return { status: "forbidden" };
    if (session.status !== "active") return { status: "updated", session };
    if (Number(session.expires_at) <= now) {
      return { status: "updated", session: await saveState(client, session, advanceTableGame(session.game, session.state, "expire", session.stake, true)) };
    }
    // A repeated or out-of-order button must never draw another card or pay twice.
    if (session.version !== version) return { status: "updated", session };
    const state = advanceTableGame(session.game, session.state, action, session.stake);
    return { status: "updated", session: await saveState(client, session, state) };
  });
}

export async function resumeTableGame(guildId, userId, pool = database, now = Date.now()) {
  const { rows } = await pool.query(
    "SELECT * FROM community_bot_game_sessions WHERE guild_id = $1 AND user_id = $2 AND status = 'active'",
    [guildId, userId],
  );
  if (!rows[0]) return null;
  if (Number(rows[0].expires_at) > now) return rows[0];
  return (await actOnTableGame({
    id: rows[0].id, guildId, userId, version: rows[0].version, action: "expire",
  }, pool, now)).session;
}

export async function attachGameMessage(id, channelId, replyId, pool = database) {
  if (![id, channelId, replyId].every((value) => idPattern.test(value))) throw new Error("Invalid game message.");
  await pool.query(
    "UPDATE community_bot_game_sessions SET channel_id = $2, reply_id = $3 WHERE id = $1",
    [id, channelId, replyId],
  );
}

export async function expireTableGames(pool = database, now = Date.now()) {
  const { rows } = await pool.query(
    "SELECT id, guild_id, user_id, version FROM community_bot_game_sessions WHERE status = 'active' AND expires_at <= $1 ORDER BY expires_at LIMIT 100",
    [now],
  );
  const expired = [];
  for (const row of rows) {
    const result = await actOnTableGame({
      id: row.id, guildId: row.guild_id, userId: row.user_id, version: row.version, action: "expire",
    }, pool, now);
    if (result.session) expired.push(result.session);
  }
  return expired;
}
