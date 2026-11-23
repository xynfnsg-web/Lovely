import { PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import { channelIdFrom, hasStaffAccess, fillTemplate } from "./format.js";
import { getGuildSettings, updateGuildSettings } from "./storage.js";
import { sendModerationLog } from "./logging.js";
import { replyCard as say, createCard } from "./presentation.js";
import { replyToMessage } from "./message-delivery.js";

function requireStaff(message, action) {
  const allowed = hasStaffAccess(
    message.member,
    PermissionFlagsBits.ManageGuild,
    config.staffRoleIds,
  );
  if (!allowed) void say(message, `You need staff access to ${action}.`);
  return allowed;
}

async function resolveTextChannel(message, input) {
  const channelId = channelIdFrom(input);
  if (!channelId) return null;
  const channel =
    message.guild.channels.cache.get(channelId) ||
    (await message.guild.channels.fetch(channelId).catch(() => null));
  return channel?.isTextBased() ? channel : null;
}

export async function prefixCommand(message, args) {
  if (!requireStaff(message, "change the bot prefix")) return;
  const prefix = args[0]?.trim();
  if (!prefix || prefix.length > 5 || /\s/.test(prefix) || prefix.includes("@")) {
    return say(message, "Usage: `fprefix <new-prefix>` (1-5 characters, no spaces).");
  }
  await updateGuildSettings(message.guild.id, { prefix });
  await say(message, `Prefix changed to \`${prefix}\` for this server.`);
}

export async function logChannelCommand(message, args) {
  if (!requireStaff(message, "change the logging channel")) return;
  const input = args[0];
  if (!input) return say(message, "Usage: `flog #channel` or `flog off`");
  if (input.toLowerCase() === "off") {
    await updateGuildSettings(message.guild.id, { logChannelId: null });
    return say(message, "Moderation and security logging is disabled.");
  }
  const channel = await resolveTextChannel(message, input);
  if (!channel) return say(message, "Mention a text channel, such as `flog #mod-logs`.");
  await updateGuildSettings(message.guild.id, { logChannelId: channel.id });
  await say(message, `Moderation and security logs will be sent to <#${channel.id}>.`);
}

export async function welcomeChannelCommand(message, args, kind) {
  if (!requireStaff(message, `configure ${kind} messages`)) return;
  const input = args[0];
  const channelKey = kind === "welcome" ? "welcomeChannelId" : "goodbyeChannelId";
  const templateKey = kind === "welcome" ? "welcomeTemplate" : "goodbyeTemplate";
  if (!input) {
    return say(
      message,
      `Usage: \`f${kind} #channel [message template]\` or \`f${kind} off\`. Use {user}, {username}, and {server} in the message.`,
    );
  }
  if (input.toLowerCase() === "off") {
    await updateGuildSettings(message.guild.id, { [channelKey]: null });
    return say(message, `${kind === "welcome" ? "Welcome" : "Goodbye"} messages are disabled.`);
  }

  const channel = await resolveTextChannel(message, input);
  if (!channel) return say(message, "Mention a text channel, for example `#general`.");

  const settings = await getGuildSettings(message.guild.id);
  const template = args.slice(1).join(" ").trim();
  const patch = { [channelKey]: channel.id };
  if (template) patch[templateKey] = template.slice(0, 300);
  await updateGuildSettings(message.guild.id, patch);

  await say(
    message,
    `${kind === "welcome" ? "Welcome" : "Goodbye"} messages will be sent to <#${channel.id}>.${template ? "" : ` Current message: ${settings[templateKey]}`}`,
  );
}

export async function responseCommand(message, args) {
  if (!requireStaff(message, "customize bot messages")) return;
  const kind = args[0]?.toLowerCase();
  const template = args.slice(1).join(" ").trim();
  const key = {
    welcome: "welcomeTemplate",
    goodbye: "goodbyeTemplate",
    spam: "spamNoticeTemplate",
    spamtimeout: "spamTimeoutTemplate",
  }[kind];
  if (!key || !template) {
    return say(
      message,
      "Usage: `fresponse welcome|goodbye|spam|spamtimeout <message>`. Placeholders: `{user}`, `{username}`, `{server}`.",
    );
  }

  await updateGuildSettings(message.guild.id, { [key]: template.slice(0, 300) });
  await say(message, `Custom ${kind} response saved.`);
}

export async function announceCommand(message, args) {
  if (!requireStaff(message, "send announcements")) return;
  const channel = await resolveTextChannel(message, args[0]);
  const content = args.slice(1).join(" ").trim();
  if (!channel || !content) {
    return say(message, "Usage: `fannounce #channel <announcement>`");
  }
  if (content.length > 1900) return say(message, "Keep announcements under 1900 characters.");

  await channel.send({
    content,
    allowedMentions: { parse: [] },
  });
  await sendModerationLog(message.guild, {
    title: "Announcement sent",
    moderator: message.author.id,
    reason: `Sent to <#${channel.id}>.`,
  });
  await say(message, `Announcement sent to <#${channel.id}>.`);
}

export async function securityCommand(message, args) {
  if (!requireStaff(message, "change security settings")) return;
  const settings = await getGuildSettings(message.guild.id);
  const topic = args[0]?.toLowerCase();
  const value = args[1]?.toLowerCase();
  const switchValue = value === "on" ? true : value === "off" ? false : null;

  if (!topic || topic === "status") {
    const embed = createCard(message, { title: "Security control panel" })
      .setColor(0x5865f2)
      .addFields(
        { name: "Join alerts", value: settings.raidEnabled ? "On" : "Off", inline: true },
        {
          name: "Join threshold",
          value: `${settings.joinThreshold} joins / ${settings.joinWindowSeconds}s`,
          inline: true,
        },
        { name: "Auto verification", value: settings.autoVerification ? "On" : "Off", inline: true },
        { name: "Spam filter", value: settings.spamEnabled ? "On" : "Off", inline: true },
        {
          name: "Spam threshold",
          value: `${settings.spamMaxMessages} messages / ${settings.spamWindowSeconds}s`,
          inline: true,
        },
        { name: "Repeat threshold", value: `${settings.repeatThreshold} matching messages`, inline: true },
        { name: "Auto-timeout", value: settings.autoTimeout ? "On" : "Off", inline: true },
      );
    return replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [] } });
  }

  if (["raid", "spam", "autoverify", "autotimeout"].includes(topic)) {
    if (switchValue === null) {
      return say(message, `Usage: \`fsecurity ${topic} on|off\``);
    }
    const key = {
      raid: "raidEnabled",
      spam: "spamEnabled",
      autoverify: "autoVerification",
      autotimeout: "autoTimeout",
    }[topic];
    await updateGuildSettings(message.guild.id, { [key]: switchValue });
    if (topic === "autoverify" && switchValue) {
      const botCanManageGuild = message.guild.members.me?.permissions.has(
        PermissionFlagsBits.ManageGuild,
      );
      if (!botCanManageGuild) {
        return say(
          message,
          "Auto-verification is saved, but the bot needs Manage Server permission to change the server verification level.",
        );
      }
    }
    return say(message, `${topic} protection is now ${switchValue ? "on" : "off"}.`);
  }

  if (topic === "threshold") {
    const count = Number(args[1]);
    const seconds = Number(args[2]);
    if (
      !Number.isInteger(count) ||
      count < 3 ||
      count > 100 ||
      !Number.isInteger(seconds) ||
      seconds < 5 ||
      seconds > 120
    ) {
      return say(message, "Usage: `fsecurity threshold <3-100 joins> <5-120 seconds>`");
    }
    await updateGuildSettings(message.guild.id, {
      joinThreshold: count,
      joinWindowSeconds: seconds,
    });
    return say(message, `Join alerts trigger at ${count} joins within ${seconds} seconds.`);
  }

  if (topic === "spamlimit") {
    const count = Number(args[1]);
    const seconds = Number(args[2]);
    if (
      !Number.isInteger(count) ||
      count < 2 ||
      count > 50 ||
      !Number.isInteger(seconds) ||
      seconds < 2 ||
      seconds > 60
    ) {
      return say(message, "Usage: `fsecurity spamlimit <2-50 messages> <2-60 seconds>`");
    }
    await updateGuildSettings(message.guild.id, {
      spamMaxMessages: count,
      spamWindowSeconds: seconds,
    });
    return say(message, `Spam alerts trigger above ${count} messages in ${seconds} seconds.`);
  }

  if (topic === "repeats") {
    const count = Number(args[1]);
    if (!Number.isInteger(count) || count < 2 || count > 10) {
      return say(message, "Usage: `fsecurity repeats <2-10>`");
    }
    await updateGuildSettings(message.guild.id, { repeatThreshold: count });
    return say(message, `Repeated-message detection now triggers at ${count} matching messages.`);
  }

  return say(
    message,
    "Use `fsecurity status`, `raid on|off`, `spam on|off`, `autoverify on|off`, `autotimeout on|off`, `threshold <joins> <seconds>`, `spamlimit <messages> <seconds>`, or `repeats <count>`.",
  );
}

