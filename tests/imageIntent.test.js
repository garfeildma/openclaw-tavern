import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaIntentWithModel,
  detectPhotoRequestIntent,
  detectVoiceRequestIntent,
  shouldClassifyMediaIntent,
} from "../src/utils/imageIntent.js";

test("detects portrait-style photo requests", () => {
  const intent = detectPhotoRequestIntent("给我看看你的样子");
  assert.deepEqual(intent, {
    type: "portrait",
    styleHint: "portrait photo",
  });
});

test("detects outfit-style photo requests", () => {
  const intent = detectPhotoRequestIntent("看看今天的穿搭");
  assert.deepEqual(intent, {
    type: "outfit",
    styleHint: "outfit photo",
  });
});

test("detects implicit visual requests with standing pose", () => {
  const intent = detectPhotoRequestIntent("你站起来让我仔细看看你");
  assert.deepEqual(intent, {
    type: "photo",
    styleHint: "photo snapshot",
  });
});

test("detects scenery-style photo requests", () => {
  const intent = detectPhotoRequestIntent("看看你周围的风景");
  assert.deepEqual(intent, {
    type: "scenery",
    styleHint: "scenery photo",
  });
});

test("ignores negative image mentions", () => {
  assert.equal(detectPhotoRequestIntent("先别发图片，继续聊天"), null);
});

test("detects voice requests", () => {
  const intent = detectVoiceRequestIntent("说句话给我听");
  assert.deepEqual(intent, {
    type: "voice",
  });
});

test("ignores negative voice mentions", () => {
  assert.equal(detectVoiceRequestIntent("先不要发语音"), null);
});

test("marks ambiguous media requests for model fallback", () => {
  assert.equal(shouldClassifyMediaIntent("让我看清楚一点"), true);
  assert.equal(shouldClassifyMediaIntent("继续聊剧情"), false);
});

test("classifyMediaIntentWithModel parses image label", async () => {
  const result = await classifyMediaIntentWithModel({
    modelProvider: {
      async generate() {
        return { content: "IMAGE" };
      },
    },
    text: "让我看清楚一点",
  });
  assert.deepEqual(result, { image: true, voice: false });
});

test("classifyMediaIntentWithModel parses both label", async () => {
  const result = await classifyMediaIntentWithModel({
    modelProvider: {
      async generate() {
        return { content: "BOTH" };
      },
    },
    text: "给我看看你再说句话给我听",
  });
  assert.deepEqual(result, { image: true, voice: true });
});
