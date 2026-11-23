import { PermissionFlagsBits } from "discord.js";

export function userIdFrom(input = "") {
  return input.match(/^<@!?(\d+)>$/)?.[1] || ( /^\d{17,20}$/.test(input) ? input : null);
}

export function channelIdFrom(input = "") {
  return input.match(/^<#(\d+)>$/)?.[1] || (/^\d{17,20}$/.test(input) ? input : null);
}

export function parseDuration(input = "") {
  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

export function readableDuration(milliseconds) {
  const units = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ];
  const parts = [];
  let remaining = milliseconds;
  for (const [label, value] of units) {
    const count = Math.floor(remaining / value);
    if (count > 0) {
      parts.push(`${count}${label}`);
      remaining %= value;
    }
  }
  return parts.join(" ") || "0s";
}

export function hasStaffAccess(member, permission, staffRoleIds = []) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (permission && member.permissions.has(permission)) return true;
  return staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

export function fillTemplate(template, member) {
  return template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user.username)
    .replaceAll("{server}", member.guild.name);
}

export function clampText(value, maxLength = 1000) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function escapeInline(value) {
  return String(value).replaceAll("`", "ˋ").replaceAll("@", "@\u200b");
}
