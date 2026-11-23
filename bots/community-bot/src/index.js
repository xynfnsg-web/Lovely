import dns from "node:dns";
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { config, validateConfig } from "./config.js";
import { database, ensureGuildSettings, getGuildSettings, awardActivityPoints, closeStorage, verifyStorage } from "./storage.js";
import { handleCommandMessage } from "./commands.js";
import { handleTriviaAnswer } from "./community.js";
import {
  detectSpam,
  handleMemberJoin,
  logRuntimeError,
  restorePendingVerifications,
} from "./security.js";
import { postWelcome } from "./admin.js";
import { chatService } from "./chat.js";
import { tableGames, startTableGameExpiryWorker } from "./table-games.js";
import { createBotLeadership } from "./bot-leadership.js";
import { createMessageDispatcher } from "./message-dispatcher.js";
import { createMessageReceipts } from "./message-receipts.js";
import { createActivityRewards } from "./activity-rewards.js";
import { levelService } from "./level-service.js";

validateConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});
let stopGameExpiry;
let stopLevels;
let botLeadership;
let shuttingDown = false;
const rewardActivity = createActivityRewards({ award: awardActivityPoints });
const dispatchMessage = createMessageDispatcher({
  claim: createMessageReceipts({
    database, log: (line) => process.stderr.write(`${line}\n`),
  }),
  prepare: (message) => getGuildSettings(message.guild.id),
  detectSpam, command: handleCommandMessage, trivia: handleTriviaAnswer,
  chat: (message, settings) => chatService.handleMention(message, settings),
  award: (guildId, userId, message, settings) => Promise.all([
    rewardActivity(guildId, userId),
    levelService.activity(message, settings),
  ]),
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await verifyStorage();
    botLeadership = createBotLeadership({
      pool: database,
      onAcquired: async () => {
        await ensureGuildSettings([...readyClient.guilds.cache.keys()]);
        await restorePendingVerifications(readyClient);
      },
      onReady: () => {
        if (process.send) process.send({ type: "bot-ready" });
        stopGameExpiry = startTableGameExpiryWorker(readyClient);
        stopLevels = levelService.start(readyClient);
        process.stdout.write(`[ready] ${readyClient.user.tag} (${readyClient.user.id}) active for ${readyClient.guilds.cache.size} server(s).\n`);
      },
      onStandby: () => {
        // Discord and database are verified; another database session owns
        // event processing. This lets rolling promotion complete without
        // permitting a second worker to send replies.
        if (process.send) process.send({ type: "bot-standby" });
        process.stdout.write("[standby] Another instance owns bot events; this copy will not respond.\n");
      },
      onLost: () => {
        stopGameExpiry?.();
        stopLevels?.();
        process.stderr.write("[bot-leadership] Database ownership connection lost; stopping this worker to prevent duplicate actions.\n");
        void client.destroy();
        process.exit(1);
      },
    });
    await botLeadership.start();
  } catch (error) {
    logRuntimeError("startup-database", error);
    process.stderr.write("Startup failed: check the production database connection and publish the bot database tables.\n");
    await botLeadership?.close().catch(() => {});
    await client.destroy();
    await closeStorage().catch(() => {});
    process.exit(1);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (shuttingDown || !botLeadership?.isLeader()) return;
  try {
    await tableGames.interaction(interaction);
  } catch (error) {
    logRuntimeError("game-interaction", error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (shuttingDown || !botLeadership?.isLeader()) return;
  if (!message.guild || message.author.bot || !message.member) return;

  try {
    await dispatchMessage(message);
  } catch (error) {
    logRuntimeError("message-handler", error);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (shuttingDown || !botLeadership?.isLeader()) return;
  try {
    await Promise.all([handleMemberJoin(member), postWelcome(member, "welcome")]);
  } catch (error) {
    logRuntimeError("member-join", error);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (shuttingDown || !botLeadership?.isLeader()) return;
  try {
    await postWelcome(member, "goodbye");
  } catch (error) {
    logRuntimeError("member-leave", error);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  if (shuttingDown || !botLeadership?.isLeader()) return;
  try {
    await ensureGuildSettings([guild.id]);
    process.stdout.write(`[guild] Added to ${guild.name} (${guild.id}).\n`);
  } catch (error) {
    logRuntimeError("guild-settings", error);
  }
});

client.on(Events.Error, (error) => logRuntimeError("discord-client", error));
client.on(Events.Warn, (warning) => process.stderr.write(`[discord-warning] ${warning.slice(0, 500)}\n`));

process.on("unhandledRejection", (error) => logRuntimeError("unhandled-rejection", error));
process.on("uncaughtException", (error) => {
  logRuntimeError("uncaught-exception", error);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`[shutdown] Received ${signal}; closing the Discord connection.\n`);
    stopGameExpiry?.();
    stopLevels?.();
    await botLeadership?.close().catch((error) => logRuntimeError("leadership-shutdown", error));
    await client.destroy();
    await closeStorage().catch((error) => logRuntimeError("database-shutdown", error));
    process.exit(0);
  });
}

client.login(config.token).catch((error) => {
  logRuntimeError("login", error);
  process.stderr.write(
    "Discord login failed. Check DISCORD_TOKEN and confirm the bot application is available.\n",
  );
  process.exit(1);
});
