import { database } from "./storage.js";
import { MAX_WAGER } from "./game-rules.js";

// The round and balance commit together. Discord message IDs prevent a replay
// (including overlapping bot instances on the same database) charging twice.
export async function settleWager({ messageId, guildId, userId, game, stake, multiplier }, pool = database) {
  if (![messageId, guildId, userId].every((id) => /^\d{17,20}$/.test(id)) ||
      !["slots", "dice", "roulette"].includes(game) ||
      !Number.isInteger(stake) || stake < 1 || stake > MAX_WAGER ||
      ![0, 1, 2, 5, 10, 36].includes(multiplier)) {
    throw new Error("Invalid wager.");
  }
  const payout = stake * multiplier;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO community_bot_game_rounds
       (message_id, guild_id, user_id, game, stake, payout, balance_after, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
       ON CONFLICT (message_id) DO NOTHING RETURNING message_id`,
      [messageId, guildId, userId, game, stake, payout, Date.now()],
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return { status: "duplicate" };
    }
    const updated = await client.query(
      `UPDATE community_bot_economy SET points = points - $3 + $4
       WHERE guild_id = $1 AND user_id = $2 AND points >= $3
         AND points::bigint - $3 + $4 <= 2147483647
       RETURNING points`,
      [guildId, userId, stake, payout],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return { status: "insufficient" };
    }
    const balance = Number(updated.rows[0].points);
    await client.query(
      "UPDATE community_bot_game_rounds SET balance_after = $2 WHERE message_id = $1",
      [messageId, balance],
    );
    await client.query("COMMIT");
    return { status: "settled", balance, stake, payout, net: payout - stake };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
