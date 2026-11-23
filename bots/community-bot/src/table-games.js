import { parseWager } from "./game-rules.js";
import { replyCard } from "./presentation.js";
import { logRuntimeError } from "./security.js";
import * as store from "./table-game-store.js";
import { tableGamePayload } from "./table-game-view.js";
import { replyToMessage } from "./message-delivery.js";

export function createTableGameHandlers({ persistence = store, say = replyCard } = {}) {
  return {
    async command(message, args, game) {
      const usage = game === "mines" ? "fmines <points> [1-5 mines]" : "fblackjack <points>";
      let result;
      if (!args.length) {
        const session = await persistence.resumeTableGame(message.guild.id, message.author.id);
        if (session) result = { status: "resumed", session };
      } else {
        const stake = parseWager(args[0]);
        const mines = args[1] === undefined ? 3 : /^[1-5]$/.test(args[1]) ? Number(args[1]) : null;
        if (!stake || !mines || args.length > (game === "mines" ? 2 : 1)) {
          return say(message, `Usage: \`${usage}\`. Stake 1–1,000 fictional points. Run the command without arguments to resume an active game.`);
        }
        result = await persistence.openTableGame({
          id: message.id, guildId: message.guild.id, userId: message.author.id,
          channelId: message.channel.id, game, stake, mines,
        });
      }
      if (!result) return say(message, `Usage: \`${usage}\`. You have no active table game. Use fictional points only.`);
      if (result.status === "duplicate") return;
      if (result.status === "insufficient") return say(message, "You need enough points for the whole stake. Check `fprofile` or claim `fdaily`.");
      const sent = await replyToMessage(message, {
        ...tableGamePayload(message, result.session, result.status === "resumed"),
        nonce: message.id, enforceNonce: true,
      });
      await persistence.attachGameMessage(result.session.id, sent.channelId || message.channel.id, sent.id);
    },

    async interaction(interaction) {
      if (!interaction.isButton() || !interaction.customId.startsWith("play:")) return false;
      await interaction.deferUpdate();
      const match = /^play:(\d{17,20}):(\d{1,10}):(hit|stand|cashout|[0-9]|1[0-5])$/.exec(interaction.customId);
      if (!match || !interaction.guildId) {
        await interaction.followUp({ content: "That game button isn't valid.", flags: 64, allowedMentions: { parse: [] } });
        return true;
      }
      try {
        const result = await persistence.actOnTableGame({
          id: match[1], guildId: interaction.guildId, userId: interaction.user.id,
          version: Number(match[2]), action: match[3],
        });
        if (result.status === "forbidden" || result.status === "missing") {
          await interaction.followUp({
            content: result.status === "forbidden" ? "Only the player who started this game can use its buttons." : "This game isn't available in this server.",
            flags: 64, allowedMentions: { parse: [] },
          });
        } else {
          await interaction.editReply(tableGamePayload(interaction.message, result.session));
        }
      } catch (error) {
        logRuntimeError("table-game-action", error);
        await interaction.followUp({
          content: "I couldn't update that game. Use the game command without arguments to reload its saved state; your stake won't be charged again.",
          flags: 64, allowedMentions: { parse: [] },
        }).catch(() => {});
      }
      return true;
    },
  };
}

export const tableGames = createTableGameHandlers();

export function startTableGameExpiryWorker(client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const expired = await store.expireTableGames();
      for (const session of expired) {
        if (!session.reply_id) continue;
        try {
          const channel = await client.channels.fetch(session.channel_id);
          const message = await channel?.messages?.fetch(session.reply_id);
          if (message) await message.edit(tableGamePayload(message, session));
        } catch {
          // Settlement is committed even if the board was deleted or inaccessible.
        }
      }
    } catch (error) {
      logRuntimeError("table-game-expiry", error);
    } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
