import { estimateTokens } from "./tokenEstimator.js";

export async function createCl100kEstimator() {
  try {
    const mod = await import("js-tiktoken");
    const enc = mod.getEncoding ? mod.getEncoding("cl100k_base") : null;
    if (!enc) {
      return estimateTokens;
    }

    return function cl100kEstimator(text) {
      const value = String(text || "");
      return enc.encode(value).length;
    };
  } catch {
    return estimateTokens;
  }
}
