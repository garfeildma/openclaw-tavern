# Changelog

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
