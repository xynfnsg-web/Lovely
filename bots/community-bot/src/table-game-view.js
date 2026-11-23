import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { createCard, colors } from "./presentation.js";
import { cardLabel, handValue } from "./table-game-rules.js";
import { minesGamePayload } from "./mines-view.js";

export function tableGamePayload(message, session, resumed = false) {
  if (session.game === "mines") return minesGamePayload(message, session, resumed);
  const state = session.state, finished = session.status === "finished";
  const button = (action, label, style = ButtonStyle.Primary, disabled = finished) =>
    new ButtonBuilder().setCustomId(`play:${session.id}:${session.version}:${action}`)
      .setLabel(label).setStyle(style).setDisabled(disabled);
  const rows = [];
  const description = [
    `<@${session.user_id}>'s game`,
    resumed ? "**Existing game resumed. No additional points charged.**" : null,
    finished ? state.result : `Finish before <t:${Math.floor(Number(session.expires_at) / 1000)}:R>.`,
  ].filter(Boolean);
  const fields = [{ name: "Stake", value: `${session.stake} points`, inline: true }];
    fields.push(
      { name: `Your hand · ${handValue(state.player)}`, value: state.player.map(cardLabel).join(" · ") },
      {
        name: finished ? `Dealer · ${handValue(state.dealer)}` : "Dealer · hidden card",
        value: finished ? state.dealer.map(cardLabel).join(" · ") : `${cardLabel(state.dealer[0])} · Hidden`,
      },
    );
    rows.push(new ActionRowBuilder().addComponents(button("hit", "Hit"), button("stand", "Stand", ButtonStyle.Secondary)));
    if (finished) fields.push({ name: "Total return", value: `${state.payout} points`, inline: true });
    else description.push("Dealer stands on all 17s. Blackjack pays 3:2; other wins pay 1:1. No splits, doubles, or insurance.");
  if (finished) fields.push({ name: "Net change", value: `${state.payout - session.stake >= 0 ? "+" : ""}${state.payout - session.stake} points`, inline: true });
  fields.push({ name: finished ? "Balance after settlement" : "Balance after placing stake", value: `${Number(session.balance_after).toLocaleString()} points`, inline: true });
  return {
    embeds: [createCard(message, {
      title: `${session.game === "mines" ? "Mines · 4 × 4" : "Blackjack"}${finished ? " · Round complete" : ""}`,
      description: description.join("\n\n"), fields,
      color: finished ? state.payout > session.stake ? colors.success : colors.warning : colors.primary,
      footer: "Fictional points only · Total returns include stake · Fractions round down",
    })],
    components: rows, allowedMentions: { parse: [], repliedUser: false },
  };
}
