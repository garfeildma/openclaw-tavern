function ensureFetch() {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is required (Node 18+)");
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  ensureFetch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} for ${url}`);
    }
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

export function createHttpAttachmentResolver({ headers, timeoutMs = 15000 } = {}) {
  return async function resolveAttachment(attachment) {
    if (attachment?.buffer) {
      return attachment;
    }
    if (!attachment?.url) {
      return attachment;
    }

    const resp = await fetchWithTimeout(
      attachment.url,
      {
        method: "GET",
        headers: headers || {},
      },
      timeoutMs,
    );
    const arr = await resp.arrayBuffer();

    return {
      ...attachment,
      buffer: Buffer.from(arr),
      mimeType: attachment.mimeType || resp.headers.get("content-type") || undefined,
    };
  };
}

export function createTelegramAttachmentResolver({ botToken, apiBaseUrl = "https://api.telegram.org", timeoutMs = 15000 }) {
  if (!botToken) {
    throw new Error("createTelegramAttachmentResolver requires botToken");
  }

  const base = String(apiBaseUrl).replace(/\/$/, "");
  return async function resolveAttachment(attachment) {
    if (attachment?.buffer) {
      return attachment;
    }
    if (!attachment?.fileId) {
      return attachment;
    }

    const fileMetaResp = await fetchWithTimeout(
      `${base}/bot${botToken}/getFile?file_id=${encodeURIComponent(attachment.fileId)}`,
      { method: "GET" },
      timeoutMs,
    );
    const meta = await fileMetaResp.json();
    if (!meta?.ok || !meta?.result?.file_path) {
      throw new Error("Telegram getFile failed");
    }

    const fileResp = await fetchWithTimeout(`${base}/file/bot${botToken}/${meta.result.file_path}`, { method: "GET" }, timeoutMs);
    const arr = await fileResp.arrayBuffer();

    return {
      ...attachment,
      buffer: Buffer.from(arr),
      mimeType: attachment.mimeType || fileResp.headers.get("content-type") || undefined,
    };
  };
}

export function composeAttachmentResolvers(...resolvers) {
  const list = resolvers.filter((fn) => typeof fn === "function");
  return async function composed(attachment, ctx) {
    let current = attachment;
    for (const resolver of list) {
      // eslint-disable-next-line no-await-in-loop
      const next = await resolver(current, ctx);
      if (next) {
        current = next;
      }
      if (current?.buffer) {
        return current;
      }
    }
    return current;
  };
}
