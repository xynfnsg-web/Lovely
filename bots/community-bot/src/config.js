import "dotenv/config";

const safePrefix = process.env.BOT_PREFIX?.trim();

export const config = {
  token: process.env.DISCORD_TOKEN,
  databaseUrl: process.env.DATABASE_URL,
  aiReady: Boolean(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
  aiModel: process.env.AI_MODEL?.trim() || "gpt-5.4-mini",
  defaultPrefix:
    safePrefix && safePrefix.length <= 5 && !/\s/.test(safePrefix)
      ? safePrefix
      : "f",
  staffRoleIds: (process.env.STAFF_ROLE_IDS || "")
    .split(",")
    .map((roleId) => roleId.trim())
    .filter(Boolean),
  defaultJoinThreshold: 8,
  defaultJoinWindowSeconds: 10,
  defaultSpamMaxMessages: 5,
  defaultSpamWindowSeconds: 8,
};

export function validateConfig() {
  if (!config.token) {
    throw new Error(
      "DISCORD_TOKEN is missing. Add it in Replit Secrets or your local .env file.",
    );
  }
}
