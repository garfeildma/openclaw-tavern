export function normalizeMessageContext(raw = {}) {
  return {
    channelType: raw.channelType || raw.channel_type,
    platformContextId: raw.platformContextId || raw.platform_context_id,
    channelId: raw.channelId || raw.channel_id,
    userId: raw.userId || raw.user_id,
    content: raw.content || "",
    attachments: raw.attachments || [],
  };
}

export function buildChannelSessionKey(rawCtx) {
  const ctx = normalizeMessageContext(rawCtx);
  return `${ctx.channelType}:${ctx.platformContextId}:${ctx.channelId}:${ctx.userId}`;
}
