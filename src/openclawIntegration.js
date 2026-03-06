import {
  normalizeDiscordMessage,
  normalizeTelegramMessage,
  toDiscordSendPayload,
  toTelegramSendPayload,
} from "./channels/adapters.js";

async function runMessageHook(plugin, normalizedCtx) {
  if (!plugin?.hooks?.message_received) {
    throw new Error("Plugin does not expose hooks.message_received");
  }
  return plugin.hooks.message_received(normalizedCtx);
}

export function createDiscordMessageHandler({ plugin, send }) {
  if (typeof send !== "function") {
    throw new Error("createDiscordMessageHandler requires send(payload, event)");
  }

  return async function handleDiscordEvent(event) {
    const ctx = normalizeDiscordMessage(event);
    const result = await runMessageHook(plugin, ctx);
    if (!result?.handled) {
      return { handled: false };
    }

    const payload = toDiscordSendPayload(result.response);
    if (payload) {
      await send(payload, event);
    }

    return {
      handled: true,
      response: result.response,
      payload,
    };
  };
}

export function createTelegramUpdateHandler({ plugin, send }) {
  if (typeof send !== "function") {
    throw new Error("createTelegramUpdateHandler requires send(method, payload, update)");
  }

  return async function handleTelegramUpdate(update) {
    const ctx = normalizeTelegramMessage(update);
    const result = await runMessageHook(plugin, ctx);
    if (!result?.handled) {
      return { handled: false };
    }

    const out = toTelegramSendPayload(result.response);
    if (out) {
      await send(out.method, out.payload, update);
    }

    return {
      handled: true,
      response: result.response,
      payload: out,
    };
  };
}
