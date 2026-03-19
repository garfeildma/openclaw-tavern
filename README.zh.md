# OpenClaw RP Plugin（SillyTavern 兼容）

[English README](./README.md) | [中文架构文档](./docs/ARCHITECTURE.zh-CN.md) | [English Architecture](./docs/ARCHITECTURE.md)

OpenClaw RP Plugin 是一个面向角色扮演（RolePlay）的 OpenClaw 插件，重点兼容 SillyTavern 资产生态，并提供多模态能力与长记忆能力。

> 重点更新：基于 [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442) 的 Companion 设计，支持长期记忆驱动的主动关怀（主动消息、主动询问、行动汇报）。

## 适用人群

- 希望把 SillyTavern 角色卡/Preset/Lorebook 迁移到 OpenClaw 的用户
- 想在 Discord / Telegram / OpenClaw 原生消息链路中统一使用 RP 的用户
- 希望以命令方式快速管理会话与资产的用户

## 特性总览

### 1. SillyTavern 兼容导入

- 角色卡：支持 `PNG (tEXt/chara)` 与 `JSON`
- 角色卡版本：兼容 V1 / V2，并保留未映射字段
- Preset：兼容 ST JSON 预设字段映射
- Lorebook：兼容 ST World/Lorebook JSON
- 资产导入支持三种输入：
  - 直接附件
  - `--url`
  - `--file`
- OpenClaw 原生插件模式支持“先发文件，再执行 `/rp import-*`”

### 2. 会话管理与上下文控制

- 会话状态机：`active / paused / summarizing / ended`
- 每会话互斥锁（per-session mutex），避免并发串话
- `retry` / `retry --edit` 回退并重生最后一轮回复
- 自动摘要（超过阈值触发），降低上下文膨胀
- Prompt 预算裁剪：固定保留角色关键信息，优先保留近期对话

### 3. 长记忆（Long Memory）

- 对话轮次写入 embedding（可持久化到 SQLite）
- 查询时召回历史“相关记忆”，注入 Prompt 的 `Relevant Memory Recall`
- 默认内置多语言哈希 embedding（无需外部 embedding 服务也可运行）
- 可切换为外部 embedding provider（OpenAI / Gemini 等）

### 4. 多模态能力

- `/rp speak`：对最近一条角色回复进行语音合成（TTS）
- `/rp image`：基于角色上下文生成图像，可加 `--prompt` / `--style`
- `/rp agent-image`：查看或切换原生 agent 生图 provider / model / enabled
- 可选 agent tool：`rp_generate_image`，让 OpenClaw 自身 agent 在非 `/rp` 普通对话中也能生图并回传到 IM
- 多模态请求自带限流（默认 5 秒窗口）

### 5. OpenClaw 原生集成

- 注册命令：`/rp`
- Hook 集成：`message_received`、`before_prompt_build`、`llm_output`
- 自动继承 OpenClaw 全局模型配置，支持 OpenAI-compatible / Gemini provider
- SQLite 默认持久化会话、资产、摘要与记忆向量
- 全局模式下的会话隔离：RP 上下文基于 `conversationId` + `channelId` 联合键值隔离，防止跨会话消息串扰

### Companion 情感伙伴（Generative Agents 风格）[WIP]

- 采用“记忆流（Memory Stream）→ 反思（Reflection）→ 计划（Planning）”的角色行为设计
- 长期记忆直接复用 `rp_turn_embeddings` 召回结果，主动关怀会参考历史偏好与关键事件
- 提供 `/rp companion-nudge`：
  - 主动给用户发消息
  - 主动发起追问
  - 主动汇报角色当前行动（已记录了什么、下一步怎么跟进）
- 提供 `companion_tick` hook（可接你的定时器/自动化任务），在空闲阈值满足时自动触发主动关怀
- 默认不改变现有对话主链路，属于增量能力；关闭方式：`contextPolicy.companionEnabled = false`

## 快速安装（通过 OpenClaw 聊天界面）

说明：不同 OpenClaw 网关版本的安装入口名称可能不同（有的为插件管理按钮，有的为管理员命令）。下面给出最稳妥流程。

1. 打开 OpenClaw 管理员聊天窗口（或插件管理会话）。
2. 选择“安装插件 / Install from Git”入口，粘贴本仓库地址并安装。
   - 若你的网关是命令式安装，使用网关提示的安装命令（常见形态是 `/plugins install <repo-url>`）。
3. 安装后启用插件，确认插件 ID 为 `openclaw-rp-plugin`。
4. 在任意会话发送 `/rp help`，看到命令列表即代表安装成功。

## 3 分钟上手

### Step 1: 导入资产

```text
/rp import-card      （附角色卡文件）
/rp import-preset    （附 preset 文件）
/rp import-lorebook  （附 lorebook 文件，可选）
```

### Step 2: 启动会话

```text
/rp start --card <角色名或ID> --preset <预设名或ID> --lorebook <知识书名或ID>
```

### Step 3: 直接聊天

