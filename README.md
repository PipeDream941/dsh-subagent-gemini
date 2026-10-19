---
description: "Gemini subagent: drive the official Google Gemini CLI as a one-shot coding subagent inside DeepSeek Harness (subagent_gemini delegation tool)."
kind: "package-bundle"
---
> **发布状态：暂未发布到 npm / DSH 插件市场。**
> Gemini CLI 目前尚未提供 Gemini 4，且本插件需要用户自备 Gemini API key 才能完成端到端验证；
> 在验证通过前不提交市场收录，避免把未经验证的插件放给用户。代码、测试与 CI 均已就绪，验证后可发布。
>
> 想用 Gemini 4 请安装 [`dsh-subagent-antigravity`](https://github.com/PipeDream941/dsh-subagent-antigravity)。


# dsh-subagent-gemini

English | [中文](README.zh.md)

Adds a **Gemini subagent** to DeepSeek Harness (DSH): a parent session can call
`subagent_gemini` to run a Google Gemini CLI coding agent in a **separate process**
inside the parent workspace, let it edit files and run commands on its own, and
get only the final answer back.

The shape is the same as the official Codex subagent (`subagent_codex`) and the
community Cursor subagent (`cursor_code`):

- **Fresh process, fresh session** — every delegation spawns a new `gemini --acp`;
- **Final answer only** — the child's thoughts, tool calls and stderr never enter the parent conversation;
- **One task per run** — no follow-up input or continuation (use the native `subagent`/`fork` backends for those);
- **Safe diagnostics** — failures report fixed stage/category facts, never stderr, paths or credentials.

> Community plugin; not affiliated with Google. Gemini CLI is Google's official CLI — this plugin only drives it from DSH.

## How it works

```
parent session (DeepSeek model)
   │  calls tool subagent_gemini({ description, prompt })
   ▼
DSH subagent seam (ctx.subagents)
   │  provider: gemini (registered by this plugin)
   ▼
@deepseek-ai/dsh-subagent-acp (official ACP subagent backend)
   │  spawn, ACP handshake, auto-answered permissions, process-range cleanup, safe diagnostics
   ▼
gemini --acp --skip-trust  (separate process, parent cwd)
   │  uses Gemini CLI's own tools (file edits / shell / search / MCP …)
   ▼
final answer → parent conversation
```

This plugin owns the Gemini-specific parts — **locating the executable**, **validating configuration**
and **detecting credentials at load time with actionable guidance**. Process lifecycle and the ACP
protocol are handled by DSH's official backend, so a DSH upgrade does not require rewriting the protocol here.

## Requirements

| Dependency | Version / notes |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` series (provides `ctx.subagents` and the ACP subagent backend) |
| Node.js | `^22.19.0` or `>=24` |
| Google Gemini CLI | a build that supports `--acp` (`0.60+`, latest recommended) |
| Gemini credential | Gemini Developer API key (recommended), or Vertex AI / Code Assist variables |

Install the CLI:

```bash
npm install -g @google/gemini-cli
gemini --version
```

## Install the plugin

**From the DSH plugin market (recommended):** search for `dsh-subagent-gemini`, install and enable it.

**From the command line:**

```bash
dsh plugin --profile desktop add dsh-subagent-gemini
```

Then add the package to that profile's `package.json` → `dsh.profile.bundles` and restart (or let the
profile recompose):

```json
"dsh": {
  "profile": {
    "bundles": ["…", "dsh-subagent-gemini"]
  }
}
```

Once enabled, every agent sees the global tool `subagent_gemini` (a running session picks it up on its next request).

## Credentials (important)

Gemini CLI needs its own credential. **Google account browser login (OAuth) no longer works**: Google retired
the individual Gemini Code Assist OAuth client for Gemini CLI, and the CLI reports
*"This client is no longer supported for Gemini Code Assist for individuals"*.
Use an **API key** instead:

1. Create a key at <https://aistudio.google.com/apikey>;
2. Store it where Gemini CLI looks (no plugin config required):

```bash
printf 'GEMINI_API_KEY=your-key\n' > ~/.gemini/.env
chmod 600 ~/.gemini/.env
```

Gemini CLI loads `~/.gemini/.env` automatically. Environment variables also work:

- `GEMINI_API_KEY` — Gemini Developer API;
- `GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_API_KEY` — Vertex AI;
- `GOOGLE_GENAI_USE_GCA=true` — Google Code Assist license.

To pass variables to the child explicitly, use the plugin's `env` config (see below). The plugin never reads,
logs or returns secret values.

## Usage

The model calls it like any other delegation tool:

```json
{
  "name": "subagent_gemini",
  "arguments": {
    "description": "Fix login timeout",
    "prompt": "In the workspace, find the login request timeout and raise it from 5s to 15s, run the related tests, and reply only with what you changed and the test result."
  }
}
```

- `description` — 3–5 word task name shown in the subagent list;
- `prompt` — a **self-contained** task; the child cannot see the parent conversation, so include paths, constraints and acceptance criteria.

When the run finishes the parent receives a completion notice with Gemini's final answer or a safe failure
diagnostic. The child's tool traffic and reasoning stay out of the parent session.

## Configuration

Override the `subagent-gemini` entry's `config` in a profile patch:

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `gemini` | Name registered on `ctx.subagents`; must be unique in one profile |
| `command` | empty (auto-detect) | Path to the `gemini` executable; empty searches `PATH`, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, … |
| `args` | `['--acp', '--skip-trust']` | CLI arguments; `--acp` is always kept, `--skip-trust` is present by default |
| `model` | empty (CLI default) | Fixed model id such as `gemini-2.5-flash`; becomes one `--model` argument |
| `permission` | `allow` | Auto-answer for child permission requests: `allow` approves (edits/shell), `reject` declines (read-only) |
| `env` | `{}` | Extra environment variables layered over the credential-scrubbed parent environment |
| `disposeEofGraceMs` | `6000` | Time the child gets to flush after stdin EOF before escalation |
| `disposeGraceMs` | `3000` | Failure-observation and SIGTERM→SIGKILL escalation grace |

Example — fixed model, read-only child:

```yaml
- id: subagent-gemini
  config:
    model: gemini-2.5-flash
    permission: reject
```

## Security and permissions

- `permission: allow` means **unattended**: the child may edit workspace files and run commands without a human
  approval prompt. That is what makes delegated coding tasks possible; use it in trusted workspaces and review
  `git diff` afterwards.
- `--skip-trust` trusts the parent workspace for the child session only, so a delegation never stalls on an
  interactive trust prompt.
- The child is a separate process with its own credential environment: DSH's subprocess seam scrubs credential-like
  variables from the parent environment; only variables in `env` are forwarded.
- No telemetry. No credential is read, logged or returned by this plugin; the key is managed by Gemini CLI itself.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Delegation fails with a `process-start` diagnostic | `gemini` not found. `npm install -g @google/gemini-cli`, or set `command` to an absolute path |
| `Gemini API key is missing or not configured` | No credential. Write `~/.gemini/.env` as above (`chmod 600`) |
| `This client is no longer supported for Gemini Code Assist for individuals` | The retired OAuth login is in use. Switch to an API key |
| Child starts but never answers / times out | Check network reachability of the Gemini API; if it needs a proxy, put `HTTPS_PROXY` in the plugin's `env` |
| Want to check the machine setup | Run `npm run smoke` in the plugin checkout (costs one API request and prints PONG) |

## Compatibility and development

- Depends on the official `@deepseek-ai/dsh-subagent-acp@0.2.1-rc.2`, so protocol work tracks the official backend;
- Unit tests: `npm test` (32 cases: config normalization, executable discovery, credential detection);
- End-to-end self-check: `npm run smoke` (requires an API key);
- Reference implementations: the official Codex subagent (`@deepseek-ai/dsh-subagent-codex`) and the official ACP
  backend (`@deepseek-ai/dsh-subagent-acp`); all three share the same `ctx.subagents` contract.

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-subagent-gemini
```

Then remove `dsh-subagent-gemini` from the profile's `dsh.profile.bundles` and restart.

## License

MIT. Gemini CLI and its name belong to Google; this project is not affiliated with Google.
