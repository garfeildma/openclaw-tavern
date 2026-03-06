import test from "node:test";
import assert from "node:assert/strict";
import {
  createRPPlugin,
  createDiscordMessageHandler,
  createTelegramUpdateHandler,
  RP_ERROR_CODES,
} from "../src/index.js";

function basicPlugin(options = {}) {
  return createRPPlugin({
    modelProvider: {
      async generate() {
        return { content: "assistant reply" };
      },
    },
    ...options,
  });
}

test("attachmentResolver hydrates attachment buffers for imports", async () => {
  const plugin = basicPlugin({
    attachmentResolver: async () => Buffer.from(JSON.stringify({ name: "AttachCard", description: "d" }), "utf8"),
  });

  const result = await plugin.hooks.message_received({
    content: "/rp import-card",
    channelType: "discord",
    platformContextId: "g1",
    channelId: "c1",
    userId: "u1",
    attachments: [{ filename: "card.json", url: "https://example.com/card.json" }],
  });

  assert.equal(result.response.ok, true);
  assert.ok(result.response.data.asset_id.startsWith("card_"));
});

test("message hook timeout returns RP_INTERNAL_ERROR", async () => {
  const plugin = basicPlugin({
    hookTimeoutMs: 10,
    attachmentResolver: async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(Buffer.from("{}")), 50);
      }),
  });

  const result = await plugin.hooks.message_received({
    content: "/rp import-card",
    channelType: "discord",
    platformContextId: "g1",
    channelId: "c1",
    userId: "u1",
    attachments: [{ filename: "card.json", url: "https://example.com/card.json" }],
  });

  assert.equal(result.handled, true);
  assert.equal(result.response.ok, false);
  assert.equal(result.response.code, RP_ERROR_CODES.INTERNAL_ERROR);
});

test("discord integration handler dispatches payload", async () => {
  const plugin = basicPlugin();
  const sent = [];
  const handle = createDiscordMessageHandler({
    plugin,
    send: async (payload) => {
      sent.push(payload);
    },
  });

  const card = await handle({
    guild_id: "g1",
    channel_id: "c1",
    author: { id: "u1" },
    content: "/rp import-card",
    attachments: [{ filename: "x.json", buffer: Buffer.from(JSON.stringify({ name: "X" }), "utf8") }],
  });
  assert.equal(card.handled, true);

  const preset = await handle({
    guild_id: "g1",
    channel_id: "c1",
    author: { id: "u1" },
    content: "/rp import-preset",
    attachments: [{ filename: "p.json", buffer: Buffer.from(JSON.stringify({ temperature: 0.5 }), "utf8") }],
  });
  assert.equal(preset.handled, true);

  const list = await handle({
    guild_id: "g1",
    channel_id: "c1",
    author: { id: "u1" },
    content: "/rp list-assets",
    attachments: [],
  });

  assert.equal(list.handled, true);
  assert.ok(sent.length >= 1);
  assert.equal(typeof sent.at(-1).content, "string");
});

test("telegram integration handler dispatches method and payload", async () => {
  const plugin = basicPlugin({
    ttsProvider: {
      async synthesize() {
        return { audioUrl: "https://example.com/audio.mp3" };
      },
    },
  });

  const sent = [];
  const handle = createTelegramUpdateHandler({
    plugin,
    send: async (method, payload) => {
      sent.push({ method, payload });
    },
  });

  await handle({
    message: {
      chat: { id: 101 },
      from: { id: 202 },
      text: "/rp import-card",
      document: {
        file_id: "f1",
        file_name: "card.json",
      },
    },
  });

  // import above fails without attachmentResolver, but still emits a response payload.
  assert.ok(sent.length >= 1);
  assert.equal(sent[0].method, "sendMessage");
});
