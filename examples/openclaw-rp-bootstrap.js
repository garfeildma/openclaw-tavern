import Database from "better-sqlite3";
import {
  createRPPlugin,
  createOpenAICompatibleProviders,
  createHttpAttachmentResolver,
  createTelegramAttachmentResolver,
  composeAttachmentResolvers,
  createDiscordMessageHandler,
  createTelegramUpdateHandler,
} from "../src/index.js";

function createPlugin() {
  const db = new Database("./rp.sqlite");

  const providers = createOpenAICompatibleProviders({
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    ttsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
  });

  const resolvers = [createHttpAttachmentResolver()];
  if (process.env.TELEGRAM_BOT_TOKEN) {
    resolvers.push(
      createTelegramAttachmentResolver({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
      }),
    );
  }
  const attachmentResolver = composeAttachmentResolvers(...resolvers);

  return createRPPlugin({
    sqliteDb: db,
    ...providers,
    attachmentResolver,
    hookTimeoutMs: 10000,
  });
}

export function createHandlers({ discordSend, telegramSend }) {
  const plugin = createPlugin();

  const onDiscordEvent = createDiscordMessageHandler({
    plugin,
    send: discordSend,
  });

  const onTelegramUpdate = createTelegramUpdateHandler({
    plugin,
    send: telegramSend,
  });

  return {
    plugin,
    onDiscordEvent,
    onTelegramUpdate,
  };
}
