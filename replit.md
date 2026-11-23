# Discord Community Bot

A Node.js Discord.js v14 bot for community moderation, server security, fun commands, a persistent points economy, and mention-based AI chat.

## Run & Operate

- `pnpm --filter @workspace/community-bot start` — run the Discord bot
- `pnpm --filter @workspace/community-bot dev` — run with Node.js watch mode
- `pnpm --filter @workspace/community-bot check` — check JavaScript syntax
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_TOKEN`
- Required database env: `DATABASE_URL` (provided by the project's managed PostgreSQL database)
- Optional env: `BOT_PREFIX`, `STAFF_ROLE_IDS`
- Managed AI env: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (provisioned by Replit); optional `AI_MODEL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Discord bot: JavaScript, Discord.js v14, PostgreSQL
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `bots/community-bot/src/` — bot startup, commands, security, and persistent storage
- `bots/community-bot/README.md` — setup, permissions, environment, and command guide
- `lib/db/src/schema/community-bot.ts` — persistent bot data tables

## Architecture decisions

- Discord prefix commands use message-content and member gateway intents; enable both in the Discord Developer Portal.
- Server settings, warnings, points, and channel lock state use the managed PostgreSQL database; published app files are reset on every publish.
- AI chat uses Replit-managed OpenAI access, billed to Replit credits. No public AI endpoint is exposed: Discord mention handling calls the SDK on the server.
- Only explicitly mentioned messages are sent to OpenAI. Memory is isolated by server/channel/member and expires after inactivity or restart; do not persist chat transcripts.

## Product

- Staff moderation, join-raid alerts, spam detection, welcome/goodbye messages, announcements, and moderation logs.
- Non-wagering fun commands, daily/activity points, trivia rewards, profiles, and leaderboards.

## User preferences

- Never write Discord tokens or API keys into source files or print them in logs.
- AI chat was restored at the user's request. Keep moderation tools inaccessible to the AI and preserve staff-only personality and on/off controls.

## Gotchas

- The bot requires Node.js 24 or newer and privileged Message Content and Server Members intents.
- Automated join verification requires the bot's Manage Server permission; it is off until enabled.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
