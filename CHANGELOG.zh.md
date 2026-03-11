# Changelog

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
