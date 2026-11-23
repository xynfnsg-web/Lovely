// Discord also deduplicates sends across copies using different databases.
// Keep this nonce stable for the same source message across every command.
export function responseOptions(message, options, suffix = "") {
  return {
    ...options,
    nonce: message.id ? `${message.id}${suffix}` : undefined,
    enforceNonce: Boolean(message.id),
  };
}

function recordDelivery(message, sent, suffix) {
  if (message.id && sent?.id) process.stdout.write(
    `[bot-response] source=${message.id} response=${sent.id} kind=${suffix ? "replacement" : "primary"}\n`,
  );
  return sent;
}

export async function replyToMessage(message, options, suffix = "") {
  const sent = await message.reply(responseOptions(message, options, suffix));
  return recordDelivery(message, sent, suffix);
}

export async function sendToMessageChannel(message, options) {
  // Used when a command cannot be replied to (for example, after fclear).
  const sent = await message.channel.send(responseOptions(message, options));
  return recordDelivery(message, sent, "");
}
