# Discord Community Bot

A persistent community bot built with Node.js 24+, JavaScript, Discord.js v14, and the project's managed PostgreSQL database. The default prefix is `f`.

AI chat uses Replit AI Integrations for managed OpenAI access; no personal OpenAI API key is required, and usage is billed to Replit credits. Slots, dice, and roulette use fictional community points only. Points cannot be purchased, transferred, sold, redeemed, or exchanged for money or prizes. Coin flips remain wager-free.

See [Running one active bot](RUNNING.md) for hosted replica protection, publishing handoffs, and preventing duplicate AI replies.

## Setup

### 1. Create and configure the Discord bot

1. Create an application in the Discord Developer Portal and add a bot user.
2. Copy the bot token directly into Replit Secrets as `DISCORD_TOKEN`. Do not paste it into chat, source files, or screenshots.
3. In the bot's **Privileged Gateway Intents**, enable **Message Content Intent** and **Server Members Intent**.
4. Invite the bot to your server with the `bot` OAuth2 scope.
5. Give it the permissions needed for the features you plan to use:
   - View Channels, Send Messages, Read Message History, and Embed Links
   - Manage Messages for `fclear` and spam cleanup
   - Ban Members, Kick Members, and Moderate Members for moderation commands
   - Manage Channels for slowmode and channel locks
   - Manage Server only if you enable temporary verification during a raid
6. Put the bot's role above the roles it needs to moderate.

The bot uses prefix commands, so application/slash-command registration and a client ID are not required.

### 2. Install and start

From the workspace root:

```sh
pnpm install
pnpm --filter @workspace/community-bot check
pnpm --filter @workspace/community-bot start
```

In Replit, add `DISCORD_TOKEN` through **Tools → Secrets**. Replit provides the project database connection. Start the **Discord Community Bot** workflow, or use the start command above.

For a local machine, copy `.env.example` to `.env`, set `DISCORD_TOKEN` and `DATABASE_URL` there, and never commit `.env`.

### Always-on Replit hosting

The production website and bot are configured to run together on a Reserved VM. Publish the project and select the Reserved VM option to keep the bot online when your phone or workspace is closed. Replit charges a fixed monthly cost for this always-on VM. The bot token must be available in the production Secrets environment; the bot's data is stored in the managed PostgreSQL database so it survives publishes.

The hosted bot starts with a fresh production database; development point balances are not copied. After the VM deployment is healthy, stop the separate **Discord Community Bot** development workflow to prevent duplicate replies.

On startup and when joining a server, the bot saves a default settings record for that real server if none exists. Existing settings are never overwritten, and no points or warnings are created. This also supplies legitimate initial development data for Replit's first production database setup.

If Publishing stalls at **Validating database migrations**, check **Publishing → Database settings** and ensure **Create production database** is enabled. If the current attempt is stuck, stop that attempt, refresh Replit, and retry once after confirming database setup. Keep **Overwrite production data** off. Do not reset the database or add schema-changing startup/build scripts to bypass validation.

If the existing release still says **Autoscale**, use **Publishing → Adjust settings → Deployment type → Reserved VM**, then republish. Changing a workspace configuration file does not switch the active release's hosting type. Publishing applies the new bot tables to the production database; do not overwrite existing production data.

The production health endpoint stays unready until the Discord connection and all four bot tables are available. Startup errors now fail explicitly with a diagnostic message instead of leaving the publish check waiting indefinitely.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | — | Discord bot token; keep it in Replit Secrets or a local ignored `.env`. |
| `BOT_PREFIX` | No | `f` | Default prefix for servers that have not set their own prefix. |
| `STAFF_ROLE_IDS` | No | — | Comma-separated role IDs that may use staff commands. |
| `DATABASE_URL` | Yes | Replit-managed | PostgreSQL connection string. Replit provides it for the project database. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | For AI chat | Replit-managed | Managed OpenAI endpoint; provisioned by the integration, never put it in client-side code. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | For AI chat | Replit-managed | Managed credential; never print it or commit it. |
| `AI_MODEL` | No | `gpt-5.4-mini` | Managed chat model. |

The prefix can also be changed for one server with `fprefix <new-prefix>`. Per-server settings are saved in PostgreSQL.

## Commands

### AI chat

- Mention the bot with a question, for example `@YourBot how can I welcome new members?`.
- Ask for a member roast with `@YourBot roast @member` or `@YourBot can you roast @member?`, selecting real Discord mentions. The bot replies once, addresses that member without sending a notification, and uses sharper one-line wordplay rather than generic assistant filler.
- `fchat status` shows availability and privacy information.
- `fchat on` / `fchat off` require Manage Server or a configured staff role.
- `fchat reset` clears your conversation in the current channel.
- `fpersonality <description>` and `fpersonality reset` require staff access. Maximum 500 characters; personality changes never override safety rules.

