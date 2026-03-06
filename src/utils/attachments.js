function normalizeResolvedAttachment(original, resolved) {
  if (!resolved) {
    return original;
  }

  if (Buffer.isBuffer(resolved)) {
    return {
      ...original,
      buffer: resolved,
    };
  }

  if (typeof resolved === "string") {
    return {
      ...original,
      buffer: Buffer.from(resolved, "base64"),
    };
  }

  if (typeof resolved === "object") {
    return {
      ...original,
      ...resolved,
    };
  }

  return original;
}

function maybeBufferFromInlineContent(attachment) {
  if (attachment?.buffer && Buffer.isBuffer(attachment.buffer)) {
    return attachment;
  }
  if (typeof attachment?.content === "string") {
    return {
      ...attachment,
      buffer: Buffer.from(attachment.content, "base64"),
    };
  }
  return attachment;
}

export async function resolveContextAttachments(ctx, attachmentResolver) {
  const attachments = Array.isArray(ctx?.attachments) ? ctx.attachments : [];
  if (attachments.length === 0) {
    return {
      ...ctx,
      attachments,
    };
  }

  const resolved = [];
  for (const item of attachments) {
    let attachment = maybeBufferFromInlineContent(item);
    if (!attachment?.buffer && typeof attachmentResolver === "function") {
      // eslint-disable-next-line no-await-in-loop
      const result = await attachmentResolver(attachment, ctx);
      attachment = normalizeResolvedAttachment(attachment, result);
      attachment = maybeBufferFromInlineContent(attachment);
    }
    resolved.push(attachment);
  }

  return {
    ...ctx,
    attachments: resolved,
  };
}
