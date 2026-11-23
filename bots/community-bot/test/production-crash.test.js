import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("host exits with a diagnostic when the bot fails to start", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-crash-"));
  await mkdir(join(root, "artifacts/community-bot-site/dist/public"), { recursive: true });
  await mkdir(join(root, "bots/community-bot/src"), { recursive: true });
  await writeFile(join(root, "artifacts/community-bot-site/dist/public/index.html"), "<h1>Test</h1>");
  await writeFile(join(root, "bots/community-bot/src/index.js"), "process.exit(2)");
  const host = spawn(process.execPath, [resolve("production-host.js")], {
    cwd: root, env: { ...process.env, PORT: "19384" }, stdio: ["ignore", "ignore", "pipe"],
  });
  let diagnostic = "";
  host.stderr.on("data", (chunk) => { diagnostic += chunk; });
  const timeout = setTimeout(() => host.kill("SIGKILL"), 8000);
  try {
    const [code] = await once(host, "exit");
    assert.equal(code, 2);
    assert.match(diagnostic, /Exited unexpectedly/);
  } finally {
    clearTimeout(timeout);
    await rm(root, { recursive: true, force: true });
  }
});
