import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { config } from "../src/config.js";
import { xpForLevel, levelForXp, levelProgress, xpFingerprint, levelNonce } from "../src/level-rules.js";
import { createLevelStore } from "../src/level-store.js";
import { createLevelService } from "../src/level-service.js";
import { createLevelCommands } from "../src/level-commands.js";

const chat = (content = "a proper chat message") => ({
  content, guild: { id: "guild" }, author: { id: "member", bot: false }, member: {},
});
const settings = { levelsEnabled: true, prefix: "f", levelRoles: {}, levelChannelId: null };

test("level curve and progress are correct at boundaries and increasingly difficult", () => {
  for (let level = 0; level <= 1000; level++) {
    const xp = xpForLevel(level);
    assert.equal(levelForXp(xp), level);
    if (level > 0) assert.equal(levelForXp(xp - 1), level - 1);
    assert.equal(levelProgress(xp).bar, "▱".repeat(10));
    assert.ok(xpForLevel(level + 2) - xpForLevel(level + 1) > xpForLevel(level + 1) - xp);
  }
  assert.equal(levelForXp(124), 0);
  assert.equal(levelForXp(125), 1);
  assert.equal(xpForLevel(15), 7125);
  assert.equal(xpForLevel(25), 18125);
});

test("XP eligibility rejects commands, bots, filler, links and disabled XP; hashes normalized content", () => {
  for (const content of ["fhelp", "funknowncommand", "....", "123", "👋👋", "<@123456789012345678>", "https://example.com"]) {
    assert.equal(xpFingerprint(chat(content), settings), null, content);
  }
  assert.equal(xpFingerprint(chat("!help"), { ...settings, prefix: "!" }), null);
  assert.equal(xpFingerprint(chat(), { ...settings, levelsEnabled: false }), null);
  assert.equal(xpFingerprint({ ...chat(), webhookId: "hook" }, settings), null);
  assert.equal(xpFingerprint({ ...chat(), author: { bot: true } }, settings), null);
  assert.equal(xpFingerprint(chat("HELLO   community"), settings), xpFingerprint(chat("hello community"), settings));
  assert.match(xpFingerprint(chat("こんにちは世界"), settings), /^[a-f0-9]{64}$/);
  assert.equal(levelNonce("g", "u", 15), levelNonce("g", "u", 15));
  assert.notEqual(levelNonce("g", "u", 15), levelNonce("g", "u", 25));
  assert.equal(levelNonce("g", "u", 15).length, 24);
});

test("PostgreSQL awards XP atomically, preserves cooldowns across restarts, and persists pending rewards", {
  skip: !config.databaseUrl,
}, async () => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  try {
    await pool.query("CREATE TEMP TABLE community_bot_levels (LIKE public.community_bot_levels INCLUDING ALL)");
    const store = createLevelStore(pool);
    const first = await Promise.all(Array.from({ length: 30 }, () => store.award("guild", "u", "first", 100000)));
    assert.equal(first.filter(Boolean).length, 1);
    assert.equal(Number((await store.member("guild", "u")).xp), 20);
    const restarted = createLevelStore(pool);
    assert.equal(await restarted.award("guild", "u", "different", 159999), null);
    assert.equal(await restarted.award("guild", "u", "first", 160000), null);
    assert.equal(Number((await restarted.award("guild", "u", "different", 160000)).xp), 40);
    assert.equal(Number((await restarted.award("another-guild", "u", "first", 100000)).xp), 20);
    for (let i = 1; i <= 5; i++) await store.award("guild", "u", `unique${i}`, 160000 + 60000 * i);
    const member = await store.member("guild", "u");
    assert.equal(Number(member.xp), 140);
    assert.equal(member.level, 1);
    assert.equal(Number(member.rank), 1);
    let pending = await store.pending(1_000_000);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].notified_level, 0);
    await store.defer("guild", "u", 2_000_000);
    assert.equal((await store.pending(1_999_999)).length, 0);
    assert.equal((await store.pending(2_000_000)).length, 1);
    await store.acknowledge("guild", "u", 1, "notice");
    assert.equal((await store.pending(2_000_000)).length, 1, "failed role delivery is independent of notification");
    await store.acknowledge("guild", "u", 1, "roles");
    assert.equal((await store.pending(2_000_000)).length, 0);
    await store.acknowledge("guild", "u", 0, "notice");
    assert.equal((await store.member("guild", "u")).notified_level, 1, "acknowledgements cannot go backwards");
    await store.resetRoles("guild");
    assert.equal((await store.pending(2_000_000)).length, 1);
    assert.equal((await store.member("guild", "missing")).xp, 0);
    assert.deepEqual((await store.top("guild")).map((r) => r.user_id), ["u"]);
    await pool.query("INSERT INTO community_bot_levels(guild_id,user_id,xp,level) VALUES ('guild','a',140,1)");
    assert.equal(Number((await store.member("guild", "u")).rank), 2, "ties have a stable member-ID order");
    assert.deepEqual((await store.top("guild")).map((r) => r.user_id), ["a", "u"]);
  } finally { await pool.end(); }
});

