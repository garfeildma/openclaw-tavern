export const RP_ASSET_TYPES = {
  CARD: "card",
  PRESET: "preset",
  LOREBOOK: "lorebook",
};

export const RP_SESSION_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  SUMMARIZING: "summarizing",
  ENDED: "ended",
};

export const RP_ERROR_CODES = {
  OK: "RP_OK",
  BAD_REQUEST: "RP_BAD_REQUEST",
  UNSUPPORTED_FILE: "RP_UNSUPPORTED_FILE",
  PARSE_FAILED: "RP_PARSE_FAILED",
  VALIDATION_FAILED: "RP_VALIDATION_FAILED",
  ASSET_NOT_FOUND: "RP_ASSET_NOT_FOUND",
  ASSET_IN_USE: "RP_ASSET_IN_USE",
  SESSION_NOT_FOUND: "RP_SESSION_NOT_FOUND",
  SESSION_CONFLICT: "RP_SESSION_CONFLICT",
  PERMISSION_DENIED: "RP_PERMISSION_DENIED",
  ATTACHMENT_MISSING: "RP_ATTACHMENT_MISSING",
  MODEL_UNAVAILABLE: "RP_MODEL_UNAVAILABLE",
  MEDIA_FAILED: "RP_MEDIA_FAILED",
  SUMMARY_FAILED: "RP_SUMMARY_FAILED",
  RATE_LIMITED: "RP_RATE_LIMITED",
  INTERNAL_ERROR: "RP_INTERNAL_ERROR",
};

export const DEFAULT_CONTEXT_POLICY = {
  recentMessagesLimit: 24,
  summaryTriggerTokens: 6000,
  maxPromptTokens: 8000,
  summaryStyle: "persona-safe",
  memoryEnabled: true,
  memoryTopK: 6,
  memoryMinScore: 0.2,
  memoryExcludeRecentTurns: 10,
  memoryPromptBudget: 900,
  memoryMaxCharsPerItem: 320,
  memoryCandidateLimit: 250,
  embeddingDimensions: 384,
  companionEnabled: true,
  companionIdleMinutes: 120,
  companionMemoryTopK: 3,
  companionRecentTurns: 8,
};
