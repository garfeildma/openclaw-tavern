import { RPError } from "../errors.js";
import { RP_ERROR_CODES } from "../types.js";
import { extractCharaJsonFromPng } from "../utils/png.js";

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") {
      return v;
    }
  }
  return undefined;
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "Invalid JSON file");
  }
}

function detectCardVersion(raw) {
  const spec = raw?.spec;
  const specVersion = Number.parseFloat(raw?.spec_version || raw?.data?.spec_version || "0");
  if (spec === "chara_card_v2" || specVersion >= 2) {
    return "chara_card_v2";
  }
  if (spec && spec !== "chara_card_v2") {
    return "unknown";
  }

  const root = raw?.data || raw || {};
  const v1Hints = [
    root.name,
    root.char_name,
    root.description,
    root.personality,
    root.char_persona,
    root.scenario,
    root.first_mes,
    root.char_greeting,
    root.mes_example,
  ].filter(Boolean);

  if (v1Hints.length > 0) {
    return "tavern_v1";
  }

  return "unknown";
}

function mapCard(raw) {
  const sourceFormat = detectCardVersion(raw);
  const root = sourceFormat === "chara_card_v2" ? raw?.data || {} : raw?.data || raw || {};

  const name = firstDefined(root.name, raw?.name, root.char_name, raw?.char_name);
  if (!name) {
    throw new RPError(RP_ERROR_CODES.VALIDATION_FAILED, "Card missing required field: name");
  }

  const mappedFields = [];
  const unmappedFields = [];

  const card = {
    name,
    description: firstDefined(root.description, raw?.description),
    personality: firstDefined(root.personality, root.char_persona, raw?.personality, raw?.char_persona),
    scenario: firstDefined(root.scenario, raw?.scenario),
    first_message: firstDefined(root.first_mes, root.char_greeting, raw?.first_mes, raw?.char_greeting),
    example_dialogue: firstDefined(root.mes_example, raw?.mes_example),
    system_prompt: firstDefined(root.system_prompt),
    post_history_instructions: firstDefined(root.post_history_instructions),
    alternate_greetings_json: JSON.stringify(normalizeArray(root.alternate_greetings)),
    creator: firstDefined(root.creator),
    tags_json: JSON.stringify(normalizeArray(root.tags)),
    character_version: firstDefined(root.character_version),
  };

  for (const [k, v] of Object.entries(card)) {
    if (v !== undefined && v !== null && v !== "") {
      mappedFields.push(k);
    }
  }

  const knownKeys = new Set([
    "name",
    "char_name",
    "description",
    "personality",
    "char_persona",
    "scenario",
    "first_mes",
    "char_greeting",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
    "alternate_greetings",
    "creator",
    "tags",
    "character_version",
    "spec",
    "spec_version",
    "data",
    "extensions",
  ]);

  for (const key of Object.keys(raw || {})) {
    if (!knownKeys.has(key)) {
      unmappedFields.push(key);
    }
  }

  const extra = {
    root_unknown: Object.fromEntries(Object.entries(raw || {}).filter(([k]) => !knownKeys.has(k))),
    data_extensions: root.extensions,
  };

  const warnings = [];
  if (!card.description) {
    warnings.push("Card has empty description");
  }

  return {
    sourceFormat,
    card,
    extra,
    mappedFields,
    unmappedFields,
    warnings,
  };
}

export function importCardFromAttachment(attachment) {
  if (!attachment?.buffer || !attachment?.filename) {
    throw new RPError(RP_ERROR_CODES.ATTACHMENT_MISSING, "Missing attachment for card import");
  }

  const lower = attachment.filename.toLowerCase();
  let raw;

  if (lower.endsWith(".png")) {
    raw = extractCharaJsonFromPng(attachment.buffer);
  } else if (lower.endsWith(".json")) {
    raw = parseJsonBuffer(attachment.buffer);
  } else {
    throw new RPError(RP_ERROR_CODES.UNSUPPORTED_FILE, "Card import supports PNG or JSON only");
  }

  return {
    raw,
    ...mapCard(raw),
  };
}
