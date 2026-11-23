import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { createActivityRewards } from "./activity-rewards.js";
import { getGuildSettings } from "./storage.js";
import { createLevelStore } from "./level-store.js";
import { levelNonce, xpFingerprint } from "./level-rules.js";

export function createLevelService({
  store = createLevelStore(), getSettings = getGuildSettings, now = Date.now,
  log = (error) => process.stderr.write(`[levels] ${String(error?.message || error).slice(0, 300)}\n`),
} = {}) {
  let client, timer, running, stopped = true;
  const award = createActivityRewards({
    now, award: (guildId, userId, hash) => store.award(guildId, userId, hash, now()),
  });

  async function deliver(row) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild || stopped) return;
    const settings = await getSettings(guild.id);
    if (!settings.levelsEnabled) return;
    let member = guild.members.cache.get(row.user_id);
    if (!member) {
      try { member = await guild.members.fetch(row.user_id); }
      catch (error) {
        if (error.code !== 10007) throw error;
        // Do not ping someone who left the server.
        await store.acknowledge(guild.id, row.user_id, row.level, "roles");
        await store.acknowledge(guild.id, row.user_id, row.level, "notice");
        return;
      }
    }
    const earned = [];
    // Announcement delivery is independent of role permission failures.
    let roleError;
    if (row.roles_level < row.level && !stopped) {
      try {
        for (const [milestone, roleId] of Object.entries(settings.levelRoles || {})) {
          if (Number(milestone) > row.level) continue;
          const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId);
          if (!role) throw Error(`Level ${milestone} role was deleted; run the levelroles command to repair it.`);
          // Never turn an edited reward role into a privilege-escalation route.
          if (role.managed || role.id === guild.id || role.permissions.bitfield !== 0n || !role.editable) {
            throw Error(`Level ${milestone} role is unsafe or above the bot. Use permission-free roles below the bot.`);
          }
          if (stopped) return;
          if (!member.roles.cache.has(role.id)) await member.roles.add(role, "Community level milestone earned");
          earned.push(`Level ${milestone}`);
        }
        await store.acknowledge(guild.id, row.user_id, row.level, "roles");
      } catch (error) { roleError = error; }
    }
    if (row.notified_level < row.level && !stopped) {
      if (settings.levelChannelId) {
        const channel = guild.channels.cache.get(settings.levelChannelId) ??
          await guild.channels.fetch(settings.levelChannelId);
        const permissions = channel?.permissionsFor(guild.members.me);
        if (!channel?.isTextBased() || channel.isThread() ||
            !permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
          throw Error("Level-up channel is missing or not writable. Update levelchannel or the bot's permissions.");
        }
        if (stopped) return;
        await channel.send({
          content: `<@${row.user_id}>`,
          embeds: [new EmbedBuilder().setColor(0x9b87f5).setTitle(`Level up · ${row.level}`)
            .setDescription(`You reached **Level ${row.level}** by chatting!\n\n**${Number(row.xp).toLocaleString()} total XP**${earned.length ? `\nMilestone roles: **${earned.join(", ")}**` : ""}`)
            .setThumbnail(member.user.displayAvatarURL({ size: 128 }))],
          allowedMentions: { parse: [], users: [row.user_id], roles: [], repliedUser: false },
          nonce: levelNonce(guild.id, row.user_id, row.level), enforceNonce: true,
        });
      }
      // Turning announcements off doesn't queue a flood for when they return.
      await store.acknowledge(guild.id, row.user_id, row.level, "notice");
    }
    if (roleError) throw roleError;
  }

  function flush() {
    if (stopped || running) return running ?? Promise.resolve();
    running = (async () => {
      for (const row of await store.pending(now())) {
        if (stopped) break;
        // A failed channel or role won't monopolize the next batch. This also
        // leaves durable pending progress to retry after a worker restart.
        await store.defer(row.guild_id, row.user_id, now() + 60_000);
        try { await deliver(row); } catch (error) { log(error); }
      }
    })().catch(log).finally(() => { running = null; });
    return running;
  }

  return {
    store, flush,
    async activity(message, settings) {
      const hash = xpFingerprint(message, settings);
      if (!hash) return false;
      const result = await award(message.guild.id, message.author.id, hash);
      if (result && (result.level > result.notified_level || result.level > result.roles_level)) void flush();
      return Boolean(result);
    },
    start(discordClient) {
      client = discordClient;
      stopped = false;
      clearInterval(timer);
      timer = setInterval(() => void flush(), 15_000);
      timer.unref?.();
      void flush();
      return () => { stopped = true; clearInterval(timer); };
    },
  };
}

export const levelService = createLevelService();
