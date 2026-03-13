/**
 * Gemini API provider for RP plugin.
 *
 * - Chat completions: OpenAI-compatible endpoint
 * - TTS: Native Gemini generateContent with AUDIO modality
 * - Image: Native Gemini generateContent with IMAGE modality
 */

function ensureFetch() {
    if (typeof fetch !== "function") {
        throw new Error("Global fetch is required (Node 18+)");
    }
}

function isAbortError(err) {
    const name = String(err?.name || "");
    const message = String(err?.message || "");
    return name === "AbortError" || /aborted/i.test(message);
}

async function geminiPost(url, { apiKey, body, timeoutMs = 30000 }) {
    ensureFetch();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gemini HTTP ${response.status}: ${text}`);
        }
        return response.json();
    } catch (err) {
        if (isAbortError(err)) {
            throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function openaiPost(url, { apiKey, body, timeoutMs = 30000 }) {
    ensureFetch();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
        }
        return response.json();
    } catch (err) {
        if (isAbortError(err)) {
            throw new Error(`OpenAI-compatible request timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function contentToText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text || "" : "")).join("");
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

export function createGeminiProviders(config = {}) {
    const apiKey = config.apiKey;
    const openaiBase = "https://generativelanguage.googleapis.com/v1beta/openai";
    const geminiBase = "https://generativelanguage.googleapis.com/v1beta";
    const chatModel = config.model || "gemini-3-flash-preview";
    const ttsModel = config.ttsModel || "gemini-2.5-flash-preview-tts";
    const ttsVoice = config.ttsVoice || "Kore"; // Gemini TTS voice name
    const imageModel = config.imageModel || "gemini-3.1-flash-image-preview";
    const embeddingModel = config.embeddingModel || "text-embedding-004";

    return {
        modelProvider: {
            async generate({ prompt, modelConfig }) {
                const messages = prompt?.messages?.map((m) => ({ role: m.role, content: m.content })) || [];
                const body = {
                    model: modelConfig?.model_id || chatModel,
                    messages,
                    temperature: modelConfig?.temperature,
                    top_p: modelConfig?.top_p,
                    max_tokens: modelConfig?.max_tokens,
                };

                if (Array.isArray(modelConfig?.stop_sequences) && modelConfig.stop_sequences.length > 0) {
                    body.stop = modelConfig.stop_sequences;
                }

                const json = await openaiPost(`${openaiBase}/chat/completions`, {
                    apiKey,
                    body,
                    timeoutMs: config.chatTimeoutMs || 60000,
                });

                return {
                    content: contentToText(json?.choices?.[0]?.message?.content),
                    raw: json,
                };
            },

            async summarize(input) {
                const body = {
                    model: config.summaryModel || chatModel,
                    messages: summaryPrompt(input),
                    temperature: 0.2,
                };

                const json = await openaiPost(`${openaiBase}/chat/completions`, {
                    apiKey,
                    body,
                    timeoutMs: config.summaryTimeoutMs || 30000,
                });

                return contentToText(json?.choices?.[0]?.message?.content);
            },
        },

        embeddingProvider: {
            model: embeddingModel,
            async embed(text) {
                const body = {
                    content: {
                        parts: [{ text: String(text || "") }],
                    },
                    taskType: "RETRIEVAL_QUERY",
                };

                const json = await geminiPost(
                    `${geminiBase}/models/${embeddingModel}:embedContent`,
                    { apiKey, body, timeoutMs: config.embeddingTimeoutMs || 30000 },
                );
                const vector = json?.embedding?.values;
                if (!Array.isArray(vector) || vector.length === 0) {
                    throw new Error("Gemini embedding response missing vector");
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
                // Use native Gemini TTS API
                const body = {
                    contents: [
                        {
                            parts: [{ text }],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: ttsVoice,
                                },
                            },
                        },
                    },
                };

                const json = await geminiPost(
                    `${geminiBase}/models/${ttsModel}:generateContent`,
                    { apiKey, body, timeoutMs: config.ttsTimeoutMs || 90000 },
                );

                // Extract audio from response
                const parts = json?.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
                        const mimeType = part.inlineData.mimeType;
                        // Gemini returns audio/L16 PCM, we'll convert to a usable data URL
                        // The audio is base64 encoded
                        const audioUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                        return { audioUrl, raw: json };
                    }
                }

                throw new Error("TTS response missing audio payload");
            },
        },

        imageProvider: {
            async generate({ prompt, style, model }) {
                const mergedPrompt = style ? `${prompt}\n\nStyle: ${style}` : prompt;
                const body = {
                    contents: [
                        {
                            parts: [{ text: mergedPrompt }],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ["TEXT", "IMAGE"],
                    },
                };

                const json = await geminiPost(
                    `${geminiBase}/models/${model || imageModel}:generateContent`,
                    { apiKey, body, timeoutMs: config.imageTimeoutMs || 120000 },
                );

                // Check for safety blocks or empty candidates
                if (!json?.candidates || json.candidates.length === 0) {
                    const blockReason = json?.promptFeedback?.blockReason;
                    if (blockReason) {
                        throw new Error(`Image blocked by safety filter: ${blockReason}`);
                    }
                    throw new Error("Image generation returned empty response");
                }

                const candidate = json.candidates[0];

                // Check finish reason
                if (candidate.finishReason && candidate.finishReason !== "STOP") {
                    throw new Error(`Image generation stopped: ${candidate.finishReason}`);
                }

                // Extract image from response parts
                const parts = candidate?.content?.parts || [];
                let textContent = "";
                for (const part of parts) {
                    if (part?.inlineData?.data && part?.inlineData?.mimeType?.startsWith("image/")) {
                        const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        return { imageUrl, raw: { model: model || imageModel, finishReason: candidate.finishReason } };
                    }
                    if (part?.text) {
                        textContent += part.text;
                    }
                }

                // No image found - provide helpful error
                if (textContent) {
                    throw new Error(`Image not generated. Model response: ${textContent.slice(0, 200)}`);
                }
                throw new Error("Image response missing image payload");
            },
        },
    };
}
