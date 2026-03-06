const DEFAULT_DIMENSIONS = 384;

function fnv1a(input, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unitNormalize(vector) {
  let norm2 = 0;
  for (const v of vector) {
    norm2 += v * v;
  }
  if (norm2 <= 0) {
    return vector.map(() => 0);
  }
  const inv = 1 / Math.sqrt(norm2);
  return vector.map((v) => v * inv);
}

function projectVector(raw, targetDim) {
  const out = new Array(targetDim).fill(0);
  if (!Array.isArray(raw) || raw.length === 0) {
    return out;
  }
  for (let i = 0; i < raw.length; i += 1) {
    const value = toFiniteNumber(raw[i]);
    if (value === 0) {
      continue;
    }
    const idx = i % targetDim;
    out[idx] += value;
  }
  return out;
}

function normalizeText(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function addFeature(vec, feature, weight) {
  if (!feature) {
    return;
  }
  const hashA = fnv1a(feature, 0x811c9dc5);
  const hashB = fnv1a(feature, 0x9e3779b1);
  const idxA = hashA % vec.length;
  const idxB = hashB % vec.length;
  const signA = (hashA & 1) === 0 ? 1 : -1;
  const signB = (hashB & 1) === 0 ? 1 : -1;
  vec[idxA] += signA * weight;
  vec[idxB] += signB * (weight * 0.6);
}

function buildHashedEmbedding(text, dimensions) {
  const normalized = normalizeText(text);
  const vec = new Array(dimensions).fill(0);
  if (!normalized) {
    return vec;
  }

  const chars = [...normalized];
  for (let n = 2; n <= 4; n += 1) {
    if (chars.length < n) {
      continue;
    }
    const weight = 1 / n;
    for (let i = 0; i <= chars.length - n; i += 1) {
      const gram = chars.slice(i, i + n).join("");
      addFeature(vec, gram, weight);
    }
  }

  const words = normalized.split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    addFeature(vec, `w:${words[i]}`, 1.5);
    if (i + 1 < words.length) {
      addFeature(vec, `b:${words[i]}_${words[i + 1]}`, 1.0);
    }
  }

  return vec;
}

export function normalizeEmbeddingVector(rawVector, dimensions = DEFAULT_DIMENSIONS) {
  const dim = Number.isInteger(dimensions) && dimensions > 0 ? dimensions : DEFAULT_DIMENSIONS;
  return unitNormalize(projectVector(rawVector, dim));
}

export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
    return 0;
  }
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += toFiniteNumber(vecA[i]) * toFiniteNumber(vecB[i]);
  }
  return dot;
}

export function detectLanguageTag(text) {
  const raw = String(text || "");
  if (!raw.trim()) {
    return "unknown";
  }
  if (/[\u4e00-\u9fff]/u.test(raw)) return "zh";
  if (/[\u3040-\u30ff]/u.test(raw)) return "ja";
  if (/[\uac00-\ud7af]/u.test(raw)) return "ko";
  if (/[\u0600-\u06ff]/u.test(raw)) return "ar";
  if (/[\u0400-\u04ff]/u.test(raw)) return "cyrillic";
  if (/[\u0900-\u097f]/u.test(raw)) return "devanagari";
  if (/[a-z]/iu.test(raw)) return "latin";
  return "other";
}

export function createHashedMultilingualEmbeddingProvider({ dimensions = DEFAULT_DIMENSIONS } = {}) {
  const dim = Number.isInteger(dimensions) && dimensions > 0 ? dimensions : DEFAULT_DIMENSIONS;
  return {
    model: `hashed-multilingual-${dim}`,
    dimensions: dim,
    async embed(text) {
      const vector = buildHashedEmbedding(text, dim);
      return normalizeEmbeddingVector(vector, dim);
    },
  };
}
