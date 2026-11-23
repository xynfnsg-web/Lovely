# Deploying Lovelyshell Bot to Render

This repository is fully configured to run on **Render** as a free Web Service.

---

### Step 1: Push your code to GitHub
1. Create a new GitHub repository at [github.com/new](https://github.com/new).
2. Double-click `push-to-github.bat` in this folder.
3. Paste your GitHub repository URL and press Enter.

---

### Step 2: Create a Web Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com) and click **New +** ➔ **Web Service**.
2. Connect your GitHub repository.
3. Render will automatically read `render.yaml` or you can verify:
   - **Name**: `lovelyshell-bot`
   - **Language / Runtime**: `Node`
   - **Region**: `Oregon (US West)` (or closest to you)
   - **Branch**: `main`
   - **Build Command**: `pnpm install`
   - **Start Command**: `node bots/community-bot/production-host.js`
   - **Plan**: `Free`

---

### Step 3: Add Environment Variables on Render
Under the **Environment Variables** tab in your Render service settings, add:

| Key | Value | Description |
|---|---|---|
| `DISCORD_TOKEN` | `MTU2ODc2...` | Your bot token from Discord Developer Portal |
| `NODE_VERSION` | `24` | Node.js version |
| `BOT_PREFIX` | `f` | Bot command prefix (default: `f`) |

*(Optional: If you want persistent cloud storage across Render restarts, you can add `DATABASE_URL` pointing to a free [Neon](https://neon.tech) or [Supabase](https://supabase.com) PostgreSQL database).*

---

### Step 4: Health Check
Render will monitor your web service via:
- Health Check Path: `/healthz`

Your web landing page and Discord bot will run 24/7 on Render!