Mention the bot to chat. Genuine questions get helpful answers, even if the message also contains an insult. Insults aimed at the bot or requests to roast yourself get a short, playful comeback; normal chat stays friendly. The bot stops teasing when asked and does not join third-party bullying or target sensitive traits. Public command guidance uses the server's actual prefix.

Requested member roasts stay light and fictional: no attacks on bodies, identities, disabilities, private lives, or other vulnerabilities. Requests naming multiple targets get a single notice instead of starting a pile-on. A target has a one-minute roast cooldown shared across requesters and channels in the active worker. A member's `@YourBot stop roasting me` request is respected for their current conversation in that channel, including while the AI is still responding or if generation fails. These temporary protections reset with the worker; conversation memory expires after ten minutes. `@YourBot roast me` explicitly resumes self-directed banter. No member profiles are fetched, and target IDs are replaced with a generic label before generation.

For faster replies, AI generation starts alongside the initial Discord acknowledgement. Streaming previews are coalesced and sent without blocking token reading, with only one edit in flight; redundant final edits are skipped. Short questions get concise answers by default. Delivery speed still depends on OpenAI and Discord, and existing cooldowns, safety rules, and concurrency limits remain in place.

Only the text of questions explicitly mentioning the bot and that member's recent AI conversation are sent to OpenAI, not unrelated channel history, attachments, or bot secrets. Context is isolated by member, channel, and server, holds at most six turns, and expires after 10 minutes of inactivity or a restart. Preferences persist in PostgreSQL; transcripts are not saved there.

Answers can be wrong. Do not include private information. A safety-focused system instruction keeps the conversation suitable for a general audience; the model cannot access moderation tools or execute actions. Rate limits allow one question per member per 10 seconds, up to 20 questions per server per minute and three concurrent AI requests across the bot. Questions are limited to 1,500 characters and displayed answers to 1,800 characters. AI failures leave ordinary bot commands available.

AI replies acknowledge the question immediately and update the same message as text arrives, no more than about once every 1.5 seconds. The provider uses low reasoning effort for quicker community answers and stops generation when enough text has arrived for a Discord reply. Actual speed still depends on OpenAI and Discord.

Server settings are cached for five seconds and concurrent reads share one database request. Successful local changes replace the cache immediately; changes from a separate process may take up to five seconds to appear. Points, warnings, and other member records are never served from this configuration cache.

Command preflight loads settings and claims the durable duplicate-message receipt concurrently, then shares the same settings with spam checks, command routing, and mention routing. No moderation or command action runs until both checks succeed. Profiles use cached Discord members when available and load point balances alongside any required member lookup. After a confirmed activity reward, additional messages from that member skip unnecessary reward writes for one minute; PostgreSQL remains authoritative for eligibility and balances. This reduces database traffic without weakening duplicate protection, anti-spam checks, or command cooldowns. Discord delivery and AI generation can still add latency.

The integration is provisioned in this project. Republish to make the new code and managed configuration available to the hosted bot. If the integration is unavailable, mention replies explain that AI is unavailable instead of inventing an answer.

Use `fhelp` for an interactive category menu, or open a page directly with `fhelp moderation`, `fhelp community`, `fhelp server`, or `fhelp security`. The menu is controlled by the requester, expires after two minutes, and respects your server's custom prefix.

### Moderation

| Command | Purpose |
| --- | --- |
| `fban @member [reason]` | Ban a member or user ID. |
| `fkick @member [reason]` | Kick a member. |
| `ftimeout @member <duration> [reason]` | Timeout for a duration such as `15m`, `2h`, or `1d` (up to 28 days). |
| `funtimeout @member [reason]` | Remove a timeout. |
| `fwarn @member <reason>` | Save a persistent warning. |
| `fwarnings @member` | Show the latest saved warnings. |
| `fclear <1-100>` | Delete recent messages; Discord does not bulk-delete messages older than 14 days. |
| `fslowmode <0-21600>` | Set slowmode seconds; `0` turns it off. |
| `flock` / `funlock` | Lock this channel for @everyone and restore its previous send-message setting. |

Commands require the relevant Discord permission, Administrator, or a role listed in `STAFF_ROLE_IDS`. Discord role hierarchy still applies. The bot itself must also have the corresponding permission.

### Fun and community points

| Command | Purpose |
| --- | --- |
| `f8ball <question>` | Get a lighthearted answer. |
| `fcoinflip` | Flip a coin with no wager or points. |
| `ftrivia` | Start a 30-second trivia round; the first correct answer earns 15 points. |
| `frps <rock\|paper\|scissors>` | Play rock-paper-scissors. |
| `fcompliment [@member]` | Send a friendly compliment. |
| `fjoke` | Get a clean joke. |
| `frandom [min] [max]` | Generate a random whole number. |
| `fprofile [@member]` | View a server profile and point balance. |
| `fdaily` | Claim 25 points once per 24 hours. |
| `fleaderboard` | Show the top 10 point balances in this server. |

