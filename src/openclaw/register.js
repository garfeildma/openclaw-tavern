import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { asRPError } from "../errors.js";
import { createRPPlugin } from "../plugin.js";
import { createOpenAICompatibleProviders } from "../providers/openaiCompatible.js";
import { createGeminiProviders } from "../providers/gemini.js";
import { SqliteStore } from "../store/sqliteStore.js";
import { NodeSqliteCompat } from "./nodeSqliteCompat.js";
import { parseRpCommand } from "../utils/commandParser.js";
import { estimateTokens } from "../utils/tokenEstimator.js";

const execFileAsync = promisify(execFile);

function parseDataUrl(raw) {
  const match = String(raw || "").match(/^data:([^,]+),([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const meta = String(match[1] || "");
  const tokens = meta
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tokens.some((item) => item.toLowerCase() === "base64")) {
    return null;
  }
  const mimeType = tokens[0] || "application/octet-stream";
  const params = {};
  for (const token of tokens.slice(1)) {
    const lower = token.toLowerCase();
    if (lower === "base64") {
      continue;
    }
    const eq = token.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = token.slice(eq + 1).trim();
    if (!key) {
      continue;
    }
    params[key] = value.replace(/^"(.*)"$/, "$1");
  }
  return {
    mimeType,
    params,
    base64: String(match[2] || "").replace(/\s+/g, ""),
  };
}

function extFromMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("l16") || mime.includes("pcm")) return "pcm";
  return "bin";
}

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isPcmAudioMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  return mime.includes("l16") || mime.includes("pcm");
}

function toPositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const normalized = Math.floor(n);
  return normalized > 0 ? normalized : fallback;
}

async function tryTranscodePcmToMp3(sourcePath, sampleRate, channels) {
  const targetPath = sourcePath.replace(/\.[^.]+$/, ".mp3");
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-i",
      sourcePath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      targetPath,
    ],
    { timeout: 60000 },
  );
  return targetPath;
}

