import test from "node:test";
import assert from "node:assert/strict";
import { matchLorebookEntries } from "../src/core/lorebookMatcher.js";

test("match lorebook entries by key and priority", () => {
  const entries = [
    { uid: "1", keys: ["city"], content: "City lore", priority: 50, enabled: true },
    { uid: "2", keys: ["hero"], content: "Hero lore", priority: 100, enabled: true },
  ];

  const active = matchLorebookEntries(entries, [{ role: "user", content: "Tell me hero in the city" }]);
  assert.equal(active.length, 2);
  assert.equal(active[0].uid, "2");
});

test("constant lorebook always active", () => {
  const entries = [{ uid: "c", keys: [], content: "Always", constant: true, enabled: true }];
  const active = matchLorebookEntries(entries, []);
  assert.equal(active.length, 1);
  assert.equal(active[0].uid, "c");
});
