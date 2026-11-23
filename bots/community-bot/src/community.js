import { replyCard as say, createCard, colors } from "./presentation.js";
import { replyToMessage, sendToMessageChannel } from "./message-delivery.js";
import { userIdFrom } from "./format.js";
import { levelService } from "./level-service.js";
import { levelProgress } from "./level-rules.js";
import {
  addPoints,
  claimDaily,
  getEconomy,
  getLeaderboard,
} from "./storage.js";

const eightBallAnswers = [
  "Yes, definitely.",
  "It looks likely.",
  "Signs point to yes.",
  "Ask again in a little while.",
  "I can't predict that one.",
  "Probably not.",
  "The outlook isn't great.",
  "No, not this time.",
];

const compliments = [
  "You make this community a better place.",
  "You have a great way of making people feel welcome.",
  "Your contributions don't go unnoticed.",
  "You bring a lot of good energy to the server.",
  "You're thoughtful, helpful, and appreciated.",
  "You have a knack for making a tough day better.",
];

const jokes = [
  "Why did the scarecrow get promoted? They were outstanding in their field.",
  "I told my computer I needed a break. It said, “No problem — I'll go to sleep.”",
  "Why don't scientists trust atoms? Because they make up everything.",
  "I tried to organize a hide-and-seek tournament, but good players are hard to find.",
  "What do you call a group of musical whales? An orca-stra.",
];

const triviaQuestions = [
  {
    question: "Which planet has the most moons currently confirmed?",
    options: ["Earth", "Saturn", "Mars", "Venus"],
    answer: "Saturn",
  },
  {
    question: "What is the largest ocean on Earth?",
    options: ["Atlantic", "Indian", "Pacific", "Arctic"],
    answer: "Pacific",
  },
  {
    question: "Which element has the chemical symbol Fe?",
    options: ["Fluorine", "Iron", "Francium", "Fermium"],
    answer: "Iron",
  },
  {
    question: "How many sides does a hexagon have?",
    options: ["5", "6", "7", "8"],
    answer: "6",
  },
  {
    question: "Which language is primarily spoken in Brazil?",
    options: ["Spanish", "Portuguese", "French", "Italian"],
    answer: "Portuguese",
  },
];

const triviaGames = new Map();

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export async function eightBallCommand(message, args) {
  const question = args.join(" ").trim();
  if (!question) return say(message, "Ask a question. Example: `f8ball will we win?`");
  const embed = createCard(message, { title: "Magic 8-ball" })
    .addFields(
      { name: "Question", value: question.slice(0, 1000) },
      { name: "Answer", value: randomItem(eightBallAnswers) },
    );
  await replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [] } });
}

export async function coinflipCommand(message) {
  const result = Math.random() < 0.5 ? "Heads" : "Tails";
  await say(message, `The coin landed on **${result}**.\n\nJust for fun. No points or wagers involved.`, { title: "Coin flip", color: colors.primary });
}

