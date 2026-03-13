import test from "node:test";
import assert from "node:assert/strict";
import { createRPPlugin, RP_ERROR_CODES } from "../src/index.js";

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
  return r.response.data.session_id;
}

test("before_prompt_build returns assembled prompt", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  const sessionId = await seedSession(plugin);
  await plugin.hooks.message_received(makeCtx("hello"));

  const built = await plugin.hooks.before_prompt_build({ session_id: sessionId });
  assert.ok(Array.isArray(built.messages));
  assert.ok(built.messages.length > 0);
  assert.ok(Number.isFinite(built.token_count));
});

test("before_model_resolve merges preset and overrides", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  const sessionId = await seedSession(plugin);
  const resolved = await plugin.hooks.before_model_resolve({
    session_id: sessionId,
    command_overrides: { temperature: 0.2, top_k: 40 },
  });

  assert.equal(resolved.temperature, 0.2);
  assert.equal(resolved.top_k, 40);
  assert.equal(resolved.top_p, 0.95);
  assert.equal(resolved.max_tokens, 512);
});

test("delete-asset requires confirm flag", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  const cardPayload = { name: "Alice", description: "role" };
  const imported = await plugin.hooks.message_received(
    makeCtx("/rp import-card", {
      attachments: [{ filename: "alice.json", buffer: Buffer.from(JSON.stringify(cardPayload)) }],
    }),
  );
  const cardId = imported.response.data.asset_id;

  const blocked = await plugin.hooks.message_received(makeCtx(`/rp delete-asset ${cardId}`));
  assert.equal(blocked.response.ok, false);
  assert.equal(blocked.response.code, RP_ERROR_CODES.BAD_REQUEST);

  const deleted = await plugin.hooks.message_received(makeCtx(`/rp delete-asset ${cardId} --confirm`));
  assert.equal(deleted.response.ok, true);
});

test("multimodal commands are rate limited", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
    ttsProvider: {
      async synthesize() {
        return { audioUrl: "https://example.com/a.mp3" };
      },
    },
  });

  await seedSession(plugin);
  await plugin.hooks.message_received(makeCtx("hello"));

  const first = await plugin.hooks.message_received(makeCtx("/rp speak"));
  assert.equal(first.response.ok, true);

  const second = await plugin.hooks.message_received(makeCtx("/rp speak"));
  assert.equal(second.response.ok, false);
  assert.equal(second.response.code, RP_ERROR_CODES.RATE_LIMITED);
});

test("image command uses image-only wrapper prompt", async () => {
  let capturedPrompt = "";
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "" };
      },
    },
    imageProvider: {
      async generate({ prompt }) {
        capturedPrompt = String(prompt || "");
        return { imageUrl: "https://example.com/image.png" };
      },
    },
  });

  await seedSession(plugin);
  const result = await plugin.hooks.message_received(makeCtx("/rp image"));
  assert.equal(result.response.ok, true);
  assert.equal(capturedPrompt.includes("Return image output only."), true);
  assert.equal(capturedPrompt.includes("Do not continue dialogue or story text."), true);
  assert.equal(capturedPrompt.includes("Scene:"), true);
});

test("agent-image command reports current config", async () => {
  const plugin = createRPPlugin({
    getAgentImageConfig() {
      return {
        enabled: true,
        provider: "openai",
        imageModel: "grok-imagine-1.0",
      };
    },
  });

  const result = await plugin.hooks.message_received(makeCtx("/rp agent-image"));
  assert.equal(result.response.ok, true);
  assert.match(result.response.data.text, /Agent 生图配置/);
  assert.match(result.response.data.text, /provider: openai/);
  assert.match(result.response.data.text, /grok-imagine-1\.0/);
});

test("agent-image command updates config through callback", async () => {
  let capturedPatch = null;
  const plugin = createRPPlugin({
    getAgentImageConfig() {
      return {
        enabled: true,
        provider: "inherit",
        imageModel: "",
      };
    },
    async updateAgentImageConfig(patch) {
      capturedPatch = patch;
      return {
        enabled: true,
        provider: "gemini",
        imageModel: "gemini-3.1-flash-image-preview",
      };
    },
  });

  const result = await plugin.hooks.message_received(
    makeCtx("/rp agent-image --provider gemini --model gemini-3.1-flash-image-preview"),
  );
  assert.equal(result.response.ok, true);
  assert.deepEqual(capturedPatch, {
    provider: "gemini",
    imageModel: "gemini-3.1-flash-image-preview",
  });
  assert.match(result.response.data.text, /配置已更新/);
  assert.match(result.response.data.text, /provider: gemini/);
});

test("paused session ignores normal messages", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  await seedSession(plugin);
  const paused = await plugin.hooks.message_received(makeCtx("/rp pause"));
  assert.equal(paused.response.ok, true);

  const normal = await plugin.hooks.message_received(makeCtx("this should not trigger model"));
  assert.equal(normal.handled, true);
  assert.equal(normal.response.ok, true);
  assert.equal(normal.response.data.status, "paused");
});

test("duplicate import reports warning", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  const payload = { name: "DupCard", description: "same" };
  const one = await plugin.hooks.message_received(
    makeCtx("/rp import-card", {
      attachments: [{ filename: "dup.json", buffer: Buffer.from(JSON.stringify(payload)) }],
    }),
  );
  assert.equal(one.response.ok, true);

  const two = await plugin.hooks.message_received(
    makeCtx("/rp import-card", {
      attachments: [{ filename: "dup.json", buffer: Buffer.from(JSON.stringify(payload)) }],
    }),
  );
  assert.equal(two.response.ok, true);
  assert.equal(two.response.data.warnings.some((w) => String(w).includes("Duplicate content detected")), true);
});

test("snake_case context fields are supported", async () => {
  const plugin = createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  const payload = { name: "Snake", description: "ctx" };
  const imported = await plugin.hooks.message_received({
    content: "/rp import-card",
    channel_type: "discord",
    platform_context_id: "guild1",
    channel_id: "channel1",
    user_id: "u1",
    attachments: [{ filename: "snake.json", buffer: Buffer.from(JSON.stringify(payload)) }],
  });
  assert.equal(imported.response.ok, true);
});

test("summary failure does not block dialogue and returns warning", async () => {
  const plugin = createRPPlugin({
    contextPolicy: {
      summaryTriggerTokens: 1,
      recentMessagesLimit: 1,
    },
    summaryRetryConfig: {
      retries: 1,
      delaysMs: [1],
      timeoutMs: 100,
    },
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
      async summarize() {
        throw new Error("summary down");
      },
    },
  });

  await seedSession(plugin);
  const result = await plugin.hooks.message_received(makeCtx("long long long long long long"));
  assert.equal(result.response.ok, true);
  assert.equal(Array.isArray(result.response.data.warnings), true);
  assert.equal(result.response.data.warnings.includes("RP_SUMMARY_FAILED"), true);
});

test("companion_tick can generate proactive output", async () => {
  const plugin = createRPPlugin({
    contextPolicy: {
      companionIdleMinutes: 0,
    },
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
  });

  const sessionId = await seedSession(plugin);
  const tick = await plugin.hooks.companion_tick({
    session_id: sessionId,
    user_id: "u1",
    reason: "scheduled check",
    mode: "balanced",
  });

  assert.equal(tick.handled, true);
  assert.equal(tick.response.ok, true);
  assert.equal(typeof tick.response.data.content, "string");
  assert.equal(tick.response.data.content.includes("🧭"), true);
});
