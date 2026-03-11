import test from "node:test";
import assert from "node:assert/strict";
import { deliverAutoImageForTelegram, deliverAutoSpeakForTelegram } from "../src/openclaw/autoImage.js";

test("deliverAutoImageForTelegram deletes placeholder then sends media", async () => {
  const sendCalls = [];
  const actionCalls = [];
  const router = {
    async image(ctx, options) {
      assert.equal(ctx.platformContextId, "123");
      assert.deepEqual(options, { style: "outfit photo" });
      return {
        ok: true,
        data: {
          image_url: "https://example.com/look.png",
        },
      };
    },
  };
  const telegramRuntime = {
    async sendMessageTelegram(chatId, text, options) {
      sendCalls.push({ chatId, text, options });
      if (sendCalls.length === 1) {
        return { chatId, messageId: "41" };
      }
      return { chatId, messageId: "42" };
    },
    messageActions: {
      async handleAction(input) {
        actionCalls.push(input);
        return { ok: true };
      },
    },
  };

  const result = await deliverAutoImageForTelegram({
    router,
    routerCtx: {
      channelType: "telegram",
      platformContextId: "123",
      channelId: "123",
      userId: "u1",
    },
    styleHint: "outfit photo",
    inboundMediaDir: "/tmp/openclaw-rp-test",
    telegramRuntime,
    logger: null,
    accountId: "acct-1",
    messageThreadId: 99,
    apiConfig: {},
    materializeMedia: async (value) => value,
  });

  assert.equal(result.ok, true);
  assert.equal(sendCalls.length, 2);
  assert.equal(sendCalls[0].text, "图片生成中");
  assert.equal(sendCalls[1].options.mediaUrl, "https://example.com/look.png");
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].action, "delete");
  assert.deepEqual(actionCalls[0].params, {
    chatId: "123",
    messageId: 41,
  });
});

test("deliverAutoImageForTelegram edits placeholder on failure", async () => {
  const actionCalls = [];
  const telegramRuntime = {
    async sendMessageTelegram(chatId, text) {
      assert.equal(chatId, "123");
      assert.equal(text, "图片生成中");
      return { chatId, messageId: "51" };
    },
    messageActions: {
      async handleAction(input) {
        actionCalls.push(input);
        return { ok: true };
      },
    },
  };

  const result = await deliverAutoImageForTelegram({
    router: {
      async image() {
        throw new Error("boom");
      },
    },
    routerCtx: {
      channelType: "telegram",
      platformContextId: "123",
      channelId: "123",
      userId: "u1",
    },
    telegramRuntime,
    logger: null,
    accountId: "acct-1",
    apiConfig: {},
    materializeMedia: async (value) => value,
  });

  assert.equal(result.ok, false);
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].action, "edit");
  assert.deepEqual(actionCalls[0].params, {
    chatId: "123",
    messageId: 51,
    message: "图片生成失败",
  });
});

test("deliverAutoSpeakForTelegram deletes placeholder then sends voice", async () => {
  const sendCalls = [];
  const actionCalls = [];
  const telegramRuntime = {
    async sendMessageTelegram(chatId, text, options) {
      sendCalls.push({ chatId, text, options });
      if (sendCalls.length === 1) {
        return { chatId, messageId: "61" };
      }
      return { chatId, messageId: "62" };
    },
    messageActions: {
      async handleAction(input) {
        actionCalls.push(input);
        return { ok: true };
      },
    },
  };

  const result = await deliverAutoSpeakForTelegram({
    router: {
      async speak(ctx) {
        assert.equal(ctx.platformContextId, "123");
        return {
          ok: true,
          data: {
            audio_url: "https://example.com/voice.mp3",
          },
        };
      },
    },
    routerCtx: {
      channelType: "telegram",
      platformContextId: "123",
      channelId: "123",
      userId: "u1",
    },
    inboundMediaDir: "/tmp/openclaw-rp-test",
    telegramRuntime,
    logger: null,
    accountId: "acct-1",
    messageThreadId: 101,
    apiConfig: {},
    materializeMedia: async (value) => value,
  });

  assert.equal(result.ok, true);
  assert.equal(sendCalls.length, 2);
  assert.equal(sendCalls[0].text, "语音生成中");
  assert.equal(sendCalls[1].options.mediaUrl, "https://example.com/voice.mp3");
  assert.equal(sendCalls[1].options.asVoice, true);
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].action, "delete");
});

test("deliverAutoSpeakForTelegram edits placeholder on failure", async () => {
  const actionCalls = [];
  const telegramRuntime = {
    async sendMessageTelegram(chatId, text) {
      assert.equal(chatId, "123");
      assert.equal(text, "语音生成中");
      return { chatId, messageId: "71" };
    },
    messageActions: {
      async handleAction(input) {
        actionCalls.push(input);
        return { ok: true };
      },
    },
  };

  const result = await deliverAutoSpeakForTelegram({
    router: {
      async speak() {
        throw new Error("boom");
      },
    },
    routerCtx: {
      channelType: "telegram",
      platformContextId: "123",
      channelId: "123",
      userId: "u1",
    },
    inboundMediaDir: "/tmp/openclaw-rp-test",
    telegramRuntime,
    logger: null,
    accountId: "acct-1",
    apiConfig: {},
    materializeMedia: async (value) => value,
  });

  assert.equal(result.ok, false);
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].action, "edit");
  assert.deepEqual(actionCalls[0].params, {
    chatId: "123",
    messageId: 71,
    message: "语音生成失败",
  });
});
