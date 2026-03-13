import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_IMAGE_TOOL_NAME,
  createAgentImageTool,
  getOpenClawRpPluginConfig,
  normalizeAgentImageConfig,
} from "../src/openclaw/agentImageTool.js";

test("normalizeAgentImageConfig returns stable defaults", () => {
  assert.deepEqual(normalizeAgentImageConfig({}), {
    enabled: true,
    provider: "inherit",
    imageModel: "",
  });
});

test("getOpenClawRpPluginConfig reads nested plugin entry config", () => {
  const config = getOpenClawRpPluginConfig({
    plugins: {
      entries: {
        "openclaw-rp-plugin": {
          config: {
            agentImage: {
              enabled: true,
              provider: "openai",
              imageModel: "gpt-image-1",
            },
          },
        },
      },
    },
  });

  assert.equal(config.agentImage.provider, "openai");
  assert.equal(config.agentImage.imageModel, "gpt-image-1");
});

test("agent image tool returns MEDIA line and model override", async () => {
  let captured = null;
  const tool = createAgentImageTool({
    ensureReady: async () => {},
    getConfig: () => ({
      enabled: true,
      provider: "inherit",
      imageModel: "gpt-image-1",
    }),
    getImageProvider: () => ({
      async generate(input) {
        captured = input;
        return { imageUrl: "https://example.com/generated.png" };
      },
    }),
    getMediaDir: () => "/tmp/openclaw-agent-images",
    materializeMedia: async (value) => value,
    logger: null,
  });

  assert.equal(tool.name, AGENT_IMAGE_TOOL_NAME);
  assert.equal(tool.parameters?.type, "object");
  assert.match(tool.description || "", /Call this tool immediately/i);
  assert.match(tool.description || "", /Do not stop at planning/i);
  assert.match(tool.parameters?.properties?.style?.description || "", /Prefer photorealistic/i);
  const result = await tool.execute("call_1", {
    prompt: "a rainy cyberpunk alley",
    style: "cinematic",
  });
  const text = result.content?.[0]?.text || "";

  assert.deepEqual(captured, {
    prompt: "a rainy cyberpunk alley",
    style: "cinematic",
    model: "gpt-image-1",
  });
  assert.match(text, /Image generated successfully/);
  assert.match(text, /Model: gpt-image-1/);
  assert.match(text, /MEDIA:https:\/\/example.com\/generated\.png/);
});

test("agent image tool reports disabled state", async () => {
  const tool = createAgentImageTool({
    ensureReady: async () => {},
    getConfig: () => ({
      enabled: false,
      provider: "inherit",
      imageModel: "",
    }),
    getImageProvider: () => null,
    getMediaDir: () => "/tmp/openclaw-agent-images",
    materializeMedia: async (value) => value,
    logger: null,
  });

  const result = await tool.execute("call_2", {
    prompt: "anything",
  });

  assert.match(result.content?.[0]?.text || "", /disabled/i);
});
