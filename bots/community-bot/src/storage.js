import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { createSettingsCache } from "./settings-cache.js";

const { Pool } = pg;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS community_bot_guild_settings (
  guild_id TEXT PRIMARY KEY,
  settings_json JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS community_bot_warnings (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS community_bot_warnings_member_idx ON community_bot_warnings (guild_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS community_bot_economy (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  daily_at BIGINT NOT NULL DEFAULT 0,
  activity_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_bot_channel_locks (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  everyone_send_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_bot_game_rounds (
  message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  stake INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_bot_game_sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  reply_id TEXT,
  game TEXT NOT NULL,
  stake INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  state JSONB NOT NULL,
  expires_at BIGINT NOT NULL,
  balance_after INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS community_bot_message_receipts (
  message_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_bot_levels (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  last_xp_at BIGINT NOT NULL DEFAULT 0,
  last_hash TEXT NOT NULL DEFAULT '',
  notified_level INTEGER NOT NULL DEFAULT 0,
  roles_level INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
`;

class LocalPGPool {
  constructor(pglite) {
    this.pglite = pglite;
  }
  async query(sql, params) {
    const res = await this.pglite.query(sql, params);
    return {
      rows: res.rows,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  }
  async connect() {
    return {
      query: (sql, params) => this.query(sql, params),
      release: () => {},
      on: () => {},
      removeListener: () => {},
    };
  }
  on() {}
  async end() {
    await this.pglite.close();
  }
}

function createDatabase() {
  if (
    config.databaseUrl &&
    !config.databaseUrl.includes("local") &&
    !config.databaseUrl.includes("dummy") &&
    !config.databaseUrl.includes("embedded") &&
    !config.databaseUrl.includes("none")
  ) {
    return new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
    });
  }
  const pglite = new PGlite();
  return new LocalPGPool(pglite);
}

export const database = createDatabase();

export async function verifyStorage() {
  if (database.pglite) {
    await database.pglite.exec(SCHEMA_SQL);
  }
  // Validate required tables/columns in one round trip, without reading their rows.
  await database.query(`SELECT s.guild_id, w.id, e.guild_id, l.channel_id, r.message_id,
      t.id, t.state, t.expires_at, t.version, t.status, t.balance_after, m.message_id,
      x.xp, x.level, x.last_xp_at, x.last_hash, x.notified_level, x.roles_level, x.next_attempt_at
    FROM community_bot_guild_settings s
    CROSS JOIN community_bot_warnings w
    CROSS JOIN community_bot_economy e
    CROSS JOIN community_bot_channel_locks l
    CROSS JOIN community_bot_game_rounds r
    CROSS JOIN community_bot_game_sessions t
    CROSS JOIN community_bot_message_receipts m
    CROSS JOIN community_bot_levels x
    LIMIT 0`);
}

export async function ensureGuildSettings(guildIds) {
  if (guildIds.length === 0) return;
  // Real server configuration, not placeholder data. Never replace staff settings.
  await database.query(
    `INSERT INTO community_bot_guild_settings (guild_id, settings_json)
     SELECT guild_id, '{}'::jsonb
     FROM unnest($1::text[]) AS guilds(guild_id)
     WHERE true
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildIds],
  );
}

database.on("error", (error) => {
  process.stderr.write(
    `[database] ${String(error?.message || error).slice(0, 500)}\n`,
  );
});

const defaultSettings = {
  chatEnabled: true,
  personality: "Friendly, welcoming, encouraging, and helpful. Use clear everyday language and light humor.",
  prefix: config.defaultPrefix,
  logChannelId: null,
  welcomeChannelId: null,
  goodbyeChannelId: null,
  welcomeTemplate: "Welcome {user} to {server}!",
  goodbyeTemplate: "{user} has left {server}.",
  raidEnabled: true,
  joinThreshold: config.defaultJoinThreshold,
  joinWindowSeconds: config.defaultJoinWindowSeconds,
  autoVerification: false,
  spamEnabled: true,
  spamMaxMessages: config.defaultSpamMaxMessages,
  spamWindowSeconds: config.defaultSpamWindowSeconds,
  repeatThreshold: 3,
  autoTimeout: true,
  spamNoticeTemplate: "{user}, your message was removed by the spam filter.",
  spamTimeoutTemplate: "{user} was timed out for repeated spam.",
  verificationRestoreAt: 0,
  verificationPrevious: null,
  levelsEnabled: true,
  levelChannelId: null,
  levelRoles: {},
};

function normalizeEconomy(row) {
  return {
    points: Number(row?.points ?? 0),
    daily_at: Number(row?.daily_at ?? 0),
    activity_at: Number(row?.activity_at ?? 0),
  };
}

const settingsCache = createSettingsCache({
  load: async (guildId) => {
    const { rows } = await database.query(
      "SELECT settings_json FROM community_bot_guild_settings WHERE guild_id = $1",
      [guildId],
    );
    return { ...defaultSettings, ...(rows[0]?.settings_json || {}) };
  },
});

export function getGuildSettings(guildId) {
  return settingsCache.get(guildId);
}

export async function updateGuildSettings(guildId, patch) {
  const { rows } = await database.query(
    `INSERT INTO community_bot_guild_settings (guild_id, settings_json)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (guild_id) DO UPDATE
       SET settings_json = community_bot_guild_settings.settings_json || EXCLUDED.settings_json
     RETURNING settings_json`,
    [guildId, JSON.stringify(patch)],
  );
  return settingsCache.set(guildId, { ...defaultSettings, ...rows[0].settings_json });
}

export async function addWarning(guildId, userId, moderatorId, reason, createdAt = Date.now()) {
  const { rows } = await database.query(
    `INSERT INTO community_bot_warnings (guild_id, user_id, moderator_id, reason, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [guildId, userId, moderatorId, reason, createdAt],
  );
  return rows[0].id;
}

export async function getWarnings(guildId, userId, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 10)));
  const { rows } = await database.query(
    `SELECT id, moderator_id, reason, created_at
     FROM community_bot_warnings
     WHERE guild_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [guildId, userId, safeLimit],
  );
  return rows.map((row) => ({ ...row, created_at: Number(row.created_at) }));
}

export async function getWarningCount(guildId, userId) {
  const { rows } = await database.query(
    "SELECT COUNT(*)::int AS count FROM community_bot_warnings WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId],
  );
  return rows[0].count;
}

export async function getEconomy(guildId, userId) {
  const { rows } = await database.query(
    `SELECT points, daily_at, activity_at
     FROM community_bot_economy WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  return normalizeEconomy(rows[0]);
}

export async function awardActivityPoints(guildId, userId, now = Date.now()) {
  const { rowCount } = await database.query(
    `INSERT INTO community_bot_economy (guild_id, user_id, points, daily_at, activity_at)
     VALUES ($1, $2, 2, 0, $3)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       points = community_bot_economy.points + 2,
       activity_at = EXCLUDED.activity_at
     WHERE EXCLUDED.activity_at - community_bot_economy.activity_at >= 60000`,
    [guildId, userId, now],
  );
  return rowCount > 0;
}

export async function addPoints(guildId, userId, points) {
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error("Points must be a positive whole number.");
  }
  const { rows } = await database.query(
    `INSERT INTO community_bot_economy (guild_id, user_id, points, daily_at, activity_at)
     VALUES ($1, $2, $3, 0, 0)
     ON CONFLICT (guild_id, user_id) DO UPDATE
       SET points = community_bot_economy.points + EXCLUDED.points
     RETURNING points`,
    [guildId, userId, points],
  );
  return Number(rows[0].points);
}

export async function claimDaily(guildId, userId, now = Date.now()) {
  const cooldownMs = 24 * 60 * 60 * 1000;
  const { rows } = await database.query(
    `INSERT INTO community_bot_economy (guild_id, user_id, points, daily_at, activity_at)
     VALUES ($1, $2, 25, $3, 0)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       points = community_bot_economy.points + 25,
       daily_at = EXCLUDED.daily_at
     WHERE EXCLUDED.daily_at - community_bot_economy.daily_at >= $4
     RETURNING points`,
    [guildId, userId, now, cooldownMs],
  );
  if (rows[0]) return { claimed: true, nextAt: now + cooldownMs, points: Number(rows[0].points) };
  const economy = await getEconomy(guildId, userId);
  return {
    claimed: false,
    nextAt: economy.daily_at + cooldownMs,
    points: economy.points,
  };
}

export async function getLeaderboard(guildId, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 10)));
  const { rows } = await database.query(
    `SELECT user_id, points FROM community_bot_economy
     WHERE guild_id = $1 AND points > 0
     ORDER BY points DESC, user_id ASC
     LIMIT $2`,
    [guildId, safeLimit],
  );
  return rows;
}

export async function saveChannelLock(channelId, guildId, everyoneSendState) {
  await database.query(
    `INSERT INTO community_bot_channel_locks (channel_id, guild_id, everyone_send_state)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel_id) DO UPDATE SET
       guild_id = EXCLUDED.guild_id,
       everyone_send_state = EXCLUDED.everyone_send_state`,
    [channelId, guildId, everyoneSendState],
  );
}

export async function getChannelLock(channelId) {
  const { rows } = await database.query(
    "SELECT everyone_send_state FROM community_bot_channel_locks WHERE channel_id = $1",
    [channelId],
  );
  return rows[0];
}

export async function removeChannelLock(channelId) {
  await database.query(
    "DELETE FROM community_bot_channel_locks WHERE channel_id = $1",
    [channelId],
  );
}

export async function closeStorage() {
  await database.end();
}
