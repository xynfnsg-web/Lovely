import {
  PermissionFlagsBits,
} from "discord.js";
import { config } from "./config.js";
import { hasStaffAccess, parseDuration, readableDuration, userIdFrom } from "./format.js";
import {
  addWarning,
  getWarnings,
  getWarningCount,
  getGuildSettings,
  saveChannelLock,
  getChannelLock,
  removeChannelLock,
} from "./storage.js";
import { sendModerationLog } from "./logging.js";
import { replyCard as say, createCard, colors } from "./presentation.js";
import { replyToMessage, sendToMessageChannel } from "./message-delivery.js";

function requirePermission(message, permission, action) {
  if (hasStaffAccess(message.member, permission, config.staffRoleIds)) return true;
  void say(message, `You need staff access to ${action}.`);
  return false;
}

function getTargetId(input) {
  return userIdFrom(input);
}

async function getTargetMember(message, targetId, { allowMissing = false } = {}) {
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) return allowMissing ? null : undefined;

  if (member.id === message.author.id) {
    await say(message, "You can't use this command on yourself.");
    return undefined;
  }
  if (member.id === message.guild.ownerId) {
    await say(message, "This command can't be used on the server owner.");
    return undefined;
  }

  const authorIsAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
  if (
    !authorIsAdmin &&
    member.roles.highest.comparePositionTo(message.member.roles.highest) >= 0
  ) {
    await say(message, "Your highest role must be above the target member's highest role.");
    return undefined;
  }

  const botMember = message.guild.members.me;
  if (
    botMember &&
    member.roles.highest.comparePositionTo(botMember.roles.highest) >= 0
  ) {
    await say(message, "Move the bot's role above the target member's highest role.");
    return undefined;
  }
  return member;
}

function getReason(args, start = 1) {
  return args.slice(start).join(" ").trim().slice(0, 500) || "No reason provided.";
}

async function completeAction(message, title, targetId, reason, action) {
  await sendModerationLog(message.guild, {
    title,
    moderator: message.author.id,
    member: targetId,
    reason,
  });
  await say(message, `**Member** · <@${targetId}>\n**Action** · ${action}\n**Reason** · ${reason}`, { title, color: colors.success });
}

export async function banCommand(message, args) {
  if (!requirePermission(message, PermissionFlagsBits.BanMembers, "ban members")) return;
  const targetId = getTargetId(args[0]);
  if (!targetId) return say(message, "Usage: `fban @member [reason]`");
  if (targetId === message.author.id || targetId === message.guild.ownerId) {
    return say(message, "That member can't be banned with this command.");
  }
  const member = await getTargetMember(message, targetId, { allowMissing: true });
  if (!member && (await message.guild.members.fetch(targetId).catch(() => null))) return;

  const reason = getReason(args);
  await message.guild.members.ban(targetId, { reason });
  await completeAction(message, "Member banned", targetId, reason, "Banned");
}

export async function kickCommand(message, args) {
  if (!requirePermission(message, PermissionFlagsBits.KickMembers, "kick members")) return;
  const targetId = getTargetId(args[0]);
  if (!targetId) return say(message, "Usage: `fkick @member [reason]`");
  const member = await getTargetMember(message, targetId);
  if (!member) return say(message, "I couldn't find that member in this server.");

  const reason = getReason(args);
  await member.kick(reason);
  await completeAction(message, "Member kicked", targetId, reason, "Kicked");
}

export async function timeoutCommand(message, args, remove = false) {
  if (!requirePermission(message, PermissionFlagsBits.ModerateMembers, "manage timeouts")) return;
  const targetId = getTargetId(args[0]);
  if (!targetId) {
    return say(
      message,
      remove
        ? "Usage: `funtimeout @member [reason]`"
        : "Usage: `ftimeout @member <duration> [reason]` (for example: `15m`, `2h`, `1d`)",
    );
  }
  const member = await getTargetMember(message, targetId);
  if (!member) return say(message, "I couldn't find that member in this server.");

  const duration = remove ? null : parseDuration(args[1]);
  if (!remove && (!duration || duration > 28 * 24 * 60 * 60 * 1000)) {
    return say(message, "Choose a duration such as `15m`, `2h`, or `2d` (maximum 28 days).");
  }

  const reason = getReason(args, remove ? 1 : 2);
  await member.timeout(duration, reason);
  const action = remove ? "Timeout removed from" : `Timed out for ${readableDuration(duration)}`;
  await completeAction(
    message,
    remove ? "Timeout removed" : "Member timed out",
    targetId,
    reason,
    action,
  );
}

export async function warnCommand(message, args) {
  if (!requirePermission(message, PermissionFlagsBits.ModerateMembers, "warn members")) return;
  const targetId = getTargetId(args[0]);
  if (!targetId || !args.slice(1).join(" ").trim()) {
    return say(message, "Usage: `fwarn @member <reason>`");
  }
  const member = await getTargetMember(message, targetId, { allowMissing: true });
  if (!member && (await message.guild.members.fetch(targetId).catch(() => null))) return;

  const reason = getReason(args);
  const warningId = await addWarning(message.guild.id, targetId, message.author.id, reason);
  const total = await getWarningCount(message.guild.id, targetId);
  await sendModerationLog(message.guild, {
    title: "Member warned",
    moderator: message.author.id,
    member: targetId,
    reason: `Warning #${warningId} (${total} total): ${reason}`,
  });
  await say(message, `Warned <@${targetId}>. They now have ${total} warning(s).`);
}

