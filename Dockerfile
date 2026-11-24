FROM node:24-slim

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

EXPOSE 22433

CMD ["node", "bots/community-bot/production-host.js"]
