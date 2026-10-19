---
description: "Gemini 子智能体：把 Google Gemini CLI 作为 DeepSeek Harness 的一次性编码子智能体（subagent_gemini 委派工具）。"
kind: "package-bundle"
---

# dsh-subagent-gemini

[English](README.md) | 中文

给 DeepSeek Harness（DSH）加一个 **Gemini 子智能体**：父会话里的模型可以调用 `subagent_gemini`，
在**独立进程**里起一个 Google 官方 Gemini CLI 编码智能体，在父会话的工作目录里自主改文件、跑命令，
只把最终答案带回父会话。

形态和官方的 Codex 子智能体（`subagent_codex`）、社区的 Cursor 子智能体（`cursor_code`）一致：

- **独立进程、独立会话**：每次委派都 spawn 一个全新的 `gemini --acp` 进程，互不干扰；
- **只回最终答案**：子会话的思考、工具调用、stderr 都不会污染父会话上下文；
- **一次一个任务**：不支持追加输入或续聊（需要续聊请用原生 `subagent` / `fork`）；
- **安全诊断**：失败只返回固定的阶段/类别信息，不泄露 stderr、路径或凭据。

> 这是一个社区插件，与 Google 无关。Gemini CLI 是 Google 的官方 CLI，本插件只负责在 DSH 里安全地驱动它。

## 工作原理

```
父会话（DeepSeek 模型）
   │  调用工具 subagent_gemini({ description, prompt })
   ▼
DSH subagent seam (ctx.subagents)
   │  provider: gemini（本插件注册）
   ▼
官方 ACP 子智能体后端 @deepseek-ai/dsh-subagent-acp
   │  spawn、ACP 握手、权限自动应答、进程树清理、安全诊断
   ▼
gemini --acp --skip-trust  （独立进程，父会话 cwd）
   │  使用 Gemini CLI 自己的工具（读写文件 / shell / 搜索 / MCP …）
   ▼
最终答案 → 回到父会话
```

本插件负责 Gemini 专属的部分：**定位 gemini 可执行文件**、**校验/规范化配置**、**在加载时检测凭据并给出可操作的提示**；
进程生命周期与 ACP 协议由 DSH 官方后端负责，这样升级 DSH 时无需跟着重写协议层。

## 环境要求

| 依赖 | 版本 / 说明 |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` 或同系列（提供 `ctx.subagents` 与 ACP 子智能体后端） |
| Node.js | `^22.19.0` 或 `>=24` |
| Google Gemini CLI | 需要支持 `--acp`（`0.60+`，建议最新版） |
| Gemini 凭据 | Gemini Developer API key（推荐），或 Vertex AI / Code Assist 变量 |

安装 Gemini CLI：

```bash
npm install -g @google/gemini-cli     # 官方 npm 包
gemini --version                      # 只需要能打印版本即可
```

## 安装插件

**方式一：DSH 插件市场（推荐）** —— 在 DSH 的插件页搜索 `dsh-subagent-gemini` 安装并启用。

**方式二：命令行**

```bash
dsh plugin --profile desktop add dsh-subagent-gemini
```

然后把包名加进该 profile 的 `package.json` → `dsh.profile.bundles` 数组，重启或让 profile 重新组合：

```json
"dsh": {
  "profile": {
    "bundles": ["…", "dsh-subagent-gemini"]
  }
}
```

启用后，所有智能体都会看到全局工具 `subagent_gemini`（正在运行的会话在下一次请求时生效）。

## 配置凭据（重要）

Gemini CLI 需要它自己的凭据。**Google 账号浏览器登录（OAuth）已经不能用了**：
Google 下线了面向个人的 Gemini Code Assist OAuth 客户端，`gemini` 会报
*"This client is no longer supported for Gemini Code Assist for individuals"*。
现在请使用 **API key**：

1. 打开 <https://aistudio.google.com/apikey> 创建 API key；
2. 写到 Gemini CLI 自己的配置文件里（不用改本插件配置）：

```bash
printf 'GEMINI_API_KEY=你的key\n' > ~/.gemini/.env
chmod 600 ~/.gemini/.env
```

Gemini CLI 会自动加载 `~/.gemini/.env`。也可以改用环境变量：

- `GEMINI_API_KEY` —— Gemini Developer API；
- `GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_API_KEY` —— Vertex AI；
- `GOOGLE_GENAI_USE_GCA=true` —— Google Code Assist 授权。

需要把变量显式传给子进程时，用插件的 `env` 配置（见下表）。插件**不会**读取、记录或回传密钥内容。

## 使用

模型会像使用其他子智能体一样调用：

```json
{
  "name": "subagent_gemini",
  "arguments": {
    "description": "修复登录超时",
    "prompt": "在工作区里找到登录请求的超时配置，把它从 5s 调到 15s，跑相关测试，只回复你改了什么和测试结果。"
  }
}
```

- `description`：3–5 个词的任务名，显示在子智能体列表里；
- `prompt`：**自包含**的任务说明 —— 子智能体看不到父会话的上下文，文件路径、约束、验收标准都要写清楚。

完成后父会话会收到一条完成通知，包含 Gemini 的最终答案或安全失败诊断。子智能体的工具调用、
思考过程不会进入父会话。

## 配置项

在 profile patch 中覆盖 `subagent-gemini` 条目的 `config`：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `providerName` | `gemini` | 注册到 `ctx.subagents` 的名字；同一 profile 内必须唯一 |
| `command` | 空（自动查找） | `gemini` 可执行文件路径；留空则按 `PATH` → `~/.local/bin` → `/opt/homebrew/bin` → `/usr/local/bin` 等顺序查找 |
| `args` | `['--acp', '--skip-trust']` | 传给 CLI 的参数；`--acp` 总会保留，`--skip-trust` 默认存在 |
| `model` | 空（CLI 默认） | 固定模型，例如 `gemini-2.5-flash`；会转换成一个 `--model` 参数 |
| `permission` | `allow` | 子智能体权限请求的自动应答：`allow` 自动批准（可改文件/跑命令），`reject` 全部拒绝（只读） |
| `env` | `{}` | 追加给子进程的环境变量（在凭据清洗后的父环境之上） |
| `disposeEofGraceMs` | `6000` | stdin EOF 后等待子进程自行退出的时间 |
| `disposeGraceMs` | `3000` | 失败观测与 SIGTERM→SIGKILL 的升级宽限 |

示例：固定模型并改用只读权限

```yaml
- id: subagent-gemini
  config:
    model: gemini-2.5-flash
    permission: reject
