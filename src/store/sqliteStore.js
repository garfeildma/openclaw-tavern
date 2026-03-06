import { RPError } from "../errors.js";
import { RP_ASSET_TYPES, RP_ERROR_CODES, RP_SESSION_STATUS } from "../types.js";
import { makeId } from "../utils/id.js";
import { cosineSimilarity } from "../utils/multilingualEmbedding.js";
import { SQLITE_SCHEMA_SQL } from "./schema.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(input) {
  return String(input || "").trim().toLowerCase();
}

function safeJson(raw) {
  try {
    return JSON.stringify(raw || {});
  } catch {
    return "{}";
  }
}

function runAndMapSqliteError(fn, defaultCode, defaultMessage) {
  try {
    return fn();
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("UNIQUE constraint failed") || msg.includes("constraint failed")) {
      throw new RPError(defaultCode, defaultMessage);
    }
    throw err;
  }
}

function parseEmbeddingJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class SqliteStore {
  constructor(db, options = {}) {
    if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
      throw new Error("SqliteStore requires a database object with exec() and prepare()");
    }
    this.db = db;
    this.vectorDistanceFunction = null;
    this.vectorExtensionLoaded = false;
    if (options.vector) {
      this.configureVectorSearch(options.vector);
    }
  }

  migrate() {
    this.db.exec(SQLITE_SCHEMA_SQL);
  }

  configureVectorSearch({ extensionPath, distanceFunction } = {}) {
    let loaded = false;
    if (extensionPath) {
      try {
        if (typeof this.db.enableLoadExtension === "function") {
          this.db.enableLoadExtension(true);
        }
        if (typeof this.db.loadExtension === "function") {
          this.db.loadExtension(extensionPath);
          loaded = true;
        }
      } catch {
        loaded = false;
      }
    }

    const userFn = String(distanceFunction || "").trim();
    const candidates = [userFn, "vec_distance_cosine", "vector_distance_cosine"].filter(Boolean);
    for (const fn of candidates) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fn)) {
        continue;
      }
      try {
        this.db.prepare(`SELECT ${fn}(?, ?) AS d`).get("[1,0]", "[1,0]");
        this.vectorDistanceFunction = fn;
        this.vectorExtensionLoaded = loaded || fn !== userFn;
        return {
          enabled: true,
          distanceFunction: fn,
          extensionLoaded: this.vectorExtensionLoaded,
        };
      } catch {
        // Try next function name.
      }
    }

    this.vectorDistanceFunction = null;
    this.vectorExtensionLoaded = loaded;
    return {
      enabled: false,
      distanceFunction: null,
      extensionLoaded: loaded,
    };
  }

  nextAssetVersion(userId, type, name) {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(version), 0) AS v
         FROM rp_assets
         WHERE user_id = ? AND type = ? AND lower(name) = lower(?)`,
      )
      .get(userId, type, name);
    return Number(row?.v || 0) + 1;
  }

  createAsset({ userId, type, name, sourceFormat, rawJson, extraJson, contentHash }) {
    if (!Object.values(RP_ASSET_TYPES).includes(type)) {
      throw new RPError(RP_ERROR_CODES.BAD_REQUEST, `Invalid asset type: ${type}`);
    }

    const id = makeId(type);
    const version = this.nextAssetVersion(userId, type, name);

    runAndMapSqliteError(
      () =>
        this.db
          .prepare(
            `INSERT INTO rp_assets
             (id, user_id, type, name, source_format, version, content_hash, raw_json, extra_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            userId,
            type,
            String(name || "").trim(),
            sourceFormat || "unknown",
            version,
            contentHash || null,
            rawJson || "{}",
            extraJson || "{}",
          ),
      RP_ERROR_CODES.INTERNAL_ERROR,
      "Failed to create asset",
    );

    return this.getAssetById(id);
  }

  replaceAsset({ assetId, userId, sourceFormat, rawJson, extraJson, contentHash, detail }) {
    const asset = this.getAssetById(assetId);
    if (!asset) {
      throw new RPError(RP_ERROR_CODES.ASSET_NOT_FOUND, "Asset not found");
    }
    if (asset.user_id !== userId) {
      throw new RPError(RP_ERROR_CODES.PERMISSION_DENIED, "Cannot replace asset owned by another user");
    }

    this.db
      .prepare(
        `UPDATE rp_assets
         SET source_format = ?, raw_json = ?, extra_json = ?, content_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(sourceFormat || asset.source_format, rawJson || asset.raw_json, extraJson || asset.extra_json, contentHash || asset.content_hash, assetId);

    if (asset.type === RP_ASSET_TYPES.CARD && detail) {
      this.saveCardDetail(assetId, detail);
    }
    if (asset.type === RP_ASSET_TYPES.PRESET && detail) {
      this.savePresetDetail(assetId, detail);
    }
    if (asset.type === RP_ASSET_TYPES.LOREBOOK && detail) {
      this.saveLorebookDetail(assetId, detail);
    }

    return this.getAssetById(assetId);
  }

  saveCardDetail(assetId, detail) {
    const d = detail || {};
    this.db
      .prepare(
        `INSERT INTO rp_cards
         (asset_id, name, description, personality, scenario, first_message, alternate_greetings_json, example_dialogue,
          system_prompt, post_history_instructions, creator, tags_json, character_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           personality = excluded.personality,
           scenario = excluded.scenario,
           first_message = excluded.first_message,
           alternate_greetings_json = excluded.alternate_greetings_json,
           example_dialogue = excluded.example_dialogue,
           system_prompt = excluded.system_prompt,
           post_history_instructions = excluded.post_history_instructions,
           creator = excluded.creator,
           tags_json = excluded.tags_json,
           character_version = excluded.character_version`,
      )
      .run(
        assetId,
        d.name || "",
        d.description || null,
        d.personality || null,
        d.scenario || null,
        d.first_message || null,
        d.alternate_greetings_json || safeJson([]),
        d.example_dialogue || null,
        d.system_prompt || null,
        d.post_history_instructions || null,
        d.creator || null,
        d.tags_json || safeJson([]),
        d.character_version || null,
      );
  }

  savePresetDetail(assetId, detail) {
    const d = detail || {};
    this.db
      .prepare(
        `INSERT INTO rp_presets
         (asset_id, temperature, top_p, top_k, max_tokens, frequency_penalty, presence_penalty, repetition_penalty,
          prompt_template_json, stop_sequences_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           temperature = excluded.temperature,
           top_p = excluded.top_p,
           top_k = excluded.top_k,
           max_tokens = excluded.max_tokens,
           frequency_penalty = excluded.frequency_penalty,
           presence_penalty = excluded.presence_penalty,
           repetition_penalty = excluded.repetition_penalty,
           prompt_template_json = excluded.prompt_template_json,
           stop_sequences_json = excluded.stop_sequences_json`,
      )
      .run(
        assetId,
        d.temperature ?? null,
        d.top_p ?? null,
        d.top_k ?? null,
        d.max_tokens ?? null,
        d.frequency_penalty ?? null,
        d.presence_penalty ?? null,
        d.repetition_penalty ?? null,
        d.prompt_template_json || safeJson({}),
        d.stop_sequences_json || safeJson([]),
      );
  }

  saveLorebookDetail(assetId, detail) {
    const d = detail || {};
    this.db
      .prepare(
        `INSERT INTO rp_lorebooks (asset_id, entries_json, activation_strategy)
         VALUES (?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           entries_json = excluded.entries_json,
           activation_strategy = excluded.activation_strategy`,
      )
      .run(assetId, d.entries_json || safeJson([]), d.activation_strategy || "keyword");
  }

  getAssetById(assetId) {
    const row = this.db.prepare("SELECT * FROM rp_assets WHERE id = ?").get(assetId);
    return row ? clone(row) : null;
  }

  findAssetByHash({ userId, type, contentHash }) {
    if (!contentHash) {
      return null;
    }
    const where = ["user_id = ?", "content_hash = ?"];
    const args = [userId, contentHash];
    if (type) {
      where.push("type = ?");
      args.push(type);
    }
    const row = this.db
      .prepare(
        `SELECT * FROM rp_assets
         WHERE ${where.join(" AND ")}
         ORDER BY version DESC, created_at DESC
         LIMIT 1`,
      )
      .get(...args);
    return row ? clone(row) : null;
  }

  listAssets({ userId, type, search, page = 1, pageSize = 10 }) {
    const where = ["user_id = ?"];
    const args = [userId];

    if (type) {
      where.push("type = ?");
      args.push(type);
    }

    if (search) {
      where.push("lower(name) LIKE ?");
      args.push(`%${normalizeName(search)}%`);
    }

    const whereSql = where.join(" AND ");

    const countRow = this.db.prepare(`SELECT COUNT(*) AS c FROM rp_assets WHERE ${whereSql}`).get(...args);
    const total = Number(countRow?.c || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const offset = (safePage - 1) * pageSize;

    const items = this.db
      .prepare(
        `SELECT * FROM rp_assets
         WHERE ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, offset)
      .map(clone);

    return {
      items,
      page: safePage,
      totalPages,
    };
  }

  resolveAssetByNameOrId({ userId, type, nameOrId }) {
    const direct = this.getAssetById(nameOrId);
    if (direct && direct.user_id === userId && (!type || direct.type === type)) {
      return direct;
    }

    const needle = normalizeName(nameOrId);
    const where = ["user_id = ?", "lower(name) LIKE ?"];
    const args = [userId, `${needle}%`];
    if (type) {
      where.push("type = ?");
      args.push(type);
    }

    const candidates = this.db
      .prepare(
        `SELECT * FROM rp_assets
         WHERE ${where.join(" AND ")}
         ORDER BY
           CASE WHEN lower(name) = ? THEN 0 ELSE 1 END ASC,
           version DESC,
           created_at DESC`,
      )
      .all(...args, needle)
      .map(clone);

    if (candidates.length === 0) {
      throw new RPError(RP_ERROR_CODES.ASSET_NOT_FOUND, "Asset not found");
    }

    const topName = normalizeName(candidates[0].name);
    if (candidates.length > 1 && needle !== topName) {
      throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "Multiple asset matches", {
        candidates: candidates.slice(0, 5).map((x) => ({ id: x.id, name: x.name, version: x.version })),
      });
    }

    return candidates[0];
  }

  getAssetDetail(assetId) {
    const asset = this.getAssetById(assetId);
    if (!asset) {
      return null;
    }

    let detail = {};
    if (asset.type === RP_ASSET_TYPES.CARD) {
      detail = this.db.prepare("SELECT * FROM rp_cards WHERE asset_id = ?").get(assetId) || {};
    } else if (asset.type === RP_ASSET_TYPES.PRESET) {
      detail = this.db.prepare("SELECT * FROM rp_presets WHERE asset_id = ?").get(assetId) || {};
    } else if (asset.type === RP_ASSET_TYPES.LOREBOOK) {
      detail = this.db.prepare("SELECT * FROM rp_lorebooks WHERE asset_id = ?").get(assetId) || {};
    }

    return {
      ...asset,
      detail: clone(detail),
    };
  }

  deleteAsset({ userId, assetId }) {
    const asset = this.getAssetById(assetId);
    if (!asset) {
      throw new RPError(RP_ERROR_CODES.ASSET_NOT_FOUND, "Asset not found");
    }
    if (asset.user_id !== userId) {
      throw new RPError(RP_ERROR_CODES.PERMISSION_DENIED, "Cannot delete asset owned by another user");
    }

    const inUse = this.db
      .prepare(
        `SELECT s.id
         FROM rp_sessions s
         LEFT JOIN rp_session_lorebooks sl ON sl.session_id = s.id
         WHERE s.status IN ('active', 'paused', 'summarizing')
           AND (s.card_id = ? OR s.preset_id = ? OR sl.lorebook_asset_id = ?)
         LIMIT 1`,
      )
      .get(assetId, assetId, assetId);

    if (inUse) {
      throw new RPError(RP_ERROR_CODES.ASSET_IN_USE, "Asset is used by an active session");
    }

    try {
      this.db.prepare("DELETE FROM rp_assets WHERE id = ?").run(assetId);
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("FOREIGN KEY constraint failed")) {
        throw new RPError(RP_ERROR_CODES.ASSET_IN_USE, "Asset is referenced by session history");
      }
      throw err;
    }

    return asset;
  }

  createSession({ userId, channelType, channelSessionKey, cardId, presetId, lorebookIds }) {
    const id = makeId("session");

    runAndMapSqliteError(
      () =>
        this.db
          .prepare(
            `INSERT INTO rp_sessions
             (id, user_id, channel_type, channel_session_key, card_id, preset_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, userId, channelType, channelSessionKey, cardId, presetId, RP_SESSION_STATUS.ACTIVE),
      RP_ERROR_CODES.SESSION_CONFLICT,
      "Active session already exists in this channel",
    );

    for (const lorebookId of [...new Set(lorebookIds || [])]) {
      this.db
        .prepare("INSERT OR IGNORE INTO rp_session_lorebooks (session_id, lorebook_asset_id) VALUES (?, ?)")
        .run(id, lorebookId);
    }

    return this.getSessionById(id);
  }

  getSessionById(sessionId) {
    const row = this.db.prepare("SELECT * FROM rp_sessions WHERE id = ?").get(sessionId);
    if (!row) return null;

    const lorebookIds = this.db
      .prepare("SELECT lorebook_asset_id FROM rp_session_lorebooks WHERE session_id = ? ORDER BY lorebook_asset_id")
      .all(sessionId)
      .map((x) => x.lorebook_asset_id);

    return {
      ...clone(row),
      lorebook_ids: lorebookIds,
    };
  }

  getSessionByChannelKey(channelSessionKey) {
    const row = this.db
      .prepare(
        `SELECT id
         FROM rp_sessions
         WHERE channel_session_key = ? AND status != 'ended'
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(channelSessionKey);

    return row ? this.getSessionById(row.id) : null;
  }

  updateSessionStatus({ sessionId, status }) {
    const result = this.db
      .prepare("UPDATE rp_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, sessionId);
    if (!result || result.changes === 0) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }
    return this.getSessionById(sessionId);
  }

  incrementSummaryVersion(sessionId) {
    const result = this.db
      .prepare(
        `UPDATE rp_sessions
         SET summary_version = summary_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(sessionId);

    if (!result || result.changes === 0) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    const row = this.db.prepare("SELECT summary_version FROM rp_sessions WHERE id = ?").get(sessionId);
    return Number(row?.summary_version || 0);
  }

  appendTurn({ sessionId, role, content, tokenEstimate }) {
    const exists = this.db.prepare("SELECT id FROM rp_sessions WHERE id = ?").get(sessionId);
    if (!exists) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    const row = this.db
      .prepare("SELECT COALESCE(MAX(turn_index), 0) AS max_turn FROM rp_turns WHERE session_id = ?")
      .get(sessionId);
    const nextTurn = Number(row?.max_turn || 0) + 1;

    this.db
      .prepare(
        `INSERT INTO rp_turns (session_id, turn_index, role, content, token_estimate)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, nextTurn, role, content, tokenEstimate ?? null);

    this.db
      .prepare(
        `UPDATE rp_sessions
         SET turn_count = (SELECT COUNT(*) FROM rp_turns WHERE session_id = ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(sessionId, sessionId);

    return this.db
      .prepare("SELECT * FROM rp_turns WHERE session_id = ? AND turn_index = ?")
      .get(sessionId, nextTurn);
  }

  getTurns(sessionId) {
    return this.db.prepare("SELECT * FROM rp_turns WHERE session_id = ? ORDER BY turn_index ASC").all(sessionId).map(clone);
  }

  getRecentTurns(sessionId, limit) {
    return this.db
      .prepare("SELECT * FROM rp_turns WHERE session_id = ? ORDER BY turn_index DESC LIMIT ?")
      .all(sessionId, Number(limit) || 0)
      .reverse()
      .map(clone);
  }

  deleteLastAssistantTurn(sessionId) {
    const row = this.db
      .prepare(
        `SELECT * FROM rp_turns
         WHERE session_id = ? AND role = 'assistant'
         ORDER BY turn_index DESC
         LIMIT 1`,
      )
      .get(sessionId);

    if (!row) {
      return null;
    }

    this.db.prepare("DELETE FROM rp_turns WHERE session_id = ? AND turn_index = ?").run(sessionId, row.turn_index);
    this.deleteTurnEmbedding(sessionId, row.turn_index);

    this.db
      .prepare(
        `UPDATE rp_sessions
         SET turn_count = (SELECT COUNT(*) FROM rp_turns WHERE session_id = ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(sessionId, sessionId);

    return clone(row);
  }

  replaceLastUserTurn(sessionId, content, tokenEstimate) {
    const row = this.db
      .prepare(
        `SELECT * FROM rp_turns
         WHERE session_id = ? AND role = 'user'
         ORDER BY turn_index DESC
         LIMIT 1`,
      )
      .get(sessionId);

    if (!row) {
      throw new RPError(RP_ERROR_CODES.BAD_REQUEST, "No user turn found for retry edit");
    }

    this.db
      .prepare(
        `UPDATE rp_turns
         SET content = ?, token_estimate = ?, created_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND turn_index = ?`,
      )
      .run(content, tokenEstimate ?? row.token_estimate ?? null, sessionId, row.turn_index);

    return this.db
      .prepare("SELECT * FROM rp_turns WHERE session_id = ? AND turn_index = ?")
      .get(sessionId, row.turn_index);
  }

  addSummary({ sessionId, coveredFrom, coveredTo, summaryText }) {
    const version = this.incrementSummaryVersion(sessionId);

    this.db
      .prepare(
        `INSERT INTO rp_summaries
         (session_id, version, covered_turn_from, covered_turn_to, summary_text)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, version, coveredFrom, coveredTo, summaryText);

    return this.db
      .prepare("SELECT * FROM rp_summaries WHERE session_id = ? AND version = ?")
      .get(sessionId, version);
  }

  getLatestSummary(sessionId) {
    const row = this.db
      .prepare(
        `SELECT * FROM rp_summaries
         WHERE session_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(sessionId);
    return row ? clone(row) : null;
  }

  getSessionAssetBundle(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session) {
      throw new RPError(RP_ERROR_CODES.SESSION_NOT_FOUND, "Session not found");
    }

    const card = this.getAssetDetail(session.card_id);
    const preset = this.getAssetDetail(session.preset_id);
    const lorebooks = (session.lorebook_ids || [])
      .map((id) => this.getAssetDetail(id))
      .filter(Boolean);

    if (!card || !preset) {
      throw new RPError(RP_ERROR_CODES.INTERNAL_ERROR, "Session has broken asset references");
    }

    return {
      session,
      card,
      preset,
      lorebooks,
    };
  }

  upsertTurnEmbedding({ sessionId, turnIndex, role, content, language, vector, model }) {
    const dim = Array.isArray(vector) ? vector.length : 0;
    const embeddingJson = JSON.stringify(Array.isArray(vector) ? vector : []);
    this.db
      .prepare(
        `INSERT INTO rp_turn_embeddings
         (session_id, turn_index, role, content, language, embedding_json, embedding_dim, embedding_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, turn_index) DO UPDATE SET
           role = excluded.role,
           content = excluded.content,
           language = excluded.language,
           embedding_json = excluded.embedding_json,
           embedding_dim = excluded.embedding_dim,
           embedding_model = excluded.embedding_model,
           created_at = CURRENT_TIMESTAMP`,
      )
      .run(
        sessionId,
        Number(turnIndex),
        role || "user",
        String(content || ""),
        language || null,
        embeddingJson,
        dim,
        model || null,
      );

    return this.db
      .prepare("SELECT * FROM rp_turn_embeddings WHERE session_id = ? AND turn_index = ?")
      .get(sessionId, Number(turnIndex));
  }

  deleteTurnEmbedding(sessionId, turnIndex) {
    const result = this.db
      .prepare("DELETE FROM rp_turn_embeddings WHERE session_id = ? AND turn_index = ?")
      .run(sessionId, Number(turnIndex));
    return Boolean(result?.changes);
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
    const safeLimit = Math.max(1, Number(limit) || 6);
    const fetchLimit = Math.max(safeLimit * 6, Number(candidateLimit) || 250);

    let rows = [];
    const fn = this.vectorDistanceFunction;

    if (fn && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fn)) {
      try {
        const queryJson = JSON.stringify(queryVector);
        rows = this.db
          .prepare(
            `SELECT session_id, turn_index, role, content, language, embedding_json, embedding_dim, embedding_model, created_at,
                    ${fn}(embedding_json, ?) AS vector_distance
             FROM rp_turn_embeddings
             WHERE session_id = ? AND turn_index <= ?
             ORDER BY vector_distance ASC
             LIMIT ?`,
          )
          .all(queryJson, sessionId, maxTurn, fetchLimit);
      } catch {
        this.vectorDistanceFunction = null;
      }
    }

    if (rows.length === 0) {
      rows = this.db
        .prepare(
          `SELECT session_id, turn_index, role, content, language, embedding_json, embedding_dim, embedding_model, created_at
           FROM rp_turn_embeddings
           WHERE session_id = ? AND turn_index <= ?
           ORDER BY turn_index DESC
           LIMIT ?`,
        )
        .all(sessionId, maxTurn, fetchLimit);
    }

    const scored = [];
    for (const row of rows) {
      const candidateVector = parseEmbeddingJson(row.embedding_json);
      const score = cosineSimilarity(queryVector, candidateVector);
      if (score < minScore) {
        continue;
      }
      scored.push({
        ...clone(row),
        score,
      });
    }

    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.turn_index - a.turn_index;
      })
      .slice(0, safeLimit);
  }
}