export async function triviaCommand(message) {
  if (triviaGames.has(message.channel.id)) {
    return say(message, "A trivia question is already active in this channel.");
  }

  const question = randomItem(triviaQuestions);
  const shuffled = [...question.options].sort(() => Math.random() - 0.5);
  const embed = createCard(message, { title: "Quick trivia", color: colors.success })
    .setDescription(
      `${question.question}\n\n${shuffled.map((option, index) => `**${index + 1}.** ${option}`).join("\n")}\n\nReply with the answer or its number. First correct answer wins 15 points.`,
    )
    .setFooter({ text: "This question closes in 30 seconds." });
  await sendToMessageChannel(message, { embeds: [embed], allowedMentions: { parse: [] } });

  const game = { answer: question.answer.toLowerCase(), options: shuffled };
  game.timer = setTimeout(async () => {
    if (triviaGames.get(message.channel.id) !== game) return;
    triviaGames.delete(message.channel.id);
    await message.channel
      .send({
        content: `Time's up. The answer was **${question.answer}**.`,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }, 30_000);
  game.timer.unref?.();
  triviaGames.set(message.channel.id, game);
}

export async function handleTriviaAnswer(message) {
  const game = triviaGames.get(message.channel.id);
  if (!game || message.author.bot) return false;

  const answer = message.content.trim().toLowerCase();
  const numberedChoice = /^\d+$/.test(answer)
    ? game.options[Number(answer) - 1]?.toLowerCase()
    : null;
  if (answer !== game.answer && numberedChoice !== game.answer) return false;

  clearTimeout(game.timer);
  triviaGames.delete(message.channel.id);
  const points = await addPoints(message.guild.id, message.author.id, 15);
  await sendToMessageChannel(message, {
    content: `Correct, <@${message.author.id}>! You earned 15 points and now have ${points}.`,
    allowedMentions: { parse: [], users: [message.author.id] },
  });
  return true;
}

export async function rpsCommand(message, args) {
  const options = ["rock", "paper", "scissors"];
  const player = args[0]?.toLowerCase();
  if (!options.includes(player)) {
    return say(message, "Choose one: `frps rock`, `frps paper`, or `frps scissors`.");
  }

  const bot = randomItem(options);
  const outcome =
    player === bot
      ? "It's a tie."
      : (player === "rock" && bot === "scissors") ||
          (player === "paper" && bot === "rock") ||
          (player === "scissors" && bot === "paper")
        ? "You win."
        : "I win.";
  await say(message, `**Your choice:** ${player}\n**Bot's choice:** ${bot}\n\n**${outcome}**`, { title: "Rock · Paper · Scissors", color: colors.primary });
}

export async function complimentCommand(message, args) {
  const mentioned = message.mentions.users.first();
  const targetId = mentioned?.id || userIdFrom(args[0]) || message.author.id;
  const target =
    mentioned ||
    (targetId === message.author.id
      ? message.author
      : await message.client.users.fetch(targetId).catch(() => null));
  if (!target) return say(message, "I couldn't find that user.");
  await sendToMessageChannel(message, {
    embeds: [createCard(message, { title: "A compliment for you", description: `<@${target.id}>\n\n${randomItem(compliments)}`, color: colors.success })],
    allowedMentions: { parse: [] },
  });
}

export async function jokeCommand(message) {
  await say(message, randomItem(jokes), { title: "A little comic relief", color: colors.primary });
}

export async function randomCommand(message, args) {
  let min = 1;
  let max = 100;
  if (args.length === 1) max = Number(args[0]);
  if (args.length >= 2) {
    min = Number(args[0]);
    max = Number(args[1]);
  }
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    max < min ||
    min < -1_000_000_000 ||
    max > 1_000_000_000
  ) {
    return say(message, "Usage: `frandom [min] [max]` with whole numbers in range.");
  }
  await say(message, `**${Math.floor(Math.random() * (max - min + 1)) + min}**\n\nSelected between ${min.toLocaleString()} and ${max.toLocaleString()}.`, { title: "Random number", color: colors.primary });
}

export async function profileCommand(message, args) {
  const targetId = message.mentions.users.first()?.id || userIdFrom(args[0]) || message.author.id;
  const [member, economy, leveling] = await Promise.all([
    Promise.resolve(message.guild.members.cache.get(targetId) ??
      message.guild.members.fetch(targetId)).catch(() => null),
    getEconomy(message.guild.id, targetId),
    levelService.store.member(message.guild.id, targetId),
  ]);
  if (!member) return say(message, "That user isn't a member of this server.");

  const { points } = economy;
  const progress = levelProgress(Number(leveling.xp));
  const embed = createCard(message, { title: "Member profile", color: member.displayColor || colors.primary })
    .setColor(member.displayColor || 0x5865f2)
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Point balance", value: `**${points.toLocaleString()}**`, inline: true },
      { name: "Chat level", value: `**Level ${progress.level}** · ${Number(leveling.xp).toLocaleString()} XP\n${progress.bar}\n${progress.remaining.toLocaleString()} XP to next level`, inline: true },
      {
        name: "Joined server",
        value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
          : "Unknown",
        inline: true,
      },
      {
        name: "Account created",
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`,
        inline: true,
      },
    );
  await replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [] } });
}

export async function dailyCommand(message) {
  const result = await claimDaily(message.guild.id, message.author.id);
  if (!result.claimed) {
    return say(
      message,
      `You've already claimed today's 25 points. Try again <t:${Math.floor(result.nextAt / 1000)}:R>.`,
    );
  }
  await say(message, `**+25 points** added to your balance.\n\n**Total balance** · ${result.points.toLocaleString()} points\n**Next reward** · <t:${Math.floor(result.nextAt / 1000)}:R>`, { title: "Daily reward claimed" });
}

export async function leaderboardCommand(message) {
  const rows = await getLeaderboard(message.guild.id, 10);
  if (rows.length === 0) return say(message, "No points have been earned yet.");
  const description = rows
    .map((row, index) => `**${String(index + 1).padStart(2, "0")}**  <@${row.user_id}>\n${row.points.toLocaleString()} points`)
    .join("\n\n");
  const embed = createCard(message, { title: "Community leaderboard", color: 0xfee75c, description, footer: `${message.guild.name} · Top 10 · Points have no cash value` });
  await replyToMessage(message, { embeds: [embed], allowedMentions: { parse: [] } });
}

export function getCommunityHelp() {
  return [
    "`f8ball <question>`",
    "`fcoinflip` (no points or wagers)",
    "`ftrivia`",
    "`frps <rock|paper|scissors>`",
    "`fcompliment [@member]`",
    "`fjoke`",
    "`frandom [min] [max]`",
    "`fprofile [@member]`",
    "`fdaily`",
    "`fleaderboard`",
    "`fslots <points>`",
    "`fdice <points> <1-6>`",
    "`froulette <points> <red|black|0-36>`",
    "`fmines <points> [1-5 mines]`",
    "`fblackjack <points>` (or `fbj`)",
  ].join("\n");
}
