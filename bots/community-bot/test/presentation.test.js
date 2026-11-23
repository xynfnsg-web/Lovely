import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCard } from "../src/presentation.js";
import { helpPayload, showHelp } from "../src/help.js";

function messageFixture() {
  return {
    author: { id: "requester" },
    guild: { name: "Test community" },
    client: { user: { username: "Community bot", displayAvatarURL: () => "https://example.com/avatar.png" } },
  };
}

test("all help categories serialize within Discord embed limits with a custom prefix", () => {
  for (const section of ["overview", "moderation", "community", "leveling", "server", "security", "__proto__"]) {
    const payload = helpPayload(messageFixture(), "!", section);
    const embed = payload.embeds[0].toJSON();
    assert.ok(embed.title.length <= 256);
    assert.ok(embed.fields.length <= 25);
    let total = embed.title.length + embed.description.length + embed.footer.text.length + embed.author.name.length;
    for (const field of embed.fields) {
      assert.ok(field.name.length <= 256);
      assert.ok(field.value.length <= 1024);
      total += field.name.length + field.value.length;
    }
    assert.ok(total < 6000);
    assert.equal(embed.fields[0].value, "`!`");
    assert.equal(payload.allowedMentions.repliedUser, false);
    assert.equal(payload.components[0].toJSON().components[0].options.length, 6);
  }
});

test("cards clamp long content and keep branding", () => {
  const card = createCard(messageFixture(), { title: "x".repeat(300), description: "x".repeat(5000) }).toJSON();
  assert.equal(card.title.length, 256);
  assert.equal(card.description.length, 4096);
  assert.equal(card.author.name, "Community bot");
});

test("help menu restricts controls to the requester and disables on expiry", async () => {
  const message = messageFixture();
  const collector = new EventEmitter();
  const edits = [];
  message.reply = async () => ({
    createMessageComponentCollector: () => collector,
    edit: async (payload) => edits.push(payload),
  });
  await showHelp(message, "f", "moderation");
  const handle = collector.listeners("collect")[0];
  let denial;
  await handle({ user: { id: "other" }, reply: async (data) => { denial = data; } });
  assert.equal(denial.flags, 64);
  let updated;
  await handle({ user: message.author, values: ["community"], update: async (data) => { updated = data; } });
  assert.match(updated.embeds[0].toJSON().title, /Community & points/);
  collector.emit("end");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(edits[0].components[0].toJSON().components[0].disabled, true);
});
