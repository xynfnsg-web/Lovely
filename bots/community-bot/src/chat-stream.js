// Keep Discord edits off the token-reading path. At most one preview is in
// flight and one newer preview is retained; intermediate previews are discarded.
export function createPreviewDispatcher(callback, { intervalMs = 1250, now = Date.now } = {}) {
  let pending = null, running = null, timer = null, closed = false;
  let lastStarted = -Infinity;
  function pump() {
    if (closed || !callback || running || timer || pending === null) return;
    const delay = intervalMs - (now() - lastStarted);
    if (delay > 0) {
      timer = setTimeout(() => { timer = null; pump(); }, delay);
      return;
    }
    const text = pending;
    pending = null;
    lastStarted = now();
    running = Promise.resolve().then(() => callback(text)).catch(() => {
      // A preview is best effort. The final response still has its own delivery.
    }).finally(() => { running = null; pump(); });
  }
  return {
    push(text) {
      if (closed || !callback) return;
      pending = text;
      pump();
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      pending = null;
      // No old edit may arrive after the caller sends the final answer.
      if (running) await running;
    },
  };
}

export async function collectChatStream(stream, { onPartial, previewIntervalMs = 1250, now = Date.now } = {}) {
  const previews = createPreviewDispatcher(onPartial, { intervalMs: previewIntervalMs, now });
  let output = "";
  try {
    for await (const chunk of stream) {
      output += chunk.choices[0]?.delta?.content || "";
      output = output.slice(0, 1800);
      if (output.trim()) previews.push(output);
      if (output.length >= 1800) {
        stream.controller?.abort();
        break;
      }
    }
  } finally {
    await previews.close();
  }
  if (!output.trim()) throw new Error("AI_EMPTY_RESPONSE");
  return output.trim();
}
