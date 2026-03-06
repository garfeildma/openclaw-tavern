import { RPError } from "../errors.js";
import { RP_ERROR_CODES } from "../types.js";

function asNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function importPresetFromAttachment(attachment) {
  if (!attachment?.buffer || !attachment?.filename) {
    throw new RPError(RP_ERROR_CODES.ATTACHMENT_MISSING, "Missing attachment for preset import");
  }

  if (!attachment.filename.toLowerCase().endsWith(".json")) {
    throw new RPError(RP_ERROR_CODES.UNSUPPORTED_FILE, "Preset import supports JSON only");
  }

  let raw;
  try {
    raw = JSON.parse(attachment.buffer.toString("utf8"));
  } catch {
    throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "Invalid preset JSON");
  }

  const preset = {
    temperature: asNumber(raw.temperature),
    top_p: asNumber(raw.top_p),
    top_k: asNumber(raw.top_k),
    max_tokens: asNumber(raw.max_tokens ?? raw.max_length),
    frequency_penalty: asNumber(raw.frequency_penalty ?? raw.freq_pen),
    presence_penalty: asNumber(raw.presence_penalty ?? raw.pres_pen),
    repetition_penalty: asNumber(raw.repetition_penalty ?? raw.rep_pen),
    stop_sequences_json: JSON.stringify(raw.stop ?? raw.stop_sequence ?? []),
    prompt_template_json: JSON.stringify({
      prompts: raw.prompts,
      prompt_order: raw.prompt_order,
      story_string: raw.story_string,
      chat_template: raw.chat_template,
    }),
  };

  const known = new Set([
    "temperature",
    "top_p",
    "top_k",
    "max_tokens",
    "max_length",
    "frequency_penalty",
    "freq_pen",
    "presence_penalty",
    "pres_pen",
    "repetition_penalty",
    "rep_pen",
    "stop",
    "stop_sequence",
    "prompts",
    "prompt_order",
    "story_string",
    "chat_template",
  ]);

  const unmappedFields = Object.keys(raw).filter((k) => !known.has(k));
  const mappedFields = Object.entries(preset)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k]) => k);

  const warnings = [];
  if (mappedFields.length === 0) {
    warnings.push("Preset has no recognized fields, defaults will apply");
  }

  return {
    raw,
    sourceFormat: "silly_tavern_preset",
    preset,
    extra: Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k))),
    mappedFields,
    unmappedFields,
    warnings,
  };
}
