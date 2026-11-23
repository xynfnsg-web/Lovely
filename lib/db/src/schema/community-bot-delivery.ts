import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// No message contents, member identifiers, or AI prompts are retained here.
export const communityBotMessageReceiptsTable = pgTable("community_bot_message_receipts", {
  messageId: text("message_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("community_bot_message_receipts_created_at_idx").on(table.createdAt)]);