- 发送普通消息即可继续剧情
- 查看状态：`/rp session`
- 暂停/恢复：`/rp pause` / `/rp resume`
- 结束：`/rp end`

## 常用命令

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
- `/rp agent-image [--provider inherit|openai|gemini] [--model "..."] [--clear-model] [--enable|--disable]`
- `/rp companion-nudge [--reason "..."] [--idle-minutes N] [--mode balanced|checkin|question|report] [--force]`
- `/rp sync-agent-persona` — 将当前 RP 角色写入 Agent 的 `SOUL.md`
- `/rp restore-agent-persona` — 从 `SOUL.md` 移除 RP 角色预设，恢复原始人设
- `/rp pause` / `/rp resume` / `/rp end`

## Companion 快速示例

```text
# 立即触发一次主动关怀（主动消息 + 追问 + 行动汇报）
/rp companion-nudge --force --reason "晚间关心一下用户今天状态" --mode balanced

# 只在用户空闲超过 3 小时后触发
/rp companion-nudge --idle-minutes 180 --mode checkin
```

`companion_tick` hook 输入示例（用于定时任务/自动化触发）：

```json
{
  "session_id": "session_xxx",
  "user_id": "u1",
  "reason": "daily check-in",
  "mode": "balanced",
  "idle_minutes": 120
}
```

## 配置说明（部署者）

### 运行环境

- Node.js `>=20`
- 可选依赖：
  - `better-sqlite3`（SQLite 持久化）
  - `js-tiktoken`（cl100k token estimator）

### Provider 来源优先级

1. OpenClaw 全局 `api.config`
2. `~/.openclaw/openclaw-rp/provider.json`
3. 环境变量（如 `OPENCLAW_RP_*`, `OPENAI_*`, `GEMINI_*`）

### Agent 生图工具配置

在 OpenClaw 配置里为插件增加：

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

- `agentImage.enabled`：是否暴露 `rp_generate_image` tool
- `agentImage.provider`：`inherit` / `openai` / `gemini`
- `agentImage.imageModel`：单独覆盖 agent 生图模型，不影响 `/rp` 主对话模型

如果要让某个 OpenClaw agent 使用它，还需要把 `rp_generate_image` 加进 agent 的额外工具名单。在 OpenClaw `2026.3.x` 上，推荐配置为：

```json
{
  "tools": {
    "profile": "messaging",
    "alsoAllow": ["rp_generate_image"]
  }
}
```

该 tool 会返回 `MEDIA:...` 行，agent 在最终回复中保留这行即可把图片发回当前 IM 会话。

补充说明：

- 如果你使用 Grok 之类的 OpenAI-compatible 生图接口，`agentImage.provider` 应设为 `openai`
- 如果你使用 Google Gemini 生图接口，`agentImage.provider` 应设为 `gemini`
- 对 OpenAI-compatible 网关，`agentImage.imageModel` 必须与 `/v1/models` 返回的模型 `id` 完全一致；例如这次网关实际提供的是 `grok-imagine-1.0`，不是 `grok/grok-imagine-1.0`
- 修改 tool 配置或插件 schema 后，已有旧 session 可能拿不到最新工具列表；先发一次 `/new` 再测试

也可以直接用命令在 OpenClaw 原生模式下切换：

```bash
/rp agent-image
/rp agent-image --provider openai --model grok-imagine-1.0
/rp agent-image --provider gemini --model gemini-3.1-flash-image-preview
/rp agent-image --clear-model
/rp agent-image --disable
/rp agent-image --enable
```

这个命令会更新 `plugins.entries.openclaw-rp-plugin.config.agentImage`，并立即刷新当前网关进程内的 agent 生图配置，不需要重启。

### 语言 / 国际化（i18n）

插件所有面向用户的提示语支持中文（`zh`）和英文（`en`）切换，包括会话状态提示、人设同步消息、帮助文本等。

语言解析优先级：

1. 环境变量 `OPENCLAW_RP_LOCALE`（如 `en` 或 `zh`）
2. `~/.openclaw/openclaw-rp/provider.json` 中的 `locale` 字段
3. `~/.openclaw/openclaw.json` 中的 `locale` 字段
4. 系统 `LANG` 环境变量（如 `zh_CN.UTF-8` → `zh`）
5. 默认：`zh`

示例 — 切换为英文：

```bash
export OPENCLAW_RP_LOCALE=en
```

或在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "locale": "en"
}
```

## Roadmap

- [] 作为长期情感伴侣，学会主动关心 <Generative Agents: Interactive Simulacra of Human Behavior>

## 开发与测试

```bash
npm test
npm run smoke
```

主要代码入口：

- `src/openclaw/register.js`（OpenClaw 原生注册）
- `src/plugin.js`（插件入口与 hooks）
- `src/core/sessionManager.js`（会话、摘要、长记忆）
- `src/core/commandRouter.js`（`/rp` 命令路由）
- `src/core/promptBuilder.js`（Prompt 组装与预算）
- `src/store/sqliteStore.js`（SQLite 持久化）
