import { RPError } from "../errors.js";
import { DEFAULT_CONTEXT_POLICY, RP_ERROR_CODES, RP_SESSION_STATUS } from "../types.js";
import { estimateTokens } from "../utils/tokenEstimator.js";
import {
  createHashedMultilingualEmbeddingProvider,
  detectLanguageTag,
  normalizeEmbeddingVector,
} from "../utils/multilingualEmbedding.js";
import { buildPrompt } from "./promptBuilder.js";
import { SessionMutex } from "./sessionMutex.js";
import { retryWithBackoff } from "./retry.js";
import { matchLorebookEntries } from "./lorebookMatcher.js";
import { resolveModelConfig } from "./modelConfigResolver.js";

function parseEntries(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseLorebookEntries(lorebooks) {
  const all = [];
  for (const lb of lorebooks || []) {
    const entries = parseEntries(lb?.detail?.entries_json);
    all.push(...entries);
  }
  return all;
}

const COMPANION_MODES = new Set(["balanced", "checkin", "question", "report"]);

function asCompanionMode(input) {
  const raw = String(input || "").trim().toLowerCase();
  return COMPANION_MODES.has(raw) ? raw : "balanced";
}

function cleanSnippet(text, maxLen = 180) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, Math.max(20, maxLen - 1))}…`;
}

function toIsoTimeValue(raw) {
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function safeParseCompanionJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatRecentTurnsForCompanion(turns, charName, limit = 8) {
  const safeTurns = Array.isArray(turns) ? turns.slice(-Math.max(1, limit)) : [];
  return safeTurns
    .map((turn) => {
      const role = turn?.role === "assistant" ? charName || "Character" : "User";
      return `${role}: ${cleanSnippet(turn?.content || "", 180)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatMemoriesForCompanion(memories, limit = 3) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return "";
  }
  return memories
    .slice(0, Math.max(1, limit))
    .map((memory) => {
      const score = Number(memory?.score || 0).toFixed(2);
      return `- [turn ${Number(memory?.turn_index || 0)}, score ${score}] ${cleanSnippet(memory?.content || "", 140)}`;
    })
    .join("\n");
}

function buildCompanionFallback({ charName, topMemory, mode }) {
  const memoryHint = cleanSnippet(topMemory?.content || "", 70);
  const baseMessage = memoryHint
    ? `${charName}想到你之前提过“${memoryHint}”，来关心一下你现在的状态。`
    : `${charName}一直在这里，想和你保持联系。`;

  let proactiveQuestion = "你这会儿更想聊哪件事？";
  let actionReport = "我已经把这次近况整理进长期记忆，后续会继续跟进。";
  if (mode === "question") {
    proactiveQuestion = "要不要告诉我你现在最在意的一件事？";
  }
  if (mode === "report") {
    actionReport = "我已更新你的偏好与情绪线索，后续回复会优先参考这些长期记忆。";
  }

  return {
    proactiveMessage: cleanSnippet(baseMessage, 220),
    proactiveQuestion: cleanSnippet(proactiveQuestion, 120),
    actionReport: cleanSnippet(actionReport, 160),
    source: "fallback",
  };
}

function renderCompanionText(companion) {
  const lines = [];
  if (companion?.proactiveMessage) {
    lines.push(`💌 ${companion.proactiveMessage}`);
  }
  if (companion?.proactiveQuestion) {
    lines.push(`❓ ${companion.proactiveQuestion}`);
  }
  if (companion?.actionReport) {
    lines.push(`🧭 ${companion.actionReport}`);
  }
  return lines.join("\n");
}

export class SessionManager {
  constructor({ store, modelProvider, embeddingProvider, logger, contextPolicy, tokenEstimator, summaryRetryConfig }) {
    this.store = store;
    this.modelProvider = modelProvider;
    this.logger = logger || console;
    this.policy = { ...DEFAULT_CONTEXT_POLICY, ...(contextPolicy || {}) };
    this.mutex = new SessionMutex();
    this.tokenEstimator = tokenEstimator || estimateTokens;
    this.embeddingProvider =
      embeddingProvider ||
      createHashedMultilingualEmbeddingProvider({
        dimensions: this.policy.embeddingDimensions,
      });
    this.summaryRetryConfig = {
      retries: 2,
      delaysMs: [1000, 3000],
      timeoutMs: 30000,
      ...(summaryRetryConfig || {}),
    };
  }

