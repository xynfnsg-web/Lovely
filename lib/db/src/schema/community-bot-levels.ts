import { bigint, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const communityBotLevelsTable = pgTable("community_bot_levels", {
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  xp: bigint("xp", { mode: "number" }).notNull().default(0),
  level: integer("level").notNull().default(0),
  lastXpAt: bigint("last_xp_at", { mode: "number" }).notNull().default(0),
  lastHash: text("last_hash").notNull().default(""),
  notifiedLevel: integer("notified_level").notNull().default(0),
  rolesLevel: integer("roles_level").notNull().default(0),
  nextAttemptAt: bigint("next_attempt_at", { mode: "number" }).notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.userId] }),
  index("community_bot_levels_ranking_idx").on(table.guildId, table.xp),
]);