Members also earn 2 points at most once per minute of normal chat activity.

### Fictional-point games

| Command | Rules |
| --- | --- |
| `fslots <points>` | Three matching symbols return 10× the stake; a pair returns the stake; otherwise no return. |
| `fdice <points> <1-6>` | Guess one fair die roll; a match returns 5× the stake. |
| `froulette <points> <red\|black\|0-36>` | One European wheel (0–36). A matching color returns 2×; an exact number returns 36×. Zero is green and loses red/black bets. |
| `fmines <points> [1-5 mines]` | A 4×4 board with 3 mines by default. Reveal safe tiles, then collect your return. Hitting a mine loses the stake; clearing every safe tile collects automatically. |
| `fblackjack <points>` / `fbj <points>` | A freshly shuffled 52-card deck. Hit/Stand buttons. Aces count as 1 or 11. Dealer stands on all 17s. Natural blackjack pays 3:2; other wins 1:1; pushes return the stake. No splits, doubles, or insurance. |

Returns include the original stake. Wagers must be whole numbers from 1 to 1,000, covered by the member's current balance. All three games share a five-second member cooldown. Results use Node's cryptographic random number generator. Rounds and balance changes commit in one PostgreSQL transaction; the command message ID prevents duplicate charges on replay. Failed transactions do not charge points. A failed Discord reply after settlement never reruns the wager: check the profile for the balance.

Mines and Blackjack reserve the whole stake immediately, with at most one active table game per member per server. Buttons are restricted to the player. Repeated and stale button clicks cannot double-pay or draw extra cards. All payouts include the original stake and round fractional points down. Mines returns use a 97% fair-survival multiplier: `floor(stake × 0.97 × product((16-i)/(16-mines-i)))` for each revealed safe tile.

Run `fmines` or `fblackjack` without arguments to resume your saved table without placing another wager, even after a restart. Rounds last ten minutes: Mines automatically collects the current safe-tile return (or refunds an untouched board); Blackjack automatically stands and resolves the dealer. Expired rounds are settled on startup, every 30 seconds, or on the next interaction. A deleted board or failed Discord reply does not delete the saved game or charge the stake again. The point balance cap is 2,147,483,647; returns are limited to available room at that cap.

The `community_bot_game_rounds` and `community_bot_game_sessions` tables are part of the Drizzle schema. Apply them to development using `pnpm --filter @workspace/db push`; managed production receives them through Publish, not through startup DDL.

Mines uses a native Discord gem-and-mine board: blue covered tiles, green revealed gems, and bombs revealed only after a round ends. The panel shows gem progress, the current collectible return, the next gem's return, and the chance the next pick is safe. The Collect button includes the exact current return. Existing saved boards use the updated design when resumed or clicked.

### Copy emojis and stickers


- `fsteal <:name:123456789012345678> [new_name]` — copy a static custom emoji.
- `fsteal <a:name:123456789012345678> [new_name]` — copy an animated custom emoji.
- `fsteal sticker <sticker ID> [new name]` — copy a supported sticker.
- Reply to a message containing a sticker with `fsteal [new name]` to copy it.

Staff-only: requires Manage Expressions, Administrator, or a configured staff role. The bot needs Create Expressions or Manage Expressions. One asset per command, with a ten-second member cooldown. Emoji uploads are capped at 256 KiB; stickers at 512 KiB. PNG/APNG/GIF are supported; Lottie is not. Discord enforces available server slots and image requirements. Duplicate names are rejected. Only Discord CDN assets are fetched; arbitrary URLs and files are not accepted. Successful copies are recorded in the configured moderation log. Copy only assets you have permission to reuse.

### Server management

| Command | Purpose |
| --- | --- |
| `fprefix <prefix>` | Set this server's prefix (1-5 characters). |
| `flog #channel` / `flog off` | Configure moderation and security logs. |
| `fwelcome #channel [message]` / `fwelcome off` | Configure welcome messages. |
| `fgoodbye #channel [message]` / `fgoodbye off` | Configure goodbye messages. |
| `fresponse welcome|goodbye|spam|spamtimeout <message>` | Change welcome, goodbye, and spam-filter responses. |
| `fannounce #channel <message>` | Send a staff announcement without mass mentions. |
| `fsettings` | View current server settings. |
| `fhelp` | Show command help. |

Welcome, goodbye, and spam templates support `{user}`, `{username}`, and `{server}`.

### Security settings

