import { RPError } from "../errors.js";
import { RP_ERROR_CODES } from "../types.js";

function normalizeEntry(entry, index) {
  const keys = Array.isArray(entry.keys) ? entry.keys : [];
  const secondaryKeys = Array.isArray(entry.secondary_keys)
    ? entry.secondary_keys
    : Array.isArray(entry.secondaryKeys)
      ? entry.secondaryKeys
      : [];

  return {
    uid: String(entry.uid ?? index),
    keys,
    secondary_keys: secondaryKeys,
    content: String(entry.content ?? ""),
    comment: String(entry.comment ?? ""),
    enabled: entry.enabled !== false,
    constant: entry.constant === true,
    selective: entry.selective === true,
    case_sensitive: entry.case_sensitive === true,
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 100,
    insertion_order: Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : index,
    position: Number.isFinite(Number(entry.position)) ? Number(entry.position) : 0,
  };
}

export function importLorebookFromAttachment(attachment) {
  if (!attachment?.buffer || !attachment?.filename) {
    throw new RPError(RP_ERROR_CODES.ATTACHMENT_MISSING, "Missing attachment for lorebook import");
  }

  if (!attachment.filename.toLowerCase().endsWith(".json")) {
    throw new RPError(RP_ERROR_CODES.UNSUPPORTED_FILE, "Lorebook import supports JSON only");
  }

  let raw;
  try {
    raw = JSON.parse(attachment.buffer.toString("utf8"));
  } catch {
    throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "Invalid lorebook JSON");
  }

  const rawEntries = Array.isArray(raw.entries)
    ? raw.entries
    : Array.isArray(raw.data?.entries)
      ? raw.data.entries
      : [];

  const entries = rawEntries.map(normalizeEntry);

  const validEntries = entries.filter((e) => e.keys.length > 0 && e.content.length > 0);
  const warnings = [];
  if (entries.length === 0) {
    warnings.push("Lorebook has no entries");
  }
  if (validEntries.length === 0) {
    warnings.push("Lorebook has no valid entries with keys and content");
  }

  return {
    raw,
    sourceFormat: "silly_tavern_lorebook",
    lorebook: {
      entries_json: JSON.stringify(entries),
      activation_strategy: "keyword",
    },
    extra: Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "entries" && k !== "data")),
    mappedFields: ["entries_json", "activation_strategy"],
    unmappedFields: Object.keys(raw).filter((k) => k !== "entries" && k !== "data"),
    warnings,
  };
}
