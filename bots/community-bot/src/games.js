import { parseWager, playGame } from "./game-rules.js";
import { settleWager } from "./wagers.js";
import { createCard, colors, replyCard } from "./presentation.js";
import { logRuntimeError } from "./security.js";
import { replyToMessage } from "./message-delivery.js";

export async function gameCommand(message, args, game) {
  const stake = parseWager(args[0]);
  const choice = args[1]?.toLowerCase();
  const usage = game === "slots" ? "fslots <points>" : game === "dice"
    ? "fdice <points> <1-6>" : "froulette <points> <red|black|0-36>";
  if (!stake || args.length !== (game === "slots" ? 1 : 2)) {
    return replyCard(message, `Usage: \`${usage}\`\nWager 1–1,000 fictional points. No purchases, cash value, or cash payouts.`);
  }
  let outcome;
  try {
    outcome = playGame(game, choice);
  } catch (error) {
    return replyCard(message, `${error.message}\nUsage: \`${usage}\``);
  }
  const result = await settleWager({
    messageId: message.id, guildId: message.guild.id, userId: message.author.id,
    game, stake, multiplier: outcome.multiplier,
  });
  if (result.status === "duplicate") return;
  if (result.status !== "settled") {
    return replyCard(message, "You need enough points to cover the entire wager, and the result must fit the balance limit. Check `fprofile` or claim `fdaily`.");
  }
  const title = result.net > 0 ? "You won" : result.net === 0 ? "Stake returned" : "No win this round";
  // Do not attempt settlement again if delivery fails after the balance commits.
  await replyToMessage(message, {
    embeds: [createCard(message, {
      title: `${game[0].toUpperCase()}${game.slice(1)} · ${title}`,
      description: outcome.detail,
      color: result.net > 0 ? colors.success : colors.warning,
      fields: [
        { name: "Wager", value: `${stake} points`, inline: true },
        { name: "Total return", value: `${result.payout} points`, inline: true },
        { name: "Net change", value: `${result.net >= 0 ? "+" : ""}${result.net} points`, inline: true },
        { name: "New balance", value: `${result.balance.toLocaleString()} points`, inline: true },
      ],
      footer: "Fictional points only · No cash value · Returns include your stake",
    })],
    nonce: message.id,
    enforceNonce: true,
    allowedMentions: { parse: [], repliedUser: false },
  }).catch((error) => logRuntimeError("game-result-delivery", error));
}
