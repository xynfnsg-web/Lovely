import { PermissionFlagsBits, StickerFormatType } from "discord.js";
import { config } from "./config.js";
import { hasStaffAccess } from "./format.js";
import { replyCard, colors } from "./presentation.js";
import { sendModerationLog } from "./logging.js";

const emojiPattern = /<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>/;
const snowflake = /^\d{17,20}$/;

export async function downloadDiscordAsset(url, limit, fetchAsset = fetch) {
  // Never accept arbitrary user URLs, redirects, local files, or private hosts.
  if (!/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:emojis|stickers)\/\d{17,20}\.(?:png|gif)$/.test(url)) {
    throw new Error("Only Discord emoji and sticker assets are supported.");
  }
  const response = await fetchAsset(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("That asset isn't available from Discord.");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("That asset is too large for Discord's upload limit.");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("That asset is too large for Discord's upload limit.");
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const gif = /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("ascii"));
  if (!png && !gif) throw new Error("Discord did not return a supported PNG, APNG, or GIF image.");
  return buffer;
}

function friendlyError(error) {
  const code = Number(error.code);
  if (code === 30008 || code === 30039) return "This server has no free slots for that emoji or sticker type.";
  if (code === 50013 || code === 50001) return "I need Create Expressions (or Manage Expressions) permission and access to that asset.";
  if (code === 40005 || code === 50045) return "That asset is too large for Discord's upload limit.";
  if (code === 50035) return "Discord rejected the image, name, or sticker format. Try another supported asset.";
  // Only our own downloader's controlled errors are safe to show.
  if (error instanceof Error && !("code" in error) &&
      /^(Only Discord|That asset|Discord did not)/.test(error.message)) return error.message;
  return "I couldn't copy that asset. Check that it still exists, the server has a free slot, and my expression permissions are enabled.";
}

export function createStealCommand({ say = replyCard, log = sendModerationLog, download = downloadDiscordAsset } = {}) {
  return async function steal(message, args) {
    if (!hasStaffAccess(message.member, PermissionFlagsBits.ManageGuildExpressions, config.staffRoleIds)) {
      return say(message, "You need staff access or Manage Expressions permission to copy assets.");
    }
    const permissions = message.guild.members.me?.permissions;
    if (!permissions?.has(PermissionFlagsBits.CreateGuildExpressions) &&
        !permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
      return say(message, "I need Create Expressions or Manage Expressions permission.");
    }
    const tokens = [...args];
    const mode = ["emoji", "sticker"].includes(tokens[0]?.toLowerCase()) ? tokens.shift().toLowerCase() : null;
    let sourceMessage = message;
    if (message.reference) {
      sourceMessage = await message.fetchReference().catch(() => null) || message;
    }
    const emoji = (tokens[0] || "").match(emojiPattern) ||
      (!mode && tokens.length === 0 ? sourceMessage.content?.match(emojiPattern) : null);
    let created;
    let kind;
    try {
      if (mode !== "sticker" && emoji) {
        if (tokens[0]?.includes(emoji[0])) tokens.shift();
        const name = tokens.join("_") || emoji[2];
        if (!/^[A-Za-z0-9_]{2,32}$/.test(name)) return say(message, "Emoji names must be 2–32 letters, numbers, or underscores.");
        const existing = await message.guild.emojis.fetch();
        if (existing.some((item) => item.name === name)) return say(message, "This server already has an emoji with that name. Choose another name.");
        const file = await download(`https://cdn.discordapp.com/emojis/${emoji[3]}.${emoji[1] ? "gif" : "png"}`, 256 * 1024);
        created = await message.guild.emojis.create({
          attachment: file, name, reason: `Copied by ${message.author.id}`,
        });
        kind = "emoji";
      } else {
        let sticker;
        if (mode === "sticker" && snowflake.test(tokens[0] || "")) {
          sticker = await message.client.fetchSticker(tokens.shift());
        } else if (mode !== "emoji") {
          const attached = sourceMessage.stickers?.first();
          if (attached) sticker = await message.client.fetchSticker(attached.id);
        }
        if (!sticker) {
          return say(message, "Usage: `fsteal <custom emoji> [name]` or `fsteal sticker <ID> [name]`. You can also reply to a sticker with `fsteal [name]`. One asset per command; arbitrary URLs and files aren't accepted.");
        }
        if (sticker.format === StickerFormatType.Lottie ||
            ![StickerFormatType.PNG, StickerFormatType.APNG, StickerFormatType.GIF].includes(sticker.format)) {
          return say(message, "That sticker format isn't supported. Use a PNG, APNG, or GIF sticker; Lottie stickers cannot be copied.");
        }
        const name = tokens.join(" ") || sticker.name;
        if (!name || name.length < 2 || name.length > 30 || /[\r\n<>@]/.test(name)) {
          return say(message, "Sticker names must be 2–30 characters without mentions, angle brackets, or newlines.");
        }
        const existing = await message.guild.stickers.fetch();
        if (existing.some((item) => item.name === name)) return say(message, "This server already has a sticker with that name. Choose another name.");
        const gif = sticker.format === StickerFormatType.GIF;
        const file = await download(`https://${gif ? "media.discordapp.net" : "cdn.discordapp.com"}/stickers/${sticker.id}.${gif ? "gif" : "png"}`, 512 * 1024);
        created = await message.guild.stickers.create({
          file: { attachment: file, name: `sticker.${gif ? "gif" : "png"}` },
          name, tags: "smile", reason: `Copied by ${message.author.id}`,
        });
        kind = "sticker";
      }
    } catch (error) {
      return say(message, friendlyError(error));
    }
    await log(message.guild, {
      title: `Copied ${kind}`, moderator: message.author.id,
      reason: `Added ${created.name} (${created.id}) from a Discord asset.`,
    }).catch(() => {});
    return say(message, `Added ${kind} **${created.name}** to this server.\nAsset ID: \`${created.id}\``, {
      title: `${kind === "emoji" ? "Emoji" : "Sticker"} copied`, color: colors.success,
    });
  };
}

export const stealCommand = createStealCommand();