```

## 安全与权限

- `permission: allow` 意味着**无人值守**：子智能体可以修改工作区文件、执行命令，不会弹出人工审批。
  这是委派编码任务的前提；请只在可信工作区使用，任务结束后检查 `git diff`。
- `--skip-trust` 只对当前会话生效，让 Gemini CLI 信任父会话的工作目录，避免委派卡在交互式信任提示。
- 子智能体是独立进程、独立凭据环境：DSH 的 subprocess seam 会清洗父环境里的凭据类变量，
  只有 `env` 显式给出的变量才会传给子进程。
- 本插件不包含遥测；不读取、不记录、不回传任何密钥。密钥由 Gemini CLI 自己管理。

## 故障排查

| 现象 | 处理 |
|---|---|
| 工具调用失败，诊断为 `process-start` | 没找到 `gemini`。运行 `npm install -g @google/gemini-cli`，或在配置里写 `command: /绝对路径/gemini` |
| `Gemini API key is missing or not configured` | 未配置 API key。按上文写入 `~/.gemini/.env`（`chmod 600`） |
| `This client is no longer supported for Gemini Code Assist for individuals` | 用了已下线的 Google OAuth 登录。改用 API key |
| 子进程启动后没有响应 / 超时 | 检查网络（Gemini API 在部分网络需要代理）；给插件 `env` 配置 `HTTPS_PROXY`（Gemini CLI 读取标准代理变量） |
| 想确认机器环境是否就绪 | 在插件目录运行 `npm run smoke`（会消耗一次 API 请求并打印 PONG） |

## 兼容性与开发

- 依赖 DSH 官方包 `@deepseek-ai/dsh-subagent-acp@0.2.1-rc.2`，协议层随官方后端升级，无需本插件改动；
- 单元测试：`npm test`（32 个用例，覆盖配置规范化、可执行文件查找、凭据识别）；
- 端到端自检：`npm run smoke`（需要 API key）；
- 参考实现：官方 Codex 子智能体（`@deepseek-ai/dsh-subagent-codex`）、官方 ACP 后端
  （`@deepseek-ai/dsh-subagent-acp`），本插件与它们共用同一个 `ctx.subagents` 契约。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-subagent-gemini
```

并从 profile 的 `dsh.profile.bundles` 中移除 `dsh-subagent-gemini` 后重启。

## 许可证

MIT。Gemini CLI 及其名称归 Google 所有；本项目与 Google 无关联。
