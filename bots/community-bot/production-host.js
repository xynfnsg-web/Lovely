import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

const webRoot = resolve(process.cwd(), "artifacts/community-bot-site/dist/public");
const botWorkingDirectory = resolve(process.cwd(), "bots/community-bot");
const port = Number(process.env.PORT || 22433);
const host = "0.0.0.0";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (!existsSync(join(webRoot, "index.html"))) {
  throw new Error(`Built website not found at ${webRoot}. Run the website build first.`);
}
if (!existsSync(join(botWorkingDirectory, "src/index.js"))) {
  throw new Error(`Bot entry point not found in ${botWorkingDirectory}.`);
}

let botReady = false;
let botStandby = false;
let shuttingDown = false;
let server;
let bot;
let startupTimer;

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(text);
}

async function serve(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return sendText(response, 405, "Method not allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    return sendText(response, 400, "Invalid URL");
  }

  if (pathname === "/healthz") {
    return sendText(response, botReady ? 200 : 503, botReady ? botStandby ? "standby" : "ok" : "starting");
  }

  const requestedFile = resolve(webRoot, `.${pathname}`);
  const pathFromRoot = relative(webRoot, requestedFile);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot.startsWith(sep)) {
    return sendText(response, 403, "Forbidden");
  }

  let filePath = requestedFile;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    if (extname(pathname)) return sendText(response, 404, "Not found");
    filePath = join(webRoot, "index.html");
  }

  const fileExtension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes[fileExtension] || "application/octet-stream",
    "Cache-Control":
      filePath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.headersSent) sendText(response, 500, "Unable to load page");
    else response.destroy();
  });
  stream.pipe(response);
}

function shutdown(exitCode, signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  botReady = false;
  clearTimeout(startupTimer);

  if (bot && bot.exitCode === null && !bot.killed) bot.kill(signal);

  if (server?.listening) {
    server.close(() => process.exit(exitCode));
    const forceExit = setTimeout(() => process.exit(exitCode), 5_000);
    forceExit.unref?.();
  } else {
    process.exit(exitCode);
  }
}

server = createServer((request, response) => {
  serve(request, response).catch(() => {
    if (!response.headersSent) sendText(response, 500, "Unable to load page");
    else response.destroy();
  });
});
server.on("error", (error) => {
  process.stderr.write(`[web] Could not start HTTP server: ${error.code || "unknown"}.\n`);
  shutdown(1);
});

bot = spawn(process.execPath, ["src/index.js"], {
  cwd: botWorkingDirectory,
  env: process.env,
  stdio: ["ignore", "pipe", "inherit", "ipc"],
});

startupTimer = setTimeout(() => {
  process.stderr.write("[startup] Discord/database readiness timed out after 55 seconds. Check the bot token, privileged intents, database connection, and published schema.\n");
  shutdown(1);
}, 55_000);
startupTimer.unref();
bot.on("message", (message) => {
  if (message?.type === "bot-ready" || message?.type === "bot-standby") {
    botReady = true;
    botStandby = message.type === "bot-standby";
    clearTimeout(startupTimer);
  }
});

bot.stdout.setEncoding("utf8");
bot.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

bot.on("error", (error) => {
  process.stderr.write(`[bot-process] ${error.message.slice(0, 500)}\n`);
  shutdown(1);
});

bot.on("exit", (code, signal) => {
  botReady = false;
  if (!shuttingDown) {
    process.stderr.write(
      `[bot-process] Exited unexpectedly (${signal || code || "unknown"}); stopping hosted service.\n`,
    );
    shutdown(code && code > 0 ? code : 1);
  }
});

server.listen(port, host, () => {
  process.stdout.write(`[web] Serving the bot site on ${host}:${port}.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0, signal));
}