  async processDialogue({ channelSessionKey, userId, content }) {
    const session = this.store.getSessionByChannelKey(channelSessionKey);
    if (!session || session.user_id !== userId) {
      return null;
    }

    return this.mutex.run(session.id, async () => {
      this.logger.info?.("rp.dialogue.start", { session_id: session.id, user_id: userId });
      const current = this.store.getSessionById(session.id);
      if (!current) {
        throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
      }
      if (current.status !== RP_SESSION_STATUS.ACTIVE) {
        return {
          ignored: true,
          status: current.status,
        };
      }

      const userTurn = this.store.appendTurn({
        sessionId: current.id,
        role: "user",
        content,
        tokenEstimate: this.tokenEstimator(content),
      });
      await this.indexTurnEmbedding(current.id, userTurn);

      const summaryResult = await this.maybeSummarize(current.id);

      const prepared = await this.preparePromptForSession(current.id, {
        queryText: content,
        userName: userId,
      });
      const modelConfig = this.resolveModelConfig({
        preset: prepared.bundle.preset,
      });

      if (!this.modelProvider?.generate) {
        throw new RPError(RP_ERROR_CODES.MODEL_UNAVAILABLE, "Model provider is not configured");
      }

      const modelResponse = await retryWithBackoff(
        async () =>
          this.modelProvider.generate({
            session: prepared.bundle.session,
            preset: prepared.bundle.preset,
            prompt: prepared.prompt,
            modelConfig,
          }),
        {
          retries: 2,
          delaysMs: [1000, 3000],
          timeoutMs: 30000,
        },
      ).catch((err) => {
        this.logger.warn?.("rp.dialogue.model_unavailable", { session_id: current.id, error: String(err?.message || err) });
        throw new RPError(RP_ERROR_CODES.MODEL_UNAVAILABLE, err?.message || "Model unavailable");
      });

      const assistantText = modelResponse?.content;
      if (!assistantText) {
        throw new RPError(RP_ERROR_CODES.MODEL_UNAVAILABLE, "Model returned empty content");
      }

      const turn = this.store.appendTurn({
        sessionId: current.id,
        role: "assistant",
        content: assistantText,
        tokenEstimate: this.tokenEstimator(assistantText),
      });
      await this.indexTurnEmbedding(current.id, turn);

      return {
        turn,
        content: assistantText,
        status: RP_SESSION_STATUS.ACTIVE,
        warnings: summaryResult.attempted && !summaryResult.success ? [RP_ERROR_CODES.SUMMARY_FAILED] : [],
      };
    });
  }

