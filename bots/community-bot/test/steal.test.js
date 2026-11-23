import test from "node:test";
import assert from "node:assert/strict";
import { Collection, PermissionFlagsBits, StickerFormatType } from "discord.js";
import { createStealCommand, downloadDiscordAsset } from "../src/steal.js";

function fixture({ staff = true, botPermission = true, uploadError } = {}) {
  const replies = [], uploads = [], logs = [], downloads = [];
  const manager = {
    fetch: async () => new Collection(),
    create: async (data) => {
      if (uploadError) throw uploadError;
      uploads.push(data);
      return { id: "123456789012345688", name: data.name };
    },
  };
  const message = {
    member: { permissions: { has: (p) => staff && p === PermissionFlagsBits.ManageGuildExpressions }, roles: { cache: new Collection() } },
    author: { id: "123456789012345679" },
    guild: {
      members: { me: { permissions: { has: () => botPermission } } },
      emojis: manager, stickers: manager,
    },
    stickers: new Collection(),
    client: { fetchSticker: async (id) => ({ id, name: "happy", format: StickerFormatType.PNG }) },
  };
  const command = createStealCommand({
    say: async (_, text) => replies.push(text),
    log: async (_, entry) => logs.push(entry),
    download: async (url, limit) => { downloads.push({ url, limit }); return Buffer.from("test"); },
  });
  return { command, message, replies, uploads, logs, downloads };
}

test("steal blocks nonstaff and missing bot permissions before reading or uploading assets", async () => {
  for (const options of [{ staff: false }, { botPermission: false }]) {
    const f = fixture(options);
    await f.command(f.message, ["<:happy:123456789012345678>"]);
    assert.equal(f.uploads.length, 0);
    assert.equal(f.downloads.length, 0);
    assert.match(f.replies[0], /permission|staff/);
  }
});

test("steal copies static and animated emoji, validates names, and logs success", async () => {
  for (const animated of [false, true]) {
    const f = fixture();
    await f.command(f.message, [`<${animated ? "a" : ""}:happy:123456789012345678>`, "copied"]);
    assert.equal(f.uploads[0].name, "copied");
    assert.equal(f.downloads[0].limit, 256 * 1024);
    assert.match(f.downloads[0].url, animated ? /\.gif$/ : /\.png$/);
    assert.equal(f.logs.length, 1);
  }
  const f = fixture();
  await f.command(f.message, ["<:happy:123456789012345678>", "x"]);
  assert.equal(f.uploads.length, 0);
});

test("steal copies a sticker by ID or from a replied-to message and rejects Lottie", async () => {
  const f = fixture();
  await f.command(f.message, ["sticker", "123456789012345678", "new", "name"]);
  assert.equal(f.uploads[0].name, "new name");
  assert.equal(f.downloads[0].limit, 512 * 1024);
  f.message.reference = {};
  f.message.fetchReference = async () => ({ stickers: new Collection([["sticker", { id: "123456789012345678" }]]) });
  await f.command(f.message, []);
  assert.equal(f.uploads.length, 2);
  f.message.client.fetchSticker = async () => ({ format: StickerFormatType.Lottie });
  await f.command(f.message, ["sticker", "123456789012345678"]);
  assert.equal(f.uploads.length, 2);
  assert.match(f.replies.at(-1), /Lottie/);
});

test("steal rejects duplicates and reports exhausted Discord slots without exposing errors", async () => {
  const f = fixture();
  f.message.guild.emojis.fetch = async () => new Collection([["emoji", { name: "happy" }]]);
  await f.command(f.message, ["<:happy:123456789012345678>"]);
  assert.equal(f.downloads.length, 0);
  const full = fixture({ uploadError: { code: 30008, message: "internal details" } });
  await full.command(full.message, ["<:happy:123456789012345678>"]);
  assert.match(full.replies[0], /no free slots/);
  assert.doesNotMatch(full.replies[0], /internal details/);
});

test("downloader rejects unsafe hosts and redirects and caps both declared and streamed sizes", async () => {
  await assert.rejects(downloadDiscordAsset("https://127.0.0.1/private.png", 100), /Only Discord/);
  const url = "https://cdn.discordapp.com/emojis/123456789012345678.png";
  await assert.rejects(downloadDiscordAsset(url, 10, async () => new Response("oversized", {
    headers: { "content-length": "100" },
  })), /too large/);
  await assert.rejects(downloadDiscordAsset(url, 3, async (_, options) => {
    assert.equal(options.redirect, "error");
    return new Response("12345");
  }), /too large/);
  await assert.rejects(downloadDiscordAsset(url, 100, async () => new Response("not an image")), /supported/);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.deepEqual(await downloadDiscordAsset(url, 100, async () => new Response(png)), png);
});
