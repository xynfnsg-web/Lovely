import test from "node:test";
import assert from "node:assert/strict";
import { collectChatStream, createPreviewDispatcher } from "../src/chat-stream.js";

const turn = () => new Promise((resolve) => setImmediate(resolve));
const chunk = (text) => ({ choices: [{ delta: { content: text } }] });

test("a slow Discord preview does not pause reading AI tokens or create an edit backlog", async () => {
  let release, read = 0, calls = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  async function* stream() {
    for (let i = 0; i < 100; i++) { read++; yield chunk("a"); }
  }
  const result = collectChatStream(stream(), {
    onPartial: async () => { calls++; await blocked; },
  });
  await turn();
  assert.equal(read, 100, "all tokens should be read while the preview is still waiting");
  assert.equal(calls, 1, "previews must be coalesced, not queued");
  release();
  assert.equal(await result, "a".repeat(100));
  await turn();
  assert.equal(calls, 1, "no stale preview may run after the final answer");
});

test("previews are serialized and closing waits for the in-flight edit", async () => {
  let release, completed = false;
  const edits = [];
  const dispatcher = createPreviewDispatcher(async (text) => {
    edits.push(text);
    await new Promise((resolve) => { release = resolve; });
  });
  dispatcher.push("first");
  await turn();
  dispatcher.push("second");
  dispatcher.push("latest");
  const closing = dispatcher.close().then(() => { completed = true; });
  await turn();
  assert.equal(completed, false);
  assert.deepEqual(edits, ["first"]);
  release();
  await closing;
  dispatcher.push("too late");
  assert.deepEqual(edits, ["first"]);
});

test("preview failures cannot erase the final answer and empty streams fail explicitly", async () => {
  async function* stream() { yield chunk("A"); yield chunk(" useful answer"); }
  assert.equal(await collectChatStream(stream(), { onPartial: async () => { throw new Error("Discord unavailable"); } }), "A useful answer");
  async function* empty() { yield { choices: [] }; }
  await assert.rejects(collectChatStream(empty()), /AI_EMPTY_RESPONSE/);
});

test("stream errors drain pending edits before surfacing and long replies stop generation", async () => {
  let release;
  async function* failing() { yield chunk("partial"); throw new Error("stream failed"); }
  const result = collectChatStream(failing(), {
    onPartial: async () => { await new Promise((resolve) => { release = resolve; }); },
  });
  const rejected = assert.rejects(result, /stream failed/);
  await turn();
  release();
  await rejected;
  let aborted = false;
  const stream = {
    controller: { abort: () => { aborted = true; } },
    async *[Symbol.asyncIterator]() { yield chunk("x".repeat(2000)); assert.fail("must not read past Discord's reply limit"); },
  };
  assert.equal((await collectChatStream(stream)).length, 1800);
  assert.equal(aborted, true);
});
