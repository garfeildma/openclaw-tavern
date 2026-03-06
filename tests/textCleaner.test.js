import test from "node:test";
import assert from "node:assert/strict";
import { extractDialogueForTts } from "../src/utils/textCleaner.js";

test("extractDialogueForTts keeps quoted dialogue only", () => {
  const input = '她轻轻一笑，整理了一下袖口。“欢迎回来。”她望着你，又补了一句：“今天想吃点什么？”';
  assert.equal(extractDialogueForTts(input), "欢迎回来。\n今天想吃点什么？");
});

test("extractDialogueForTts falls back to de-noised plain speech", () => {
  const input = "*微笑* 欢迎回来，今晚我给你做点心。";
  assert.equal(extractDialogueForTts(input), "欢迎回来，今晚我给你做点心。");
});
