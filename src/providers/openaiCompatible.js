function ensureFetch() {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is required (Node 18+)");
  }
}

function defaultHeaders(apiKey) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function normalizeBase(baseUrl) {
  return String(baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
}

async function post(url, { apiKey, body, timeoutMs = 30000 }) {
  ensureFetch();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: defaultHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response) {
  return response.json();
}

async function readJsonOrBinary(response, mediaType) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json") || contentType.includes("text/json")) {
    return {
      type: "json",
      data: await response.json(),
    };
  }

  const arr = await response.arrayBuffer();
  const buffer = Buffer.from(arr);
  return {
    type: "binary",
    dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
    bytes: buffer,
  };
}

function makeChatMessages(prompt) {
  if (!prompt?.messages) {
    return [];
  }
  return prompt.messages.map((m) => ({ role: m.role, content: m.content }));
}

function contentToText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text") {
          return part.text || "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function summaryPrompt({ summaryStyle, name, personality, previousSummary, conversation }) {
  return [
    {
      role: "system",
      content: [
        "You summarize roleplay sessions.",
        "Keep output third-person and persona-safe.",
        `Style: ${summaryStyle || "persona-safe"}`,
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Character: ${name}`,
        `Personality cues: ${personality}`,
        "Keep core persona, key relationships, unresolved plot lines, and promises.",
        `Previous summary: ${previousSummary || "(none)"}`,
        "Conversation to summarize:",
        conversation,
      ].join("\n"),
    },
  ];
}

export function createOpenAICompatibleProviders(config = {}) {
  const baseUrl = normalizeBase(config.baseUrl);
  const apiKey = config.apiKey;
  const defaultModel = config.model || "gpt-4o-mini";
  const ttsModel = config.ttsModel || "gpt-4o-mini-tts";
  const ttsVoice = config.ttsVoice || "alloy";
  const imageModel = config.imageModel || "gpt-image-1";
  const embeddingModel = config.embeddingModel || "text-embedding-3-small";

  return {
    modelProvider: {
      async generate({ prompt, modelConfig }) {
        const body = {
          model: modelConfig?.model_id || defaultModel,
          messages: makeChatMessages(prompt),
          temperature: modelConfig?.temperature,
          top_p: modelConfig?.top_p,
          max_tokens: modelConfig?.max_tokens,
        };

        if (Array.isArray(modelConfig?.stop_sequences) && modelConfig.stop_sequences.length > 0) {
          body.stop = modelConfig.stop_sequences;
        }

        const response = await post(`${baseUrl}/chat/completions`, {
          apiKey,
          body,
          timeoutMs: config.chatTimeoutMs || 30000,
        });
        const json = await readJsonResponse(response);

        return {
          content: contentToText(json?.choices?.[0]?.message?.content),
          raw: json,
        };
      },

      async summarize(input) {
        const body = {
          model: config.summaryModel || defaultModel,
          messages: summaryPrompt(input),
          temperature: 0.2,
        };

        const response = await post(`${baseUrl}/chat/completions`, {
          apiKey,
          body,
          timeoutMs: config.summaryTimeoutMs || 30000,
        });
        const json = await readJsonResponse(response);

        return contentToText(json?.choices?.[0]?.message?.content);
      },
    },

    embeddingProvider: {
      model: embeddingModel,
      async embed(text) {
        const response = await post(`${baseUrl}/embeddings`, {
          apiKey,
          body: {
            model: embeddingModel,
            input: String(text || ""),
          },
          timeoutMs: config.embeddingTimeoutMs || 30000,
        });
        const json = await readJsonResponse(response);
        const vector = json?.data?.[0]?.embedding;
        if (!Array.isArray(vector) || vector.length === 0) {
          throw new Error("Embedding response missing vector");
        }
        return {
          embedding: vector,
          model: embeddingModel,
          raw: json,
        };
      },
    },

    ttsProvider: {
      async synthesize({ text }) {
        const response = await post(`${baseUrl}/audio/speech`, {
          apiKey,
          body: {
            model: ttsModel,
            voice: ttsVoice,
            input: text,
            format: "mp3",
          },
          timeoutMs: config.ttsTimeoutMs || 15000,
        });

        const parsed = await readJsonOrBinary(response, "audio/mpeg");
        if (parsed.type === "binary") {
          return {
            audioUrl: parsed.dataUrl,
            raw: { binary: true, bytes: parsed.bytes.length },
          };
        }

        const json = parsed.data;
        const audioUrl = json?.audio_url || json?.url || null;
        if (audioUrl) {
          return { audioUrl, raw: json };
        }

        if (json?.audio_base64) {
          return {
            audioUrl: `data:audio/mpeg;base64,${json.audio_base64}`,
            raw: json,
          };
        }

        throw new Error("TTS response missing audio payload");
      },
    },

    imageProvider: {
      async generate({ prompt, style, model }) {
        const mergedPrompt = style ? `${prompt}\n\nStyle: ${style}` : prompt;
        const response = await post(`${baseUrl}/images/generations`, {
          apiKey,
          body: {
            model: model || imageModel,
            prompt: mergedPrompt,
            size: config.imageSize || "1024x1024",
          },
          timeoutMs: config.imageTimeoutMs || 60000,
        });
        const json = await readJsonResponse(response);

        const imageUrl = json?.data?.[0]?.url || json?.image_url || null;
        if (imageUrl) {
          return { imageUrl, raw: json };
        }

        const b64 = json?.data?.[0]?.b64_json;
        if (b64) {
          return {
            imageUrl: `data:image/png;base64,${b64}`,
            raw: json,
          };
        }

        throw new Error("Image response missing payload");
      },
    },
  };
}
