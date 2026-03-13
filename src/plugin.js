import { asRPError } from "./errors.js";
import { CommandRouter } from "./core/commandRouter.js";
import { SessionManager } from "./core/sessionManager.js";
import { InMemoryStore } from "./store/inMemoryStore.js";
import { SqliteStore } from "./store/sqliteStore.js";
import { normalizeMessageContext } from "./utils/sessionKey.js";
import { resolveContextAttachments } from "./utils/attachments.js";
import { runWithTimeout } from "./utils/timeout.js";

export function createRPPlugin(options = {}) {
  const hookTimeoutMs = Number(options.hookTimeoutMs || 10000);
  const store = resolveStore(options);
  const sessionManager = new SessionManager({
    store,
    modelProvider: options.modelProvider,
    embeddingProvider: options.embeddingProvider,
    logger: options.logger,
    contextPolicy: options.contextPolicy,
    tokenEstimator: options.tokenEstimator,
    summaryRetryConfig: options.summaryRetryConfig,
  });
  const router = new CommandRouter({
    store,
    sessionManager,
    modelProvider: options.modelProvider,
    ttsProvider: options.ttsProvider,
    imageProvider: options.imageProvider,
    rateLimiter: options.rateLimiter,
    getAgentImageConfig: options.getAgentImageConfig,
    updateAgentImageConfig: options.updateAgentImageConfig,
  });

  return {
    name: "openclaw-rp-plugin",
    hooks: {
      async message_received(ctx) {
        try {
          const normalized = normalizeMessageContext(ctx);
          const hydrated = await runWithTimeout(
            () => resolveContextAttachments(normalized, options.attachmentResolver),
            hookTimeoutMs,
            "RP message_received attachment resolution timeout",
          );
          const response = await runWithTimeout(
            () => router.handleMessage(hydrated),
            hookTimeoutMs,
            "RP message_received timeout",
          );
          if (!response) {
            return { handled: false };
          }
          return { handled: true, response };
        } catch (err) {
          const rpErr = asRPError(err);
          return { handled: true, response: rpErr.toResponse() };
        }
      },

      async before_prompt_build(ctx) {
        try {
          const result = await runWithTimeout(
            async () => {
              const sessionId = ctx?.session_id || ctx?.sessionId;
              if (!sessionId) {
                return ctx;
              }
              const prepared = await sessionManager.preparePromptForSession(sessionId);
              return {
                messages: prepared.prompt.messages,
                token_count: prepared.prompt.tokenCount,
              };
            },
            hookTimeoutMs,
            "RP before_prompt_build timeout",
          );
          return result;
        } catch (err) {
          const rpErr = asRPError(err);
          return {
            messages: [],
            token_count: 0,
            error: rpErr.toResponse(),
          };
        }
      },

      async before_model_resolve(ctx) {
        try {
          const result = await runWithTimeout(
            async () => {
              const sessionId = ctx?.session_id || ctx?.sessionId;
              let preset = ctx?.preset;
              if (!preset && sessionId) {
                const bundle = sessionManager.store.getSessionAssetBundle(sessionId);
                preset = bundle?.preset;
              }
              return sessionManager.resolveModelConfig({
                preset,
                extraParams: ctx?.extra_params || ctx?.extraParams,
                commandOverrides: ctx?.command_overrides || ctx?.commandOverrides,
              });
            },
            hookTimeoutMs,
            "RP before_model_resolve timeout",
          );
          return result;
        } catch (err) {
          const rpErr = asRPError(err);
          return {
            error: rpErr.toResponse(),
          };
        }
      },

      async companion_tick(ctx) {
        try {
          const response = await runWithTimeout(
            () => router.handleCompanionTick(ctx || {}),
            hookTimeoutMs,
            "RP companion_tick timeout",
          );
          if (!response) {
            return { handled: false };
          }
          return { handled: true, response };
        } catch (err) {
          const rpErr = asRPError(err);
          return { handled: true, response: rpErr.toResponse() };
        }
      },
    },
    services: {
      store,
      sessionManager,
      router,
    },
  };
}

function resolveStore(options) {
  if (options.store) {
    return options.store;
  }

  if (options.sqliteDb) {
    const sqliteStore = new SqliteStore(options.sqliteDb, {
      vector: options.vectorSearch,
    });
    sqliteStore.migrate();
    return sqliteStore;
  }

  return new InMemoryStore();
}
