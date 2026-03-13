export const OPENCLAW_RP_PLUGIN_ID = "openclaw-rp-plugin";
export const AGENT_IMAGE_TOOL_NAME = "rp_generate_image";

export const openclawRpPluginConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    agentImage: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: {
          type: "boolean",
          default: true,
          description: "Expose an optional agent tool for image generation in non-/rp chats.",
        },
        provider: {
          type: "string",
          enum: ["inherit", "openai", "gemini"],
          default: "inherit",
          description:
            "Which provider stack the agent image tool should use. inherit follows the plugin's normal provider resolution.",
        },
        imageModel: {
          type: "string",
          minLength: 1,
          description:
            "Override the image model used by the agent image tool. Leave empty to use provider defaults.",
        },
      },
    },
  },
};

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getOpenClawRpPluginConfig(apiConfig) {
  const value = apiConfig?.plugins?.entries?.[OPENCLAW_RP_PLUGIN_ID]?.config;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeAgentImageConfig(pluginConfig = {}) {
  const raw = pluginConfig?.agentImage;
  const provider = asTrimmedString(raw?.provider).toLowerCase();
  const normalizedProvider =
    provider === "openai" || provider === "gemini" ? provider : "inherit";

  return {
    enabled: raw?.enabled !== false,
    provider: normalizedProvider,
    imageModel: asTrimmedString(raw?.imageModel),
  };
}

export function createAgentImageTool({
  ensureReady,
  getConfig,
  getImageProvider,
  getMediaDir,
  materializeMedia,
  logger,
}) {
  return {
    name: AGENT_IMAGE_TOOL_NAME,
    optional: true,
    description: [
      "Generate a brand-new image from a text prompt for the current conversation.",
      "Call this tool immediately when the user asks you to draw, render, illustrate, generate, or show an image or photo.",
      "If the user asks to see you, your appearance, your photo, or an imagined scene, treat that as a direct image-generation request and call this tool instead of replying with only text.",
      "Do not stop at planning, prompt-writing, or describing the image in words when this tool can satisfy the request.",
      "The tool returns a MEDIA line. In your final reply, keep that MEDIA line verbatim and outside code fences so OpenClaw can attach the image back to IM.",
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          description:
            "A concrete image-generation prompt describing the exact scene to generate. Use this tool instead of asking the user to copy a prompt elsewhere.",
        },
        style: {
          type: "string",
          minLength: 1,
          description:
            "Optional style hint, such as photorealistic, anime, cinematic, or product photo. Prefer photorealistic for requests about seeing your photo or appearance unless the user asks for another style.",
        },
      },
    },
    async execute(_id, params) {
      await ensureReady?.();

      const config = typeof getConfig === "function" ? getConfig() : { enabled: true, imageModel: "" };
      if (config?.enabled === false) {
        return {
          content: [
            {
              type: "text",
              text: "Agent image generation is disabled in plugin config.",
            },
          ],
        };
      }

      const prompt = asTrimmedString(params?.prompt);
      const style = asTrimmedString(params?.style);
      if (!prompt) {
        return {
          content: [
            {
              type: "text",
              text: "Image generation failed: prompt is required.",
            },
          ],
        };
      }

      const imageProvider = typeof getImageProvider === "function" ? getImageProvider() : null;
      if (!imageProvider?.generate) {
        return {
          content: [
            {
              type: "text",
              text: "Image generation is unavailable because no image provider is configured.",
            },
          ],
        };
      }

      try {
        const result = await imageProvider.generate({
          prompt,
          style: style || undefined,
          model: config?.imageModel || undefined,
        });
        const mediaRaw = result?.imageUrl;
        if (!mediaRaw) {
          throw new Error("image provider returned no media");
        }
        const mediaPath = await materializeMedia(mediaRaw, getMediaDir?.());
        const lines = [
          "Image generated successfully.",
          config?.imageModel ? `Model: ${config.imageModel}` : "",
          "Keep the following line exactly as-is in your final reply so OpenClaw can send the image to IM:",
          `MEDIA:${mediaPath}`,
        ].filter(Boolean);
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (err) {
        logger?.warn?.(`[openclaw-rp] agent image tool failed: ${String(err?.message || err)}`);
        return {
          content: [
            {
              type: "text",
              text: `Image generation failed: ${String(err?.message || err)}`,
            },
          ],
        };
      }
    },
  };
}
