import test from "node:test";
import assert from "node:assert/strict";
import { prepareRoastRequest } from "../src/chat-roasts.js";
import { buildChatMessages } from "../src/chat-prompt.js";
import { createChatService } from "../src/chat.js";

const member = "123456789012345678";
const requester = "223456789012345678";
function fixture(content, user = requester, channel = "general") {
  const replies = [];
  return {
    content, replies, guild: { id: "guild" }, channel: { id: channel },
    author: { id: user, bot: false }, member: {},
    client: { user: { id: "bot", username: "lovelyshell" } },
    reply: async (payload) => {
      replies.push({ ...payload });
      return { edit: async (update) => Object.assign(replies.at(-1), update) };
    },
  };
}
function harness(generate = async () => "Your confidence has a better launch trailer than the gameplay.") {
  let time = 100000;
  const inputs = [];
  const service = createChatService({
    getSettings: async () => ({ chatEnabled: true, prefix: "f", personality: "Friendly" }),
    generate: async (input) => { inputs.push(input); return generate(input); },
    ready: () => true, now: () => time,
  });
  return { service, inputs, advance: (ms = 61000) => { time += ms; } };
}

test("member roast parsing handles polite requests, nick mentions, and self targets without sending IDs", () => {
  for (const text of [`roast <@${member}>`, `can you roast <@!${member}>?`, `yo cook <@${member}> please`]) {
    const result = prepareRoastRequest(text, requester);
    assert.equal(result.kind, "member");
    assert.equal(result.targetId, member);
    assert.equal(result.prefix, `<@${member}> `);
    assert.ok(!result.text.includes(member));
    assert.match(result.text, /the mentioned member/);
  }
  assert.equal(prepareRoastRequest(`roast <@${requester}>`, requester).kind, "self");
  assert.equal(prepareRoastRequest(`roast <@${requester}>`, requester).text, "Roast me.");
});

test("unrelated mentions, stop requests, real questions and group pile-ons do not become member roasts", () => {
  for (const text of [`hello <@${member}>`, `don't roast <@${member}>`, `roast <@${member}> but how do I start mines?`]) {
    assert.equal(prepareRoastRequest(text, requester), null);
  }
  assert.deepEqual(prepareRoastRequest(`roast <@${member}> and <@${requester}>`, requester), { error: "multiple" });
});

test("member roast prompts address the target and require harmless, original one-line humor", () => {
  const messages = buildChatMessages({ text: "roast the mentioned member", roastTarget: "member" });
  assert.match(messages.at(-2).content, /PLAYFUL MEMBER ROAST/);
  assert.match(messages.at(-2).content, /Do not roast the requester instead/);
  assert.match(messages.at(-2).content, /NO names, labels, placeholders, or mentions/);
  assert.match(messages[0].content, /Stronger means cleverer, not crueler/);
  assert.match(messages[0].content, /Do not join attacks on third parties/);
  assert.match(buildChatMessages({ text: "hello", banterOptOut: true }).at(-2).content, /HELPFUL ONLY/);
});

test("a member roast edits ONE reply, identifies the right target, and never notifies them", async () => {
  const h = harness(async ({ onPartial }) => {
    await onPartial("Your confidence");
    return "Your confidence has a better launch trailer than the gameplay.";
  });
  const m = fixture(`<@bot> roast <@${member}>`);
  await h.service.handleMention(m);
  assert.equal(m.replies.length, 1);
  assert.equal(m.replies[0].content, `<@${member}> Your confidence has a better launch trailer than the gameplay.`);
  assert.deepEqual(m.replies[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(h.inputs[0].roastTarget, "member");
  assert.ok(!h.inputs[0].text.includes(member));
  h.advance();
  await h.service.handleMention(fixture("<@bot> hello"));
  assert.ok(!JSON.stringify(h.inputs[1].history).includes(member), "the model's conversation history must not contain target IDs");
});

test("a member cannot be repeatedly roasted by changing requester or channel", async () => {
  const h = harness();
  await h.service.handleMention(fixture(`<@bot> roast <@${member}>`));
  const blocked = fixture(`<@bot> roast <@${member}>`, "another-user", "another-channel");
  await h.service.handleMention(blocked);
  assert.equal(h.inputs.length, 1);
  assert.match(blocked.replies[0].content, /one roast per member per minute/);
  h.advance();
  await h.service.handleMention(fixture(`<@bot> roast <@${member}>`, "another-user"));
  assert.equal(h.inputs.length, 2);
});

test("target opt-outs apply immediately even when their own AI response is still pending", async () => {
  let release;
  const h = harness(() => new Promise((resolve) => { release = resolve; }));
  const stopping = h.service.handleMention(fixture("<@bot> stop roasting me", member));
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const blocked = fixture(`<@bot> roast <@${member}>`);
  await h.service.handleMention(blocked);
  assert.equal(h.inputs.length, 1);
  assert.match(blocked.replies[0].content, /asked to keep it friendly/);
  release("Got it.");
  await stopping;
});

test("failed AI responses do not discard a member's stop request", async () => {
  const h = harness(async () => { throw new Error("provider unavailable"); });
  await h.service.handleMention(fixture("<@bot> stop roasting me", member));
  const blocked = fixture(`<@bot> roast <@${member}>`);
  await h.service.handleMention(blocked);
  assert.equal(h.inputs.length, 1);
  assert.match(blocked.replies[0].content, /asked to keep it friendly/);
});

test("self-targets resume consensual banter, mixed help stays helpful, and group requests get one notice", async () => {
  const h = harness();
  await h.service.handleMention(fixture(`<@bot> roast <@${requester}>`));
  assert.equal(h.inputs[0].roastTarget, "self");
  h.advance();
  await h.service.handleMention(fixture(`<@bot> roast <@${member}> but how do I start mines?`));
  assert.equal(h.inputs[1].roastTarget, null);
  assert.match(buildChatMessages(h.inputs[1]).at(-2).content, /HELPFUL ONLY/);
  h.advance();
  const group = fixture(`<@bot> roast <@${member}> and <@${requester}>`);
  await h.service.handleMention(group);
  assert.equal(h.inputs.length, 2);
  assert.equal(group.replies.length, 1);
  assert.match(group.replies[0].content, /Pick one member/);
});
