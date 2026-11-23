// The receipt is committed BEFORE any moderation, rewards, commands or AI.
// Fail closed on database failure, and retain it even if execution fails:
// retrying an uncertain moderation action is worse than asking for a new command.
export function createMessageDispatcher({
  claim, prepare = async () => undefined, detectSpam, command, trivia, chat, award,
}) {
  return async (message) => {
    if (!message.guild || message.author.bot || !message.member) return false;
    // Configuration is a read, not a side effect: overlap it with the durable
    // receipt instead of paying two sequential database round trips. Await both
    // together so either failure is handled and all actions remain fail-closed.
    const [claimed, settings] = await Promise.all([claim(message), prepare(message)]);
    if (!claimed) return false;
    if (await detectSpam(message, settings)) return true;
    if (await command(message, settings)) return true;
    if (await trivia(message)) return true;
    if (await chat(message, settings)) return true;
    await award(message.guild.id, message.author.id, message, settings);
    return true;
  };
}
