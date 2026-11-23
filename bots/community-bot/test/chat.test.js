import test from "node:test";
import assert from "node:assert/strict";
import { createChatService } from "../src/chat.js";

function fixture({ user = "member", guild = "server", channel = "general", staff = false, content = "<@bot> Hello" } = {}) {
  const replies = [];
  const edits = [];
  return {
    replies, edits, content,
    author: { id: user, bot: false },
    guild: { id: guild },
    channel: { id: channel, sendTyping: async () => {} },
    member: { permissions: { has: () => staff }, roles: { cache: new Map() } },
    client: { user: { id: "bot" } },
    reply: async (payload) => {
      const sent = { ...payload };
      replies.push(sent);
      return { edit: async (update) => {
        edits.push({ ...update });
        Object.assign(sent, update);
      } };
    },
  };
}

function harness(generate = async () => "Hello!") {
  let clock = 100_000;
  const settings = { chatEnabled: true, personality: "Friendly", prefix: "!" };
  let saves = 0;
  const service = createChatService({
    getSettings: async () => ({ ...settings }),
    saveSettings: async (_, patch) => { Object.assign(settings, patch); saves++; },
    generate,
    ready: () => true,
    now: () => clock,
  });
  return { service, settings, advance: (ms = 11_000) => { clock += ms; }, saves: () => saves };
}

test("AI only handles explicit mentions from server members and prevents pings", async () => {
  const { service } = harness();
  const plain = fixture({ content: "hello everyone" });
  assert.equal(await service.handleMention(plain), false);
  const bot = fixture();
  bot.author.bot = true;
  assert.equal(await service.handleMention(bot), false);
  const dm = fixture();
  dm.guild = null;
  assert.equal(await service.handleMention(dm), false);
  const message = fixture({ content: "<@!bot> Hello" });
  assert.equal(await service.handleMention(message), true);
  assert.equal(message.replies[0].content, "Hello!");
  assert.deepEqual(message.replies[0].allowedMentions, { parse: [], repliedUser: false });
});

test("memory is isolated by member/channel/server, bounded, and expires", async () => {
  const calls = [];
  const h = harness(async (input) => { calls.push(input); return "An answer"; });
  for (let i = 0; i < 8; i++) {
    await h.service.handleMention(fixture({ content: `<@bot> Question ${i}` }));
    h.advance();
  }
  assert.equal(calls.at(-1).history.length, 12);
  for (const options of [{ user: "another" }, { channel: "another" }, { guild: "another" }]) {
    await h.service.handleMention(fixture(options));
    assert.deepEqual(calls.at(-1).history, []);
  }
  h.advance(600_001);
  await h.service.handleMention(fixture());
  assert.deepEqual(calls.at(-1).history, []);
});

test("cooldowns, oversized inputs and missing configuration avoid API calls", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return "Hi"; });
  const message = fixture();
  await h.service.handleMention(message);
  await h.service.handleMention(message);
  assert.match(message.replies.at(-1).content, /wait 10 seconds/);
  const long = fixture({ user: "long", content: `<@bot> ${"x".repeat(1501)}` });
  await h.service.handleMention(long);
  assert.match(long.replies[0].content, /shorten/);
  assert.equal(calls, 1);
  const service = createChatService({ getSettings: async () => h.settings, ready: () => false, generate: async () => { throw Error("must not call"); } });
  const unavailable = fixture();
  await service.handleMention(unavailable);
  assert.match(unavailable.replies[0].content, /unavailable/);
});

test("only staff can toggle chat or change personality; members can reset their own memory", async () => {
  const calls = [];
  const h = harness(async (input) => { calls.push(input); return "Hello"; });
  const member = fixture();
  await h.service.chatCommand(member, ["off"]);
  await h.service.personalityCommand(member, ["ignore safety"]);
  assert.equal(h.saves(), 0);
  await h.service.handleMention(member);
  await h.service.chatCommand(member, ["reset"]);
  h.advance();
  await h.service.handleMention(member);
  assert.deepEqual(calls.at(-1).history, []);
  const staff = fixture({ staff: true });
  await h.service.personalityCommand(staff, ["Calm", "and", "concise"]);
  assert.equal(h.settings.personality, "Calm and concise");
  await h.service.chatCommand(staff, ["off"]);
  const disabled = fixture({ user: "new" });
  const before = calls.length;
  await h.service.handleMention(disabled);
  assert.equal(disabled.replies.length, 0);
  assert.equal(calls.length, before);
  await h.service.chatCommand(staff, ["on"]);
  await h.service.handleMention(fixture({ user: "new" }));
  assert.equal(calls.at(-1).personality, "Calm and concise");
});

test("provider failures are safe and output respects Discord's character limit", async () => {
  const failing = harness(async () => { throw new Error("sensitive SDK response"); });
  const message = fixture();
  await failing.service.handleMention(message);
  assert.match(message.replies[0].content, /couldn't get an AI response/);
  assert.doesNotMatch(message.replies[0].content, /sensitive/);
  const long = harness(async () => "x".repeat(8000));
  const other = fixture();
  await long.service.handleMention(other);
  assert.equal(other.replies[0].content.length, 1800);
});

test("the per-server minute limit prevents more than 20 requests", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return "Hello"; });
  let last;
  for (let index = 0; index < 21; index++) {
    last = fixture({ user: `user-${index}` });
    await h.service.handleMention(last);
  }
  assert.equal(calls, 20);
  assert.match(last.replies[0].content, /busy/);
});