async function materializeMediaUrl(rawUrl, mediaDir) {
  const dataUrl = parseDataUrl(rawUrl);
  if (!dataUrl) {
    // If it's already a file path, return as-is
    return rawUrl;
  }
  await mkdir(mediaDir, { recursive: true });
  const ext = extFromMime(dataUrl.mimeType);
  const fileName = `rp-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(mediaDir, fileName);
  await writeFile(filePath, Buffer.from(dataUrl.base64, "base64"));

  if (isPcmAudioMime(dataUrl.mimeType)) {
    const sampleRate = toPositiveInteger(dataUrl.params?.rate, 24000);
    const channels = toPositiveInteger(
      dataUrl.params?.channels || dataUrl.params?.channel_count || dataUrl.params?.channel,
      1,
    );
    try {
      const mp3Path = await tryTranscodePcmToMp3(filePath, sampleRate, channels);
      return mp3Path;
    } catch {
      // ffmpeg unavailable or conversion failed; keep original PCM file.
    }
  }
  return filePath;
}

function isVoiceMediaSource(rawUrl) {
  const parsed = parseDataUrl(rawUrl);
  if (parsed) {
    const mime = String(parsed.mimeType || "").toLowerCase();
    return (
      mime.includes("mp3") ||
      mime.includes("mpeg") ||
      mime.includes("ogg") ||
      mime.includes("wav") ||
      mime.includes("m4a") ||
      mime.includes("mp4")
    );
  }
  return /\.(mp3|mpeg|ogg|wav|m4a|mp4)(\?.*)?$/i.test(String(rawUrl || ""));
}

function buildCommandContext(ctx) {
  const channelType = String(ctx.channel || ctx.channelId || "unknown");
  const platformContextId = String(ctx.to || ctx.accountId || channelType || "unknown");
  const channelId = ctx.messageThreadId
    ? `${platformContextId}:${ctx.messageThreadId}`
    : platformContextId;
  const userId = String(ctx.senderId || ctx.from || "unknown");

  return {
    channelType,
    platformContextId,
    channelId,
    userId,
    content: String(ctx.commandBody || "/rp"),
    attachments: [],
  };
}

function createMediaCache() {
  const byRoute = new Map();
  const bySender = new Map();
  const byTime = [];
  const ttlMs = 10 * 60 * 1000;

  function routeKey(channelId, from, to) {
    return `${channelId || ""}|${from || ""}|${to || ""}`;
  }

  function senderKey(channelId, senderId) {
    return `${channelId || ""}|${senderId || ""}`;
  }

  function cleanup(now = Date.now()) {
    for (const [key, item] of byRoute) {
      if (now - item.at > ttlMs) {
        byRoute.delete(key);
      }
    }
    for (const [key, item] of bySender) {
      if (now - item.at > ttlMs) {
        bySender.delete(key);
      }
    }
    while (byTime.length > 0 && now - byTime[0].at > ttlMs) {
      byTime.shift();
    }
  }

  function consumeByPath(pathValue) {
    if (!pathValue) {
      return null;
    }
    let consumed = null;
    for (const [key, item] of byRoute) {
      if (item.path === pathValue) {
        consumed = consumed || item;
        byRoute.delete(key);
      }
    }
    for (const [key, item] of bySender) {
      if (item.path === pathValue) {
        consumed = consumed || item;
        bySender.delete(key);
      }
    }
    for (let i = byTime.length - 1; i >= 0; i -= 1) {
      if (byTime[i].path === pathValue) {
        consumed = consumed || byTime[i];
        byTime.splice(i, 1);
      }
    }
    return consumed;
  }

  return {
    remember({ channelId, from, to, senderId, mediaPath, mediaType }) {
      const at = Date.now();
      cleanup(at);
      const value = {
        path: mediaPath,
        mediaType,
        at,
        channelId,
        from,
        to,
        senderId,
      };
      byTime.push(value);
      if (channelId && from && to) {
        byRoute.set(routeKey(channelId, from, to), value);
      }
      if (channelId && senderId) {
        bySender.set(senderKey(channelId, senderId), value);
      }
    },
    peek({ channelId, from, to, senderId }) {
      const now = Date.now();
      cleanup(now);

      if (channelId && from && to) {
        const key = routeKey(channelId, from, to);
        const item = byRoute.get(key);
        if (item) {
          return item;
        }
      }

      if (channelId && senderId) {
        const key = senderKey(channelId, senderId);
        const item = bySender.get(key);
        if (item) {
          return item;
        }
      }

      return null;
    },
    peekRecent({ channelId, senderId, maxAgeMs = 90 * 1000 }) {
      const now = Date.now();
      cleanup(now);
      for (let i = byTime.length - 1; i >= 0; i -= 1) {
        const item = byTime[i];
        if (maxAgeMs > 0 && now - item.at > maxAgeMs) {
          continue;
        }
        if (channelId && item.channelId && item.channelId !== channelId) {
          continue;
        }
        if (senderId && item.senderId && item.senderId !== senderId) {
          continue;
        }
        return item;
      }
      return null;
    },
    consumeByPath,
    consume({ channelId, from, to, senderId }) {
      const item = this.peek({ channelId, from, to, senderId });
      if (!item) {
        return null;
      }
      return consumeByPath(item.path) || item;
    },
  };
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractSenderId(value) {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  const direct = raw.match(/^-?\d+$/);
  if (direct) {
    return direct[0];
  }
  const prefixed = raw.match(/:(-?\d+)$/);
  if (prefixed) {
    return prefixed[1];
  }
  return "";
}

function resolveHookUserId(event) {
  return (
    asString(event?.metadata?.senderId) ||
    extractSenderId(event?.from) ||
    extractSenderId(event?.metadata?.to) ||
    ""
  );
}

function buildHookRouterContext(event, hookCtx) {
  const channelType = asString(hookCtx?.channelId || "unknown").toLowerCase();
  const conversationId =
    asString(hookCtx?.conversationId) ||
    asString(event?.metadata?.originatingTo) ||
    asString(event?.metadata?.to) ||
    asString(event?.metadata?.threadId) ||
    asString(event?.from) ||
    "unknown";
  const userId = resolveHookUserId(event) || extractSenderId(conversationId) || conversationId;
  const threadIdRaw = event?.metadata?.threadId;
  const threadId =
    typeof threadIdRaw === "number"
      ? threadIdRaw
      : typeof threadIdRaw === "string" && /^-?\d+$/.test(threadIdRaw)
        ? Number(threadIdRaw)
        : null;

  return {
    channelType,
    platformContextId: conversationId,
    channelId: threadId !== null ? `${conversationId}:${threadId}` : conversationId,
    userId,
    senderName:
      asString(event?.metadata?.senderName) ||
      asString(event?.metadata?.senderDisplayName) ||
      asString(event?.metadata?.firstName) ||
      asString(event?.metadata?.from_name) ||
      "",
    content: asString(event?.content),
    attachments: [],
  };
}

function buildRouteKey(channelId, accountId, peer) {
  return `${asString(channelId).toLowerCase()}|${asString(accountId)}|${asString(peer)}`;
}

function candidatePeers(value) {
  const peers = new Set();
  const raw = asString(value);
  if (!raw) {
    return peers;
  }
  peers.add(raw);
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0 && lastColon < raw.length - 1) {
    peers.add(raw.slice(lastColon + 1));
  }
  const num = extractSenderId(raw);
  if (num) {
    peers.add(num);
  }
  return peers;
}

function cleanupPendingInbound(pendingByKey, ttlMs) {
  const now = Date.now();
  for (const [key, value] of pendingByKey.entries()) {
    if (!value?.at || now - value.at > ttlMs) {
      pendingByKey.delete(key);
    }
  }
}

function stashPendingInbound(pendingByKey, ttlMs, payload) {
  cleanupPendingInbound(pendingByKey, ttlMs);
  if (!Array.isArray(payload.peers) || payload.peers.length === 0) {
    payload.peers = [payload.routerCtx?.platformContextId || "unknown"];
  }
  const keys = new Set();
  for (const peer of payload.peers) {
    keys.add(buildRouteKey(payload.channelId, payload.accountId, peer));
  }
  keys.add(buildRouteKey(payload.channelId, payload.accountId, "__latest__"));
  for (const key of keys) {
    pendingByKey.set(key, payload);
  }
}

function findPendingInbound(pendingByKey, ttlMs, { channelId, accountId, to }) {
  cleanupPendingInbound(pendingByKey, ttlMs);
  for (const peer of candidatePeers(to)) {
    const key = buildRouteKey(channelId, accountId, peer);
    const item = pendingByKey.get(key);
    if (item) {
      return item;
    }
  }
  return pendingByKey.get(buildRouteKey(channelId, accountId, "__latest__")) || null;
}

function dropPendingInbound(pendingByKey, found) {
  if (!found) {
    return;
  }
  for (const [key, value] of pendingByKey.entries()) {
    if (value === found) {
      pendingByKey.delete(key);
    }
  }
}

function withChannelPrefix(channelType, value) {
  const ch = asString(channelType).toLowerCase();
  const raw = asString(value);
  if (!ch || !raw) {
    return "";
  }
  if (raw.startsWith(`${ch}:`)) {
    return raw;
  }
  if (raw.includes(":")) {
    return raw;
  }
  return `${ch}:${raw}`;
}

function collectIdentityCandidates(channelType, value) {
  const out = new Set();
  const raw = asString(value);
  if (raw) {
    out.add(raw);
    const lastColon = raw.lastIndexOf(":");
    if (lastColon > 0 && lastColon < raw.length - 1) {
      out.add(raw.slice(lastColon + 1));
    }
  }
  const numeric = extractSenderId(raw);
  if (numeric) {
    out.add(numeric);
  }
  const prefixedRaw = withChannelPrefix(channelType, raw);
  if (prefixedRaw) {
    out.add(prefixedRaw);
  }
  if (numeric) {
    out.add(withChannelPrefix(channelType, numeric));
  }
  return [...out].filter(Boolean);
}

function collectSessionKeyCandidates(pending) {
  const routerCtx = pending?.routerCtx || {};
  const channelType = asString(routerCtx.channelType).toLowerCase();
  if (!channelType) {
    return [];
  }

  const platformCandidates = new Set([
    ...collectIdentityCandidates(channelType, routerCtx.platformContextId),
  ]);
  for (const peer of pending?.peers || []) {
    for (const item of collectIdentityCandidates(channelType, peer)) {
      platformCandidates.add(item);
    }
  }

  const channelCandidates = new Set([
    ...collectIdentityCandidates(channelType, routerCtx.channelId),
  ]);
  for (const item of platformCandidates) {
    channelCandidates.add(item);
  }

  const userCandidates = new Set(collectIdentityCandidates(channelType, routerCtx.userId));
  for (const peer of pending?.peers || []) {
    for (const item of collectIdentityCandidates(channelType, peer)) {
      if (/^-?\d+$/.test(item) || item.startsWith(`${channelType}:`)) {
        userCandidates.add(item);
      }
    }
  }

  if (asString(routerCtx.userId)) {
    userCandidates.add(asString(routerCtx.userId));
  }
  if (asString(routerCtx.platformContextId)) {
    platformCandidates.add(asString(routerCtx.platformContextId));
  }
  if (asString(routerCtx.channelId)) {
    channelCandidates.add(asString(routerCtx.channelId));
  }

  const keys = new Set();
  for (const p of platformCandidates) {
    for (const c of channelCandidates) {
      for (const u of userCandidates) {
        keys.add(`${channelType}:${p}:${c}:${u}`);
      }
      keys.add(`${channelType}:${p}:${c}:${extractSenderId(p) || p}`);
    }
  }
  return [...keys].filter(Boolean);
}

function tryFindSessionByUserAndChannel(db, store, channelType, userId) {
  const ch = asString(channelType).toLowerCase();
  const user = asString(userId);
  if (!db?.prepare || !store?.getSessionById || !ch || !user) {
    return null;
  }
  try {
    const row = db
      .prepare(
        `SELECT id
         FROM rp_sessions
         WHERE channel_type = ? AND user_id = ? AND status != 'ended'
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(ch, user);
    return row?.id ? store.getSessionById(row.id) : null;
  } catch {
    return null;
  }
}

