# Changelog

## 2026-03-24

### Added
- Added `/rp video` command for AI video generation from character context, supporting `--prompt` and `--style` options.
- Added automatic video follow-up in Telegram: when a user message implies video intent, the plugin auto-generates a short video after the normal assistant response.
- Added `before_message_write` hook with `{ block: true }` to fully isolate RP sessions from the main OpenClaw conversation — RP messages are only stored in the plugin's own SQLite database, keeping the main agent context completely clean.
- Added post-session context break injection: after `/rp end`, a system instruction is injected via `before_prompt_build` to force the LLM to drop the RP character and revert to its original persona.
- Added `recentlyEndedRpChannels` tracking to ensure the context break is injected even when rpContext maps are already cleaned up by the time the next message arrives.

### Improved
- Added i18n support for all auto-media placeholder/success/failure messages (image, voice, video) in `autoImage.js`.
- Added `findRpContext` fallback: when `before_prompt_build` ctx has no `conversationId`, the function now extracts candidate IDs from `ctx.sessionKey` to match stored RP contexts.

### Fixed
- Fixed `before_prompt_build` hook not finding RP context due to `conversationId` being empty in the hook ctx, causing the RP character prompt to never be injected.
- Fixed RP character persona leaking into normal conversations after `/rp end` because the main OpenClaw conversation history retained RP messages.

## 2026-03-19

### Added
- Added `SKILL.md` for ClawHub marketplace publishing, following the standard YAML frontmatter + markdown body format.
- Added ClawHub metadata to `openclaw.plugin.json` (author, homepage, license, tags, slug, category).
- Added npm registry metadata to `package.json` (description, author, license, repository, keywords).
- Added `clawhub:publish` convenience script for one-command publishing.

### Improved
- Added internationalization (i18n) support for all user-facing messages in the RP plugin. Supported locales: Chinese (`zh`) and English (`en`).
- Locale resolution priority: `OPENCLAW_RP_LOCALE` env var → `locale` field in `~/.openclaw/openclaw-rp/provider.json` → `locale` field in `~/.openclaw/openclaw.json` → system `LANG` env var → default `zh`.
- New module `src/openclaw/i18n.js` centralizes all translatable strings with `t(key)` accessor function.
- Added `/rp restore-agent-persona` command to remove the RP character preset block from `SOUL.md`, restoring the agent's original persona.

### Fixed
- Fixed session isolation when the plugin runs in global mode: RP context now keys on `conversationId` in addition to `channelId`, preventing cross-conversation message leakage where replies from one RP session leaked into another.
- Removed the unconditional fallback to the latest active session in `resolveActiveSessionForPending`, which was the root cause of cross-conversation pollution.

## 2026-03-13

### Improved
- Added the optional `rp_generate_image` agent tool so native OpenClaw agents can generate images in normal non-`/rp` chats and return them to the current IM conversation through a `MEDIA:` line.
- Added plugin config `agentImage.enabled / provider / imageModel` so operators can choose a dedicated provider and image model for agent-side generation without changing the `/rp` dialogue model.
- Image providers now support per-call `imageModel` overrides, making it possible to split image workloads across different models within the same provider stack.

## 2026-03-11

### Improved
- Added automatic Telegram media follow-ups for native RP sessions: when a user message implies "show me" or "let me hear your voice", the plugin can now auto-generate an image or voice reply after the normal assistant response.
- Added `/rp sync-agent-persona` to manually write the current RP character into the OpenClaw agent `SOUL.md` managed block.
- Added tests covering image and voice intent detection, Telegram auto media delivery, and manual agent persona synchronization.

## 2026-03-06

### Fixed
- Fixed an issue where assistant turns were not persisted correctly in the native OpenClaw RP dialogue flow.
- Fixed `/rp speak` and `/rp image` reading `first_message` or stale replies in some sessions instead of the latest role reply.
- Fixed RP context association during `llm_output` by tracking context with OpenClaw's stable `sessionKey` instead of incorrectly relying on `channelId` or a non-RP `sessionId`.
- Fixed premature RP context consumption when no valid assistant text was available, which could cause the real follow-up reply to be dropped.

### Improved
- Improved `/rp speak` TTS preprocessing so it synthesizes character dialogue by default instead of reading full narration or action text.
- Added dialogue extraction rules that prefer quoted speech from `“...”`, `"..."`, `「...」`, and `『...』`.
- Added a conservative fallback cleanup path for unquoted replies, stripping common action markers and short narration fragments such as `*...*`, `_..._`, and parenthetical asides while preserving speakable dialogue.
- Added tests covering RP hook context association and TTS text-cleaning behavior.
