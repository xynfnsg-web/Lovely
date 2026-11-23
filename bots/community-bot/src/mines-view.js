import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { createCard, colors } from "./presentation.js";
import { minesReturn } from "./table-game-rules.js";

export function minesGamePayload(message, session, resumed = false) {
  const state = session.state;
  const finished = session.status === "finished";
  const hitMine = Number.isInteger(state.hit);
  const found = state.revealed.length;
  const mines = state.mines.length;
  const safeTotal = 16 - mines;
  const current = finished ? state.payout : minesReturn(session.stake, mines, found);
  const points = (value) => `**${value.toLocaleString()}** pts`;
  const returned = (value) => `${points(value)} · **${(value / session.stake).toFixed(2)}×**`;
  const description = [
    `<@${session.user_id}> · **Find gems. Avoid mines.**`,
    resumed ? "Your saved board · **No extra stake charged.**" : null,
    finished ? state.result : "Tap a covered tile to reveal it. Collect after a gem, or risk another pick.",
    `\`${"▰".repeat(found)}${"▱".repeat(safeTotal - found)}\` **${found}/${safeTotal} gems**`,
    "🟦 Covered · 💎 Gem · 💣 Mine",
  ].filter(Boolean);
  const fields = [
    { name: "Stake", value: points(session.stake), inline: true },
    { name: "Mines", value: `**${mines}** / 16 tiles`, inline: true },
    { name: "Gems found", value: `**${found}** / ${safeTotal}`, inline: true },
    {
      name: finished ? "Total returned" : "Collect now",
      value: !finished && !found ? "Reveal a gem first" : returned(current), inline: true,
    },
  ];
  if (!finished) {
    fields.push(
      { name: "Next gem return", value: returned(minesReturn(session.stake, mines, found + 1)), inline: true },
      { name: "Next pick is safe", value: `**${((safeTotal - found) / (16 - found) * 100).toFixed(1)}%**`, inline: true },
    );
    description.push(`Board closes <t:${Math.floor(Number(session.expires_at) / 1000)}:R> · Safe returns collect automatically.`);
  } else {
    fields.push({
      name: "Net result",
      value: `**${current - session.stake >= 0 ? "+" : ""}${current - session.stake}** pts`, inline: true,
    });
  }
  fields.push({
    name: finished ? "Balance after round" : "Balance after stake",
    value: points(Number(session.balance_after)), inline: true,
  });

  const rows = Array.from({ length: 4 }, (_, row) => new ActionRowBuilder().addComponents(
    Array.from({ length: 4 }, (_, column) => {
      const tile = row * 4 + column;
      const picked = state.revealed.includes(tile);
      const mine = finished && state.mines.includes(tile);
      const emoji = mine ? state.hit === tile ? "💥" : "💣" : picked || finished ? "💎" : "🟦";
      return new ButtonBuilder()
        .setCustomId(`play:${session.id}:${session.version}:${tile}`)
        .setLabel(String(tile + 1).padStart(2, "0"))
        .setEmoji(emoji)
        .setStyle(mine ? ButtonStyle.Danger : picked ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(finished || picked);
    }),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`play:${session.id}:${session.version}:cashout`)
      .setEmoji(finished ? hitMine ? "💣" : "✅" : "💰")
      .setLabel(finished ? "Round finished" : found ? `Collect ${current.toLocaleString()} points` : "Reveal a gem to collect")
      .setStyle(hitMine ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(finished || !found),
  ));

  return {
    embeds: [createCard(message, {
      title: finished ? hitMine ? "💥 MINES · Mine hit" : "💎 MINES · Points collected" : "💎 MINES · 4 × 4",
      description: description.join("\n\n"), fields,
      color: hitMine ? colors.error : finished ? colors.success : 0x14b8a6,
      footer: "Fictional points only · Returns include stake · 3% house edge before rounding",
    })],
    components: rows,
    allowedMentions: { parse: [], repliedUser: false },
  };
}
