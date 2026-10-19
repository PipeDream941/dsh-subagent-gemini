/**
 * Configuration surface of the Gemini subagent provider.
 *
 * The bundle inserts two profile entries: this provider (`subagent-gemini`) and
 * the model-facing delegation tool (`subagent_gemini`). Everything a deployment
 * may reasonably need to change — which binary to run, which model to fix, how
 * child permission requests are answered, what environment to add — lives here
 * so the profile patch stays tiny and readable.
 *
 * @module dsh-subagent-gemini/config
 */

import z from '@deepseek-ai/schemastery'

/** Registry name the provider registers on `ctx.subagents`. */
export const DEFAULT_PROVIDER_NAME = 'gemini'
/** The only arguments Gemini CLI needs to speak ACP as an IDE/agent backend. */
export const DEFAULT_ARGS = Object.freeze(['--acp', '--skip-trust'])
/**
 * Auto-answer policy for the child's `session/request_permission` prompts.
 *
 * `allow` selects the first `allow_once`/`allow_always` option so an unattended
 * child can edit files and run commands in its workspace; `reject` declines
 * every prompt and turns the child into a read-only assistant.
 */
export const DEFAULT_PERMISSION = 'allow'
/** Child's window to flush its own persistence after stdin EOF before escalation. */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6000
/** Failure-observation and SIGTERM→SIGKILL escalation grace. */
export const DEFAULT_DISPOSE_GRACE_MS = 3000

/** Deployment settings for one Gemini subagent provider instance. */
export const Config = z.object({
    /**
     * Registry name on `ctx.subagents`. One provider instance is mounted per
     * name, so a profile that wires several CLI backends must keep these unique.
     */
    providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
    /**
     * Absolute path to the Gemini CLI executable, or a bare name to resolve
     * through `PATH`. Empty (the default) searches `PATH` plus the usual
     * install locations for the current user.
     */
    command: z.string().default(''),
    /**
     * Arguments passed to the CLI for every run. `--acp` is always present;
     * the default additionally trusts the child workspace for that session so
     * a delegated task never stalls on an interactive trust prompt.
     */
    args: z.array(z.string()).default([...DEFAULT_ARGS]),
    /**
     * Optional Gemini model id fixed for this provider instance, e.g.
     * `gemini-2.5-flash`. Empty keeps the CLI's own default model.
     */
    model: z.string().default(''),
    /** Auto-answer policy for child permission requests (`allow` or `reject`). */
    permission: z.union(['allow', 'reject']).default(DEFAULT_PERMISSION),
    /**
     * Extra environment variables for the child process, layered over the
     * subprocess seam's credential-scrubbed parent environment. Note that
     * Gemini CLI reads `GEMINI_API_KEY` from its own `~/.gemini/.env`, so most
     * deployments do not need to put secrets here.
     */
    env: z.dict(z.string()).default({}),
    /** Grace after stdin EOF before the child's managed process range is terminated. */
    disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
    /** Failure-observation and SIGTERM→SIGKILL escalation grace. */
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** True for a positive finite number (the seam's timing bound contract). */
function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Coerce a value to a trimmed, non-empty string, else undefined. */
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Normalize a raw environment dictionary, dropping non-string values. */
function environmentObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    const entries = Object.entries(value).filter(([, entry]) => typeof entry === 'string')
    return Object.fromEntries(entries)
}

/**
 * Resolve a raw config into the exact shape the ACP provider backend accepts.
 *
 * This is deliberately total: the loader validates `Config` before `apply`, but
 * unit tests, programmatic mounts and hand-written patch overlays may bypass the
 * schema, so a missing or wrong-typed field must degrade to its default rather
 * than crash the host at boot.
 *
 * @param {Record<string, unknown>} [raw] - configuration as supplied by the loader.
 * @returns {{
 *   providerName: string,
 *   command: string,
 *   args: string[],
 *   model: string,
 *   permission: 'allow' | 'reject',
 *   env: Record<string, string>,
 *   disposeEofGraceMs: number,
 *   disposeGraceMs: number,
 * }} resolved configuration.
 */
export function resolveConfig(raw = {}) {
    const source = raw !== null && typeof raw === 'object' ? raw : {}
    const providerName = nonEmptyString(source.providerName) ?? DEFAULT_PROVIDER_NAME
    const command = typeof source.command === 'string' ? source.command.trim() : ''
    const model = nonEmptyString(source.model) ?? ''
    const permission = source.permission === 'reject' ? 'reject' : DEFAULT_PERMISSION
    const env = environmentObject(source.env)

    let args = Array.isArray(source.args) ? source.args.map(String) : [...DEFAULT_ARGS]
    // The provider drives an ACP agent: without the flag the child would start
    // its interactive TUI and the protocol handshake would never happen.
    if (!args.includes('--acp') && !args.includes('--experimental-acp')) args.unshift('--acp')
    // `--skip-trust` only matters for a child that is not already trusted; keep
    // the default for safety, but never duplicate a caller-provided flag.
    if (!args.includes('--skip-trust') && !args.includes('--no-skip-trust')) args.push('--skip-trust')
    if (model !== '' && !args.includes('-m') && !args.includes('--model')) args.push('--model', model)

    const disposeEofGraceMs = positiveNumber(source.disposeEofGraceMs) ?? DEFAULT_DISPOSE_EOF_GRACE_MS
    const disposeGraceMs = positiveNumber(source.disposeGraceMs) ?? DEFAULT_DISPOSE_GRACE_MS

    return { providerName, command, args, model, permission, env, disposeEofGraceMs, disposeGraceMs }
}

/**
 * Project a resolved config onto the ACP backend's own config object.
 *
 * Kept separate so the mapping is unit-testable without importing the backend
 * (whose peer dependencies only resolve inside a running DSH host).
 *
 * @param {ReturnType<typeof resolveConfig>} config - resolved plugin config.
 * @param {string} command - executable to spawn for each delegation.
 * @returns {Record<string, unknown>} the ACP provider backend config.
 */
export function acpProviderConfig(config, command) {
    return {
        providerName: config.providerName,
        command,
        args: [...config.args],
        permission: config.permission,
        env: { ...config.env },
        disposeEofGraceMs: config.disposeEofGraceMs,
        disposeGraceMs: config.disposeGraceMs,
    }
}
