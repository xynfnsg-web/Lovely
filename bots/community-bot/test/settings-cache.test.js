import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsCache } from "../src/settings-cache.js";

test("100 concurrent and repeated settings reads share one database load", async () => {
  let loads = 0;
  const cache = createSettingsCache({ load: async () => { loads++; return { prefix: "f" }; } });
  await Promise.all(Array.from({ length: 100 }, () => cache.get("guild")));
  for (let index = 0; index < 100; index++) await cache.get("guild");
  assert.equal(loads, 1);
});

test("settings expire and are refreshed; callers cannot mutate the cached value", async () => {
  let time = 0;
  let loads = 0;
  const cache = createSettingsCache({
    now: () => time,
    load: async () => { loads++; return { prefix: "f", nested: { enabled: true } }; },
  });
  const value = await cache.get("guild");
  value.nested.enabled = false;
  assert.equal((await cache.get("guild")).nested.enabled, true);
  time = 5001;
  await cache.get("guild");
  assert.equal(loads, 2);
});

test("a completed write supersedes stale reads already in flight", async () => {
  let finishRead;
  const cache = createSettingsCache({ load: () => new Promise((resolve) => { finishRead = resolve; }) });
  const pending = cache.get("guild");
  await new Promise((resolve) => setImmediate(resolve));
  cache.set("guild", { prefix: "!", chatEnabled: false });
  finishRead({ prefix: "f", chatEnabled: true });
  assert.deepEqual(await pending, { prefix: "!", chatEnabled: false });
  assert.equal((await cache.get("guild")).prefix, "!");
});

test("failed database loads are not cached or replaced with fake defaults", async () => {
  let loads = 0;
  const cache = createSettingsCache({ load: async () => {
    if (++loads === 1) throw Error("database unavailable");
    return { prefix: "f" };
  } });
  await assert.rejects(cache.get("guild"), /database unavailable/);
  assert.equal((await cache.get("guild")).prefix, "f");
  assert.equal(loads, 2);
});

test("the settings cache has a bounded number of entries", async () => {
  let loads = 0;
  const cache = createSettingsCache({ maxEntries: 2, load: async () => { loads++; return { prefix: "f" }; } });
  for (const key of ["one", "two", "three", "one"]) await cache.get(key);
  assert.equal(loads, 4);
});
