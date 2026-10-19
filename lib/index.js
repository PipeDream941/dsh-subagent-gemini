/**
 * Gemini subagent provider for DeepSeek Harness.
 *
 * The plugin is the Gemini-specific shell around DSH's official Agent Client
 * Protocol subagent backend (`@deepseek-ai/dsh-subagent-acp`): it resolves the
 * Gemini CLI executable, validates the deployment configuration, reports a
 * missing or retired credential at load time, and then mounts the official ACP
 * provider under a stable name (`gemini` by default). The bundle also inserts
 * the generic delegation tool as `subagent_gemini`, so a parent agent can hand a
 * self-contained task to a fresh Gemini CLI process and get only the final
 * answer back.
 *
 * Everything the parent observes is the `ctx.subagents` seam contract: one
 * fresh child process per run, its own session/model/tools, no inherited
 * parent context, and a safe failure diagnostic instead of raw stderr.
 *
 * @module dsh-subagent-gemini
 */

import { apply as applyAcpSubagentProvider } from '@deepseek-ai/dsh-subagent-acp'
import { acpProviderConfig, Config, resolveConfig } from './config.js'
import { resolveGeminiCommand } from './resolve.js'
import { credentialGuidance, geminiCredentialState } from './auth.js'

/** Plugin id used by the loader and diagnostics. */
export const name = 'subagent-gemini'
/**
 * Services the inner ACP provider needs: the subagent registry to register on
 * and the subprocess seam to spawn each child through.
 */
export const inject = ['subagents', 'subprocess']

export { Config }

/** True when the credential state means the CLI is expected to authenticate. */
function usableCredential(state) {
    return state === 'api-key' || state === 'vertex-ai' || state === 'gca'
}

/**
 * Mount the Gemini provider.
 *
 * Load-time checks are advisory on purpose: a missing binary or credential must
 * not stop the host from booting, because the operator can fix it and reload the
 * profile without touching the running session. The warnings carry the exact
 * fix; the delegation itself will fail with the seam's safe diagnostic until
 * then.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} [rawConfig] - profile configuration.
 */
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig)
    const logger = ctx.logger

    const resolution = resolveGeminiCommand({ command: config.command })
    if (resolution.ok) {
        logger?.debug?.(`dsh-subagent-gemini: using Gemini CLI at ${resolution.command} (${resolution.source})`)
    } else {
        logger?.warn?.(`dsh-subagent-gemini: ${resolution.error}`)
    }

    const credential = geminiCredentialState()
    if (usableCredential(credential.state)) {
        logger?.debug?.(`dsh-subagent-gemini: Gemini credential from ${credential.source}`)
    } else {
        for (const line of credentialGuidance(credential)) logger?.warn?.(line)
    }

    // Fall back to the bare executable name: the subprocess seam may still
    // resolve it through the host's own PATH, and the delegation failure is
    // reported per run rather than silently disabling the tool.
    const command = resolution.ok ? resolution.command : 'gemini'
    applyAcpSubagentProvider(ctx, acpProviderConfig(config, command))
}

export { resolveGeminiCommand } from './resolve.js'
export { geminiCredentialState, credentialGuidance } from './auth.js'
export { resolveConfig } from './config.js'