function serviceFixture() {
  let time = 100000;
  const row = { guild_id: "guild", user_id: "member", level: 25, xp: "18125", roles_level: 0, notified_level: 0, next_attempt_at: 0 };
  const state = { settings: { ...settings, levelChannelId: "channel", levelRoles: { 15: "role15", 25: "role25", 50: "role50" } }, sends: [], adds: [], errors: [], writes: 0 };
  const roles = new Map([15, 25, 50].map((level) => [`role${level}`, {
    id: `role${level}`, managed: false, permissions: { bitfield: 0n }, editable: true,
  }]));
  const member = {
    user: { displayAvatarURL: () => "https://example.com/avatar.png" },
    roles: { cache: new Map(), add: async (role) => { state.adds.push(role.id); member.roles.cache.set(role.id, role); } },
  };
  const channel = {
    isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { state.sends.push(payload); },
  };
  const guild = {
    id: "guild", roles: { cache: roles, fetch: async (id) => roles.get(id) },
    members: { cache: new Map([["member", member]]), me: {}, fetch: async () => member },
    channels: { cache: new Map([["channel", channel]]) },
  };
  const store = {
    pending: async (now) => row.next_attempt_at <= now && (row.roles_level < row.level || row.notified_level < row.level) ? [{ ...row }] : [],
    defer: async (_, __, until) => { row.next_attempt_at = until; },
    acknowledge: async (_, __, level, kind) => { row[kind === "roles" ? "roles_level" : "notified_level"] = level; },
    award: async () => { state.writes++; return { ...row }; },
  };
  const options = { store, getSettings: async () => state.settings, now: () => time, log: (error) => state.errors.push(error.message) };
  const client = { guilds: { cache: new Map([["guild", guild]]) } };
  return { state, row, roles, member, guild, channel, client, options, advance: () => { time += 60001; } };
}

test("level-up sends one controlled member ping and grants all earned milestones, never higher roles", async () => {
  const h = serviceFixture(), service = createLevelService(h.options);
  const stop = service.start(h.client);
  try {
    await service.flush();
    await service.flush();
    assert.deepEqual(h.state.adds, ["role15", "role25"]);
    assert.equal(h.state.sends.length, 1);
    const payload = h.state.sends[0];
    assert.equal(payload.content, "<@member>");
    assert.deepEqual(payload.allowedMentions, { parse: [], users: ["member"], roles: [], repliedUser: false });
    assert.match(payload.embeds[0].toJSON().title, /25/);
    assert.equal(payload.enforceNonce, true);
    assert.equal(h.row.roles_level, 25);
    assert.equal(h.row.notified_level, 25);
  } finally { stop(); }
});

test("unsafe reward roles never grant permissions, but announcements still work; role retry doesn't reannounce", async () => {
  const h = serviceFixture();
  h.roles.get("role15").permissions.bitfield = 8n;
  const first = createLevelService(h.options), stop = first.start(h.client);
  await first.flush();
  stop();
  assert.equal(h.state.adds.length, 0);
  assert.equal(h.state.sends.length, 1);
  assert.equal(h.row.roles_level, 0);
  assert.equal(h.row.notified_level, 25);
  assert.match(h.state.errors[0], /unsafe/);
  h.roles.get("role15").permissions.bitfield = 0n;
  h.advance();
  const restarted = createLevelService(h.options), stopAgain = restarted.start(h.client);
  try {
    await restarted.flush();
    assert.deepEqual(h.state.adds, ["role15", "role25"]);
    assert.equal(h.state.sends.length, 1);
  } finally { stopAgain(); }
});

