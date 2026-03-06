import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/core/promptBuilder.js";

test("prompt order follows spec", () => {
  const result = buildPrompt({
    card: {
      detail: {
        name: "Alice",
        description: "desc",
        personality: "calm",
        scenario: "room",
        system_prompt: "system",
        example_dialogue: "example",
        post_history_instructions: "post",
      },
    },
    lorebookEntries: [{ uid: "1", content: "lore", comment: "lore1" }],
    summary: { summary_text: "sum" },
    recentTurns: [{ role: "user", content: "hello" }],
    maxPromptTokens: 1000,
  });

  const contents = result.messages.map((m) => m.content);
  assert.equal(contents[0], "system");
  assert.match(contents[1], /Character Name:/);
  assert.match(contents[2], /Lorebook Entries/);
  assert.match(contents[3], /Example Dialogue/);
  assert.match(contents[4], /Conversation Summary/);
  assert.equal(result.messages.at(-1).content, "post");
});
