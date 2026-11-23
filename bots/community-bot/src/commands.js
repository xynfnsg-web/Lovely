import {
  banCommand,
  clearCommand,
  kickCommand,
  lockCommand,
  slowmodeCommand,
  timeoutCommand,
  unlockCommand,
  warnCommand,
  warningsCommand,
} from "./moderation.js";
import {
  announceCommand,
  logChannelCommand,
  prefixCommand,
  responseCommand,
  securityCommand,
  settingsCommand,
  welcomeChannelCommand,
} from "./admin.js";
import {
  coinflipCommand,
  complimentCommand,
  dailyCommand,
  eightBallCommand,
  jokeCommand,
  leaderboardCommand,
  profileCommand,
  randomCommand,
  rpsCommand,
  triviaCommand,
} from "./community.js";
import { getGuildSettings } from "./storage.js";
import { logRuntimeError } from "./security.js";
import { showHelp } from "./help.js";
import { replyCard, colors } from "./presentation.js";
import { chatService } from "./chat.js";
import { gameCommand } from "./games.js";
import { stealCommand } from "./steal.js";
import { tableGames } from "./table-games.js";
import { levelCommands } from "./level-commands.js";

const cooldowns = new Map();
const funCommands = new Set([
  "8ball",
  "coinflip",
  "trivia",
  "rps",
  "compliment",
  "joke",
  "random",
  "profile",
  "daily",
  "leaderboard",
  "slots",
  "dice",
  "roulette",
]);

const handlers = {
  rank: (message, args) => levelCommands.rank(message, args),
  level: (message, args) => levelCommands.rank(message, args),
  leveltop: (message) => levelCommands.top(message),
  levels: (message, args) => levelCommands.configure(message, args, "levels"),
  levelsetup: (message, args) => levelCommands.configure(message, args, "levelsetup"),
  levelchannel: (message, args) => levelCommands.configure(message, args, "levelchannel"),
  levelroles: (message, args) => levelCommands.configure(message, args, "levelroles"),
  mines: (message, args) => tableGames.command(message, args, "mines"),
  blackjack: (message, args) => tableGames.command(message, args, "blackjack"),
  bj: (message, args) => tableGames.command(message, args, "blackjack"),
  slots: (message, args) => gameCommand(message, args, "slots"),
  dice: (message, args) => gameCommand(message, args, "dice"),
  roulette: (message, args) => gameCommand(message, args, "roulette"),
  steal: (message, args) => stealCommand(message, args),
  chat: (message, args) => chatService.chatCommand(message, args),
  personality: (message, args) => chatService.personalityCommand(message, args),
  ban: (message, args) => banCommand(message, args),
  kick: (message, args) => kickCommand(message, args),
  timeout: (message, args) => timeoutCommand(message, args),
  untimeout: (message, args) => timeoutCommand(message, args, true),
  warn: (message, args) => warnCommand(message, args),
  warnings: (message, args) => warningsCommand(message, args),
  clear: (message, args) => clearCommand(message, args),
  slowmode: (message, args) => slowmodeCommand(message, args),
  lock: (message) => lockCommand(message),
  unlock: (message) => unlockCommand(message),
  "8ball": (message, args) => eightBallCommand(message, args),
  coinflip: (message) => coinflipCommand(message),
  trivia: (message) => triviaCommand(message),
  rps: (message, args) => rpsCommand(message, args),
  compliment: (message, args) => complimentCommand(message, args),
  joke: (message) => jokeCommand(message),
  random: (message, args) => randomCommand(message, args),
  profile: (message, args) => profileCommand(message, args),
  daily: (message) => dailyCommand(message),
  leaderboard: (message) => leaderboardCommand(message),
  prefix: (message, args) => prefixCommand(message, args),
  log: (message, args) => logChannelCommand(message, args),
  welcome: (message, args) => welcomeChannelCommand(message, args, "welcome"),
  goodbye: (message, args) => welcomeChannelCommand(message, args, "goodbye"),
  response: (message, args) => responseCommand(message, args),
  announce: (message, args) => announceCommand(message, args),
  security: (message, args) => securityCommand(message, args),
  settings: (message) => settingsCommand(message),
};

function hasCooldown(message, commandName) {
  const wager = ["slots", "dice", "roulette", "mines", "blackjack", "bj"].includes(commandName);
  const cooldownMs = wager ? 5_000 : commandName === "steal" ? 10_000 : funCommands.has(commandName) ? 3_000 : 1_500;
  const key = `${message.guild.id}:${message.author.id}:${wager ? "wager" : commandName}`;
  const now = Date.now();
  const expiresAt = cooldowns.get(key) || 0;
  if (now < expiresAt) return true;
  cooldowns.set(key, now + cooldownMs);

  if (cooldowns.size > 5_000) {
    for (const [cooldownKey, value] of cooldowns) {
      if (value <= now) cooldowns.delete(cooldownKey);
    }
  }
  return false;
}

export async function handleCommandMessage(message, preparedSettings) {
  if (!message.guild || message.author.bot || !message.member) return false;

  const prefix = (preparedSettings ?? await getGuildSettings(message.guild.id)).prefix;
  if (!prefix || !message.content.startsWith(prefix)) return false;

  const commandLine = message.content.slice(prefix.length).trim();
  if (!commandLine) return true;

  const parts = commandLine.split(/\s+/);
  const commandName = parts.shift().toLowerCase();
  const args = parts;

  if (commandName === "help" || commandName === "commands") {
    if (hasCooldown(message, "help")) return true;
    await showHelp(message, prefix, args[0]?.toLowerCase());
    return true;
  }

  const handler = handlers[commandName];
  if (!handler) return false;
  if (hasCooldown(message, commandName)) return true;

  try {
    await handler(message, args);
  } catch (error) {
    logRuntimeError(`command:${commandName}`, error);
    await replyCard(message,
      "That command couldn't be completed. Check the bot's permissions and role position, then try again. If it continues, staff can check the bot logs.",
      { title: "Command failed", color: colors.error })
      .catch(() => {});
  }
  return true;
}
