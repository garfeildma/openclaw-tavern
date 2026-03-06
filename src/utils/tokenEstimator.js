// Fallback estimator: roughly 1 token ~= 4 chars.
// You can inject a cl100k_base estimator for production.
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export function trimToTokens(text, maxTokens) {
  if (!text) return "";
  if (maxTokens <= 0) return "";
  const maxChars = Math.max(1, maxTokens * 4);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}
