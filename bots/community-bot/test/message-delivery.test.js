import test from "node:test";
import assert from "node:assert/strict";
import { responseOptions, replyToMessage, sendToMessageChannel } from "../src/message-delivery.js";

test("all command transports share one stable nonce across copies and preserve payloads", async () => {
  const id = "123456789012345678";
  const payload = { content: "Hello", components: [], allowedMentions: { parse: [] } };
  const seen = new Map();
  let created = 0;
  const discord = async (options) => {
    assert.equal(options.enforceNonce, true);
    assert.equal(options.nonce, id);
    assert.deepEqual(options.allowedMentions, payload.allowedMentions);
    if (!seen.has(options.nonce)) seen.set(options.nonce, { id: `response-${++created}` });
    return seen.get(options.nonce);
  };
  const a = { id, reply: discord, channel: { send: discord } };
  const b = { id, reply: discord, channel: { send: discord } };
  const sent = await Promise.all([
    replyToMessage(a, payload), replyToMessage(b, payload), sendToMessageChannel(a, payload),
  ]);
  assert.equal(created, 1);
  assert.ok(sent.every((entry) => entry.id === sent[0].id));
  assert.equal(responseOptions(a, payload, ":f").nonce, `${id}:f`);
  assert.notEqual(responseOptions({ id: `${BigInt(id) + 1n}` }, payload).nonce, id);
});

test("delivery failures are explicit and do not trigger hidden retries", async () => {
  let calls = 0;
  await assert.rejects(replyToMessage({ id: "123456789012345678", reply: async () => {
    calls++;
    throw new Error("Discord delivery failed");
  } }, { content: "Test" }), /Discord delivery failed/);
  assert.equal(calls, 1);
});
