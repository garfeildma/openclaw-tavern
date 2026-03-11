import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  buildManagedSoulOverride,
  mergeManagedSoulOverride,
  resolvePersonaWorkspaceDir,
  syncManagedSoulOverride,
} from "../src/openclaw/agentPersona.js";

test("buildManagedSoulOverride renders character persona summary", () => {
  const text = buildManagedSoulOverride({
    cardDetail: {
      name: "Alice",
      description: "<b>Sharp-eyed</b> detective",
      personality: "Calm and precise",
      scenario: "Rainy night in the city",
      system_prompt: "Stay in character as {{char}}.",
    },
    userName: "Bob",
  });

  assert.match(text, /Character: Alice/);
  assert.match(text, /Description: Sharp-eyed detective/);
  assert.match(text, /Personality: Calm and precise/);
  assert.match(text, /Scenario: Rainy night in the city/);
  assert.match(text, /Role Instruction: Stay in character as Alice\./);
});

test("mergeManagedSoulOverride prepends managed block without dropping existing soul", () => {
  const merged = mergeManagedSoulOverride("# Existing Soul\n\nKeep this.", "# Active RP Persona Override");
  assert.match(merged, /openclaw-rp-plugin:soul:begin/);
  assert.match(merged, /# Existing Soul/);
  assert.match(merged, /Keep this\./);
});

test("syncManagedSoulOverride updates existing managed block in place", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-rp-soul-"));
  const soulPath = path.join(workspaceDir, "SOUL.md");
  await writeFile(
    soulPath,
    [
      "<!-- openclaw-rp-plugin:soul:begin -->",
      "old",
      "<!-- openclaw-rp-plugin:soul:end -->",
      "",
      "# Existing Soul",
    ].join("\n"),
    "utf8",
  );

  const result = await syncManagedSoulOverride({
    workspaceDir,
    managedContent: "new persona",
  });

  const content = await readFile(soulPath, "utf8");
  assert.equal(result.updated, true);
  assert.match(content, /new persona/);
  assert.doesNotMatch(content, /\nold\n/);
  assert.match(content, /# Existing Soul/);
});

test("resolvePersonaWorkspaceDir prefers explicit workspaceDir", () => {
  const result = resolvePersonaWorkspaceDir({
    workspaceDir: "/tmp/explicit-workspace",
    apiConfig: {},
  });
  assert.equal(result, path.resolve("/tmp/explicit-workspace"));
});

test("resolvePersonaWorkspaceDir falls back to default agent workspace config", () => {
  const result = resolvePersonaWorkspaceDir({
    apiConfig: {
      agents: {
        list: [{ id: "main", default: true, workspace: "/tmp/main-workspace" }],
      },
    },
  });
  assert.equal(result, path.resolve("/tmp/main-workspace"));
});