test("only three requests run concurrently, and reset cancels an in-flight reply", async () => {
  const pending = [];
  const h = harness(() => new Promise((resolve) => pending.push(resolve)));
  const first = fixture({ user: "first" });
  const second = fixture({ user: "second" });
  const third = fixture({ user: "third" });
  const requests = [first, second, third].map((message) => h.service.handleMention(message));
  await new Promise((resolve) => setImmediate(resolve));
  const fourth = fixture({ user: "fourth" });
  await h.service.handleMention(fourth);
  assert.match(fourth.replies[0].content, /busy/);
  await h.service.chatCommand(first, ["reset"]);
  for (const resolve of pending) resolve("Finished");
  await Promise.all(requests);
  assert.equal(first.replies.length, 2);
  assert.match(first.replies[0].content, /stopped/);
  assert.match(first.replies[1].content, /cleared/);
  assert.equal(second.replies[0].content, "Finished");
});

test("AI acknowledges immediately and streams edits into one safe reply", async () => {
  const message = fixture();
  const h = harness(async ({ onPartial }) => {
    assert.equal(message.replies[0].content, "Thinking…");
    await onPartial("A partial answer");
    assert.equal(message.replies[0].content, "A partial answer");
    return "The final answer";
  });
  await h.service.handleMention(message);
  assert.equal(message.replies.length, 1);
  assert.equal(message.replies[0].content, "The final answer");
  assert.equal(message.edits.length, 2);
  for (const edit of message.edits) assert.deepEqual(edit.allowedMentions, { parse: [], repliedUser: false });
});

test("a failed preview falls back to a final reply instead of losing the answer", async () => {
  const message = fixture();
  const baseReply = message.reply;
  let sends = 0;
  message.reply = async (payload) => {
    const response = await baseReply(payload);
    if (++sends === 1) response.edit = async () => { throw Error("Discord unavailable"); };
    return response;
  };
  const h = harness(async ({ onPartial }) => { await onPartial("Preview"); return "Final answer"; });
  await h.service.handleMention(message);
  assert.equal(message.replies.at(-1).content, "Final answer");
});

test("AI generation starts before a slow acknowledgement finishes", async () => {
  const message = fixture();
  const baseReply = message.reply;
  let releaseAck, generated = false;
  message.reply = async (payload) => {
    await new Promise((resolve) => { releaseAck = resolve; });
    return baseReply(payload);
  };
  const h = harness(async () => { generated = true; return "Fast answer"; });
  const handling = h.service.handleMention(message);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(generated, true);
  assert.equal(message.replies.length, 0);
  releaseAck();
  await handling;
  assert.equal(message.replies.length, 1);
  assert.equal(message.replies[0].content, "Fast answer");
});

test("identical final text does not send a redundant Discord edit", async () => {
  const message = fixture();
  const h = harness(async ({ onPartial }) => {
    await onPartial("Already complete");
    return "Already complete";
  });
  await h.service.handleMention(message);
  assert.equal(message.edits.length, 1);
  assert.equal(message.replies[0].content, "Already complete");
});

test("an acknowledgement failure still allows a generated final answer", async () => {
  const message = fixture();
  const baseReply = message.reply;
  let sends = 0;
  message.reply = async (payload) => {
    if (++sends === 1) throw new Error("temporary Discord send failure");
    return baseReply(payload);
  };
  const h = harness(async () => "Final answer");
  await h.service.handleMention(message);
  assert.equal(message.replies[0].content, "Final answer");
});

test("failed edits remove only the old bot reply after the replacement is delivered", async () => {
  const message = fixture();
  message.id = "323456789012345678";
  const events = [];
  let sends = 0;
  message.reply = async (payload) => {
    events.push({ send: payload.content, nonce: payload.nonce, enforceNonce: payload.enforceNonce });
    if (++sends === 1) return {
      id: "323456789012345679",
      edit: async () => { throw new Error("edit failed"); },
      delete: async () => events.push({ deleted: "old bot reply" }),
    };
    return { id: "323456789012345680" };
  };
  const h = harness(async ({ onPartial }) => { await onPartial("Partial"); return "Complete answer"; });
  await h.service.handleMention(message);
  assert.deepEqual(events.map((entry) => entry.send || entry.deleted), ["Thinking…", "Complete answer", "old bot reply"]);
  assert.equal(events[0].nonce, message.id);
  assert.equal(events[1].nonce, `${message.id}:f`);
  assert.ok(events.filter((entry) => entry.send).every((entry) => entry.enforceNonce));
});

test("a failed replacement never deletes the only existing bot reply", async () => {
  const message = fixture();
  let sends = 0, deletes = 0;
  message.reply = async () => {
    if (++sends > 1) throw new Error("send failed");
    return { edit: async () => { throw new Error("edit failed"); }, delete: async () => { deletes++; } };
  };
  const h = harness(async () => "Complete answer");
  await h.service.handleMention(message);
  assert.equal(deletes, 0);
});
