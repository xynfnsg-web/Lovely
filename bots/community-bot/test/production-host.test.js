import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

test("production host waits for verified readiness and supports a silent standby during handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-host-"));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await mkdir(join(root, "artifacts/community-bot-site/dist/public"), { recursive: true });
  await mkdir(join(root, "bots/community-bot/src"), { recursive: true });
  await writeFile(join(root, "artifacts/community-bot-site/dist/public/index.html"), "<h1>Community bot</h1>");
  await writeFile(join(root, "bots/community-bot/src/index.js"),
    'setTimeout(() => process.send({type:"bot-standby"}), 1000); setTimeout(() => process.send({type:"bot-ready"}), 1800); setInterval(() => {}, 1000);');
  const host = spawn(process.execPath, [resolve("production-host.js")], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  host.stdout.on("data", (data) => { logs += data; });
  host.stderr.on("data", (data) => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 60 && !logs.includes("[web]"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(logs, /\[web\]/);
    assert.equal((await fetch(`${base}/healthz`)).status, 503);
    assert.match(await (await fetch(base)).text(), /Community bot/);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/..%2f..%2foutside.txt`)).status, 403);
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await fetch(`${base}/healthz`)).status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal(await (await fetch(`${base}/healthz`)).text(), "standby");
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await (await fetch(`${base}/healthz`)).text() === "ok") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await (await fetch(`${base}/healthz`)).text(), "ok");
  } finally {
    const stopped = once(host, "exit");
    host.kill("SIGTERM");
    await stopped;
    await rm(root, { recursive: true, force: true });
  }
});
