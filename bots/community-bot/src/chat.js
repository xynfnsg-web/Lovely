import { PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import { getGuildSettings, updateGuildSettings } from "./storage.js";
import { hasStaffAccess, clampText } from "./format.js";
import { replyToMessage } from "./message-delivery.js";
import { prepareRoastRequest } from "./chat-roasts.js";
import { hasBanterOptOut } from "./chat-prompt.js";

const safeMentions = { parse: [], repliedUser: false };
const TTL = 10 * 60_000;

export function createChatService({
  getSettings = getGuildSettings,
  saveSettings = updateGuildSettings,
  generate = async (input) => (await import("./ai-provider.js")).generateChatReply(input),
  ready = () => config.aiReady,
  now = Date.now,
} = {}) {
  const conversations = new Map();
  const users = new Map();
  const guilds = new Map();
  const roastTargets = new Map();
  let active = 0;
  const keyFor = (message) => `${message.guild.id}:${message.channel.id}:${message.author.id}`;
  const reply = (message, content, replacement = false) => replyToMessage(
    message, { content, allowedMentions: safeMentions }, replacement ? ":f" : "",
  );
  const staff = (message) => hasStaffAccess(message.member, PermissionFlagsBits.ManageGuild, config.staffRoleIds);

  function clearGuild(guildId) {
    for (const key of conversations.keys()) if (key.startsWith(`${guildId}:`)) conversations.delete(key);
  }

  function cleanup(time) {
    for (const [key, entry] of conversations) if (time - entry.at >= TTL) conversations.delete(key);
    for (const [key, expires] of users) if (expires <= time) users.delete(key);
    for (const [key, entry] of guilds) if (time - entry.at >= 60_000) guilds.delete(key);
    for (const [key, expires] of roastTargets) if (expires <= time) roastTargets.delete(key);
    while (conversations.size >= 1000) conversations.delete(conversations.keys().next().value);
  }

  async function chatCommand(message, args) {
    const action = args[0]?.toLowerCase() || "status";
    const settings = await getSettings(message.guild.id);
    if (action === "status") {
      return reply(message, `AI chat is **${settings.chatEnabled ? "on" : "off"}**. Connection: **${ready() ? "configured" : "unavailable"}**.\nMention me to chat: genuine questions get help, and playful roasts get a lighthearted comeback. Try \`@${message.client.user.username || "lovelyshell"} roast @member\` for a one-line member roast without a notification. One roast per target per minute. Only messages explicitly addressed to me are sent to OpenAI. Conversation memory expires after 10 minutes or a restart. AI can make mistakes.`);
    }
    if (action === "reset") {
      conversations.delete(keyFor(message));
      return reply(message, "Your AI conversation memory in this channel has been cleared.");
    }
    if (!["on", "off"].includes(action)) return reply(message, `Usage: \`${settings.prefix}chat on|off|status|reset\`.`);
    if (!staff(message)) return reply(message, "You need Manage Server permission or a configured staff role to enable or disable AI chat.");
    if (action === "on" && !ready()) return reply(message, "The AI connection is unavailable. Staff need to finish the managed OpenAI setup before enabling chat.");
    await saveSettings(message.guild.id, { chatEnabled: action === "on" });
    clearGuild(message.guild.id);
    return reply(message, `AI chat is now **${action}** for this server.`);
  }

  async function personalityCommand(message, args) {
    if (!staff(message)) return reply(message, "You need Manage Server permission or a configured staff role to customize the bot personality.");
    const settings = await getSettings(message.guild.id);
    const text = args.join(" ").trim();
    if (!text) return reply(message, `Current personality: ${settings.personality}\n\nUse \`${settings.prefix}personality <tone>\` or \`${settings.prefix}personality reset\`. Safety rules always apply.`);
    if (text.length > 500) return reply(message, "Keep the personality description to 500 characters or fewer.");
    await saveSettings(message.guild.id, {
      personality: text.toLowerCase() === "reset" ? "Friendly, welcoming, encouraging, and helpful. Use clear everyday language and light humor." : text,
    });
    clearGuild(message.guild.id);
    return reply(message, "Bot personality saved. Safety rules remain in place, and existing server conversation memories have been cleared.");
  }

  async function handleMention(message, preparedSettings) {
    if (!message.guild || message.author.bot || !message.member) return false;
    const botId = message.client.user.id;
    const mentions = [`<@${botId}>`, `<@!${botId}>`];
    if (!mentions.some((mention) => message.content.includes(mention))) return false;
    const settings = preparedSettings ?? await getSettings(message.guild.id);
    if (!settings.chatEnabled) return true;
    if (!ready()) {
      await reply(message, "My AI connection is unavailable right now. Staff can check the bot configuration.");
      return true;
    }
    let text = message.content;
    for (const mention of mentions) text = text.replaceAll(mention, "");
    text = text.trim();
    if (!text) {
      await reply(message, `Hi! Mention me with a question, or use \`${settings.prefix}help\` for commands. Your question will be sent to OpenAI; don't include private information.`);
      return true;
    }
    if (text.length > 1500) {
      await reply(message, "Please shorten your question to 1,500 characters or fewer.");
      return true;
    }
    const time = now();
    cleanup(time);
    const roast = prepareRoastRequest(text, message.author.id);
    if (roast?.error) {
      await reply(message, "Pick one member per roast—mention me and say `roast @member`.");
      return true;
    }
    const targetKey = roast?.kind === "member" ? `${message.guild.id}:${roast.targetId}` : null;
    if (targetKey) {
      const targetConversation = conversations.get(`${message.guild.id}:${message.channel.id}:${roast.targetId}`);
      if (targetConversation?.banterOptedOut ?? hasBanterOptOut(targetConversation?.history)) {
        await reply(message, "They asked to keep it friendly in this conversation, so I'll skip that roast.");
        return true;
      }
      if (roastTargets.has(targetKey)) {
        await reply(message, "Give them a breather—one roast per member per minute.");
        return true;
      }
    }
    if (roast) text = roast.text;
    const userKey = `${message.guild.id}:${message.author.id}`;
    const key = keyFor(message);
    if (users.has(userKey)) {
      await reply(message, "Please wait 10 seconds between AI questions.");
      return true;
    }
    const window = guilds.get(message.guild.id) || { at: time, count: 0 };
    if (active >= 3 || window.count >= 20) {
      await reply(message, "AI chat is busy. Please try again in a minute.");
      return true;
    }
    const previous = conversations.get(key);
    if (previous?.pending) {
      await reply(message, "I'm still answering your previous question.");
      return true;
    }
    users.set(userKey, time + 10_000);
    if (targetKey) roastTargets.set(targetKey, time + 60_000);
    window.count++;
    guilds.set(message.guild.id, window);
    const conversation = {
      at: time, history: previous?.history || [], pending: true,
      // Honor stop requests immediately, even if the AI request later fails.
      banterOptedOut: hasBanterOptOut(
        [{ role: "user", content: text }],
        previous?.banterOptedOut ?? hasBanterOptOut(previous?.history),
      ),
    };
    conversations.set(key, conversation);
    active++;
    let response;
    let acknowledgement = Promise.resolve(null);
    let previewFailed = false;
    let lastPreview = "";
    const displayAnswer = (answer) => clampText(`${roast?.prefix || ""}${answer}`, 1800);
    const sendReplacement = async (content) => {
      const previous = response;
      const sent = await reply(message, content, true);
      // Never delete the old answer until its replacement has been delivered.
      if (previous && previous !== sent && typeof previous.delete === "function" &&
          (!previous.id || previous.id !== sent?.id)) {
        await previous.delete().catch((error) => {
          if (Number(error?.code) !== 10008) process.stderr.write("[ai-chat] Could not remove a stale bot response.\n");
        });
      }
      response = sent;
      if (previous) process.stdout.write("[ai-chat] Replaced a stale response after an edit failed.\n");
    };
    const updateReply = async (content) => {
      if (!response?.edit || previewFailed || content === lastPreview) return;
      try {
        await response.edit({ content, allowedMentions: safeMentions });
        lastPreview = content;
      } catch {
        // A failed preview must not prevent a final answer from being delivered.
        previewFailed = true;
      }
    };
    try {
      // Start generation while Discord creates the acknowledgement instead of
      // putting a complete Discord round trip before every AI request.
      acknowledgement = reply(message, "Thinking…").then((sent) => {
        response = sent;
        return sent;
      }).catch(() => {
        previewFailed = true;
        return null;
      });
      const answer = await generate({
        text, history: [...conversation.history], personality: settings.personality, prefix: settings.prefix,
        roastTarget: roast?.kind || null,
        banterOptOut: conversation.banterOptedOut,
        onPartial: async (partial) => {
          if (conversations.get(key) !== conversation) return;
          await acknowledgement;
          if (conversations.get(key) !== conversation) return;
          const current = await getSettings(message.guild.id);
          if (current.chatEnabled && conversations.get(key) === conversation) {
            await updateReply(displayAnswer(partial));
          }
        },
      });
      await acknowledgement;
      // A server setting change or member reset invalidates any in-flight reply.
      const currentSettings = await getSettings(message.guild.id);
      if (conversations.get(key) !== conversation || !currentSettings.chatEnabled) {
        if (response?.edit) await response.edit({ content: "This AI response was stopped because the chat was reset or disabled.", allowedMentions: safeMentions }).catch(() => {});
        return true;
      }
      const rawContent = clampText(answer, 1800 - (roast?.prefix || "").length);
      if (!rawContent) throw new Error("AI_EMPTY_RESPONSE");
      const content = displayAnswer(rawContent);
      if (response?.edit && !previewFailed) {
        try {
          if (lastPreview !== content) await response.edit({ content, allowedMentions: safeMentions });
        } catch {
          await sendReplacement(content);
        }
      } else {
        await sendReplacement(content);
      }
      conversation.history = [...conversation.history, { role: "user", content: text }, { role: "assistant", content: rawContent }].slice(-12);
      conversation.at = now();
    } catch (error) {
      await acknowledgement;
      const status = Number(error?.status);
      // Never log SDK bodies, prompts, headers, URLs, or credentials.
      process.stderr.write(`[ai-chat] Request failed${Number.isInteger(status) && status > 0 ? ` (HTTP ${status})` : ""}.\n`);
      const failure = "I couldn't get an AI response right now. Please try again shortly; my regular commands still work.";
      if (response?.edit) {
        await response.edit({ content: failure, allowedMentions: safeMentions }).catch(() => sendReplacement(failure).catch(() => {}));
      } else {
        await reply(message, failure).catch(() => {});
      }
    } finally {
      conversation.pending = false;
      active--;
    }
    return true;
  }

  return { handleMention, chatCommand, personalityCommand };
}

export const chatService = createChatService();
