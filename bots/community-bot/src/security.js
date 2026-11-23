import { addWarning, getGuildSettings, updateGuildSettings } from "./storage.js";
import { sendModerationLog, sendSecurityAlert } from "./logging.js";
import { fillTemplate } from "./format.js";

const joinsByGuild = new Map();
const joinAlertCooldown = new Map();
const spamByMember = new Map();
const strikesByMember = new Map();
const autoVerificationTimers = new Map();

export async function handleMemberJoin(member) {
  const settings = await getGuildSettings(member.guild.id);
  if (!settings.raidEnabled) return;

  const now = Date.now();
  const windowMs = settings.joinWindowSeconds * 1000;
  const recent = (joinsByGuild.get(member.guild.id) || []).filter(
    (joinedAt) => now - joinedAt <= windowMs,
  );
  recent.push(now);
  joinsByGuild.set(member.guild.id, recent);

  if (recent.length < settings.joinThreshold) return;
  if (now - (joinAlertCooldown.get(member.guild.id) || 0) < 45_000) return;
  joinAlertCooldown.set(member.guild.id, now);

  await sendSecurityAlert(
    member.guild,
    "Possible join raid detected",
    `${recent.length} members joined within ${settings.joinWindowSeconds} seconds. Review the member list and moderation logs.`,
  );

  if (settings.autoVerification) {
    await temporarilyRaiseVerification(member.guild);
  }
}

async function temporarilyRaiseVerification(guild) {
  const settings = await getGuildSettings(guild.id);
  const priorLevel = settings.verificationRestoreAt
    ? settings.verificationPrevious
    : guild.verificationLevel;
  const restoreAt = Date.now() + 10 * 60 * 1000;
  try {
    // Discord.js v14 represents guild verification levels as API integers.
    await guild.setVerificationLevel(3, "Temporary join-raid protection");
    await updateGuildSettings(guild.id, {
      verificationPrevious: priorLevel,
      verificationRestoreAt: restoreAt,
    });
    await sendSecurityAlert(
      guild,
      "Temporary verification enabled",
      "Server verification was raised to High for 10 minutes. It will be restored automatically.",
    );
    scheduleVerificationRestore(guild, restoreAt, priorLevel);
  } catch {
    await sendSecurityAlert(
      guild,
      "Could not enable temporary verification",
      "The bot needs the Manage Server permission to raise verification. Check the bot's permissions or disable auto-verification with fsecurity autoverify off.",
    );
  }
}

function scheduleVerificationRestore(guild, restoreAt, priorLevel) {
  const existingTimer = autoVerificationTimers.get(guild.id);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    try {
      await guild.setVerificationLevel(
        priorLevel,
        "Join-raid protection window ended",
      );
      await updateGuildSettings(guild.id, {
        verificationPrevious: null,
        verificationRestoreAt: 0,
      });
      await sendSecurityAlert(
        guild,
        "Temporary verification ended",
        "The server's previous verification level has been restored.",
      );
    } catch {
      await sendSecurityAlert(
        guild,
        "Verification level needs review",
        "The bot could not restore the previous server verification level. A staff member should check Server Settings.",
      );
    } finally {
      autoVerificationTimers.delete(guild.id);
    }
  }, Math.max(0, restoreAt - Date.now()));
  timer.unref?.();
  autoVerificationTimers.set(guild.id, timer);
}

export async function restorePendingVerifications(client) {
  for (const guild of client.guilds.cache.values()) {
    const settings = await getGuildSettings(guild.id);
    if (settings.verificationRestoreAt && settings.verificationPrevious !== null) {
      scheduleVerificationRestore(
        guild,
        settings.verificationRestoreAt,
        settings.verificationPrevious,
      );
    }
  }
}

function normalizedContent(message) {
  const parts = [message.content || ""];
  for (const attachment of message.attachments.values()) {
    parts.push(attachment.name || attachment.url);
  }
  return parts.join(" ").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 1500);
}

export async function detectSpam(message, preparedSettings) {
  if (!message.guild || !message.member || message.author.bot) return false;
  const settings = preparedSettings ?? await getGuildSettings(message.guild.id);
  if (!settings.spamEnabled) return false;

  const now = Date.now();
  const key = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
  const current = spamByMember.get(key) || { messages: [], lastOffenseAt: 0 };
  const cutoff = now - settings.spamWindowSeconds * 1000;
  current.messages = current.messages.filter((entry) => entry.at >= cutoff);

  const body = normalizedContent(message);
  current.messages.push({ at: now, body });
  spamByMember.set(key, current);

  const messageBurst = current.messages.length > settings.spamMaxMessages;
  const repeatedCount = body
    ? current.messages.filter((entry) => entry.body === body).length
    : 0;
  const repeatedContent = repeatedCount >= settings.repeatThreshold;
  if ((!messageBurst && !repeatedContent) || now - current.lastOffenseAt < 5_000) return false;

  current.lastOffenseAt = now;
  await message.delete().catch(() => {});

  const reason = messageBurst
    ? `Message rate exceeded ${settings.spamMaxMessages} messages in ${settings.spamWindowSeconds} seconds.`
    : `Repeated the same message ${repeatedCount} times.`;
  const warningId = await addWarning(
    message.guild.id,
    message.author.id,
    message.client.user.id,
    `Automatic spam protection: ${reason}`,
    now,
  );
  await sendModerationLog(message.guild, {
    title: "Automatic spam action",
    moderator: null,
    member: message.author.id,
    reason: `${reason} Warning #${warningId}.`,
    color: 0xed4245,
  });

  const strikeKey = `${message.guild.id}:${message.author.id}`;
  const strikes = (strikesByMember.get(strikeKey) || []).filter(
    (strikeAt) => now - strikeAt < 10 * 60 * 1000,
  );
  strikes.push(now);
  strikesByMember.set(strikeKey, strikes);

  let timedOut = false;
  if (settings.autoTimeout && strikes.length >= 2 && message.member.moderatable) {
    await message.member
      .timeout(60_000, "Repeated automatic spam protection violations")
      .then(() => {
        timedOut = true;
      })
      .catch(() => {});
  }

  const responseTemplate = timedOut
    ? settings.spamTimeoutTemplate
    : settings.spamNoticeTemplate;
  const notice = await message.channel
    .send({
      content: fillTemplate(responseTemplate, message.member),
      allowedMentions: { parse: [], users: [message.author.id] },
    })
    .catch(() => null);

  if (notice) {
    const timer = setTimeout(() => notice.delete().catch(() => {}), 7_000);
    timer.unref?.();
  }

  return true;
}

export function logRuntimeError(label, error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[${label}] ${message.slice(0, 500)}\n`);
}
