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
- 多模态请求自带限流（默认 5 秒窗口）

### 5. OpenClaw 原生集成

- 注册命令：`/rp`
- Hook 集成：`message_received`、`before_prompt_build`、`llm_output`
- 自动继承 OpenClaw 全局模型配置，支持 OpenAI-compatible / Gemini provider
- SQLite 默认持久化会话、资产、摘要与记忆向量

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
- `/rp companion-nudge [--reason "..."] [--idle-minutes N] [--mode balanced|checkin|question|report] [--force]`
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