function tryFindLatestSessionByChannel(db, store, channelType) {
  const ch = asString(channelType).toLowerCase();
  if (!db?.prepare || !store?.getSessionById || !ch) {
    return null;
  }
  try {
    const row = db
      .prepare(
        `SELECT id
         FROM rp_sessions
         WHERE channel_type = ? AND status != 'ended'
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(ch);
    return row?.id ? store.getSessionById(row.id) : null;
  } catch {
    return null;
  }
}

function resolveActiveSessionForPending(store, db, pending) {
  const keys = collectSessionKeyCandidates(pending);
  for (const key of keys) {
    const found = store?.getSessionByChannelKey?.(key);
    if (found) {
      return found;
    }
  }

  const routerCtx = pending?.routerCtx || {};
  const channelType = asString(routerCtx.channelType).toLowerCase();
  const userCandidates = new Set([
    ...collectIdentityCandidates(channelType, routerCtx.userId),
    ...collectIdentityCandidates(channelType, routerCtx.platformContextId),
  ]);
  for (const peer of pending?.peers || []) {
    for (const item of collectIdentityCandidates(channelType, peer)) {
      userCandidates.add(item);
    }
  }

  for (const user of userCandidates) {
    const numeric = extractSenderId(user);
    if (!numeric) {
      continue;
    }
    const found = tryFindSessionByUserAndChannel(db, store, channelType, numeric);
    if (found) {
      return found;
    }
  }

  return tryFindLatestSessionByChannel(db, store, channelType);
}

function formatDialogueHandledText(handled) {
  if (!handled) {
    return "";
  }
  if (handled.ignored) {
    const status = asString(handled.status).toLowerCase();
    if (status === "paused") {
      return "当前 RP 会话已暂停（/rp resume 可恢复）。";
    }
    if (status === "ended") {
      return "当前 RP 会话已结束（/rp start 可重新开始）。";
    }
    return "当前 RP 会话暂不可用。";
  }
  return asString(handled.content);
}

async function appendHookTrace(stateDir, payload) {
  if (!stateDir || !payload) {
    return;
  }
  const file = path.join(stateDir, "hook-debug.log");
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...payload,
  });
  await writeFile(file, `${line}\n`, { flag: "a" });
}

function escapeQuotedArg(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseImportInjectPlan(commandBody) {
  let parsed;
  try {
    parsed = parseRpCommand(commandBody);
  } catch {
    return null;
  }
  if (!parsed) {
    return null;
  }

  if (!["import-card", "import-preset", "import-lorebook"].includes(parsed.command)) {
    return null;
  }

  if (parsed.options?.file || parsed.options?.url) {
    return null;
  }

  return parsed;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isTelegramCommandContext(ctx) {
  const ch = asString(ctx.channel || ctx.channelId).toLowerCase();
  return ch === "telegram";
}

async function findLatestInboundMediaPath({ inboundMediaDir, maxAgeMs, usedPaths }) {
  if (!inboundMediaDir) {
    return null;
  }

  let dirItems = [];
  try {
    dirItems = await readdir(inboundMediaDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const now = Date.now();
  let best = null;
  for (const item of dirItems) {
    if (!item.isFile()) {
      continue;
    }
    const abs = path.join(inboundMediaDir, item.name);
    if (usedPaths?.has(abs)) {
      continue;
    }
    let meta;
    try {
      meta = await stat(abs);
    } catch {
      continue;
    }
    if (!meta.isFile()) {
      continue;
    }
    const mtimeMs = Number(meta.mtimeMs || 0);
    if (!mtimeMs) {
      continue;
    }
    if (maxAgeMs > 0 && now - mtimeMs > maxAgeMs) {
      continue;
    }
    if (!best || mtimeMs > best.mtimeMs) {
      best = { path: abs, mtimeMs };
    }
  }
  return best?.path || null;
}

async function tryInjectImportFile(commandBody, ctx, mediaCache, options = {}) {
  const parsed = parseImportInjectPlan(commandBody);
  if (!parsed) {
    return commandBody;
  }

  const cacheKey = {
    channelId: asString(ctx.channelId || ctx.channel),
    from: asString(ctx.from),
    to: asString(ctx.to),
    senderId: asString(ctx.senderId),
  };

  let cached = mediaCache.peek(cacheKey);
  const shouldWaitForMedia = isTelegramCommandContext(ctx);
  if (!cached && shouldWaitForMedia) {
    // On Telegram command path, media pre-processing can finish a few seconds later.
    const delays = [200, 300, 500, 800, 1200, 1800, 2400, 3200];
    for (const delay of delays) {
      await sleep(delay);
      cached = mediaCache.peek(cacheKey);
      if (cached) {
        break;
      }
    }
  }

  if (!cached) {
    cached = mediaCache.peekRecent({
      channelId: cacheKey.channelId,
      senderId: cacheKey.senderId,
      maxAgeMs: 90 * 1000,
    });
  }

  if (!cached && shouldWaitForMedia) {
    const latestInboundPath = await findLatestInboundMediaPath({
      inboundMediaDir: options.inboundMediaDir,
      maxAgeMs: 90 * 1000,
      usedPaths: options.usedFallbackPaths,
    });
    if (latestInboundPath) {
      options.usedFallbackPaths?.add(latestInboundPath);
      cached = { path: latestInboundPath, source: "inbound-scan" };
    }
  }

  if (!cached?.path) {
    return commandBody;
  }

  mediaCache.consumeByPath(cached.path);
  options.logger?.info?.(
    `[openclaw-rp] import injection via ${cached.source || "media-cache"}: ${path.basename(cached.path)}`,
  );
  return `${commandBody} --file "${escapeQuotedArg(cached.path)}"`;
}

function buildImportMissingAttachmentHint(commandBody) {
  const parsed = parseImportInjectPlan(commandBody);
  if (!parsed) {
    return null;
  }
  return [
    "Import command needs one attachment (or --url / --file).",
    "If you are on Telegram native slash command, send the file first, then run the import command.",
  ].join(" ");
}

function rewriteImportMissingAttachmentMessage(response, commandBody) {
  if (!response || response.ok !== false || response.code !== "RP_ATTACHMENT_MISSING") {
    return response;
  }
  const hint = buildImportMissingAttachmentHint(commandBody);
  if (!hint) {
    return response;
  }
  return {
    ...response,
    message: hint,
  };
}

function normalizeCommandBodyWithImportFile(commandBody, ctx, mediaCache, options) {
  return tryInjectImportFile(commandBody, ctx, mediaCache, options);
}

async function handleRouterCommandWithImportFallback(router, ctx, mediaCache, options) {
  const commandBody = String(ctx.commandBody || "/rp");
  const patchedCommandBody = await normalizeCommandBodyWithImportFile(
    commandBody,
    ctx,
    mediaCache,
    options,
  );
  const response = await router.handleMessage(
    buildCommandContext({
      ...ctx,
      commandBody: patchedCommandBody,
    }),
  );
  return {
    response: rewriteImportMissingAttachmentMessage(response, commandBody),
  };
}

function normalizeMediaType(value) {
  return asString(value) || undefined;
}

function normalizeMediaPath(value) {
  return asString(value);
}

function isValidPreprocessedEvent(event) {
  return event && event.type === "message" && event.action === "preprocessed";
}

function storeEventMediaToCache(event, mediaCache) {
  const mediaPath = normalizeMediaPath(event.context?.mediaPath);
  if (!mediaPath) {
    return;
  }

  const cached = mediaCache.consume({
    channelId: asString(event.context?.channelId),
    from: asString(event.context?.from),
    to: asString(event.context?.to),
    senderId: asString(event.context?.senderId),
  });
  if (cached?.path === mediaPath) {
    mediaCache.remember({
      channelId: asString(event.context?.channelId),
      from: asString(event.context?.from),
      to: asString(event.context?.to),
      senderId: asString(event.context?.senderId),
      mediaPath,
      mediaType: normalizeMediaType(event.context?.mediaType),
    });
    return;
  }

  mediaCache.remember({
    channelId: asString(event.context?.channelId),
    from: asString(event.context?.from),
    to: asString(event.context?.to),
    senderId: asString(event.context?.senderId),
    mediaPath,
    mediaType: normalizeMediaType(event.context?.mediaType),
  });
}

function formatResponseText(response) {
  if (!response) {
    return "❌ No response";
  }
  // If 'text' field exists in data, use it (e.g. intro text)
  if (response.ok && typeof response?.data?.text === "string" && response.data.text.trim()) {
    return response.data.text;
  }
  // Use the message field as human-readable output (set by ok() in commandRouter)
  if (response.ok && typeof response?.message === "string" && response.message.trim()) {
    return response.message;
  }
  // Error responses
  if (!response.ok && typeof response?.message === "string" && response.message.trim()) {
    return `❌ ${response.message}`;
  }
  // Fallback: format as readable summary
  const msg = response.message || "Unknown";
  const data = response.data;
  if (!data || Object.keys(data).length === 0) {
    return msg;
  }
  const lines = [msg];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || key === "text") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`• ${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

function extractTelegramChatId(input) {
  const raw = asString(input);
  if (!raw) {
    return null;
  }
  const matches = raw.match(/-?\d+/g);
  if (!matches || matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1] || null;
}

function resolveTelegramChatIdFromContext(ctx) {
  return (
    extractTelegramChatId(ctx.to) ||
    extractTelegramChatId(ctx.from) ||
    extractTelegramChatId(ctx.platformContextId) ||
    null
  );
}

async function sendTelegramFollowup({ ctx, text, logger }) {
  const channel = asString(ctx.channel || ctx.channelId).toLowerCase();
  if (channel !== "telegram") {
    return false;
  }

  const content = asString(text);
  if (!content) {
    return false;
  }

  const chatId = resolveTelegramChatIdFromContext(ctx);
  if (!chatId) {
    return false;
  }
  const sendMessageTelegram = ctx.telegramRuntime?.sendMessageTelegram;
  if (typeof sendMessageTelegram !== "function") {
    logger?.warn?.("[openclaw-rp] telegram runtime sendMessageTelegram is unavailable");
    return false;
  }

  const maxLen = 3500;
  const chunks = [];
  for (let i = 0; i < content.length; i += maxLen) {
    chunks.push(content.slice(i, i + maxLen));
  }

  for (const chunk of chunks) {
    await sendMessageTelegram(String(chatId), chunk, {
      accountId: ctx.accountId,
      messageThreadId: typeof ctx.messageThreadId === "number" ? ctx.messageThreadId : undefined,
      textMode: "html",
      plainText: chunk,
    });
  }

  return chunks.length > 0;
}

function scheduleFollowupIfNeeded(response, ctx, logger, telegramRuntime) {
  const followupText = asString(response?.data?.followup_text);
  if (!followupText) {
    return;
  }
  // Use a longer delay to ensure the main response (which may include
  // a large avatar image upload) is fully delivered first.
  setTimeout(() => {
    sendTelegramFollowup({
      ctx: { ...ctx, telegramRuntime },
      text: followupText,
      logger,
    }).catch((err) => {
      logger?.warn?.(`[openclaw-rp] telegram followup error: ${String(err?.message || err)}`);
    });
  }, 3000);
}

function loadProviderFileConfig() {
  try {
    const configPath = path.join(
      process.env.HOME || "/root",
      ".openclaw",
      "openclaw-rp",
      "provider.json",
    );
    const raw = require("node:fs").readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfigPath(input, pathTokens) {
  let cur = input;
  for (const token of pathTokens) {
    if (!isObject(cur)) {
      return undefined;
    }
    if (!(token in cur)) {
      return undefined;
    }
    cur = cur[token];
  }
  return cur;
}

function firstNonEmptyValue(values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        return value;
      }
      continue;
    }
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function pickConfigValue(source, paths) {
  const values = [];
  for (const pathTokens of paths) {
    values.push(readConfigPath(source, pathTokens));
  }
  return firstNonEmptyValue(values);
}

function normalizeProviderHint(value) {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("gemini") || raw.includes("google")) return "gemini";
  if (raw.includes("openai")) return "openai";
  if (raw.includes("anthropic") || raw.includes("claude")) return "openai";
  if (raw.includes("compatible")) return "openai";
  return "";
}

function extractInheritedProviderConfig(apiConfig) {
  const cfg = isObject(apiConfig) ? apiConfig : {};
  const providerHint = normalizeProviderHint(
    pickConfigValue(cfg, [
      ["provider"],
      ["llm", "provider"],
      ["model", "provider"],
      ["chat", "provider"],
      ["ai", "provider"],
      ["providers", "default"],
      ["llm_provider"],
    ]),
  );

  const globalModel = pickConfigValue(cfg, [
    ["model"],
    ["llm", "model"],
    ["chat", "model"],
    ["ai", "model"],
    ["default_model"],
  ]);

  const openai = {
    apiKey: pickConfigValue(cfg, [
      ["openai", "apiKey"],
      ["openai", "api_key"],
      ["providers", "openai", "apiKey"],
      ["providers", "openai", "api_key"],
      ["llm", "openai", "apiKey"],
      ["llm", "openai", "api_key"],
      ["llm", "apiKey"],
      ["llm", "api_key"],
      ["openai_api_key"],
    ]),
    baseUrl: pickConfigValue(cfg, [
      ["openai", "baseUrl"],
      ["openai", "base_url"],
      ["openai", "endpoint"],
      ["openai", "url"],
      ["providers", "openai", "baseUrl"],
      ["providers", "openai", "base_url"],
      ["providers", "openai", "endpoint"],
      ["llm", "openai", "baseUrl"],
      ["llm", "openai", "base_url"],
      ["openai_base_url"],
    ]),
    model: pickConfigValue(cfg, [
      ["openai", "model"],
      ["providers", "openai", "model"],
      ["llm", "openai", "model"],
      ["openai_model"],
      ["llm", "model"],
      ["chat", "model"],
      ["model"],
      ["default_model"],
    ]) || globalModel,
    ttsModel: pickConfigValue(cfg, [
      ["openai", "ttsModel"],
      ["openai", "tts_model"],
      ["providers", "openai", "ttsModel"],
      ["providers", "openai", "tts_model"],
      ["openai_tts_model"],
    ]),
    imageModel: pickConfigValue(cfg, [
      ["openai", "imageModel"],
      ["openai", "image_model"],
      ["providers", "openai", "imageModel"],
      ["providers", "openai", "image_model"],
      ["openai_image_model"],
    ]),
    embeddingModel: pickConfigValue(cfg, [
      ["openai", "embeddingModel"],
      ["openai", "embedding_model"],
      ["providers", "openai", "embeddingModel"],
      ["providers", "openai", "embedding_model"],
      ["openai_embedding_model"],
    ]),
  };

  const gemini = {
    apiKey: pickConfigValue(cfg, [
      ["gemini", "apiKey"],
      ["gemini", "api_key"],
      ["google", "apiKey"],
      ["google", "api_key"],
      ["providers", "gemini", "apiKey"],
      ["providers", "gemini", "api_key"],
      ["llm", "gemini", "apiKey"],
      ["llm", "gemini", "api_key"],
      ["gemini_api_key"],
    ]),
    model: pickConfigValue(cfg, [
      ["gemini", "model"],
      ["providers", "gemini", "model"],
      ["llm", "gemini", "model"],
      ["gemini_model"],
      ["llm", "model"],
      ["chat", "model"],
      ["model"],
      ["default_model"],
    ]) || globalModel,
    ttsModel: pickConfigValue(cfg, [
      ["gemini", "ttsModel"],
      ["gemini", "tts_model"],
      ["providers", "gemini", "ttsModel"],
      ["providers", "gemini", "tts_model"],
      ["gemini_tts_model"],
    ]),
    ttsVoice: pickConfigValue(cfg, [
      ["gemini", "ttsVoice"],
      ["gemini", "tts_voice"],
      ["providers", "gemini", "ttsVoice"],
      ["providers", "gemini", "tts_voice"],
      ["gemini_tts_voice"],
    ]),
    imageModel: pickConfigValue(cfg, [
      ["gemini", "imageModel"],
      ["gemini", "image_model"],
      ["providers", "gemini", "imageModel"],
      ["providers", "gemini", "image_model"],
      ["gemini_image_model"],
    ]),
    embeddingModel: pickConfigValue(cfg, [
      ["gemini", "embeddingModel"],
      ["gemini", "embedding_model"],
      ["providers", "gemini", "embeddingModel"],
      ["providers", "gemini", "embedding_model"],
      ["gemini_embedding_model"],
    ]),
  };

  return {
    providerHint,
    openai,
    gemini,
  };
}

function resolveProviderConfig(apiConfig) {
  // Try to read provider config from JSON file (most reliable for systemd-managed gateways)
  const fileConfig = loadProviderFileConfig();
  const inherited = extractInheritedProviderConfig(apiConfig);
  const explicitProvider = normalizeProviderHint(
    firstNonEmptyValue([
      process.env.OPENCLAW_RP_PROVIDER,
      fileConfig.provider,
      fileConfig.llm_provider,
    ]),
  );
  const selectedProvider = inherited.providerHint || explicitProvider;

  const geminiApiKey =
    inherited.gemini.apiKey ||
    process.env.OPENCLAW_RP_GEMINI_API_KEY ||
    fileConfig.gemini_api_key ||
    process.env.GEMINI_API_KEY;
  const openaiApiKey =
    inherited.openai.apiKey ||
    process.env.OPENCLAW_RP_OPENAI_API_KEY ||
    fileConfig.openai_api_key ||
    process.env.OPENAI_API_KEY;

  const preferGemini =
    selectedProvider === "gemini" ||
    (!selectedProvider && geminiApiKey && !openaiApiKey);

  if (preferGemini && geminiApiKey) {
    return createGeminiProviders({
      apiKey: geminiApiKey,
      model:
        inherited.gemini.model ||
        process.env.OPENCLAW_RP_GEMINI_MODEL ||
        fileConfig.gemini_model ||
        process.env.GEMINI_MODEL,
      ttsModel:
        inherited.gemini.ttsModel ||
        process.env.OPENCLAW_RP_GEMINI_TTS_MODEL ||
        fileConfig.gemini_tts_model ||
        process.env.GEMINI_TTS_MODEL,
      ttsVoice:
        inherited.gemini.ttsVoice ||
        process.env.OPENCLAW_RP_GEMINI_TTS_VOICE ||
        fileConfig.gemini_tts_voice ||
        process.env.GEMINI_TTS_VOICE,
      imageModel:
        inherited.gemini.imageModel ||
        process.env.OPENCLAW_RP_GEMINI_IMAGE_MODEL ||
        fileConfig.gemini_image_model ||
        process.env.GEMINI_IMAGE_MODEL,
      embeddingModel:
        inherited.gemini.embeddingModel ||
        process.env.OPENCLAW_RP_GEMINI_EMBEDDING_MODEL ||
        fileConfig.gemini_embedding_model ||
        process.env.GEMINI_EMBEDDING_MODEL,
      chatTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_CHAT_TIMEOUT_MS ||
          fileConfig.gemini_chat_timeout_ms ||
          process.env.GEMINI_CHAT_TIMEOUT_MS,
        60000,
      ),
      ttsTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_TTS_TIMEOUT_MS ||
          fileConfig.gemini_tts_timeout_ms ||
          process.env.GEMINI_TTS_TIMEOUT_MS,
        90000,
      ),
      imageTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_IMAGE_TIMEOUT_MS ||
          fileConfig.gemini_image_timeout_ms ||
          process.env.GEMINI_IMAGE_TIMEOUT_MS,
        120000,
      ),
      embeddingTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_EMBEDDING_TIMEOUT_MS ||
          fileConfig.gemini_embedding_timeout_ms ||
          process.env.GEMINI_EMBEDDING_TIMEOUT_MS,
        30000,
      ),
    });
  }

  if (!openaiApiKey && geminiApiKey) {
    return createGeminiProviders({
      apiKey: geminiApiKey,
      model:
        inherited.gemini.model ||
        process.env.OPENCLAW_RP_GEMINI_MODEL ||
        fileConfig.gemini_model ||
        process.env.GEMINI_MODEL,
      ttsModel:
        inherited.gemini.ttsModel ||
        process.env.OPENCLAW_RP_GEMINI_TTS_MODEL ||
        fileConfig.gemini_tts_model ||
        process.env.GEMINI_TTS_MODEL,
      ttsVoice:
        inherited.gemini.ttsVoice ||
        process.env.OPENCLAW_RP_GEMINI_TTS_VOICE ||
        fileConfig.gemini_tts_voice ||
        process.env.GEMINI_TTS_VOICE,
      imageModel:
        inherited.gemini.imageModel ||
        process.env.OPENCLAW_RP_GEMINI_IMAGE_MODEL ||
        fileConfig.gemini_image_model ||
        process.env.GEMINI_IMAGE_MODEL,
      embeddingModel:
        inherited.gemini.embeddingModel ||
        process.env.OPENCLAW_RP_GEMINI_EMBEDDING_MODEL ||
        fileConfig.gemini_embedding_model ||
        process.env.GEMINI_EMBEDDING_MODEL,
      chatTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_CHAT_TIMEOUT_MS ||
          fileConfig.gemini_chat_timeout_ms ||
          process.env.GEMINI_CHAT_TIMEOUT_MS,
        60000,
      ),
      ttsTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_TTS_TIMEOUT_MS ||
          fileConfig.gemini_tts_timeout_ms ||
          process.env.GEMINI_TTS_TIMEOUT_MS,
        90000,
      ),
      imageTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_IMAGE_TIMEOUT_MS ||
          fileConfig.gemini_image_timeout_ms ||
          process.env.GEMINI_IMAGE_TIMEOUT_MS,
        120000,
      ),
      embeddingTimeoutMs: toPositiveNumber(
        process.env.OPENCLAW_RP_GEMINI_EMBEDDING_TIMEOUT_MS ||
          fileConfig.gemini_embedding_timeout_ms ||
          process.env.GEMINI_EMBEDDING_TIMEOUT_MS,
        30000,
      ),
    });
  }

  if (!openaiApiKey) {
    return {};
  }

  return createOpenAICompatibleProviders({
    apiKey: openaiApiKey,
    baseUrl:
      inherited.openai.baseUrl ||
      process.env.OPENCLAW_RP_OPENAI_BASE_URL ||
      fileConfig.openai_base_url ||
      process.env.OPENAI_BASE_URL,
    model:
      inherited.openai.model ||
      process.env.OPENCLAW_RP_OPENAI_MODEL ||
      fileConfig.openai_model ||
      process.env.OPENAI_MODEL,
    ttsModel:
      inherited.openai.ttsModel ||
      process.env.OPENCLAW_RP_OPENAI_TTS_MODEL ||
      fileConfig.openai_tts_model ||
      process.env.OPENAI_TTS_MODEL,
    imageModel:
      inherited.openai.imageModel ||
      process.env.OPENCLAW_RP_OPENAI_IMAGE_MODEL ||
      fileConfig.openai_image_model ||
      process.env.OPENAI_IMAGE_MODEL,
    embeddingModel:
      inherited.openai.embeddingModel ||
      process.env.OPENCLAW_RP_OPENAI_EMBEDDING_MODEL ||
      fileConfig.openai_embedding_model ||
      process.env.OPENAI_EMBEDDING_MODEL,
    chatTimeoutMs: toPositiveNumber(
      process.env.OPENCLAW_RP_OPENAI_CHAT_TIMEOUT_MS ||
        fileConfig.openai_chat_timeout_ms ||
        process.env.OPENAI_CHAT_TIMEOUT_MS,
      30000,
    ),
    ttsTimeoutMs: toPositiveNumber(
      process.env.OPENCLAW_RP_OPENAI_TTS_TIMEOUT_MS ||
        fileConfig.openai_tts_timeout_ms ||
        process.env.OPENAI_TTS_TIMEOUT_MS,
      15000,
    ),
    imageTimeoutMs: toPositiveNumber(
      process.env.OPENCLAW_RP_OPENAI_IMAGE_TIMEOUT_MS ||
        fileConfig.openai_image_timeout_ms ||
        process.env.OPENAI_IMAGE_TIMEOUT_MS,
      60000,
    ),
    embeddingTimeoutMs: toPositiveNumber(
      process.env.OPENCLAW_RP_OPENAI_EMBEDDING_TIMEOUT_MS ||
        fileConfig.openai_embedding_timeout_ms ||
        process.env.OPENAI_EMBEDDING_TIMEOUT_MS,
      30000,
    ),
  });
}

