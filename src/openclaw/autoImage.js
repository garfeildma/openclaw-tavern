function extractTelegramChatId(input) {
  const raw = typeof input === "string" ? input.trim() : String(input || "").trim();
  if (!raw) {
    return null;
  }
  const matches = raw.match(/-?\d+/g);
  if (!matches || matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1] || null;
}

function extractMessageId(value) {
  const raw =
    value?.messageId ??
    value?.message_id ??
    value?.result?.message_id ??
    value?.result?.messageId ??
    null;
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function buildMediaLocalRoots(mediaDir) {
  return mediaDir ? [mediaDir] : undefined;
}

async function tryTelegramMessageAction({ telegramRuntime, action, params, apiConfig, accountId, mediaLocalRoots, logger }) {
  const handleAction = telegramRuntime?.messageActions?.handleAction;
  if (typeof handleAction !== "function") {
    return false;
  }
  try {
    await handleAction({
      action,
      params,
      cfg: apiConfig,
      accountId: accountId || undefined,
      mediaLocalRoots,
    });
    return true;
  } catch (err) {
    logger?.warn?.(`[openclaw-rp] telegram ${action} action failed: ${String(err?.message || err)}`);
    return false;
  }
}

async function sendTelegramPlaceholder({ telegramRuntime, chatId, accountId, messageThreadId, text, logger }) {
  const sendMessageTelegram = telegramRuntime?.sendMessageTelegram;
  if (typeof sendMessageTelegram !== "function" || !chatId || !text) {
    return null;
  }
  try {
    const result = await sendMessageTelegram(String(chatId), text, {
      accountId: accountId || undefined,
      messageThreadId: typeof messageThreadId === "number" ? messageThreadId : undefined,
      textMode: "html",
      plainText: text,
    });
    const messageId = extractMessageId(result);
    if (!messageId) {
      return null;
    }
    return {
      chatId: String(result?.chatId || chatId),
      messageId,
    };
  } catch (err) {
    logger?.warn?.(`[openclaw-rp] telegram placeholder send failed: ${String(err?.message || err)}`);
    return null;
  }
}

async function deliverDeferredMediaForTelegram({
  router,
  routerCtx,
  inboundMediaDir,
  telegramRuntime,
  logger,
  accountId,
  messageThreadId,
  apiConfig,
  materializeMedia,
  placeholderText,
  successFallbackText,
  failureText,
  buildResponse,
  extractMediaUrl,
  sendOptions,
}) {
  const chatId = extractTelegramChatId(routerCtx?.platformContextId);
  if (!chatId || typeof materializeMedia !== "function" || typeof buildResponse !== "function" || typeof extractMediaUrl !== "function") {
    return { ok: false, reason: "unsupported-context" };
  }
  if (typeof telegramRuntime?.sendMessageTelegram !== "function") {
    return { ok: false, reason: "telegram-runtime-unavailable" };
  }

  const mediaLocalRoots = buildMediaLocalRoots(inboundMediaDir);
  const placeholder = await sendTelegramPlaceholder({
    telegramRuntime,
    chatId,
    accountId,
    messageThreadId,
    text: placeholderText,
    logger,
  });

  try {
    const response = await buildResponse();
    const mediaRaw = extractMediaUrl(response);
    if (!mediaRaw) {
      throw new Error("Deferred media generation returned no media url");
    }
    const mediaUrl = await materializeMedia(mediaRaw, inboundMediaDir);

    if (placeholder) {
      const placeholderDeleted = await tryTelegramMessageAction({
        telegramRuntime,
        action: "delete",
        params: {
          chatId: placeholder.chatId,
          messageId: placeholder.messageId,
        },
        apiConfig,
        accountId,
        mediaLocalRoots,
        logger,
      });
      if (!placeholderDeleted) {
        await tryTelegramMessageAction({
          telegramRuntime,
          action: "edit",
          params: {
            chatId: placeholder.chatId,
            messageId: placeholder.messageId,
            message: successFallbackText,
          },
          apiConfig,
          accountId,
          mediaLocalRoots,
          logger,
        });
      }
    }

    await telegramRuntime.sendMessageTelegram(String(chatId), "", {
      accountId: accountId || undefined,
      messageThreadId: typeof messageThreadId === "number" ? messageThreadId : undefined,
      mediaUrl,
      mediaLocalRoots,
      textMode: "html",
      ...(sendOptions || {}),
    });

    return { ok: true, response };
  } catch (err) {
    if (placeholder) {
      await tryTelegramMessageAction({
        telegramRuntime,
        action: "edit",
        params: {
          chatId: placeholder.chatId,
          messageId: placeholder.messageId,
          message: failureText,
        },
        apiConfig,
        accountId,
        mediaLocalRoots,
        logger,
      });
    }
    logger?.warn?.(`[openclaw-rp] deferred media delivery failed: ${String(err?.message || err)}`);
    return { ok: false, reason: "media-delivery-failed" };
  }
}

export async function deliverAutoImageForTelegram({
  router,
  routerCtx,
  styleHint,
  inboundMediaDir,
  telegramRuntime,
  logger,
  accountId,
  messageThreadId,
  apiConfig,
  materializeMedia,
}) {
  if (typeof router?.image !== "function") {
    return { ok: false, reason: "unsupported-context" };
  }
  return await deliverDeferredMediaForTelegram({
    router,
    routerCtx,
    inboundMediaDir,
    telegramRuntime,
    logger,
    accountId,
    messageThreadId,
    apiConfig,
    materializeMedia,
    placeholderText: "图片生成中",
    successFallbackText: "图片已生成，见下一条。",
    failureText: "图片生成失败",
    buildResponse: async () => await router.image(routerCtx, styleHint ? { style: styleHint } : undefined),
    extractMediaUrl: (response) => response?.data?.image_url,
  });
}

export async function deliverAutoSpeakForTelegram({
  router,
  routerCtx,
  inboundMediaDir,
  telegramRuntime,
  logger,
  accountId,
  messageThreadId,
  apiConfig,
  materializeMedia,
}) {
  if (typeof router?.speak !== "function") {
    return { ok: false, reason: "unsupported-context" };
  }
  return await deliverDeferredMediaForTelegram({
    router,
    routerCtx,
    inboundMediaDir,
    telegramRuntime,
    logger,
    accountId,
    messageThreadId,
    apiConfig,
    materializeMedia,
    placeholderText: "语音生成中",
    successFallbackText: "语音已生成，见下一条。",
    failureText: "语音生成失败",
    buildResponse: async () => await router.speak(routerCtx),
    extractMediaUrl: (response) => response?.data?.audio_url,
    sendOptions: {
      asVoice: true,
    },
  });
}