  async retryLastResponse({ channelSessionKey, userId, editText }) {
    const session = this.store.getSessionByChannelKey(channelSessionKey);
    if (!session || session.user_id !== userId) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    return this.mutex.run(session.id, async () => {
      this.logger.info?.("rp.retry.start", { session_id: session.id, user_id: userId, has_edit: Boolean(editText) });
      const current = this.store.getSessionById(session.id);
      if (!current) {
        throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
      }
      if (![RP_SESSION_STATUS.ACTIVE, RP_SESSION_STATUS.PAUSED].includes(current.status)) {
        throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "Session is not retryable");
      }

      const removed = this.store.deleteLastAssistantTurn(current.id);
      if (!removed) {
        throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "No assistant reply to retry");
      }
      this.store.deleteTurnEmbedding?.(current.id, removed.turn_index);

      let latestUserTurn = null;
      if (editText) {
        latestUserTurn = this.store.replaceLastUserTurn(current.id, editText, this.tokenEstimator(editText));
        await this.indexTurnEmbedding(current.id, latestUserTurn);
      } else {
        const turns = this.store.getTurns(current.id);
        latestUserTurn = [...turns].reverse().find((t) => t.role === "user") || null;
      }

      const prepared = await this.preparePromptForSession(current.id, {
        queryText: latestUserTurn?.content || "",
        userName: userId,
      });
      const modelConfig = this.resolveModelConfig({
        preset: prepared.bundle.preset,
      });

      const modelResponse = await retryWithBackoff(
        async () =>
          this.modelProvider.generate({
            session: prepared.bundle.session,
            preset: prepared.bundle.preset,
            prompt: prepared.prompt,
            modelConfig,
          }),
        { retries: 2, delaysMs: [1000, 3000], timeoutMs: 30000 },
      ).catch((err) => {
        this.logger.warn?.("rp.retry.model_unavailable", { session_id: current.id, error: String(err?.message || err) });
        throw new RPError(RP_ERROR_CODES.MODEL_UNAVAILABLE, err?.message || "Model unavailable");
      });

      const assistantText = modelResponse?.content;
      if (!assistantText) {
        throw new RPError(RP_ERROR_CODES.MODEL_UNAVAILABLE, "Model returned empty content");
      }

      const turn = this.store.appendTurn({
        sessionId: current.id,
        role: "assistant",
        content: assistantText,
        tokenEstimate: this.tokenEstimator(assistantText),
      });
      await this.indexTurnEmbedding(current.id, turn);

      return turn;
    });
  }

  async generateCompanionNudge({
    channelSessionKey,
    sessionId,
    userId,
    reason,
    force = false,
    minIdleMinutes,
    mode = "balanced",
  }) {
    const session = sessionId
      ? this.store.getSessionById(String(sessionId))
      : this.store.getSessionByChannelKey(String(channelSessionKey || ""));
    if (!session || (userId && session.user_id !== userId)) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    return this.mutex.run(session.id, async () => {
      if (!this.policy.companionEnabled) {
        return {
          ignored: true,
          reason: "companion_disabled",
        };
      }

      const current = this.store.getSessionById(session.id);
      if (!current) {
        throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
      }
      if (![RP_SESSION_STATUS.ACTIVE, RP_SESSION_STATUS.PAUSED].includes(current.status)) {
        return {
          ignored: true,
          reason: "session_not_available",
          status: current.status,
        };
      }

      const turns = this.store.getTurns(current.id);
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      const lastTs = toIsoTimeValue(lastTurn?.created_at) ?? toIsoTimeValue(current.updated_at) ?? Date.now();
      const idleMinutes = Math.max(0, (Date.now() - lastTs) / 60000);
      const requiredIdle = Math.max(
        0,
        Number(
          minIdleMinutes ??
            this.policy.companionIdleMinutes ??
            DEFAULT_CONTEXT_POLICY.companionIdleMinutes ??
            0,
        ) || 0,
      );
      if (!force && requiredIdle > 0 && idleMinutes < requiredIdle) {
        return {
          ignored: true,
          reason: "idle_not_reached",
          idleMinutes,
          requiredIdleMinutes: requiredIdle,
          status: current.status,
        };
      }

      const triggerReason = cleanSnippet(
        reason || "Scheduled companion check-in based on long-term memory",
        240,
      );
      const prepared = await this.preparePromptForSession(current.id, {
        queryText: triggerReason,
        userName: current.user_id,
        excludeRecentTurns: 0,
      });
      const companion = await this.composeCompanionMessage({
        prepared,
        userName: current.user_id,
        triggerReason,
        mode: asCompanionMode(mode),
      });
      const text = renderCompanionText(companion);
      if (!text) {
        return {
          ignored: true,
          reason: "empty_companion_message",
        };
      }

      const proactiveTurn = this.store.appendTurn({
        sessionId: current.id,
        role: "assistant",
        content: text,
        tokenEstimate: this.tokenEstimator(text),
      });
      await this.indexTurnEmbedding(current.id, proactiveTurn);

      return {
        sessionId: current.id,
        text,
        followupText: companion.proactiveQuestion || "",
        companion,
        triggerReason,
        idleMinutes,
        status: current.status,
        memoryRecallCount: Number(prepared.retrievedMemories?.length || 0),
        turn: proactiveTurn,
      };
    });
  }

  async composeCompanionMessage({ prepared, userName, triggerReason, mode }) {
    const charName = prepared?.bundle?.card?.detail?.name || prepared?.bundle?.card?.name || "Character";
    const memoryBlock = formatMemoriesForCompanion(
      prepared?.retrievedMemories || [],
      Number(this.policy.companionMemoryTopK) || 3,
    );
    const recentBlock = formatRecentTurnsForCompanion(
      prepared?.recentTurns || [],
      charName,
      Number(this.policy.companionRecentTurns) || 8,
    );
    const summaryText = cleanSnippet(prepared?.summary?.summary_text || "", 380);
    const normalizedMode = asCompanionMode(mode);

    const fallback = buildCompanionFallback({
      charName,
      topMemory: prepared?.retrievedMemories?.[0],
      mode: normalizedMode,
    });

    if (!this.modelProvider?.generate) {
      return fallback;
    }

    const system = [
      "You are a reflective companion agent inspired by the Generative Agents paper.",
      "Use the memory stream, summarize reflection, then output a micro-plan for next interaction.",
      "Output strict JSON only with keys: proactive_message, proactive_question, action_report.",
      "Each field must be one sentence, warm, specific, and avoid role-breaking.",
      "Keep it concise and avoid markdown.",
    ].join(" ");

    const userPrompt = [
      `Character: ${charName}`,
      `User: ${userName || "User"}`,
      `Mode: ${normalizedMode}`,
      `Trigger Reason: ${triggerReason}`,
      summaryText ? `Conversation Summary: ${summaryText}` : "Conversation Summary: (none)",
      memoryBlock ? `Memory Stream:\n${memoryBlock}` : "Memory Stream: (none)",
      recentBlock ? `Recent Dialogue:\n${recentBlock}` : "Recent Dialogue: (none)",
      "Return JSON now.",
    ].join("\n\n");

    try {
      const modelConfig = this.resolveModelConfig({
        preset: prepared?.bundle?.preset,
        commandOverrides: {
          temperature: 0.7,
          max_tokens: 280,
        },
      });
      const modelResponse = await retryWithBackoff(
        () =>
          this.modelProvider.generate({
            session: prepared?.bundle?.session,
            preset: prepared?.bundle?.preset,
            prompt: {
              messages: [
                { role: "system", content: system },
                { role: "user", content: userPrompt },
              ],
            },
            modelConfig,
          }),
        { retries: 1, delaysMs: [800], timeoutMs: 20000 },
      );
      const parsed = safeParseCompanionJson(modelResponse?.content || "");
      const proactiveMessage = cleanSnippet(
        parsed?.proactive_message || parsed?.proactiveMessage || "",
        220,
      );
      const proactiveQuestion = cleanSnippet(
        parsed?.proactive_question || parsed?.proactiveQuestion || "",
        120,
      );
      const actionReport = cleanSnippet(
        parsed?.action_report || parsed?.actionReport || "",
        160,
      );

      if (proactiveMessage || proactiveQuestion || actionReport) {
        return {
          proactiveMessage: proactiveMessage || fallback.proactiveMessage,
          proactiveQuestion: proactiveQuestion || fallback.proactiveQuestion,
          actionReport: actionReport || fallback.actionReport,
          source: "model",
        };
      }
    } catch (err) {
      this.logger.warn?.("rp.companion.generate_failed", {
        error: String(err?.message || err),
      });
    }

    return fallback;
  }

  async maybeSummarize(sessionId) {
    const session = this.store.getSessionById(sessionId);
    if (!session || session.status === RP_SESSION_STATUS.SUMMARIZING) {
      return { attempted: false, success: false };
    }

    const turns = this.store.getTurns(sessionId);
    const totalTokens = turns.reduce((acc, t) => acc + (t.token_estimate || this.tokenEstimator(t.content)), 0);

    if (totalTokens <= this.policy.summaryTriggerTokens) {
      return { attempted: false, success: false };
    }

    const latestSummary = this.store.getLatestSummary(sessionId);
    const coveredTo = latestSummary?.covered_turn_to || 0;
    const summarizeTo = Math.max(coveredTo, turns.length - this.policy.recentMessagesLimit);

    if (summarizeTo <= coveredTo) {
      return { attempted: false, success: false };
    }

    const chunk = turns.filter((t) => t.turn_index > coveredTo && t.turn_index <= summarizeTo);
    if (chunk.length === 0) {
      return { attempted: false, success: false };
    }

    this.store.updateSessionStatus({ sessionId, status: RP_SESSION_STATUS.SUMMARIZING });
    this.logger.info?.("rp.summary.start", { session_id: sessionId });

    try {
      const bundle = this.store.getSessionAssetBundle(sessionId);
      const personality = bundle.card?.detail?.personality || "";
      const name = bundle.card?.detail?.name || bundle.card?.name || "Character";

      const summaryText = await this.generateSummary({
        name,
        personality,
        turns: chunk,
        previousSummary: latestSummary?.summary_text || "",
      });

      this.store.addSummary({
        sessionId,
        coveredFrom: coveredTo + 1,
        coveredTo: summarizeTo,
        summaryText,
      });

      this.store.updateSessionStatus({ sessionId, status: RP_SESSION_STATUS.ACTIVE });
      this.logger.info?.("rp.summary.done", { session_id: sessionId });
      return { attempted: true, success: true };
    } catch (err) {
      this.logger.warn?.("rp.summary.failed", {
        session_id: sessionId,
        error: String(err?.message || err),
      });
      this.store.updateSessionStatus({ sessionId, status: RP_SESSION_STATUS.ACTIVE });
      return { attempted: true, success: false };
    }
  }

  async generateSummary({ name, personality, turns, previousSummary }) {
    const conversation = turns.map((t) => `${t.role}: ${t.content}`).join("\n");

    if (this.modelProvider?.summarize) {
      return retryWithBackoff(
        async () =>
          this.modelProvider.summarize({
            summaryStyle: this.policy.summaryStyle,
            name,
            personality,
            previousSummary,
            conversation,
          }),
        this.summaryRetryConfig,
      );
    }

    return [
      `Character: ${name}`,
      `Personality cues: ${personality}`,
      "Summary (third-person, persona-safe):",
      trimSummary(conversation),
    ].join("\n");
  }

  async preparePromptForSession(sessionId, options = {}) {
    const bundle = this.store.getSessionAssetBundle(sessionId);
    const recentTurns = this.store.getRecentTurns(sessionId, this.policy.recentMessagesLimit);
    const summary = this.store.getLatestSummary(sessionId);
    const entries = parseLorebookEntries(bundle.lorebooks);
    const activeLorebookEntries = matchLorebookEntries(entries, recentTurns);
    const latestTurnIndex = Number(bundle.session?.turn_count || recentTurns.at(-1)?.turn_index || 0);
    const excludeRecentTurns = Math.max(
      0,
      Number(options.excludeRecentTurns ?? this.policy.memoryExcludeRecentTurns) || 0,
    );
    const beforeTurnIndex = Number.isInteger(Number(options.beforeTurnIndex))
      ? Number(options.beforeTurnIndex)
      : Math.max(0, latestTurnIndex - excludeRecentTurns);
    const queryText = String(options.queryText || recentTurns.at(-1)?.content || "");
    const retrievedMemories = await this.retrieveRelevantMemories({
      sessionId,
      queryText,
      beforeTurnIndex,
    });

    const prompt = buildPrompt({
      card: bundle.card,
      lorebookEntries: activeLorebookEntries,
      summary,
      recentTurns,
      retrievedMemories,
      userName: options.userName,
      maxPromptTokens: this.policy.maxPromptTokens,
      tokenEstimator: this.tokenEstimator,
      budget: {
        memory: this.policy.memoryPromptBudget,
      },
      memoryMaxCharsPerItem: this.policy.memoryMaxCharsPerItem,
    });

    return {
      bundle,
      summary,
      recentTurns,
      activeLorebookEntries,
      retrievedMemories,
      prompt,
    };
  }

  async getEmbedding(text) {
    if (!this.policy.memoryEnabled) {
      return null;
    }
    const input = String(text || "").trim();
    if (!input) {
      return null;
    }
    if (typeof this.embeddingProvider?.embed !== "function") {
      return null;
    }

    try {
      const embedded = await this.embeddingProvider.embed(input);
      const rawVector = Array.isArray(embedded) ? embedded : embedded?.embedding;
      if (!Array.isArray(rawVector) || rawVector.length === 0) {
        return null;
      }
      const vector = normalizeEmbeddingVector(rawVector, this.policy.embeddingDimensions);
      return {
        vector,
        model:
          embedded?.model ||
          this.embeddingProvider?.model ||
          `unknown-${this.policy.embeddingDimensions || rawVector.length}`,
      };
    } catch (err) {
      this.logger.warn?.("rp.embedding.failed", {
        error: String(err?.message || err),
      });
      return null;
    }
  }

  async indexTurnEmbedding(sessionId, turn) {
    if (!this.policy.memoryEnabled || typeof this.store.upsertTurnEmbedding !== "function") {
      return null;
    }
    if (!turn?.content || !Number.isInteger(Number(turn?.turn_index))) {
      return null;
    }

    const result = await this.getEmbedding(turn.content);
    if (!result) {
      return null;
    }

    try {
      return this.store.upsertTurnEmbedding({
        sessionId,
        turnIndex: Number(turn.turn_index),
        role: turn.role || "user",
        content: turn.content,
        language: detectLanguageTag(turn.content),
        vector: result.vector,
        model: result.model,
      });
    } catch (err) {
      this.logger.warn?.("rp.embedding.persist_failed", {
        session_id: sessionId,
        turn_index: Number(turn.turn_index),
        error: String(err?.message || err),
      });
      return null;
    }
  }

  indexTurnEmbeddingAsync(sessionId, turn) {
    this.indexTurnEmbedding(sessionId, turn).catch((err) => {
      this.logger.warn?.("rp.embedding.async_failed", {
        session_id: sessionId,
        turn_index: Number(turn?.turn_index || 0),
        error: String(err?.message || err),
      });
    });
  }

  async retrieveRelevantMemories({ sessionId, queryText, beforeTurnIndex }) {
    if (!this.policy.memoryEnabled || typeof this.store.searchTurnEmbeddings !== "function") {
      return [];
    }
    const input = String(queryText || "").trim();
    if (!input) {
      return [];
    }

    const embedded = await this.getEmbedding(input);
    if (!embedded?.vector) {
      return [];
    }

    try {
      const rows = this.store.searchTurnEmbeddings({
        sessionId,
        queryVector: embedded.vector,
        beforeTurnIndex,
        limit: this.policy.memoryTopK,
        minScore: this.policy.memoryMinScore,
        candidateLimit: this.policy.memoryCandidateLimit,
      });

      const dedup = new Set();
      const memories = [];
      for (const row of rows || []) {
        const key = `${row.turn_index}:${row.role}:${String(row.content || "").slice(0, 80)}`;
        if (dedup.has(key)) {
          continue;
        }
        dedup.add(key);
        memories.push({
          turn_index: Number(row.turn_index),
          role: row.role || "user",
          content: String(row.content || ""),
          score: Number(row.score) || 0,
          language: row.language || "unknown",
        });
      }
      return memories;
    } catch (err) {
      this.logger.warn?.("rp.memory.search_failed", {
        session_id: sessionId,
        error: String(err?.message || err),
      });
      return [];
    }
  }

  resolveModelConfig({ preset, extraParams, commandOverrides } = {}) {
    return resolveModelConfig({ preset, extraParams, commandOverrides });
  }
}

function trimSummary(raw) {
  const lines = String(raw)
    .split("\n")
    .slice(-30)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.join("\n");
}
