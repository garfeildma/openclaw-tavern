---
name: OpenClaw RP Plugin
description: SillyTavern-compatible roleplay plugin with character cards, long memory, multimodal output (TTS/image), and Generative-Agents-style companion.
version: 0.1.0
homepage: https://github.com/garfeildma/openclaw-tavern
user-invocable: true
metadata: {"requires":{"env":["OPENCLAW_RP_LOCALE"],"bins":[],"install":[{"cmd":"npm install","when":"after-clone"}]}}
---

# OpenClaw RP Plugin

A full-featured roleplay (RP) extension for OpenClaw with first-class **SillyTavern** asset compatibility, multimodal abilities, long-term memory, and a Generative-Agents-style Companion system.

## What This Skill Does

When installed, this plugin registers the `/rp` slash command namespace and three OpenClaw hooks (`message_received`, `before_prompt_build`, `llm_output`) to provide an immersive, persistent roleplay experience across Discord, Telegram, and OpenClaw native chat.

### Core Capabilities

1. **SillyTavern-Compatible Asset Import** — Import character cards (PNG tEXt/chara or JSON, V1/V2), presets, and lorebooks directly from SillyTavern format.
2. **Session Lifecycle** — Full state machine (`active → paused → summarizing → ended`) with per-session mutex, auto-summarization, and prompt budget trimming.
3. **Long Memory** — Turn-level embedding with SQLite persistence; retrieves relevant historical turns into `Relevant Memory Recall`. Built-in multilingual hashed embedder works out of the box without external APIs.
4. **Multimodal Output** — `/rp speak` (TTS), `/rp image` (image generation with style hints), and an optional `rp_generate_image` agent tool for native-agent use.
5. **Companion (Generative Agents Style)** — Memory Stream → Reflection → Planning loop for proactive outreach, follow-up questions, and action reporting via `/rp companion-nudge` and the `companion_tick` hook.

## Installation

### Via ClawHub CLI

```bash
clawhub install openclaw-rp-plugin
```

### Via OpenClaw Chat UI

1. Open your OpenClaw admin chat or plugin management session.
2. Use **Install Plugin / Install from Git** and paste: `https://github.com/garfeildma/openclaw-tavern`
3. Enable the plugin; verify ID `openclaw-rp-plugin`.
4. Send `/rp help` — if the command list appears, installation is complete.

### Post-Install Dependencies

The plugin has two optional peer dependencies for enhanced functionality:

- `better-sqlite3` (≥9.0) — enables SQLite persistence for sessions, assets, summaries, and memory vectors. Without it, data is stored in memory only.
- `js-tiktoken` (≥1.0) — enables accurate cl100k token counting. Falls back to heuristic estimation without it.

Install them in your OpenClaw workspace if needed:

```bash
npm install better-sqlite3 js-tiktoken
```

## Quick Start (3 Minutes)

### Step 1 — Import Assets

```
/rp import-card      (attach a character card file)
/rp import-preset    (attach a preset file)
/rp import-lorebook  (attach a lorebook file, optional)
```

### Step 2 — Start a Session

```
/rp start --card <card_name_or_id> --preset <preset_name_or_id> --lorebook <lorebook_name_or_id>
```

### Step 3 — Chat

Send plain messages to continue the story. The plugin intercepts dialogue automatically through the registered hooks.

- Check status: `/rp session`
- Pause / resume: `/rp pause` / `/rp resume`
- Regenerate: `/rp retry [--edit "..."]`
- End: `/rp end`

## Commands Reference

| Command | Description |
|---------|-------------|
| `/rp help` | Show full command list |
| `/rp import-card` | Import a SillyTavern character card (PNG or JSON) |
| `/rp import-preset` | Import a SillyTavern preset |
| `/rp import-lorebook` | Import a SillyTavern lorebook / world |
| `/rp list-assets` | List imported assets (`--type`, `--search`, `--page`) |
| `/rp show-asset <id>` | Show asset details |
| `/rp delete-asset <id> --confirm` | Delete an asset |
| `/rp start` | Start a new RP session |
| `/rp session` | Show current session status |
| `/rp retry [--edit "..."]` | Regenerate last reply, optionally with edited user turn |
| `/rp speak` | TTS of last assistant reply |
| `/rp image [--prompt] [--style]` | Image generation from RP context |
| `/rp agent-image` | Manage agent image tool settings |
| `/rp companion-nudge` | Trigger proactive companion outreach |
| `/rp sync-agent-persona` | Write current RP character into Agent SOUL.md |
| `/rp restore-agent-persona` | Remove RP character from SOUL.md, restore original |
| `/rp pause` / `/rp resume` / `/rp end` | Session lifecycle control |

## Companion (Generative Agents)

Trigger a proactive companion interaction:

```
/rp companion-nudge --force --reason "evening emotional check-in" --mode balanced
/rp companion-nudge --idle-minutes 180 --mode checkin
```

Modes: `balanced`, `checkin`, `question`, `report`.

The `companion_tick` hook can be wired to a scheduler for automatic proactive check-ins.

## Configuration

### Provider Resolution Priority

1. OpenClaw global `api.config`
2. `~/.openclaw/openclaw-rp/provider.json`
3. Environment variables (`OPENCLAW_RP_LOCALE`, `OPENAI_*`, `GEMINI_*`)

### Agent Image Tool

Add to your OpenClaw config to expose `rp_generate_image` as an agent tool:

```json
{
  "plugins": {
    "entries": {
      "openclaw-rp-plugin": {
        "config": {
          "agentImage": {
            "enabled": true,
            "provider": "openai",
            "imageModel": "gpt-image-1"
          }
        }
      }
    }
  }
}
```

Then allow the tool in your agent config:

```json
{
  "tools": {
    "profile": "messaging",
    "alsoAllow": ["rp_generate_image"]
  }
}
```

### Locale / i18n

Supports Chinese (`zh`) and English (`en`). Resolution priority:
`OPENCLAW_RP_LOCALE` → `provider.json` locale → `openclaw.json` locale → system `LANG` → default `zh`.

```bash
export OPENCLAW_RP_LOCALE=en
```

## Runtime Requirements

- Node.js ≥ 20
- OpenClaw 2026.x
- Optional: `better-sqlite3`, `js-tiktoken`, `ffmpeg` (for PCM→MP3 transcoding)

## Architecture

Key entry points:

- `src/openclaw/register.js` — Native OpenClaw extension registration (hooks & commands)
- `src/plugin.js` — Plugin entry, hook wiring
- `src/core/sessionManager.js` — Session lifecycle, summaries, long memory
- `src/core/commandRouter.js` — `/rp` command routing
- `src/core/promptBuilder.js` — Prompt assembly and budget management
- `src/store/sqliteStore.js` — SQLite persistence layer
