import { EmbedBuilder } from "discord.js";
import { getGuildSettings } from "./storage.js";
import { replyToMessage } from "./message-delivery.js";

export const colors = { primary: 0x5865f2, success: 0x2d9d78, warning: 0xd69a32, error: 0xd95360 };

export function createCard(message, {
  title = "Community bot",
  description,
  color = colors.primary,
  fields = [],
  footer,
} = {}) {
  const bot = message.client.user;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: bot.username || "Community bot", iconURL: bot.displayAvatarURL() })
    .setTitle(title.slice(0, 256))
    .setFooter({ text: (footer || message.guild.name).slice(0, 2048) })
    .setTimestamp();
  if (description) embed.setDescription(description.slice(0, 4096));
  if (fields.length) embed.addFields(fields);
  return embed;
}

export async function replyCard(message, content, options = {}) {
  const { prefix } = await getGuildSettings(message.guild.id);
  const description = content.replaceAll("`f", `\`${prefix}`);
  const needsInput = /usage:|choose |example:|ask a question/i.test(content);
  const blocked = /can't|couldn't|need staff|need .*permission|isn't|under |already|no .*yet/i.test(content);
  const embed = createCard(message, {
    title: needsInput ? "How to use this command" : blocked ? "Check this first" : "Command complete",
    color: needsInput || blocked ? colors.warning : colors.success,
    ...options,
    description,
  });
  return replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
}