export default {
  id: "openclaw-rp-plugin",
  name: "OpenClaw RP",
  description: "SillyTavern-compatible role-play command plugin for OpenClaw.",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    let db = null;
    let store = null;
    let sessionManager = null;
    let stateDir = null;
    let inboundMediaDir = null;
    let router = null;
    const mediaCache = createMediaCache();
    const usedFallbackPaths = new Set();
    const pendingInboundByKey = new Map();
    const pendingInboundTtlMs = 120000;
    // Maps channelId (from hook context) -> { session, routerCtx, at } for active RP prompt injection
    const activeRpContextByChannel = new Map();
    const rpContextTtlMs = 120000;

    async function ensureInitialized() {
      if (router) {
        return;
      }
      const rootStateDir = api.runtime.state.resolveStateDir(api.config);
      stateDir = path.join(rootStateDir, "openclaw-rp");
      inboundMediaDir = path.join(rootStateDir, "media", "inbound");
      await mkdir(stateDir, { recursive: true });
      db = new NodeSqliteCompat(path.join(stateDir, "rp.sqlite"));
      store = new SqliteStore(db);
      store.migrate();
      const fileConfig = loadProviderFileConfig();
      const vectorExtensionPath =
        process.env.OPENCLAW_RP_SQLITE_VECTOR_EXTENSION ||
        process.env.RP_SQLITE_VECTOR_EXTENSION ||
        fileConfig.sqlite_vector_extension ||
        fileConfig.vector_extension_path;
      const vectorDistanceFunction =
        process.env.OPENCLAW_RP_SQLITE_VECTOR_DISTANCE_FUNCTION ||
        process.env.RP_SQLITE_VECTOR_DISTANCE_FUNCTION ||
        fileConfig.sqlite_vector_distance_function;
      const vectorState = store.configureVectorSearch?.({
        extensionPath: vectorExtensionPath,
        distanceFunction: vectorDistanceFunction,
      });
      if (vectorState?.enabled) {
        api.logger?.info?.(
          `[openclaw-rp] vector search enabled (${vectorState.distanceFunction})`,
        );
      } else if (vectorExtensionPath) {
        api.logger?.warn?.("[openclaw-rp] vector extension configured but unavailable; using JS cosine fallback");
      }

      const providers = resolveProviderConfig(api?.config);
      const plugin = createRPPlugin({
        store,
        ...providers,
        logger: api.logger,
      });
      router = plugin.services.router;
      sessionManager = plugin.services.sessionManager;
    }

    api.registerCommand({
      name: "rp",
      description: "RolePlay commands. Try /rp help",
      acceptsArgs: true,
      handler: async (ctx) => {
        await ensureInitialized();
        try {
          const { response } = await handleRouterCommandWithImportFallback(router, ctx, mediaCache, {
            inboundMediaDir,
            usedFallbackPaths,
            logger: api.logger,
          });
          scheduleFollowupIfNeeded(response, ctx, api.logger, api.runtime.channel?.telegram);
          const mediaRaw = response?.data?.audio_url || response?.data?.image_url;
          const mediaUrl = mediaRaw ? await materializeMediaUrl(mediaRaw, inboundMediaDir) : undefined;

          return {
            text: formatResponseText(response),
            mediaUrl,
            audioAsVoice: Boolean(response?.data?.audio_url && mediaUrl && isVoiceMediaSource(mediaRaw)),
          };
        } catch (err) {
          const rpErr = asRPError(err);
          return {
            text: formatResponseText(rpErr.toResponse()),
            isError: true,
          };
        }
      },
    });

    api.registerHook("message:preprocessed", (event) => {
      if (!isValidPreprocessedEvent(event)) {
        return;
      }
      storeEventMediaToCache(event, mediaCache);
    });

    // Clean up stale RP context entries
    function cleanupRpContextMap() {
      const now = Date.now();
      for (const [key, ctx] of activeRpContextByChannel) {
        if (now - ctx.at > rpContextTtlMs) {
          activeRpContextByChannel.delete(key);
        }
      }
    }

    api.on("message_received", async (event, hookCtx) => {
      try {
        await ensureInitialized();
        const content = asString(event?.content);
        if (!content || content.startsWith("/")) {
          return;
        }

        const routerCtx = buildHookRouterContext(event, hookCtx);

        const peers = new Set();
        for (const source of [
          hookCtx?.conversationId,
          event?.metadata?.originatingTo,
          event?.metadata?.to,
          event?.from,
          routerCtx.platformContextId,
        ]) {
          for (const peer of candidatePeers(source)) {
            peers.add(peer);
          }
        }

        // Also stash pending inbound for legacy message_sending path (if ever called)
        stashPendingInbound(pendingInboundByKey, pendingInboundTtlMs, {
          at: Date.now(),
          channelId: asString(hookCtx?.channelId || routerCtx.channelType),
          accountId: asString(hookCtx?.accountId),
          peers: [...peers],
          routerCtx,
        });

        // Find active RP session for this user
        const pending = {
          routerCtx,
          peers: [...peers],
        };
        const session = resolveActiveSessionForPending(store, db, pending);
        if (!session) {
          api.logger?.info?.(`[openclaw-rp] message_received: no active RP session`);
          return;
        }

        const status = asString(session.status).toLowerCase();
        if (status !== "active") {
          api.logger?.info?.(`[openclaw-rp] message_received: session ${session.id} status=${status}, skipping`);
          return;
        }

        // Append user turn to RP session
        const userTurn = store.appendTurn({
          sessionId: session.id,
          role: "user",
          content,
          tokenEstimate: estimateTokens(content),
        });
        sessionManager?.indexTurnEmbeddingAsync?.(session.id, userTurn);

        // Store RP context for before_prompt_build to pick up
        const channelKey = asString(hookCtx?.channelId || routerCtx.channelType).toLowerCase();
        cleanupRpContextMap();
        activeRpContextByChannel.set(channelKey, {
          at: Date.now(),
          session,
          routerCtx,
          userContent: content,
        });

        api.logger?.info?.(`[openclaw-rp] message_received: appended user turn to session ${session.id}, channelKey=${channelKey}`);
      } catch (err) {
        api.logger?.warn?.(`[openclaw-rp] message_received hook failed: ${String(err?.message || err)}`);
      }
    });

    // Inject RP character prompt when an active RP session exists
    api.on("before_prompt_build", async (event, ctx) => {
      try {
        await ensureInitialized();
        const channelKey = asString(ctx?.channelId).toLowerCase();
        const rpCtx = activeRpContextByChannel.get(channelKey);
        if (!rpCtx) {
          return;
        }

        const session = store.getSessionById(rpCtx.session.id);
        if (!session || session.status !== "active") {
          activeRpContextByChannel.delete(channelKey);
          return;
        }

        // Resolve the user's display name for {{user}} placeholder
        const userName =
          asString(rpCtx.routerCtx.senderName) ||
          asString(rpCtx.routerCtx.userId) ||
          "User";

        const prepared = await sessionManager.preparePromptForSession(session.id, {
          userName,
          queryText: rpCtx.userContent || "",
        });
        const prompt = prepared.prompt;
        const bundle = prepared.bundle;

        // Build a combined system prompt from all RP prompt messages
        const systemParts = [];
        const contextParts = [];
        for (const msg of prompt.messages) {
          if (msg.role === "system") {
            systemParts.push(msg.content);
          } else {
            // Include user/assistant turns as context
            contextParts.push(`${msg.role === "user" ? "User" : bundle.card?.detail?.name || "Character"}: ${msg.content}`);
          }
        }

        const systemPrompt = systemParts.join("\n\n");
        const prependContext = contextParts.length > 0
          ? `[RP Conversation History]\n${contextParts.join("\n\n")}`
          : undefined;

        api.logger?.info?.(`[openclaw-rp] before_prompt_build: injecting RP prompt for session ${session.id}, systemPrompt=${systemPrompt.length}chars, context=${(prependContext || "").length}chars`);

        return {
          systemPrompt,
          prependContext,
        };
      } catch (err) {
        api.logger?.warn?.(`[openclaw-rp] before_prompt_build hook failed: ${String(err?.message || err)}`);
      }
    });

    // Capture LLM output and append as assistant turn in the RP session
    api.on("llm_output", async (event, ctx) => {
      try {
        await ensureInitialized();
        const channelKey = asString(ctx?.channelId).toLowerCase();
        const rpCtx = activeRpContextByChannel.get(channelKey);
        if (!rpCtx) {
          return;
        }

        // Consume the RP context so it doesn't apply to the next message
        activeRpContextByChannel.delete(channelKey);

        const session = store.getSessionById(rpCtx.session.id);
        if (!session || session.status !== "active") {
          return;
        }

        const assistantTexts = event?.assistantTexts;
        if (!Array.isArray(assistantTexts) || assistantTexts.length === 0) {
          return;
        }

        const lastText = assistantTexts[assistantTexts.length - 1];
        if (!lastText) {
          return;
        }

        const assistantTurn = store.appendTurn({
          sessionId: session.id,
          role: "assistant",
          content: lastText,
          tokenEstimate: estimateTokens(lastText),
        });
        sessionManager?.indexTurnEmbeddingAsync?.(session.id, assistantTurn);

        api.logger?.info?.(`[openclaw-rp] llm_output: appended assistant turn to session ${session.id}, length=${lastText.length}`);
      } catch (err) {
        api.logger?.warn?.(`[openclaw-rp] llm_output hook failed: ${String(err?.message || err)}`);
      }
    });

    api.registerService({
      id: "openclaw-rp-sqlite",
      start: () => { },
      stop: () => {
        try {
          db?.close?.();
        } catch {
          // ignore close failures during shutdown
        }
      },
    });
  },
};
