import { database } from "./storage.js";

export function createLevelStore(pool = database) {
  return {
    async award(guildId, userId, hash, now = Date.now()) {
      // One atomic statement: cooldown, repeat prevention, XP and level commit
      // together. PostgreSQL serializes concurrent updates for the same member.
      const { rows } = await pool.query(
        `INSERT INTO community_bot_levels (guild_id,user_id,xp,level,last_xp_at,last_hash)
         VALUES ($1,$2,20,0,$4,$3)
         ON CONFLICT (guild_id,user_id) DO UPDATE SET
           xp = community_bot_levels.xp + 20,
           level = floor((sqrt(10000::numeric + 100 * (community_bot_levels.xp + 20)) - 100) / 50)::int,
           last_xp_at = EXCLUDED.last_xp_at, last_hash = EXCLUDED.last_hash
         WHERE EXCLUDED.last_xp_at - community_bot_levels.last_xp_at >= 60000
           AND community_bot_levels.last_hash <> EXCLUDED.last_hash
         RETURNING *`, [guildId, userId, hash, now],
      );
      return rows[0] ?? null;
    },
    async member(guildId, userId) {
      const { rows } = await pool.query(
        `SELECT *, (SELECT count(*) + 1 FROM community_bot_levels b
          WHERE b.guild_id = $1 AND (b.xp > a.xp OR (b.xp = a.xp AND b.user_id < a.user_id))) AS rank
         FROM community_bot_levels a WHERE guild_id = $1 AND user_id = $2`, [guildId, userId],
      );
      return rows[0] ?? { xp: 0, level: 0, rank: null };
    },
    async top(guildId) {
      const { rows } = await pool.query(
        "SELECT user_id,xp,level FROM community_bot_levels WHERE guild_id=$1 ORDER BY xp DESC,user_id ASC LIMIT 10",
        [guildId],
      );
      return rows;
    },
    async pending(now = Date.now()) {
      const { rows } = await pool.query(
        `SELECT * FROM community_bot_levels WHERE (notified_level < level OR roles_level < level)
         AND next_attempt_at <= $1 ORDER BY next_attempt_at ASC,last_xp_at ASC LIMIT 50`, [now],
      );
      return rows;
    },
    async defer(guildId, userId, until) {
      await pool.query(
        "UPDATE community_bot_levels SET next_attempt_at=$3 WHERE guild_id=$1 AND user_id=$2",
        [guildId, userId, until],
      );
    },
    async resetRoles(guildId) {
      await pool.query("UPDATE community_bot_levels SET roles_level=0,next_attempt_at=0 WHERE guild_id=$1 AND level>0", [guildId]);
    },
    async acknowledge(guildId, userId, level, kind) {
      const column = kind === "roles" ? "roles_level" : "notified_level";
      await pool.query(
        `UPDATE community_bot_levels SET ${column}=GREATEST(${column},$3)
         WHERE guild_id=$1 AND user_id=$2`, [guildId, userId, level],
      );
    },
  };
}
