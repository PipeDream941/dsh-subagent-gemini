/**
 * Detect whether the Gemini CLI has a usable credential.
 *
 * The CLI reads its own credentials: `GEMINI_API_KEY` (Gemini Developer API),
 * Vertex AI variables, or a Google Code Assist license. A Gemini CLI login done
 * through the browser is **not** one of them any more: Google retired the
 * individual Code Assist OAuth client for Gemini CLI, so `~/.gemini/oauth_creds.json`
 * can exist while every request fails with
 * "This client is no longer supported for Gemini Code Assist for individuals".
 *
 * This module never reads, stores, logs or returns secret values; it only
 * reports which credential *source* exists so the plugin can tell the operator
 * what to do next.
 *
 * @module dsh-subagent-gemini/auth
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Credential sources understood by Gemini CLI. */
export const CREDENTIAL_STATES = Object.freeze({
    API_KEY: 'api-key',
    VERTEX: 'vertex-ai',
    GCA: 'gca',
    OAUTH_RETIRED: 'oauth-retired',
    MISSING: 'missing',
})

/** True for a non-empty string. */
function filled(value) {
    return typeof value === 'string' && value.trim() !== ''
}

/**
 * Parse a dotenv file into key/value pairs, keeping only simple assignments.
 *
 * Deliberately tolerant: the file is user-maintained, so comments, `export`,
 * single/double quotes and CRLF line endings all have to work.
 *
 * @param {string} text - file contents.
 * @returns {Record<string, string>} parsed assignments.
 */
export function parseDotEnv(text) {
    const result = {}
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim()
        if (line === '' || line.startsWith('#')) continue
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
        if (match === null) continue
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        result[match[1]] = value
    }
    return result
}

/** Read a file as UTF-8, returning undefined when it is absent or unreadable. */
function defaultReadText(path) {
    try {
        return readFileSync(path, 'utf8')
    } catch {
        return undefined
    }
}

/** Classify one variable bag (process env or a dotenv file) into a state. */
function classify(source) {
    if (filled(source.GEMINI_API_KEY)) return { state: CREDENTIAL_STATES.API_KEY, variable: 'GEMINI_API_KEY' }
    if (filled(source.GOOGLE_GENAI_USE_VERTEXAI) && filled(source.GOOGLE_API_KEY)) {
        return { state: CREDENTIAL_STATES.VERTEX, variable: 'GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_API_KEY' }
    }
    if (filled(source.GOOGLE_GENAI_USE_GCA)) return { state: CREDENTIAL_STATES.GCA, variable: 'GOOGLE_GENAI_USE_GCA' }
    return undefined
}

/**
 * Inspect the machine for a credential the Gemini CLI can use.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   exists?: (path: string) => boolean,
 *   readText?: (path: string) => string | undefined,
 * }} [options] - injectable filesystem/environment view for tests.
 * @returns {{
 *   state: 'api-key' | 'vertex-ai' | 'gca' | 'oauth-retired' | 'missing',
 *   source: string,
 *   hint: string,
 * }} credential state; never contains a secret value.
 */
export function geminiCredentialState(options = {}) {
    const env = options.env ?? process.env
    const home = options.home ?? homedir()
    const exists = options.exists ?? existsSync
    const readText = options.readText ?? defaultReadText
    const geminiDir = join(home, '.gemini')
    const envFilePath = join(geminiDir, '.env')

    const fromEnv = classify(env)
    if (fromEnv !== undefined) {
        return { state: fromEnv.state, source: `process environment (${fromEnv.variable})`, hint: '' }
    }

    const envText = readText(envFilePath)
    if (envText !== undefined) {
        const fromFile = classify(parseDotEnv(envText))
        if (fromFile !== undefined) {
            return { state: fromFile.state, source: `${envFilePath} (${fromFile.variable})`, hint: '' }
        }
    }

    if (exists(join(geminiDir, 'oauth_creds.json'))) {
        return {
            state: CREDENTIAL_STATES.OAUTH_RETIRED,
            source: join(geminiDir, 'oauth_creds.json'),
            hint: 'A Gemini CLI browser login is present, but Google retired the individual Gemini Code Assist '
                + 'OAuth client for Gemini CLI: that login can no longer authenticate. Use a Gemini API key instead.',
        }
    }

    return {
        state: CREDENTIAL_STATES.MISSING,
        source: '',
        hint: 'No Gemini credential was found.',
    }
}

/**
 * Actionable guidance for a credential state, one step per line.
 *
 * @param {ReturnType<typeof geminiCredentialState>} state - result of {@link geminiCredentialState}.
 * @returns {string[]} guidance lines; empty when a credential is configured.
 */
export function credentialGuidance(state) {
    if (state.state === CREDENTIAL_STATES.API_KEY || state.state === CREDENTIAL_STATES.VERTEX || state.state === CREDENTIAL_STATES.GCA) {
        return []
    }
    return [
        state.hint,
        'Create an API key at https://aistudio.google.com/apikey (Gemini Developer API, free tier available), then save it for the CLI:',
        "  printf 'GEMINI_API_KEY=YOUR_KEY\\n' > ~/.gemini/.env && chmod 600 ~/.gemini/.env",
        'Alternatively set GEMINI_API_KEY (or the Vertex AI variables) in the provider\'s "env" config.',
        'Until then every subagent_gemini delegation will fail at the ACP session handshake.',
    ]
}
