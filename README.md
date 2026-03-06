# OpenClaw RP Plugin (SillyTavern Compatible)

[中文 README](./README.zh.md) | [中文 Architecture](./docs/ARCHITECTURE.zh-CN.md) | [English Architecture](./docs/ARCHITECTURE.md)

OpenClaw RP Plugin is a roleplay-focused OpenClaw plugin with first-class SillyTavern asset compatibility, multimodal output, and long-memory support.

> Featured update: a Companion design inspired by [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442), enabling long-memory-driven proactive outreach, proactive questioning, and action reporting.

## Who This Is For

- Users migrating cards/presets/lorebooks from SillyTavern to OpenClaw
- Users running RP across Discord, Telegram, and OpenClaw native message flow
- Users who prefer command-driven session and asset management

## Feature Highlights

### 1. SillyTavern-Compatible Imports

- Character cards: `PNG (tEXt/chara)` and `JSON`
- Card versions: V1 and V2 supported, with unmapped fields preserved
- Preset import: SillyTavern JSON mapping
- Lorebook import: ST world/lorebook JSON mapping
- Import inputs:
  - Direct attachment
  - `--url`
  - `--file`
- In OpenClaw native mode, users can send file first, then run `/rp import-*`

### 2. Session Lifecycle and Context Control

- Session states: `active / paused / summarizing / ended`
- Per-session mutex to prevent race conditions
- `retry` / `retry --edit` to regenerate last assistant turn
- Auto-summarization when context exceeds threshold
- Prompt budgeting with deterministic truncation priority

### 3. Long Memory

- Turn-level embedding storage (persisted in SQLite when enabled)
- Retrieval of relevant historical turns into `Relevant Memory Recall`
- Built-in multilingual hashed embedding (works without external embedding API)
- Pluggable external embedding providers (OpenAI / Gemini, etc.)

### 4. Multimodal

- `/rp speak`: TTS from latest assistant reply
- `/rp image`: image generation from role context, supports `--prompt` / `--style`
- Built-in multimodal rate limit (default 5s window)

### 5. Native OpenClaw Integration

- Command registration: `/rp`
- Hook integration: `message_received`, `before_prompt_build`, `llm_output`
- Inherits OpenClaw global model config when available
- Supports OpenAI-compatible and Gemini provider stacks
- SQLite persistence for assets, sessions, summaries, and memory vectors

### ⭐ Focus: Companion Agent (Generative Agents Style) [WIP]

- Uses a lightweight `Memory Stream -> Reflection -> Planning` behavior loop
- Reuses `rp_turn_embeddings` retrieval to personalize proactive outreach from long-term memory
- Adds `/rp companion-nudge` for:
  - proactive messages to the user
  - proactive follow-up questions
  - explicit action reports on what the character tracked and will follow up on
- Adds `companion_tick` hook for scheduler/automation-driven proactive check-ins
- Keeps existing dialogue flow unchanged by default (incremental feature); can be disabled via `contextPolicy.companionEnabled = false`

## Beginner Install (OpenClaw Chat UI)

Note: install entry names vary by gateway version (plugin manager button vs admin command). Use this version-safe flow:

1. Open your OpenClaw admin chat (or plugin management chat).
2. Use "Install Plugin / Install from Git" and paste this repo URL.
   - If your gateway uses command-style install, use the command shown by your gateway (a common pattern is `/plugins install <repo-url>`).
3. Enable the plugin and verify ID `openclaw-rp-plugin`.
4. Send `/rp help` in chat. If command list appears, installation is complete.

## 3-Min Quick Start

### Step 1: Import Assets

```text
/rp import-card      (attach a card file)
/rp import-preset    (attach a preset file)
/rp import-lorebook  (attach a lorebook file, optional)
```

### Step 2: Start Session

```text
/rp start --card <card_name_or_id> --preset <preset_name_or_id> --lorebook <lorebook_name_or_id>
```

### Step 3: Chat Normally

- Send plain messages to continue the story
- Check status: `/rp session`
- Pause/resume: `/rp pause` / `/rp resume`
- End: `/rp end`

## Common Commands

- `/rp help`
- `/rp import-card` / `/rp import-preset` / `/rp import-lorebook`
- `/rp list-assets [--type card|preset|lorebook] [--search "..."] [--page N]`
- `/rp show-asset <name_or_id>`
- `/rp delete-asset <id> --confirm`
- `/rp start --card ... [--preset ...] [--lorebook ...]`
- `/rp session`
- `/rp retry [--edit "..."]`
- `/rp speak`
- `/rp image [--prompt "..."] [--style "..."]`
- `/rp companion-nudge [--reason "..."] [--idle-minutes N] [--mode balanced|checkin|question|report] [--force]`
- `/rp pause` / `/rp resume` / `/rp end`

## Companion Quick Examples

```text
# Trigger proactive companion output now (message + question + action report)
/rp companion-nudge --force --reason "evening emotional check-in" --mode balanced

# Trigger only when user has been idle for 3 hours
/rp companion-nudge --idle-minutes 180 --mode checkin
```

`companion_tick` hook input example (for scheduler/automation):

```json
{
  "session_id": "session_xxx",
  "user_id": "u1",
  "reason": "daily check-in",
  "mode": "balanced",
  "idle_minutes": 120
}
```

## Configuration (for operators)

### Runtime Requirements

- Node.js `>=20`
- Optional dependencies:
  - `better-sqlite3` (SQLite persistence)
  - `js-tiktoken` (cl100k token estimator)

### Provider Resolution Priority

1. OpenClaw global `api.config`
2. `~/.openclaw/openclaw-rp/provider.json`
3. Environment variables (`OPENCLAW_RP_*`, `OPENAI_*`, `GEMINI_*`)

## Roadmap

- As a long-term emotional companion, learn to proactively care <Generative Agents: Interactive Simulacra of Human Behavior>

## Development & Testing

```bash
npm test
npm run smoke
```

Key entry points:

- `src/openclaw/register.js` (native OpenClaw registration)
- `src/plugin.js` (plugin entry and hooks)
- `src/core/sessionManager.js` (session, summary, long memory)
- `src/core/commandRouter.js` (`/rp` command router)
- `src/core/promptBuilder.js` (prompt assembly and budget)
- `src/store/sqliteStore.js` (SQLite persistence)
