import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const communityBotGameRoundsTable = pgTable("community_bot_game_rounds", {
  messageId: text("message_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  game: text("game").notNull(),
  stake: integer("stake").notNull(),
  payout: integer("payout").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const communityBotGameSessionsTable = pgTable("community_bot_game_sessions", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  channelId: text("channel_id").notNull(),
  replyId: text("reply_id"),
  game: text("game").notNull(),
  stake: integer("stake").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  balanceAfter: integer("balance_after").notNull(),
}, (table) => [
  uniqueIndex("community_bot_one_active_game").on(table.guildId, table.userId).where(sql`${table.status} = 'active'`),
  index("community_bot_game_expiry").on(table.expiresAt).where(sql`${table.status} = 'active'`),
]);
