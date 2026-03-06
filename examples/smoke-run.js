import { createRPPlugin } from "../src/index.js";

function ctx(content, extra = {}) {
  return {
    channelType: "discord",
    platformContextId: "guild-dev",
    channelId: "chan-dev",
    userId: "user-dev",
    content,
    attachments: [],
    ...extra,
  };
}

const plugin = createRPPlugin({
  modelProvider: {
    async generate() {
      return { content: "[mock assistant reply]" };
    },
    async summarize({ conversation }) {
      return `[summary] ${conversation.slice(0, 50)}`;
    },
  },
  ttsProvider: {
    async synthesize() {
      return { audioUrl: "https://example.local/audio.mp3" };
    },
  },
  imageProvider: {
    async generate() {
      return { imageUrl: "https://example.local/image.png" };
    },
  },
});

async function run() {
  const card = await plugin.hooks.message_received(
    ctx("/rp import-card", {
      attachments: [{ filename: "card.json", buffer: Buffer.from(JSON.stringify({ name: "SmokeCard", first_mes: "Hello" })) }],
    }),
  );
  const cardId = card.response.data.asset_id;

  const preset = await plugin.hooks.message_received(
    ctx("/rp import-preset", {
      attachments: [{ filename: "preset.json", buffer: Buffer.from(JSON.stringify({ temperature: 0.7 })) }],
    }),
  );
  const presetId = preset.response.data.asset_id;

  console.log((await plugin.hooks.message_received(ctx(`/rp start --card ${cardId} --preset ${presetId}`))).response);
  console.log((await plugin.hooks.message_received(ctx("hello"))).response);
  console.log((await plugin.hooks.message_received(ctx("/rp speak"))).response);
  console.log((await plugin.hooks.message_received(ctx('/rp image --prompt "smoke test"'))).response);
  console.log((await plugin.hooks.message_received(ctx("/rp end"))).response);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
