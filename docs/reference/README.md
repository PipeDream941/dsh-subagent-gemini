# 参考源码（只读）

来源：<https://github.com/deepseek-ai/deepseek-harness>（仓库根目录 `LICENSE` 为 MIT，已一并保留在本目录）
本地 clone：`/tmp/dsh-src`（sparse checkout，commit 687f282e8625c6b8d11ff58211a90524be2e4317，2026-10-17）

| 目录 | 内容 |
|---|---|
| `subagent-codex/` | 官方 Codex 子智能体插件（本项目 Gemini 子智能体的结构模板）：`src/index.ts` config + provider 注册、`src/run.ts` 一次性运行生命周期、`src/wire.ts` Codex app-server JSON-RPC、`cordis.patch.yml` 插入层 |
| `subagent-acp/` | 官方通用 ACP 子智能体后端（本项目实际复用的 provider）：`src/index.ts` config、`src/run.ts` ACP 客户端驱动 |
| `subagent-seam/` | `ctx.subagents` 服务契约：`SubagentProvider` 接口与 out-of-process 能力声明（`types.ts`、`out-of-process.ts`） |

本项目对 Gemini 子智能体的改动只是**配置层**（`profile-patch-rows.yml`），没有复制上述实现代码；
这些文件仅作为架构参考和后续「独立插件」开发的依据。
