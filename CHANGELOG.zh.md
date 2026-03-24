# Changelog

## 2026-03-24

### Added
- 新增 `/rp video` 命令，基于角色上下文生成 AI 视频，支持 `--prompt` 和 `--style` 选项。
- 新增 Telegram 自动视频跟进：当用户消息表达出视频意图时，插件在正常文字回复后自动补发短视频。
- 新增 `before_message_write` hook，在 RP 活跃期间返回 `{ block: true }` 完全隔离 RP 会话与主 OpenClaw 对话——RP 消息仅存储在插件自有的 SQLite 数据库中，主 agent 上下文保持完全干净。
- 新增会话结束后 context break 注入：`/rp end` 后通过 `before_prompt_build` 注入系统指令，强制 LLM 退出角色并恢复原始人设。
- 新增 `recentlyEndedRpChannels` 跟踪机制，确保即使 rpContext 已被清理，后续消息仍能注入 context break。

### Improved
- 为 `autoImage.js` 中所有自动媒体占位符/成功/失败提示语新增 i18n 支持（图片、语音、视频）。
- `findRpContext` 新增回退策略：当 `before_prompt_build` 的 ctx 中 `conversationId` 为空时，从 `ctx.sessionKey` 中提取候选 ID 进行匹配。

### Fixed
- 修复 `before_prompt_build` hook 因 ctx 中 `conversationId` 为空导致找不到 RP 上下文的问题，该问题导致角色 prompt 从未被注入。
- 修复 `/rp end` 后角色人设泄漏到正常对话的问题，原因是主 OpenClaw 对话历史中仍保留了 RP 消息。

## 2026-03-19

### Improved
- 新增国际化（i18n）支持，插件所有面向用户的提示语现在支持中文（`zh`）和英文（`en`）切换。
- 语言解析优先级：环境变量 `OPENCLAW_RP_LOCALE` → `~/.openclaw/openclaw-rp/provider.json` 中的 `locale` 字段 → `~/.openclaw/openclaw.json` 中的 `locale` 字段 → 系统 `LANG` 环境变量 → 默认 `zh`。
- 新增 `src/openclaw/i18n.js` 模块，统一管理所有可翻译字符串，通过 `t(key)` 函数访问。
- 新增 `/rp restore-agent-persona` 命令，可从 `SOUL.md` 中移除 RP 角色预设块，恢复 Agent 原始人设。

### Fixed
- 修复插件在全局模式下的会话隔离问题：RP 上下文现在同时基于 `conversationId` 和 `channelId` 进行键值隔离，防止不同会话之间的消息串扰（如一个 RP 会话的回复错误出现在另一个会话中）。
- 移除 `resolveActiveSessionForPending` 中无条件回退到同 channel type 最新活跃会话的逻辑，该逻辑是跨会话消息泄漏的根本原因。

## 2026-03-13

### Improved
- 新增可选 agent tool `rp_generate_image`，让 OpenClaw 原生 agent 在非 `/rp` 普通对话中也能调用插件的生图 provider，并通过 `MEDIA:` 回传图片到当前 IM 会话。
- 新增插件配置 `agentImage.enabled / provider / imageModel`，可单独指定 agent 生图所使用的 provider 与模型，不影响 `/rp` 对话主模型。
- image provider 现在支持按调用覆盖 `imageModel`，便于在同一 provider 栈下为不同能力分配不同生图模型。

## 2026-03-11

### Improved
- 为 OpenClaw 原生 RP 的 Telegram 会话新增自动媒体补发能力：当用户消息表达出“想看照片”或“想听语音”的意思时，插件会在正常文字回复完成后自动补发图片或语音。
- 新增 `/rp sync-agent-persona` 命令，可手动将当前 RP 角色写入 OpenClaw agent 的 `SOUL.md` 受管区块。
- 补充测试，覆盖图片/语音意图识别、Telegram 自动媒体投递，以及手动同步 Agent 人设等场景。

## 2026-03-06

### Fixed
- 修复 OpenClaw 原生 RP 对话链路中 assistant turn 未正确落库的问题。
- 修复 `/rp speak` 和 `/rp image` 在部分会话中错误读取 `first_message` 或旧回复的问题。
- 修复 `llm_output` 阶段对 RP 上下文的关联方式，改为基于 OpenClaw 稳定传递的 `sessionKey` 追踪上下文，而不再错误依赖 `channelId` / 非 RP `sessionId`。
- 修复 `llm_output` 在未拿到有效 assistant 文本时过早消费上下文，导致后续真实回复丢失的问题。

### Improved
- 优化 `/rp speak` 的 TTS 文本提取逻辑，默认只合成角色对白，不再直接朗读整段旁白/动作描述。
- 新增对白抽取规则：优先提取 `“...”`、`"..."`、`「...」`、`『...』` 中的台词。
- 在无引号对白时，对 TTS 输入做保守降噪，去除常见动作标记与简短旁白（如 `*...*`、`_..._`、括号说明），保留可朗读台词。
- 补充相关测试，覆盖 RP hook 上下文关联与 TTS 文本清洗场景。
