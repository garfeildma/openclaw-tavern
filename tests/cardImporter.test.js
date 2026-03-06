import test from "node:test";
import assert from "node:assert/strict";
import { importCardFromAttachment } from "../src/importers/cardImporter.js";

test("import V1 card JSON", () => {
  const raw = {
    name: "Alice",
    description: "desc",
    personality: "calm",
    first_mes: "hello",
  };

  const res = importCardFromAttachment({
    filename: "alice.json",
    buffer: Buffer.from(JSON.stringify(raw), "utf8"),
  });

  assert.equal(res.sourceFormat, "tavern_v1");
  assert.equal(res.card.name, "Alice");
  assert.equal(res.card.first_message, "hello");
});

test("import V2 card JSON", () => {
  const raw = {
    spec: "chara_card_v2",
    data: {
      name: "Bob",
      system_prompt: "stay in character",
      post_history_instructions: "keep style",
    },
  };

  const res = importCardFromAttachment({
    filename: "bob.json",
    buffer: Buffer.from(JSON.stringify(raw), "utf8"),
  });

  assert.equal(res.sourceFormat, "chara_card_v2");
  assert.equal(res.card.name, "Bob");
  assert.equal(res.card.system_prompt, "stay in character");
});

test("import unknown card format as best effort", () => {
  const raw = {
    spec: "mystery_card_v9",
    data: {
      name: "Neo",
    },
  };

  const res = importCardFromAttachment({
    filename: "unknown.json",
    buffer: Buffer.from(JSON.stringify(raw), "utf8"),
  });

  assert.equal(res.sourceFormat, "unknown");
  assert.equal(res.card.name, "Neo");
});