test("failed channel delivery persists for retry and keeps a stable nonce across worker recreation", async () => {
  const h = serviceFixture();
  let failedNonce;
  h.channel.send = async (payload) => { failedNonce = payload.nonce; throw Error("Discord unavailable"); };
  const service = createLevelService(h.options), stop = service.start(h.client);
  await service.flush();
  stop();
  assert.equal(h.row.notified_level, 0);
  assert.equal(h.row.roles_level, 25);
  h.advance();
  h.channel.send = async (payload) => h.state.sends.push(payload);
  const restarted = createLevelService(h.options), stopAgain = restarted.start(h.client);
  try {
    await restarted.flush();
    assert.equal(h.state.sends[0].nonce, failedNonce);
    assert.equal(h.row.notified_level, 25);
    assert.equal(h.state.adds.length, 2);
  } finally { stopAgain(); }
});

test("disabled announcements do not fall back to random channels; paused XP and stopped workers stay silent", async () => {
  const h = serviceFixture();
  h.state.settings.levelChannelId = null;
  const service = createLevelService(h.options), stop = service.start(h.client);
  await service.flush();
  assert.equal(h.state.sends.length, 0);
  assert.equal(h.row.notified_level, 25);
  assert.equal(await service.activity(chat(), { ...settings, levelsEnabled: false }), false);
  assert.equal(h.state.writes, 0);
  stop();
  h.row.level = 26;
  h.advance();
  await service.flush();
  assert.equal(h.state.sends.length, 0);
});

function commandFixture() {
  const state = { settings: { ...settings, levelRoles: {} }, created: [], replies: [], resets: 0, staff: true, manageRoles: true };
  const roles = new Map();
  const channel = { id: "123456789012345678", type: 0, permissionsFor: () => ({ has: () => true }) };
  const message = {
    author: { id: "member" }, member: { permissions: { has: () => state.staff }, roles: { cache: new Map() } },
    guild: {
      id: "guild", members: { me: { permissions: { has: () => state.manageRoles } } },
      channels: { cache: new Map([[channel.id, channel]]) },
      roles: { fetch: async (id) => roles.get(id), create: async (options) => {
        state.created.push(options);
        const role = { id: `role${state.created.length}`, permissions: { bitfield: 0n }, editable: true };
        roles.set(role.id, role);
        return role;
      } },
    },
  };
  const commands = createLevelCommands({
    getSettings: async () => structuredClone(state.settings),
    saveSettings: async (_, patch) => { Object.assign(state.settings, patch); },
    say: async (_, text) => state.replies.push(text),
    service: { store: { resetRoles: async () => { state.resets++; } }, flush: async () => {} },
  });
  return { state, message, channel, commands };
}

test("one setup command creates safe persistent milestone roles and selects the announcement channel", async () => {
  const h = commandFixture();
  await h.commands.configure(h.message, [`<#${h.channel.id}>`], "levelsetup");
  assert.deepEqual(h.state.created.map((role) => role.name), ["Level 5", "Level 10", "Level 15", "Level 25", "Level 50", "Level 75", "Level 100"]);
  for (const role of h.state.created) {
    assert.deepEqual(role.permissions, []);
    assert.equal(role.mentionable, false);
  }
  assert.equal(h.state.settings.levelChannelId, h.channel.id);
  assert.equal(h.state.settings.levelsEnabled, true);
  assert.equal(Object.keys(h.state.settings.levelRoles).length, 7);
  await h.commands.configure(h.message, [`<#${h.channel.id}>`], "levelsetup");
  assert.equal(h.state.created.length, 7, "rerunning setup reuses saved roles without making duplicates");
  assert.equal(h.state.replies.length, 2);
});