export async function settingsCommand(message) {
  const settings = await getGuildSettings(message.guild.id);
  const embed = createCard(message, { title: "Server configuration" })
    .setColor(0x5865f2)
    .addFields(
      { name: "Prefix", value: `\`${settings.prefix}\``, inline: true },
      {
        name: "Log channel",
        value: settings.logChannelId ? `<#${settings.logChannelId}>` : "Not configured",
        inline: true,
      },
      {
        name: "Welcome channel",
        value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : "Off",
        inline: true,
      },
      {
        name: "Goodbye channel",
        value: settings.goodbyeChannelId ? `<#${settings.goodbyeChannelId}>` : "Off",
        inline: true,
      },
      {
        name: "AI chat",
        value: `${settings.chatEnabled ? "On" : "Off"} · ${config.aiReady ? "Configured" : "Connection unavailable"}`,
        inline: true,
      },
      {
        name: "Chat leveling",
        value: `${settings.levelsEnabled ? "On" : "Paused"} · ${settings.levelChannelId ? `<#${settings.levelChannelId}>` : "Announcements off"}`,
        inline: true,
      },
    );
  await replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [] } });
}

export async function postWelcome(member, kind) {
  const settings = await getGuildSettings(member.guild.id);
  const channelId = kind === "welcome" ? settings.welcomeChannelId : settings.goodbyeChannelId;
  if (!channelId) return;
  const channel =
    member.guild.channels.cache.get(channelId) ||
    (await member.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const template = kind === "welcome" ? settings.welcomeTemplate : settings.goodbyeTemplate;
  const content = fillTemplate(template, member);
  await channel
    .send({
      content,
      allowedMentions: kind === "welcome" ? { parse: [], users: [member.id] } : { parse: [] },
    })
    .catch(() => {});
}

export function getAdminHelp() {
  return [
    "`fprefix <prefix>`",
    "`flog #channel|off`",
    "`fwelcome #channel [message]|off`",
    "`fgoodbye #channel [message]|off`",
    "`fresponse welcome|goodbye|spam|spamtimeout <message>`",
    "`fannounce #channel <message>`",
    "`fsecurity status`",
    "`fsecurity raid|spam|autoverify|autotimeout on|off`",
    "`fsecurity threshold <joins> <seconds>`",
    "`fsecurity spamlimit <messages> <seconds>`",
    "`fsecurity repeats <count>`",
    "`fsettings`",
  ].join("\n");
}
