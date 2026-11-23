import { EmbedBuilder } from "discord.js";
import { getGuildSettings } from "./storage.js";
import { clampText } from "./format.js";

const LOG_COLOR = 0x5865f2;
const ALERT_COLOR = 0xed4245;

export async function sendModerationLog(guild, details) {
  const settings = await getGuildSettings(guild.id);
  if (!settings.logChannelId) return;

  const channel =
    guild.channels.cache.get(settings.logChannelId) ||
    (await guild.channels.fetch(settings.logChannelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(details.color ?? LOG_COLOR)
    .setTitle(clampText(details.title, 256))
    .setTimestamp(new Date())
    .addFields(
      { name: "Moderator", value: details.moderator ? `<@${details.moderator}>` : "Automatic", inline: true },
      { name: "Member", value: details.member ? `<@${details.member}>` : "Not available", inline: true },
      { name: "Details", value: clampText(details.reason || "No reason provided.", 1000) },
    );

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

export async function sendSecurityAlert(guild, title, description) {
  const settings = await getGuildSettings(guild.id);
  let channel = settings.logChannelId
    ? guild.channels.cache.get(settings.logChannelId) ||
      (await guild.channels.fetch(settings.logChannelId).catch(() => null))
    : null;

  if (!channel?.isTextBased()) channel = guild.systemChannel;
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(ALERT_COLOR)
    .setTitle(clampText(title, 256))
    .setDescription(clampText(description, 3500))
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}
