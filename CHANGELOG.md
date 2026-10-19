# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-10-19

### Added

- `subagent_gemini` delegation tool: runs the Google Gemini CLI (`gemini --acp`)
  as a one-shot, out-of-process coding subagent over the Agent Client Protocol.
- Provider registered as `gemini` on `ctx.subagents`, backed by the official
  `@deepseek-ai/dsh-subagent-acp` backend.
- Automatic Gemini CLI discovery: configured path, `PATH`, and the common
  per-user / package-manager install directories (`~/.local/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, …) with
  platform-aware candidate names for Windows.
- Configuration schema with defaults: `providerName`, `command`, `args`,
  `model`, `permission`, `env`, `disposeEofGraceMs`, `disposeGraceMs`.
- Credential detection with actionable guidance: recognizes Gemini API key,
  Vertex AI and Code Assist variables (process environment or `~/.gemini/.env`)
  and explains the retired individual OAuth login.
- Bilingual documentation (English / 中文), `npm run smoke` end-to-end
  self-check, and 32 unit tests covering config, resolution and credentials.
