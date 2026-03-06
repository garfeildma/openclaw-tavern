function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

export function normalizeDiscordMessage(event) {
  return {
    channelType: "discord",
    platformContextId: event.guild_id || event.guildId || "dm",
    channelId: event.channel_id || event.channelId,
    userId: event.author?.id || event.user_id || event.userId,
    content: event.content || "",
    attachments: ensureArray(event.attachments).map((a) => ({
      filename: a.filename || "upload.bin",
      buffer: a.buffer,
      content: a.content,
      mimeType: a.content_type || a.mimeType,
      url: a.url,
    })),
  };
}

export function normalizeTelegramMessage(update) {
  const message = update.message || update.edited_message || update.channel_post || {};
  const chatId = String(message.chat?.id || "");
  const fromId = String(message.from?.id || "");

  return {
    channelType: "telegram",
    platformContextId: chatId,
    channelId: chatId,
    userId: fromId,
    content: message.text || message.caption || "",
    attachments: extractTelegramAttachments(message),
  };
}

function extractTelegramAttachments(message) {
  const files = [];

  if (message.document) {
    files.push({
      filename: message.document.file_name || "document.bin",
      fileId: message.document.file_id,
      mimeType: message.document.mime_type,
    });
  }

  if (message.photo && message.photo.length > 0) {
    const p = message.photo[message.photo.length - 1];
    files.push({
      filename: `photo_${p.file_unique_id || p.file_id}.jpg`,
      fileId: p.file_id,
      mimeType: "image/jpeg",
    });
  }

  if (message.audio) {
    files.push({
      filename: message.audio.file_name || "audio.mp3",
      fileId: message.audio.file_id,
      mimeType: message.audio.mime_type,
    });
  }

  return files;
}

export function toDiscordSendPayload(response) {
  if (!response) return null;

  const base = {
    content: response.message || "",
  };

  if (response.data?.content) {
    base.content = response.data.content;
  }

  if (response.data?.audio_url) {
    base.files = [response.data.audio_url];
  }

  if (response.data?.image_url) {
    base.files = [response.data.image_url];
  }

  return base;
}

export function toTelegramSendPayload(response) {
  if (!response) return null;

  if (response.data?.audio_url) {
    return {
      method: "sendVoice",
      payload: {
        voice: response.data.audio_url,
        caption: response.message || "",
      },
    };
  }

  if (response.data?.image_url) {
    return {
      method: "sendPhoto",
      payload: {
        photo: response.data.image_url,
        caption: response.message || "",
      },
    };
  }

  return {
    method: "sendMessage",
    payload: {
      text: response.data?.content || response.message || "",
    },
  };
}
