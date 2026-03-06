import { makeId } from "../utils/id.js";
import { RPError } from "../errors.js";
import { RP_ASSET_TYPES, RP_ERROR_CODES, RP_SESSION_STATUS } from "../types.js";
import { cosineSimilarity } from "../utils/multilingualEmbedding.js";

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(input) {
  return String(input || "").trim().toLowerCase();
}

function ensureAssetType(type) {
  if (!Object.values(RP_ASSET_TYPES).includes(type)) {
    throw new RPError(RP_ERROR_CODES.BAD_REQUEST, `Invalid asset type: ${type}`);
  }
}

export class InMemoryStore {
  constructor() {
    this.assets = new Map();
    this.cards = new Map();
    this.presets = new Map();
    this.lorebooks = new Map();
    this.sessions = new Map();
    this.sessionLorebooks = new Map();
    this.turns = new Map();
    this.summaries = new Map();
    this.turnEmbeddings = new Map();
  }

  nextAssetVersion(userId, type, name) {
    let max = 0;
    for (const a of this.assets.values()) {
      if (a.user_id === userId && a.type === type && normalizeName(a.name) === normalizeName(name)) {
        max = Math.max(max, a.version);
      }
    }
    return max + 1;
  }

  createAsset({ userId, type, name, sourceFormat, rawJson, extraJson, contentHash }) {
    ensureAssetType(type);

    const id = makeId(type);
    const asset = {
      id,
      user_id: userId,
      type,
      name: String(name || "").trim(),
      source_format: sourceFormat || "unknown",
      version: this.nextAssetVersion(userId, type, name),
      content_hash: contentHash || null,
      raw_json: rawJson || "{}",
      extra_json: extraJson || "{}",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.assets.set(id, asset);
    return clone(asset);
  }

  replaceAsset({ assetId, userId, sourceFormat, rawJson, extraJson, contentHash, detail }) {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new RPError(RP_ERROR_CODES.ASSET_NOT_FOUND, "Asset not found");
    }
    if (asset.user_id !== userId) {
      throw new RPError(RP_ERROR_CODES.PERMISSION_DENIED, "Cannot replace asset owned by another user");
    }

    asset.source_format = sourceFormat || asset.source_format;
    asset.raw_json = rawJson || asset.raw_json;
    asset.extra_json = extraJson || asset.extra_json;
    asset.content_hash = contentHash || asset.content_hash;
    asset.updated_at = nowIso();

    if (asset.type === RP_ASSET_TYPES.CARD && detail) {
      this.cards.set(assetId, { asset_id: assetId, ...detail });
    }
    if (asset.type === RP_ASSET_TYPES.PRESET && detail) {
      this.presets.set(assetId, { asset_id: assetId, ...detail });
    }
    if (asset.type === RP_ASSET_TYPES.LOREBOOK && detail) {
      this.lorebooks.set(assetId, { asset_id: assetId, ...detail });
    }

    return clone(asset);
  }

  saveCardDetail(assetId, detail) {
    this.cards.set(assetId, { asset_id: assetId, ...clone(detail) });
  }

  savePresetDetail(assetId, detail) {
    this.presets.set(assetId, { asset_id: assetId, ...clone(detail) });
  }

  saveLorebookDetail(assetId, detail) {
    this.lorebooks.set(assetId, { asset_id: assetId, ...clone(detail) });
  }

  getAssetById(assetId) {
    const asset = this.assets.get(assetId);
    return asset ? clone(asset) : null;
  }

  findAssetByHash({ userId, type, contentHash }) {
    if (!contentHash) {
      return null;
    }
    const candidate = [...this.assets.values()]
      .filter((a) => a.user_id === userId)
      .filter((a) => (type ? a.type === type : true))
      .filter((a) => a.content_hash === contentHash)
      .sort((a, b) => {
        if (a.version !== b.version) return b.version - a.version;
        return a.created_at < b.created_at ? 1 : -1;
      })[0];
    return candidate ? clone(candidate) : null;
  }

