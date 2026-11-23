import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
} from "drizzle-orm/pg-core";

export const communityBotGuildSettingsTable = pgTable(
  "community_bot_guild_settings",
  {
    guildId: text("guild_id").primaryKey(),
    settingsJson: jsonb("settings_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
);

export const insertCommunityBotGuildSettingsSchema = createInsertSchema(
  communityBotGuildSettingsTable,
);
export type InsertCommunityBotGuildSettings = z.infer<
  typeof insertCommunityBotGuildSettingsSchema
>;
export type CommunityBotGuildSettings =
  typeof communityBotGuildSettingsTable.$inferSelect;

export const communityBotWarningsTable = pgTable(
  "community_bot_warnings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("community_bot_warnings_member_idx").on(
      table.guildId,
      table.userId,
      table.createdAt,
    ),
  ],
);

export const insertCommunityBotWarningSchema = createInsertSchema(
  communityBotWarningsTable,
).omit({ id: true });
export type InsertCommunityBotWarning = z.infer<
  typeof insertCommunityBotWarningSchema
>;
export type CommunityBotWarning = typeof communityBotWarningsTable.$inferSelect;

export const communityBotEconomyTable = pgTable(
  "community_bot_economy",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    points: integer("points").notNull().default(0),
    dailyAt: bigint("daily_at", { mode: "number" }).notNull().default(0),
    activityAt: bigint("activity_at", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const insertCommunityBotEconomySchema = createInsertSchema(
  communityBotEconomyTable,
);
export type InsertCommunityBotEconomy = z.infer<
  typeof insertCommunityBotEconomySchema
>;
export type CommunityBotEconomy = typeof communityBotEconomyTable.$inferSelect;

export const communityBotChannelLocksTable = pgTable(
  "community_bot_channel_locks",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    everyoneSendState: text("everyone_send_state").notNull(),
  },
);

export const insertCommunityBotChannelLockSchema = createInsertSchema(
  communityBotChannelLocksTable,
);
export type InsertCommunityBotChannelLock = z.infer<
  typeof insertCommunityBotChannelLockSchema
>;
export type CommunityBotChannelLock =
  typeof communityBotChannelLocksTable.$inferSelect;
