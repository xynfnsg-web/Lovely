import { ChannelType, PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import { channelIdFrom, hasStaffAccess, userIdFrom } from "./format.js";
import { getGuildSettings, updateGuildSettings } from "./storage.js";
import { replyCard, createCard } from "./presentation.js";
import { replyToMessage } from "./message-delivery.js";
import { levelService } from "./level-service.js";
import { DEFAULT_LEVEL_ROLES, levelProgress } from "./level-rules.js";

export function createLevelCommands({
  service = levelService, getSettings = getGuildSettings, saveSettings = updateGuildSettings,
  say = replyCard, reply = replyToMessage,
} = {}) {
  const queues = new Map();
  async function serialize(guildId, action) {
    const previous = queues.get(guildId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(guildId, next);
    try { return await next; }
    finally { if (queues.get(guildId) === next) queues.delete(guildId); }
  }
  async function staff(message) {
    if (hasStaffAccess(message.member, PermissionFlagsBits.ManageGuild, config.staffRoleIds)) return true;
    await say(message, "You need Manage Server or a configured staff role to change leveling settings.");
    return false;
  }
  async function channelFor(message, input) {
    const id = channelIdFrom(input);
    if (!id) return null;
    const channel = message.guild.channels.cache.get(id) ?? await message.guild.channels.fetch(id).catch(() => null);
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type)) return null;
    return channel.permissionsFor(message.guild.members.me)?.has([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
    ]) ? channel : null;
  }
  async function createRoles(message, milestones) {
    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return { error: "Give the bot **Manage Roles** and place its role above the level roles, then try again." };
    }
    let settings = await getSettings(message.guild.id);
    let roles = { ...settings.levelRoles };
    if (new Set([...Object.keys(roles), ...milestones.map(String)]).size > 20) {
      return { error: "Use at most 20 level milestones. Remove an old mapping with `flevelroles remove <level>` first." };
    }
    // Save after each create: a later Discord failure doesn't lose mappings
    // for roles that were already created. Never reuse a role just by name.
    for (const level of milestones) {
      let role = roles[level] ? await message.guild.roles.fetch(roles[level]) : null;
      if (role && (role.managed || role.id === message.guild.id || role.permissions.bitfield !== 0n || !role.editable)) {
        return { error: `The saved Level ${level} role must have no permissions and sit below the bot. Fix it, or remove its mapping before creating a replacement.` };
      }
      if (!role) {
        role = await message.guild.roles.create({
          name: `Level ${level}`, color: 0x9b87f5, permissions: [],
          mentionable: false, hoist: false, reason: "Community leveling milestone",
        });
        roles = { ...roles, [level]: role.id };
        await saveSettings(message.guild.id, { levelRoles: roles });
      }
    }
    await service.store.resetRoles(message.guild.id);
    void service.flush();
    return { levels: milestones.join(", ") };
  }
  async function rank(message, args) {
    const targetId = message.mentions.users.first()?.id || userIdFrom(args[0]) || message.author.id;
    const member = message.guild.members.cache.get(targetId) ?? await message.guild.members.fetch(targetId).catch(() => null);
    if (!member) return say(message, "That user isn't a member of this server.");
    const data = await service.store.member(message.guild.id, targetId);
    const xp = Number(data.xp), progress = levelProgress(xp);
    const settings = await getSettings(message.guild.id);
    return reply(message, {
      embeds: [createCard(message, {
        title: `${member.displayName} · Level ${progress.level}`,
        description: `**${progress.bar}**\n${progress.remaining.toLocaleString()} XP until Level ${progress.level + 1}`,
        color: 0x9b87f5,
        fields: [
          { name: "Total XP", value: xp.toLocaleString(), inline: true },
          { name: "Server rank", value: data.rank ? `#${data.rank}` : "Not ranked yet", inline: true },
        ],
        footer: settings.levelsEnabled ? "20 XP per eligible message · Once per minute · XP cannot be wagered" : "Leveling is paused · Your progress is saved",
      }).setThumbnail(member.user.displayAvatarURL({ size: 128 }))],
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
  async function top(message) {
    const rows = await service.store.top(message.guild.id);
    return reply(message, {
      embeds: [createCard(message, {
        title: "Chat leaderboard", color: 0x9b87f5,
        description: rows.length ? rows.map((row, i) =>
          `**${i + 1}.** <@${row.user_id}> · **Level ${row.level}**\n${Number(row.xp).toLocaleString()} XP`).join("\n\n")
          : "No chat XP yet. Start a conversation to earn your first level!",
        footer: "Chat XP is separate from spendable community points",
      })], allowedMentions: { parse: [], repliedUser: false },
    });
  }
  async function configure(message, args, kind) {
    if (!await staff(message)) return;
    return serialize(message.guild.id, async () => {
      const input = args[0]?.toLowerCase();
      if (kind === "levels") {
        if (["on", "off"].includes(input)) {
          await saveSettings(message.guild.id, { levelsEnabled: input === "on" });
          if (input === "on") void service.flush();
          return say(message, `Leveling is ${input === "on" ? "enabled" : "paused"}. Existing XP and roles are kept.`);
        }
        const settings = await getSettings(message.guild.id);
        const roles = Object.entries(settings.levelRoles || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
        return say(message,
          `**XP:** ${settings.levelsEnabled ? "On" : "Paused"} · 20 XP per minute of eligible chatting\n` +
          `**Announcements:** ${settings.levelChannelId ? `<#${settings.levelChannelId}>` : "Off"}\n` +
          `**Milestones:** ${roles.length ? roles.map(([level, id]) => `Level ${level}: <@&${id}>`).join(", ") : "Not created yet"}\n\n` +
          "Use `flevelsetup #channel`, `flevelchannel #channel|off`, `flevelroles 15 25`, or `flevels on|off`.",
          { title: "Leveling settings" });
      }
      if (kind === "levelroles") {
        if (input === "remove") {
          const level = Number(args[1]);
          const settings = await getSettings(message.guild.id);
          if (!Number.isInteger(level) || !settings.levelRoles?.[level]) return say(message, "Usage: `flevelroles remove <configured level>`");
          const roles = { ...settings.levelRoles };
          delete roles[level];
          await saveSettings(message.guild.id, { levelRoles: roles });
          return say(message, `Level ${level} is no longer a reward. The Discord role and members' existing roles were not deleted.`);
        }
        const milestones = args.length ? [...new Set(args.map(Number))] : DEFAULT_LEVEL_ROLES;
        if (milestones.length > 20 || milestones.some((level) => !Number.isInteger(level) || level < 1 || level > 500)) {
          return say(message, "Usage: `flevelroles 5 15 25` (up to 20 unique levels, from 1 to 500). No arguments creates the default milestones.");
        }
        const result = await createRoles(message, milestones.sort((a, b) => a - b));
        return say(message, result.error ?? `Milestone roles ready: **${result.levels}**.\nMembers keep every milestone they earn. Place the bot's role above these roles.`);
      }
      if (kind === "levelchannel" && input === "off") {
        await saveSettings(message.guild.id, { levelChannelId: null });
        return say(message, "Level-up announcements are off. Members can still earn XP and roles.");
      }
      const channel = await channelFor(message, args[0]);
      if (!channel) return say(message, "Mention a server text channel where the bot has View Channel, Send Messages and Embed Links. Example: `flevelchannel #levels`.");
      if (kind === "levelsetup") {
        const settings = await getSettings(message.guild.id);
        const milestones = Object.keys(settings.levelRoles || {}).length
          ? Object.keys(settings.levelRoles).map(Number) : DEFAULT_LEVEL_ROLES;
        const result = await createRoles(message, milestones);
        if (result.error) return say(message, result.error);
        await saveSettings(message.guild.id, { levelsEnabled: true, levelChannelId: channel.id });
        void service.flush();
        return say(message, `**Leveling is ready!**\nLevel-up mentions go to <#${channel.id}>.\nMilestone roles: **${result.levels}**.\nMembers earn 20 XP per minute of eligible chatting. Use \`frank\` to check progress.`, { title: "Leveling setup complete" });
      }
      await saveSettings(message.guild.id, { levelChannelId: channel.id });
      return say(message, `Level-up announcements will mention members in <#${channel.id}>.`);
    });
  }
  return { rank, top, configure };
}

export const levelCommands = createLevelCommands();