  listAssets({ userId, type, search, page = 1, pageSize = 10 }) {
    const needle = normalizeName(search);
    const filtered = [...this.assets.values()]
      .filter((a) => a.user_id === userId)
      .filter((a) => (type ? a.type === type : true))
      .filter((a) => (needle ? normalizeName(a.name).includes(needle) : true))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize).map(clone),
      page: safePage,
      totalPages,
    };
  }

  resolveAssetByNameOrId({ userId, type, nameOrId }) {
    const direct = this.assets.get(nameOrId);
    if (direct && direct.user_id === userId && (!type || direct.type === type)) {
      return clone(direct);
    }

    const needle = normalizeName(nameOrId);
    const candidates = [...this.assets.values()]
      .filter((a) => a.user_id === userId)
      .filter((a) => (type ? a.type === type : true))
      .filter((a) => normalizeName(a.name).startsWith(needle))
      .sort((a, b) => {
        if (normalizeName(a.name) === needle && normalizeName(b.name) !== needle) return -1;
        if (normalizeName(a.name) !== needle && normalizeName(b.name) === needle) return 1;
        if (a.version !== b.version) return b.version - a.version;
        return a.created_at < b.created_at ? 1 : -1;
      });

    if (candidates.length === 0) {
      throw new RPError(RP_ERROR_CODES.ASSET_NOT_FOUND, "Asset not found");
    }

    const sameTop = candidates.filter((c) => normalizeName(c.name) === normalizeName(candidates[0].name));
    if (sameTop.length > 1 && normalizeName(nameOrId) !== normalizeName(candidates[0].name)) {
      throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "Multiple asset matches", {
        candidates: candidates.slice(0, 5).map((x) => ({ id: x.id, name: x.name, version: x.version })),
      });
    }

    return clone(candidates[0]);
  }

  getAssetDetail(assetId) {
    const asset = this.assets.get(assetId);
    if (!asset) {
      return null;
    }

    let detail = null;
    if (asset.type === RP_ASSET_TYPES.CARD) detail = this.cards.get(assetId) || {};
    if (asset.type === RP_ASSET_TYPES.PRESET) detail = this.presets.get(assetId) || {};
    if (asset.type === RP_ASSET_TYPES.LOREBOOK) detail = this.lorebooks.get(assetId) || {};

    return {
      ...clone(asset),
      detail: clone(detail),
    };
  }

  deleteAsset({ userId, assetId }) {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new RPError(RP_ERROR_CODES.ASSET_NOT_FOUND, "Asset not found");
    }
    if (asset.user_id !== userId) {
      throw new RPError(RP_ERROR_CODES.PERMISSION_DENIED, "Cannot delete asset owned by another user");
    }

    for (const session of this.sessions.values()) {
      if (
        [RP_SESSION_STATUS.ACTIVE, RP_SESSION_STATUS.PAUSED, RP_SESSION_STATUS.SUMMARIZING].includes(session.status) &&
        (session.card_id === assetId ||
          session.preset_id === assetId ||
          (this.sessionLorebooks.get(session.id) || []).includes(assetId))
      ) {
        throw new RPError(RP_ERROR_CODES.ASSET_IN_USE, "Asset is used by an active session");
      }
      if (
        session.card_id === assetId ||
        session.preset_id === assetId ||
        (this.sessionLorebooks.get(session.id) || []).includes(assetId)
      ) {
        throw new RPError(RP_ERROR_CODES.ASSET_IN_USE, "Asset is referenced by session history");
      }
    }

    this.assets.delete(assetId);
    this.cards.delete(assetId);
    this.presets.delete(assetId);
    this.lorebooks.delete(assetId);

    return clone(asset);
  }

  createSession({ userId, channelType, channelSessionKey, cardId, presetId, lorebookIds }) {
    const existing = [...this.sessions.values()].find(
      (s) =>
        s.channel_session_key === channelSessionKey &&
        [RP_SESSION_STATUS.ACTIVE, RP_SESSION_STATUS.PAUSED, RP_SESSION_STATUS.SUMMARIZING].includes(s.status),
    );
    if (existing) {
      throw new RPError(RP_ERROR_CODES.SESSION_CONFLICT, "Active session already exists in this channel");
    }

    const id = makeId("session");
    const session = {
      id,
      user_id: userId,
      channel_type: channelType,
      channel_session_key: channelSessionKey,
      card_id: cardId,
      preset_id: presetId,
      status: RP_SESSION_STATUS.ACTIVE,
      turn_count: 0,
      summary_version: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    this.sessions.set(id, session);
    this.sessionLorebooks.set(id, [...new Set(lorebookIds || [])]);
    this.turns.set(id, []);
    this.summaries.set(id, []);

    return clone(session);
  }

  getSessionById(sessionId) {
    const row = this.sessions.get(sessionId);
    if (!row) return null;
    return {
      ...clone(row),
      lorebook_ids: clone(this.sessionLorebooks.get(sessionId) || []),
    };
  }

  getSessionByChannelKey(channelSessionKey) {
    const session = [...this.sessions.values()].find(
      (s) => s.channel_session_key === channelSessionKey && s.status !== RP_SESSION_STATUS.ENDED,
    );
    if (!session) return null;
    return this.getSessionById(session.id);
  }

  updateSessionStatus({ sessionId, status }) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }
    session.status = status;
    session.updated_at = nowIso();
    return clone(session);
  }

  incrementSummaryVersion(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }
    session.summary_version += 1;
    session.updated_at = nowIso();
    return session.summary_version;
  }

  appendTurn({ sessionId, role, content, tokenEstimate }) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    const turns = this.turns.get(sessionId) || [];
    const turnIndex = turns.reduce((max, t) => Math.max(max, t.turn_index || 0), 0) + 1;
    const row = {
      session_id: sessionId,
      turn_index: turnIndex,
      role,
      content,
      token_estimate: tokenEstimate || null,
      created_at: nowIso(),
    };
    turns.push(row);
    this.turns.set(sessionId, turns);
    session.turn_count = turns.length;
    session.updated_at = nowIso();

    return clone(row);
  }

  getTurns(sessionId) {
    return clone(this.turns.get(sessionId) || []);
  }

  getRecentTurns(sessionId, limit) {
    const turns = this.turns.get(sessionId) || [];
    return clone(turns.slice(Math.max(0, turns.length - limit)));
  }

  deleteLastAssistantTurn(sessionId) {
    const turns = this.turns.get(sessionId) || [];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].role === "assistant") {
        const removed = turns.splice(i, 1)[0];
        this.turns.set(sessionId, turns);
        this.deleteTurnEmbedding(sessionId, removed.turn_index);
        const session = this.sessions.get(sessionId);
        if (session) {
          session.turn_count = turns.length;
          session.updated_at = nowIso();
        }
        return clone(removed);
      }
    }
    return null;
  }

  replaceLastUserTurn(sessionId, content, tokenEstimate) {
    const turns = this.turns.get(sessionId) || [];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].role === "user") {
        turns[i].content = content;
        turns[i].token_estimate = tokenEstimate || turns[i].token_estimate;
        turns[i].created_at = nowIso();
        return clone(turns[i]);
      }
    }
    throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "No user turn found for retry edit");
  }

  addSummary({ sessionId, coveredFrom, coveredTo, summaryText }) {
    const version = this.incrementSummaryVersion(sessionId);
    const row = {
      session_id: sessionId,
      version,
      covered_turn_from: coveredFrom,
      covered_turn_to: coveredTo,
      summary_text: summaryText,
      created_at: nowIso(),
    };

    const items = this.summaries.get(sessionId) || [];
    items.push(row);
    this.summaries.set(sessionId, items);
    return clone(row);
  }

  getLatestSummary(sessionId) {
    const items = this.summaries.get(sessionId) || [];
    if (items.length === 0) return null;
    return clone(items[items.length - 1]);
  }

  getSessionAssetBundle(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    const cardAsset = this.getAssetById(session.card_id);
    const presetAsset = this.getAssetById(session.preset_id);
    const lorebookAssets = (session.lorebook_ids || []).map((id) => this.getAssetById(id)).filter(Boolean);

    if (!cardAsset || !presetAsset) {
      throw new RPError(RP_ERROR_CODES.INTERNAL_ERROR, "Session has broken asset references");
    }

    return {
      session,
      card: { ...cardAsset, detail: clone(this.cards.get(cardAsset.id) || {}) },
      preset: { ...presetAsset, detail: clone(this.presets.get(presetAsset.id) || {}) },
      lorebooks: lorebookAssets.map((asset) => ({ ...asset, detail: clone(this.lorebooks.get(asset.id) || {}) })),
    };
  }

  upsertTurnEmbedding({ sessionId, turnIndex, role, content, language, vector, model }) {
    if (!sessionId || !Number.isInteger(Number(turnIndex))) {
      return null;
    }
    const key = `${sessionId}:${Number(turnIndex)}`;
    const row = {
      session_id: sessionId,
      turn_index: Number(turnIndex),
      role: role || "user",
      content: String(content || ""),
      language: language || null,
      embedding_json: JSON.stringify(Array.isArray(vector) ? vector : []),
      embedding_dim: Array.isArray(vector) ? vector.length : 0,
      embedding_model: model || null,
      created_at: nowIso(),
    };
    this.turnEmbeddings.set(key, row);
    return clone(row);
  }

  deleteTurnEmbedding(sessionId, turnIndex) {
    if (!sessionId || !Number.isInteger(Number(turnIndex))) {
      return false;
    }
    return this.turnEmbeddings.delete(`${sessionId}:${Number(turnIndex)}`);
  }

  searchTurnEmbeddings({
    sessionId,
    queryVector,
    limit = 6,
    minScore = 0.2,
    beforeTurnIndex,
    candidateLimit = 250,
  }) {
    if (!sessionId || !Array.isArray(queryVector) || queryVector.length === 0) {
      return [];
    }
    const maxTurn = Number.isInteger(Number(beforeTurnIndex)) ? Number(beforeTurnIndex) : Number.MAX_SAFE_INTEGER;
    const items = [];
    for (const row of this.turnEmbeddings.values()) {
      if (row.session_id !== sessionId) {
        continue;
      }
      if (Number(row.turn_index) > maxTurn) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(row.embedding_json);
      } catch {
        parsed = [];
      }
      const score = cosineSimilarity(queryVector, parsed);
      if (score >= minScore) {
        items.push({
          ...clone(row),
          score,
        });
      }
    }

    return items
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.turn_index - a.turn_index;
      })
      .slice(0, Math.max(1, Number(candidateLimit) || 250))
      .slice(0, Math.max(1, Number(limit) || 6));
  }
}
