import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDiscordMessage,
  normalizeTelegramMessage,
  toDiscordSendPayload,
  toTelegramSendPayload,
} from "../src/index.js";

test("normalize discord message", () => {
  const msg = normalizeDiscordMessage({
    guild_id: "g1",
    channel_id: "c1",
    author: { id: "u1" },
    content: "/rp help",
    attachments: [{ filename: "a.json", content_type: "application/json" }],
  });

  assert.equal(msg.channelType, "discord");
  assert.equal(msg.platformContextId, "g1");
  assert.equal(msg.channelId, "c1");
  assert.equal(msg.userId, "u1");
  assert.equal(msg.attachments.length, 1);
});

test("normalize telegram message", () => {
  const msg = normalizeTelegramMessage({
    message: {
      chat: { id: 101 },
      from: { id: 202 },
      text: "hello",
      document: { file_id: "f1", file_name: "card.json", mime_type: "application/json" },
    },
  });

  assert.equal(msg.channelType, "telegram");
  assert.equal(msg.channelId, "101");
  assert.equal(msg.userId, "202");
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].fileId, "f1");
});

test("format discord payload", () => {
  const payload = toDiscordSendPayload({
    message: "ok",
    data: { image_url: "https://x/y.png" },
  });
  assert.equal(payload.files[0], "https://x/y.png");
});

test("format telegram payload", () => {
  const payload = toTelegramSendPayload({
    message: "ok",
    data: { audio_url: "https://x/y.ogg" },
  });

  assert.equal(payload.method, "sendVoice");
  assert.equal(payload.payload.voice, "https://x/y.ogg");
});
