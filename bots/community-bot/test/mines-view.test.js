import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle } from "discord.js";
import { tableGamePayload } from "../src/table-game-view.js";
import { minesReturn } from "../src/table-game-rules.js";

const message = {
  guild: { name: "Test community" },
  client: { user: { username: "lovelyshell", displayAvatarURL: () => "https://example.com/avatar.png" } },
};
function session(overrides = {}) {
  return {
    id: "223456789012345678", user_id: "223456789012345679",
    game: "mines", stake: 25, status: "active", version: 0,
    expires_at: 1800000600000, balance_after: 75,
    state: { mines: [0, 5, 15], revealed: [], done: false },
    ...overrides,
  };
}
const buttons = (payload) => payload.components.slice(0, 4).flatMap((row) => row.toJSON().components);
const fields = (payload) => Object.fromEntries(payload.embeds[0].toJSON().fields.map((field) => [field.name, field.value]));

test("Mines starts with a uniform covered board without leaking hidden mine positions", () => {
  const payload = tableGamePayload(message, session());
  assert.equal(payload.components.length, 5);
  assert.equal(buttons(payload).length, 16);
  assert.ok(buttons(payload).every((button) => button.emoji.name === "🟦"));
  assert.ok(buttons(payload).every((button) => !button.disabled));
  assert.deepEqual(buttons(payload).map((button) => button.label), Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(2, "0")));
  const data = fields(payload);
  assert.equal(data["Collect now"], "Reveal a gem first");
  assert.match(data["Next gem return"], /\*\*29\*\* pts/);
  assert.equal(data["Next pick is safe"], "**81.3%**");
  assert.equal(payload.components[4].toJSON().components[0].disabled, true);
});

test("Mines shows gems, accurate collect/next returns, progress, and an actionable collect button", () => {
  const data = session({ version: 1, state: { mines: [0, 5, 15], revealed: [2], done: false } });
  const payload = tableGamePayload(message, data, true);
  const tile = buttons(payload)[2];
  assert.equal(tile.emoji.name, "💎");
  assert.equal(tile.style, ButtonStyle.Success);
  assert.equal(tile.disabled, true);
  assert.equal(buttons(payload)[0].emoji.name, "🟦", "an unrevealed mine must still look covered");
  assert.match(payload.embeds[0].toJSON().description, /No extra stake charged/);
  assert.match(payload.embeds[0].toJSON().description, /1\/13 gems/);
  assert.match(fields(payload)["Collect now"], new RegExp(`\\*\\*${minesReturn(25, 3, 1)}\\*\\* pts`));
  const collect = payload.components[4].toJSON().components[0];
  assert.equal(collect.label, "Collect 29 points");
  assert.equal(collect.disabled, false);
  assert.equal(collect.custom_id, `play:${data.id}:1:cashout`);
});

test("Mines loss reveals bombs and gems, marks the actual hit, and disables every action", () => {
  const data = session({
    status: "finished", version: 2,
    state: { mines: [0, 5, 15], revealed: [2], hit: 0, done: true, payout: 0, result: "You hit a mine." },
  });
  const payload = tableGamePayload(message, data);
  assert.equal(buttons(payload)[0].emoji.name, "💥");
  assert.equal(buttons(payload)[5].emoji.name, "💣");
  assert.equal(buttons(payload)[4].emoji.name, "💎");
  assert.match(payload.embeds[0].toJSON().title, /Mine hit/);
  assert.match(fields(payload)["Net result"], /-25/);
  assert.ok(payload.components.every((row) => row.toJSON().components.every((button) => button.disabled)));
});

test("Mines collected and timeout boards keep total returns accurate and fit Discord limits", () => {
  const data = session({
    status: "finished",
    state: { mines: [0, 5, 15], revealed: [], done: true, payout: 25, result: "Time expired: untouched stake returned." },
  });
  const payload = tableGamePayload(message, data);
  const embed = payload.embeds[0].toJSON();
  assert.match(fields(payload)["Total returned"], /\*\*25\*\* pts/);
  assert.match(fields(payload)["Net result"], /\+0/);
  assert.equal(payload.allowedMentions.repliedUser, false);
  const length = embed.title.length + embed.description.length + embed.footer.text.length +
    embed.author.name.length + embed.fields.reduce((n, field) => n + field.name.length + field.value.length, 0);
  assert.ok(length < 6000);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024 && field.name.length <= 256));
  for (const row of payload.components) {
    assert.ok(row.toJSON().components.length <= 5);
    assert.ok(row.toJSON().components.every((button) => button.custom_id.length <= 100));
  }
});
