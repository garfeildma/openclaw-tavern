/**
 * Internationalization (i18n) module for OpenClaw RP plugin.
 *
 * Locale resolution priority:
 *   1. OPENCLAW_RP_LOCALE env var
 *   2. `locale` field in ~/.openclaw/openclaw-rp/provider.json
 *   3. `locale` field in ~/.openclaw/openclaw.json
 *   4. LANG env var (e.g. "zh_CN.UTF-8" → "zh")
 *   5. Default: "zh"
 */

const messages = {
  zh: {
    session_paused: "当前 RP 会话已暂停（/rp resume 可恢复）。",
    session_ended: "当前 RP 会话已结束（/rp start 可重新开始）。",
    session_unavailable: "当前 RP 会话暂不可用。",
    sync_persona_success: "已同步当前角色到 Agent 人设",
    restore_soul_file_not_found: "SOUL.md 文件不存在",
    restore_soul_no_managed_block: "SOUL.md 中没有 RP 角色预设块，无需恢复",
    restore_soul_failed: "未能恢复",
    restore_persona_success: "已从 SOUL.md 移除 RP 角色预设，Agent 人设已恢复",
    help_sync_agent_persona: "将当前角色写入 Agent 的 SOUL.md（手动触发）",
    help_restore_agent_persona: "从 SOUL.md 移除 RP 角色预设，恢复原始人设",
  },
  en: {
    session_paused: "RP session is paused (use /rp resume to continue).",
    session_ended: "RP session has ended (use /rp start to begin a new one).",
    session_unavailable: "RP session is currently unavailable.",
    sync_persona_success: "Synced current character to Agent persona",
    restore_soul_file_not_found: "SOUL.md file not found",
    restore_soul_no_managed_block: "No RP character preset block in SOUL.md, nothing to restore",
    restore_soul_failed: "Restore failed",
    restore_persona_success: "Removed RP character preset from SOUL.md, Agent persona restored",
    help_sync_agent_persona: "Write current character to Agent's SOUL.md (manual trigger)",
    help_restore_agent_persona: "Remove RP character preset from SOUL.md, restore original persona",
  },
};

/**
 * Detect locale from LANG environment variable.
 * "zh_CN.UTF-8" → "zh", "en_US.UTF-8" → "en"
 */
function detectLocaleFromEnv() {
  const lang = String(process.env.LANG || "").toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  return "";
}

/**
 * Normalize a raw locale string to a supported locale key ("zh" | "en").
 * Returns empty string if the value is not recognized.
 */
function normalizeLocale(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("zh")) return "zh";
  if (raw.startsWith("en")) return "en";
  return "";
}

let _resolvedLocale = "";

/**
 * Resolve the effective locale. Result is cached after first call.
 * Call `resetLocaleCache()` to force re-resolution (e.g. after config reload).
 */
export function resolveLocale(fileConfig, openclawConfig) {
  if (_resolvedLocale) return _resolvedLocale;

  const fromEnv = normalizeLocale(process.env.OPENCLAW_RP_LOCALE);
  if (fromEnv) {
    _resolvedLocale = fromEnv;
    return _resolvedLocale;
  }

  const fromFile = normalizeLocale(fileConfig?.locale);
  if (fromFile) {
    _resolvedLocale = fromFile;
    return _resolvedLocale;
  }

  const fromOpenClaw = normalizeLocale(openclawConfig?.locale);
  if (fromOpenClaw) {
    _resolvedLocale = fromOpenClaw;
    return _resolvedLocale;
  }

  const fromLang = detectLocaleFromEnv();
  _resolvedLocale = fromLang || "zh";
  return _resolvedLocale;
}

/** Reset the locale cache so the next call to `resolveLocale` re-evaluates. */
export function resetLocaleCache() {
  _resolvedLocale = "";
}

/**
 * Get a translated message by key.
 * Falls back to Chinese if the key is not found in the current locale.
 *
 * @param {string} key - Message key (e.g. "session_paused")
 * @param {string} [locale] - Override locale; if omitted uses the resolved locale
 * @returns {string}
 */
export function t(key, locale) {
  const lang = locale || _resolvedLocale || "zh";
  const dict = messages[lang] || messages.zh;
  return dict[key] ?? messages.zh[key] ?? key;
}