export async function warningsCommand(message, args) {
  if (!requirePermission(message, PermissionFlagsBits.ModerateMembers, "view member warnings")) return;
  const targetId = getTargetId(args[0]);
  if (!targetId) return say(message, "Usage: `fwarnings @member`");
  const warnings = await getWarnings(message.guild.id, targetId, 10);
  const total = await getWarningCount(message.guild.id, targetId);
  if (!total) return say(message, `<@${targetId}> has no warnings.`);

  const embed = createCard(message, { title: "Member warning history", color: colors.warning })
    .setDescription(
      warnings
        .map((warning) => {
          const when = `<t:${Math.floor(warning.created_at / 1000)}:R>`;
           return `**Warning #${warning.id}** · ${when}\n${warning.reason.slice(0, 250)}\nModerator: <@${warning.moderator_id}>`;
        })
        .join("\n\n"),
    )
    .setFooter({ text: `${total} total warning(s); showing the latest ${warnings.length}` });
  await replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [] } });
}

export async function clearCommand(message, args) {
  if (!requirePermission(message, PermissionFlagsBits.ManageMessages, "clear messages")) return;
  if (!message.channel.isTextBased() || !message.channel.bulkDelete) {
    return say(message, "This command only works in a text channel.");
  }

  const amount = Number(args[0]);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    return say(message, "Usage: `fclear <1-100>`");
  }

  const deleted = await message.channel.bulkDelete(amount, true);
  const notice = await sendToMessageChannel(message, {
    embeds: [createCard(message, { title: "Channel cleaned up", description: `Removed **${deleted.size}** recent messages from this channel.`, color: colors.success })],
    allowedMentions: { parse: [] },
  });
  const timer = setTimeout(() => notice.delete().catch(() => {}), 5_000);
  timer.unref?.();
  await sendModerationLog(message.guild, {
    title: "Messages cleared",
    moderator: message.author.id,
    member: null,
    reason: `${deleted.size} messages in <#${message.channel.id}>.`,
  });
}

export async function slowmodeCommand(message, args) {
  if (!requirePermission(message, PermissionFlagsBits.ManageChannels, "change slowmode")) return;
  const seconds = Number(args[0]);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21_600) {
    return say(message, "Usage: `fslowmode <0-21600>` seconds. Use `0` to disable it.");
  }
  if (typeof message.channel.setRateLimitPerUser !== "function") {
    return say(message, "Slowmode isn't available in this channel.");
  }

  await message.channel.setRateLimitPerUser(seconds, `Changed by ${message.author.tag}`);
  await say(message, seconds ? `Slowmode set to ${seconds} second(s).` : "Slowmode disabled.");
  await sendModerationLog(message.guild, {
    title: "Slowmode changed",
    moderator: message.author.id,
    reason: `${seconds} seconds in <#${message.channel.id}>.`,
  });
}

export async function lockCommand(message) {
  if (!requirePermission(message, PermissionFlagsBits.ManageChannels, "lock channels")) return;
  if (!message.channel.permissionOverwrites) {
    return say(message, "This channel can't be locked by the bot.");
  }

  const everyone = message.guild.roles.everyone;
  const current = message.channel.permissionOverwrites.cache.get(everyone.id);
  const previousState = current?.allow.has(PermissionFlagsBits.SendMessages)
    ? "allow"
    : current?.deny.has(PermissionFlagsBits.SendMessages)
      ? "deny"
      : "inherit";

  await saveChannelLock(message.channel.id, message.guild.id, previousState);
  await message.channel.permissionOverwrites.edit(
    everyone.id,
    { SendMessages: false },
    { reason: `Locked by ${message.author.tag}` },
  );
  await say(message, "This channel is locked for @everyone.");
  await sendModerationLog(message.guild, {
    title: "Channel locked",
    moderator: message.author.id,
    reason: `<#${message.channel.id}>`,
  });
}

export async function unlockCommand(message) {
  if (!requirePermission(message, PermissionFlagsBits.ManageChannels, "unlock channels")) return;
  const previous = await getChannelLock(message.channel.id);
  if (!previous) return say(message, "This channel has no saved lock state to restore.");

  const state = previous.everyone_send_state;
  const sendMessages =
    state === "allow" ? true : state === "deny" ? false : null;
  await message.channel.permissionOverwrites.edit(
    message.guild.roles.everyone.id,
    { SendMessages: sendMessages },
    { reason: `Unlocked by ${message.author.tag}` },
  );
  await removeChannelLock(message.channel.id);
  await say(message, "The channel's previous @everyone send-message setting has been restored.");
  await sendModerationLog(message.guild, {
    title: "Channel unlocked",
    moderator: message.author.id,
    reason: `<#${message.channel.id}>`,
  });
}

export function isStaffCommand(name) {
  return new Set([
    "ban",
    "kick",
    "timeout",
    "untimeout",
    "warn",
    "warnings",
    "clear",
    "slowmode",
    "lock",
    "unlock",
  ]).has(name);
}

export function getModerationHelp() {
  return [
    "`fban @member [reason]`",
    "`fkick @member [reason]`",
    "`ftimeout @member <15m|2h|1d> [reason]`",
    "`funtimeout @member [reason]`",
    "`fwarn @member <reason>`",
    "`fwarnings @member`",
    "`fclear <1-100>`",
    "`fslowmode <0-21600>`",
    "`flock` / `funlock`",
  ].join("\n");
}
