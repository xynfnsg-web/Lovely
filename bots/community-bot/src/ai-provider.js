import { openai } from "@workspace/integrations-openai-ai-server/client";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch-utils";
import { config } from "./config.js";
import { buildChatMessages } from "./chat-prompt.js";
import { collectChatStream } from "./chat-stream.js";

export async function generateChatReply({ text, history, personality, prefix, roastTarget, banterOptOut, onPartial }) {
  const [answer] = await batchProcess([text], async (input) => {
    const stream = await openai.chat.completions.create({
      model: config.aiModel,
      store: false,
      max_completion_tokens: 8192,
      stream: true,
      reasoning_effort: "low",
      messages: buildChatMessages({ text: input, history, personality, prefix, roastTarget, banterOptOut }),
    }, { timeout: 30_000, maxRetries: 0, signal: AbortSignal.timeout(35_000) });
    return collectChatStream(stream, { onPartial });
  }, { concurrency: 1, retries: 1, minTimeout: 750, maxTimeout: 1500 });
  return answer;
}
