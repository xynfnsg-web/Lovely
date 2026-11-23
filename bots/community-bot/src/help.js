import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { createCard, colors } from "./presentation.js";
import { replyToMessage } from "./message-delivery.js";

const sections = {
  overview: {
    label: "Start here",
    description: "Your community tools in one place. Choose a category below, or use a category name after the help command.",
    commands: [
      ["help moderation", "Staff actions, warnings, and channel controls"],
      ["help community", "Games, member profiles, and points"],
      ["help leveling", "Chat XP, level-up mentions, and milestone roles"],
      ["help server", "Welcome messages, announcements, and preferences"],
      ["help security", "Join alerts, spam filters, and raid protection"],
      ["chat status", "Mention the bot to chat with AI; review privacy and status"],
    ],
  },
  moderation: {
    label: "Moderation",
    description: "Staff permissions and Discord role hierarchy apply. Actions are sent to your configured moderation log.",
    commands: [
      ["ban @member [reason]", "Ban a member"],
      ["kick @member [reason]", "Remove a member"],
      ["timeout @member 15m [reason]", "Apply a timeout, up to 28 days"],
      ["untimeout @member [reason]", "Remove an active timeout"],
      ["warn @member <reason>", "Save a persistent warning"],
      ["warnings @member", "Review the latest warnings"],
      ["clear <1-100>", "Delete recent messages"],
      ["slowmode <0-21600>", "Set slowmode in seconds; 0 disables it"],
      ["lock", "Lock the current channel for everyone"],
      ["unlock", "Restore the saved channel permissions"],
    ],
  },
  leveling: {
    label: "Chat leveling",
    description: "Earn 20 XP from an eligible chat message, at most once per minute. Commands, spam, short filler and repeated rewarded text earn no XP. Levels need increasing XP and are separate from spendable points.",
    commands: [
      ["rank [@member]", "View level, progress bar and server rank; alias: level"],
      ["leveltop", "See the server's top 10 chatters"],
      ["levelsetup #channel", "Staff: enable levels, set announcements and create milestone roles"],
      ["levelchannel #channel|off", "Staff: choose where level-ups mention members"],
      ["levelroles [5 15 25]", "Staff: create safe reward roles; no arguments uses 5, 10, 15, 25, 50, 75, 100"],
      ["levelroles remove <level>", "Staff: stop awarding that role without deleting existing roles"],
      ["levels on|off|status", "Staff: pause XP or review the configuration"],
    ],
  },
  community: {
    label: "Community & points",
    description: "Earn points through activity, daily rewards, and trivia. Wager 1–1,000 fictional points per game, with a shared 5-second cooldown. No purchases, transfers, cash value, or cash payouts. Returns below include the original stake.",
    commands: [
      ["daily", "Claim your daily points"],
      ["profile [@member]", "View a member profile and balance"],
      ["leaderboard", "See the server's top 10 balances"],
      ["trivia", "Start a 30-second trivia round"],
      ["8ball <question>", "Ask the magic 8-ball"],
      ["coinflip", "Flip a coin, just for fun"],
      ["rps <rock|paper|scissors>", "Play against the bot"],
      ["compliment [@member]", "Send some encouragement"],
      ["joke", "Get a clean joke"],
      ["random [min] [max]", "Generate a random whole number"],
      ["slots <points>", "Three matching symbols: 10× return; one pair: stake returned"],
      ["dice <points> <1-6>", "Guess a die roll for a 5× total return"],
      ["roulette <points> <red|black|0-36>", "Color: 2× return; exact number: 36×; zero is green"],
      ["mines <points> [1-5 mines]", "4×4 button board. Reveal safe tiles and collect; a mine loses the stake"],
      ["blackjack <points>", "Hit or stand; alias: bj. Natural blackjack pays 3:2; dealer stands on 17"],
      ["mines / blackjack", "No arguments resumes your active game. One table at a time; expires after 10 minutes"],
    ],
  },
  server: {
    label: "Server management",
    description: "Staff can customize the server experience. Message templates support {user}, {username}, and {server}.",
    commands: [
      ["prefix <prefix>", "Change the prefix, from 1 to 5 characters"],
      ["log #channel|off", "Set the moderation and security log"],
      ["welcome #channel [message]|off", "Set welcome messages"],
      ["goodbye #channel [message]|off", "Set goodbye messages"],
      ["response welcome|goodbye|spam|spamtimeout <message>", "Customize a response"],
      ["announce #channel <message>", "Publish an announcement without mass pings"],
      ["settings", "View the current server configuration"],
      ["chat on|off|status|reset", "Staff toggle chat; anyone can reset their own memory"],
      ["personality <tone>|reset", "Staff customize the AI's tone; safety rules stay active"],
      ["steal <custom emoji> [name]", "Staff: copy one emoji into this server"],
      ["steal sticker <ID> [name]", "Staff: copy a sticker; or reply to a sticker with the steal command"],
    ],
  },
  security: {
    label: "Security",
    description: "Staff-only controls. Automatic verification requires Manage Server permission. Start with the status command to review current settings.",
    commands: [
      ["security status", "View all protection settings"],
      ["security raid on|off", "Toggle rapid-join alerts"],
      ["security spam on|off", "Toggle spam detection"],
      ["security autotimeout on|off", "Toggle repeat-offender timeouts"],
      ["security autoverify on|off", "Temporarily raise verification during a raid"],
      ["security threshold <3-100> <5-120>", "Join count and window in seconds"],
      ["security spamlimit <2-50> <2-60>", "Message count and window in seconds"],
      ["security repeats <2-10>", "Matching messages needed to trigger detection"],
    ],
  },
};

export function helpPayload(message, prefix, section = "overview", disabled = false) {
  const current = Object.hasOwn(sections, section) ? sections[section] : sections.overview;
  const menu = new StringSelectMenuBuilder()
    .setCustomId("community-help")
    .setPlaceholder("Choose a command category")
    .setDisabled(disabled)
    .addOptions(Object.entries(sections).map(([value, page]) => ({
      label: page.label, value, default: page === current,
    })));
  const embed = createCard(message, {
    title: `Command guide · ${current.label}`,
    description: current.description,
    color: colors.primary,
    fields: [
      { name: "Current prefix", value: `\`${prefix}\``, inline: true },
      { name: "Quick start", value: `\`${prefix}daily\` · \`${prefix}profile\``, inline: true },
      ...current.commands.map(([usage, detail]) => ({
        name: `${prefix}${usage}`,
        value: detail,
      })),
    ],
    footer: disabled ? "Menu expired · Run the help command to open a new guide" : "Only you can change this menu · Available for 2 minutes",
  });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], allowedMentions: { parse: [], repliedUser: false } };
}

export async function showHelp(message, prefix, section) {
  let selected = Object.hasOwn(sections, section) ? section : "overview";
  const sent = await replyToMessage(message, helpPayload(message, prefix, selected));
  const collector = sent.createMessageComponentCollector({ time: 120_000 });
  collector.on("collect", async (interaction) => {
    try {
      if (interaction.user.id !== message.author.id) {
        await interaction.reply({ content: "Run the help command to open your own menu.", flags: 64 });
        return;
      }
      selected = interaction.values[0];
      await interaction.update(helpPayload(message, prefix, selected));
    } catch (error) {
      process.stderr.write(`[help-menu] ${error.message.slice(0, 300)}\n`);
    }
  });
  collector.on("end", () => {
    sent.edit(helpPayload(message, prefix, selected, true)).catch(() => {});
  });
}
