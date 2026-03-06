import test from "node:test";
import assert from "node:assert/strict";
import { parseRpCommand } from "../src/utils/commandParser.js";

test("parse command with quoted options", () => {
  const parsed = parseRpCommand('/rp image --prompt "hello world" --style anime');
  assert.equal(parsed.command, "image");
  assert.equal(parsed.options.prompt, "hello world");
  assert.equal(parsed.options.style, "anime");
});

test("parse repeated options", () => {
  const parsed = parseRpCommand("/rp start --lorebook a --lorebook b");
  assert.deepEqual(parsed.options.lorebook, ["a", "b"]);
});