`fsecurity status` shows the current settings. Staff can use:

- `fsecurity raid on|off` — enable or disable rapid-join alerts.
- `fsecurity threshold <joins> <seconds>` — set the join alert threshold.
- `fsecurity spam on|off` — enable or disable spam detection.
- `fsecurity spamlimit <messages> <seconds>` — set the rate threshold.
- `fsecurity repeats <count>` — set the repeated-message threshold.
- `fsecurity autotimeout on|off` — enable or disable a one-minute timeout after repeated spam violations.
- `fsecurity autoverify on|off` — temporarily raise server verification to High after a join alert. When enabled, it restores the previous level after 10 minutes; it requires Manage Server permission.

Join-raid alerts default to 8 joins in 10 seconds. Spam filtering defaults to more than 5 messages in 8 seconds or 3 repeated messages. Security actions are reported to the configured log channel, falling back to the server's system channel. A pending verification restore is saved, so the bot can finish restoring the previous server setting after a restart.

## Chat leveling

After publishing, run **`flevelsetup #levels`** in Discord (replace `#levels` with the channel you want). This enables leveling, selects the announcement channel, and creates **Level 5, 10, 15, 25, 50, 75, and 100** roles. Running setup again reuses saved roles rather than making duplicates. The bot needs **Manage Roles**, with its highest role **above all reward roles**, plus **View Channel**, **Send Messages**, and **Embed Links** in the announcement channel. Staff need Manage Server, Administrator, or a configured staff role; the bot does not need Administrator.

| Command | Purpose |
| --- | --- |
| `frank [@member]` / `flevel [@member]` | Level, total XP, progress bar, XP to next level, and server rank. |
| `fleveltop` | Top ten chatters by XP. Ties use member IDs for stable ranking. |
| `flevelsetup #channel` | Staff: one-command setup with default roles, or existing custom milestones. |
| `flevelchannel #channel` / `flevelchannel off` | Staff: select or disable level-up announcements independently of XP. |
| `flevelroles 15 25` | Staff: create or repair additional milestones, without removing other configured ones. |
| `flevelroles` | Staff: create or repair the default milestones. |
| `flevelroles remove 15` | Staff: stop awarding this milestone. Does not delete the role or remove it from members. |
| `flevels on` / `flevels off` / `flevels status` | Staff: enable, pause, or inspect leveling. Pausing keeps XP and roles. |
| `fhelp leveling` | In-Discord setup and usage guide. |

Members earn **20 XP**, at most once per **60 seconds across the server's channels**, from eligible regular chat. Messages need at least five letters/numbers after removing links and mentions. Commands (including unknown commands with the current prefix), bot/webhook/system messages, detected spam, and consecutive rewarded messages with the same normalized content earn no XP. Messages consumed by AI chat or trivia answers don't earn chat XP; trivia still awards its existing economy points. XP begins accumulating by default; announcements and roles wait for staff configuration. Attachments alone do not earn XP.

The cumulative threshold for level **L** is **25 × L² + 100 × L** XP: Level 1 needs 125 XP, Level 15 needs 7,125, and Level 25 needs 18,125. XP is independent of points: wagers never spend XP or lower levels. Profiles now show both.

At a level-up, the bot mentions **only that member** in the configured channel and displays the new level. It grants **all earned milestone roles**, retaining earlier ones. Newly configured milestones are also applied to existing leveled members by the reward worker. Reward roles are created without permissions, are not mentionable, and are never reused solely because their names match. The bot refuses to assign a reward role if it has gained permissions, is integration-managed, or is above the bot; correct the role or remove its mapping before recreating it.

XP, cooldowns, normalized text hashes (not message content), levels, and outstanding notification/role progress are saved in PostgreSQL. The worker runs only on the active bot instance. It checks pending rewards every 15 seconds and retries delivery failures after a minute, separately tracking announcements and roles so a failed role assignment doesn't repeat a successful announcement. Announcement retries use a stable Discord nonce. If several levels are pending, it announces the latest one instead of flooding the channel. Announcements disabled at delivery time are skipped rather than saved for a future flood. Errors identify the missing permission or deleted role in bot logs; XP is retained. No additional secrets or dependencies are needed.

The leveling table must be applied to the development database with the existing `pnpm --filter @workspace/db run push` workflow. **Republish to let managed Publishing apply the production schema**; there is no startup-time production migration.

## Data and security

- PostgreSQL stores server configuration, warnings, point balances, chat XP and pending level rewards, and channel-lock restore state.
- Runtime join/spam counters reset when the process restarts.
- The old development SQLite file is not imported. `.env` and secrets are excluded from Git.
- Logs do not print the bot token. Do not share or commit it.
- The bot does not respond to general chat or mentions while AI chat is disabled.
