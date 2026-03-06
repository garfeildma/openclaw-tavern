function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseJsonArray(raw) {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function asNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function pickNumeric(source, keys) {
  for (const key of keys) {
    const value = asNumber(source?.[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function resolveModelConfig({ preset, extraParams, commandOverrides } = {}) {
  const detail = preset?.detail || {};
  const extraFromAsset = parseJson(preset?.extra_json);
  const extraFromContext = parseJson(extraParams);
  const overrides = commandOverrides || {};

  const mergedExtra = {
    ...extraFromAsset,
    ...extraFromContext,
  };

  const config = {
    model_id: overrides.model_id || mergedExtra.model_id,
    temperature: pickNumeric(overrides, ["temperature"]) ?? pickNumeric(detail, ["temperature"]),
    top_p: pickNumeric(overrides, ["top_p"]) ?? pickNumeric(detail, ["top_p"]),
    top_k: pickNumeric(overrides, ["top_k"]) ?? pickNumeric(detail, ["top_k"]),
    max_tokens: pickNumeric(overrides, ["max_tokens"]) ?? pickNumeric(detail, ["max_tokens"]),
    frequency_penalty:
      pickNumeric(overrides, ["frequency_penalty"]) ?? pickNumeric(detail, ["frequency_penalty"]),
    presence_penalty: pickNumeric(overrides, ["presence_penalty"]) ?? pickNumeric(detail, ["presence_penalty"]),
    repetition_penalty:
      pickNumeric(overrides, ["repetition_penalty"]) ?? pickNumeric(detail, ["repetition_penalty"]),
    stop_sequences: detail.stop_sequences_json ? parseJsonArray(detail.stop_sequences_json) : [],
  };

  const samplingKeys = [
    "typical_p",
    "min_p",
    "mirostat",
    "mirostat_tau",
    "mirostat_eta",
    "top_a",
    "tfs_z",
    "seed",
  ];

  for (const key of samplingKeys) {
    if (overrides[key] !== undefined) {
      config[key] = overrides[key];
      continue;
    }
    if (mergedExtra[key] !== undefined) {
      config[key] = mergedExtra[key];
    }
  }

  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && config[k] === undefined) {
      config[k] = v;
    }
  }

  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined));
}
