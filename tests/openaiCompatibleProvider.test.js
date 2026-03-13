import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatibleProviders } from "../src/index.js";

test("openai-compatible model provider maps chat response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: "hello" } }],
      };
    },
  });

  try {
    const { modelProvider } = createOpenAICompatibleProviders({ baseUrl: "https://example.com/v1" });
    const result = await modelProvider.generate({
      prompt: { messages: [{ role: "user", content: "hi" }] },
      modelConfig: { temperature: 0.3 },
    });
    assert.equal(result.content, "hello");
  } finally {
    global.fetch = originalFetch;
  }
});

test("openai-compatible image provider maps b64 payload", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        data: [{ b64_json: "abcd" }],
      };
    },
  });

  try {
    const { imageProvider } = createOpenAICompatibleProviders({ baseUrl: "https://example.com/v1" });
    const result = await imageProvider.generate({ prompt: "city" });
    assert.equal(result.imageUrl, "data:image/png;base64,abcd");
  } finally {
    global.fetch = originalFetch;
  }
});

test("openai-compatible image provider allows per-call model override", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return {
      ok: true,
      async json() {
        return {
          data: [{ b64_json: "abcd" }],
        };
      },
    };
  };

  try {
    const { imageProvider } = createOpenAICompatibleProviders({ baseUrl: "https://example.com/v1" });
    await imageProvider.generate({ prompt: "city", model: "gpt-image-1-high" });
    assert.equal(capturedBody.model, "gpt-image-1-high");
  } finally {
    global.fetch = originalFetch;
  }
});

test("openai-compatible model provider supports array content", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: [{ type: "text", text: "hello" }, { type: "text", text: " world" }],
            },
          },
        ],
      };
    },
  });

  try {
    const { modelProvider } = createOpenAICompatibleProviders({ baseUrl: "https://example.com/v1" });
    const result = await modelProvider.generate({
      prompt: { messages: [{ role: "user", content: "hi" }] },
    });
    assert.equal(result.content, "hello world");
  } finally {
    global.fetch = originalFetch;
  }
});

test("openai-compatible tts provider supports binary audio response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") {
          return "audio/mpeg";
        }
        return null;
      },
    },
    async arrayBuffer() {
      return Buffer.from("audio-bytes");
    },
  });

  try {
    const { ttsProvider } = createOpenAICompatibleProviders({ baseUrl: "https://example.com/v1" });
    const result = await ttsProvider.synthesize({ text: "hello" });
    assert.match(result.audioUrl, /^data:audio\/mpeg;base64,/);
  } finally {
    global.fetch = originalFetch;
  }
});
