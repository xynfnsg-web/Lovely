import { createHash } from "node:crypto";

export const DEFAULT_LEVEL_ROLES = [5, 10, 15, 25, 50, 75, 100];
export const XP_PER_MESSAGE = 20;
export function xpForLevel(level) { return 25 * level * level + 100 * level; }
export function levelForXp(xp) {
  return Math.max(0, Math.floor((Math.sqrt(10000 + 100 * Math.max(0, xp)) - 100) / 50));
}
export function levelProgress(xp) {
  const level = levelForXp(xp);
  const floor = xpForLevel(level), next = xpForLevel(level + 1);
  const fraction = (xp - floor) / (next - floor);
  const filled = Math.min(10, Math.max(0, Math.floor(fraction * 10)));
  return { level, next, remaining: next - xp, bar: "▰".repeat(filled) + "▱".repeat(10 - filled) };
}
export function xpFingerprint(message, settings) {
  if (!settings.levelsEnabled || !message.guild || !message.member || message.author.bot ||
      message.webhookId || message.system || message.content.startsWith(settings.prefix)) return null;
  const text = message.content.toLowerCase().replace(/<[@#][!&]?\d+>/g, "")
    .replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if ((text.match(/[\p{L}\p{N}]/gu) || []).length < 5) return null;
  return createHash("sha256").update(text).digest("hex");
}
export function levelNonce(guildId, userId, level) {
  return createHash("sha256").update(`level:${guildId}:${userId}:${level}`).digest("hex").slice(0, 24);
}