test("leveling configuration is staff-only, checks bot permissions and validates milestone bounds", async () => {
  const h = commandFixture();
  h.state.staff = false;
  await h.commands.configure(h.message, [`<#${h.channel.id}>`], "levelsetup");
  assert.equal(h.state.created.length, 0);
  assert.equal(h.state.settings.levelChannelId, null);
  h.state.staff = true;
  h.state.manageRoles = false;
  await h.commands.configure(h.message, ["15", "25"], "levelroles");
  assert.equal(h.state.created.length, 0);
  assert.match(h.state.replies.at(-1), /Manage Roles/);
  h.state.manageRoles = true;
  for (const args of [["0"], ["501"], ["15.5"], ["bad"], Array.from({ length: 21 }, (_, i) => String(i + 1))]) {
    await h.commands.configure(h.message, args, "levelroles");
    assert.equal(h.state.created.length, 0);
  }
  await h.commands.configure(h.message, ["15", "25"], "levelroles");
  assert.equal(h.state.created.length, 2);
  await h.commands.configure(h.message, ["remove", "15"], "levelroles");
  assert.equal(h.state.settings.levelRoles[15], undefined);
  assert.ok(h.state.settings.levelRoles[25]);
  assert.match(h.state.replies.at(-1), /not deleted/);
});

test("staff can change or disable the announcement channel and pause XP without deleting progress", async () => {
  const h = commandFixture();
  await h.commands.configure(h.message, [`<#${h.channel.id}>`], "levelchannel");
  assert.equal(h.state.settings.levelChannelId, h.channel.id);
  await h.commands.configure(h.message, ["off"], "levelchannel");
  assert.equal(h.state.settings.levelChannelId, null);
  await h.commands.configure(h.message, ["off"], "levels");
  assert.equal(h.state.settings.levelsEnabled, false);
  await h.commands.configure(h.message, ["on"], "levels");
  assert.equal(h.state.settings.levelsEnabled, true);
  h.channel.permissionsFor = () => ({ has: () => false });
  await h.commands.configure(h.message, [`<#${h.channel.id}>`], "levelchannel");
  assert.equal(h.state.settings.levelChannelId, null);
});

test("rank and leveltop display real progress and do not ping mentioned members", async () => {
  const replies = [];
  const member = {
    displayName: "Example", user: { displayAvatarURL: () => "https://example.com/avatar.png" },
  };
  const message = {
    author: { id: "member" }, mentions: { users: { first: () => null } },
    guild: { id: "guild", name: "Community", members: { cache: new Map([["member", member]]) } },
    client: { user: { username: "Bot", displayAvatarURL: () => "https://example.com/bot.png" } },
  };
  const commands = createLevelCommands({
    getSettings: async () => settings,
    service: { store: {
      member: async (guildId, userId) => {
        assert.equal(guildId, "guild"); assert.equal(userId, "member");
        return { xp: "140", rank: "2" };
      },
      top: async () => [{ user_id: "member", xp: "140", level: 1 }],
    } },
    reply: async (_, payload) => replies.push(payload),
  });
  await commands.rank(message, []);
  await commands.top(message);
  const rank = replies[0].embeds[0].toJSON();
  assert.match(rank.title, /Level 1/);
  assert.match(rank.description, /160 XP until Level 2/);
  assert.equal(rank.fields[1].value, "#2");
  assert.match(replies[1].embeds[0].toJSON().description, /<@member>.*Level 1/);
  assert.deepEqual(replies.map((reply) => reply.allowedMentions.parse), [[], []]);
});

test("a departed member is never mentioned and missing channel permissions retain the pending announcement", async () => {
  const h = serviceFixture();
  h.guild.members.cache.clear();
  h.guild.members.fetch = async () => { throw Object.assign(Error("Unknown Member"), { code: 10007 }); };
  const service = createLevelService(h.options), stop = service.start(h.client);
  await service.flush();
  stop();
  assert.equal(h.state.sends.length, 0);
  assert.equal(h.row.notified_level, 25);
  const other = serviceFixture();
  other.channel.permissionsFor = () => ({ has: () => false });
  const unavailable = createLevelService(other.options), stopAgain = unavailable.start(other.client);
  try {
    await unavailable.flush();
    assert.equal(other.row.notified_level, 0);
    assert.equal(other.state.sends.length, 0);
    assert.match(other.state.errors[0], /not writable/);
  } finally { stopAgain(); }
});
