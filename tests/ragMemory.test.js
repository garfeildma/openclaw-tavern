import test from "node:test";
import assert from "node:assert/strict";
import { createRPPlugin } from "../src/index.js";

function makeCtx(content, extras = {}) {
  return {
    content,
    channelType: "discord",
    platformContextId: "guild1",
    channelId: "channel1",
    userId: "u1",
    attachments: [],
    ...extras,
  };
}

async function seedSession(plugin) {
  const cardPayload = {
    spec: "chara_card_v2",
    data: {
      name: "Alice",
      description: "role",
      personality: "calm",
      first_mes: "hi",
      system_prompt: "stay in character",
      post_history_instructions: "final note",
    },
  };
  const presetPayload = { temperature: 0.7, top_p: 0.95, max_tokens: 512 };

  let r = await plugin.hooks.message_received(
    makeCtx("/rp import-card", {
      attachments: [{ filename: "alice.json", buffer: Buffer.from(JSON.stringify(cardPayload)) }],
    }),
  );
  const cardId = r.response.data.asset_id;

  r = await plugin.hooks.message_received(
    makeCtx("/rp import-preset", {
      attachments: [{ filename: "preset.json", buffer: Buffer.from(JSON.stringify(presetPayload)) }],
    }),
  );
  const presetId = r.response.data.asset_id;

  r = await plugin.hooks.message_received(makeCtx(`/rp start --card ${cardId} --preset ${presetId}`));
  assert.equal(r.response.ok, true);
}

test("multilingual memory recall can bring back old turns", async () => {
  let lastPrompt = null;
  const plugin = createRPPlugin({
    contextPolicy: {
      summaryTriggerTokens: 999999,
      recentMessagesLimit: 2,
      memoryEnabled: true,
      memoryTopK: 4,
      memoryMinScore: 0.05,
      memoryExcludeRecentTurns: 2,
      memoryPromptBudget: 800,
      embeddingDimensions: 192,
    },
    modelProvider: {
      async generate({ prompt }) {
        lastPrompt = prompt;
        return { content: "assistant reply" };
      },
    },
  });

  await seedSession(plugin);

  await plugin.hooks.message_received(makeCtx("我最喜欢喝抹茶拿铁。"));
  for (let i = 0; i < 6; i += 1) {
    await plugin.hooks.message_received(makeCtx(`这是无关话题 ${i}`));
  }
  await plugin.hooks.message_received(makeCtx("你还记得我最喜欢喝什么吗？"));

  assert.ok(lastPrompt);
  const systemText = (lastPrompt.messages || [])
    .filter((m) => m.role === "system")
    .map((m) => String(m.content || ""))
    .join("\n");

  assert.match(systemText, /Relevant Memory Recall/);
  assert.match(systemText, /抹茶拿铁/);
});
