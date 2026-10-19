/**
 * Locate the Gemini CLI executable.
 *
 * A DSH host started from a desktop launcher usually does not inherit the
 * interactive shell's `PATH`, so a bare `gemini` in a profile patch would find
 * nothing even though the user installed the CLI five minutes earlier. The
 * resolver therefore checks the explicit setting, then `PATH`, then the common
 * per-user and package-manager locations, and only then reports that the CLI is
 * missing — with the install command in the error.
 *
 * @module dsh-subagent-gemini/resolve
 */

import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'

/** Directories a package-manager or official installer commonly uses. */
function commonDirectories(home) {
    return [
        join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        join(home, '.npm-global', 'bin'),
        join(home, 'bin'),
        join(home, '.local', 'share', 'npm', 'bin'),
    ]
}

/**
 * File names a Gemini CLI install may use on this platform.
 * @param {NodeJS.Platform} platform - platform id.
 * @returns {string[]} candidate basenames in preference order.
 */
export function executableNames(platform) {
    return platform === 'win32'
        ? ['gemini.cmd', 'gemini.exe', 'gemini.bat', 'gemini']
        : ['gemini']
}

/**
 * Every directory the resolver searches, in order, without duplicates.
 * @param {{env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform}} [options] - environment view.
 * @returns {string[]} absolute directories.
 */
export function searchDirectories(options = {}) {
    const env = options.env ?? process.env
    const home = options.home ?? homedir()
    const pathValue = env.PATH ?? env.Path ?? ''
    const dirs = []
    for (const entry of String(pathValue).split(delimiter)) {
        if (entry !== '') dirs.push(entry)
    }
    for (const entry of commonDirectories(home)) dirs.push(entry)
    return [...new Set(dirs)]
}

/** Default executability probe (real filesystem). */
function defaultProbe(path, platform) {
    try {
        if (!statSync(path).isFile()) return false
        if (platform !== 'win32') accessSync(path, constants.X_OK)
        return true
    } catch {
        return false
    }
}

/**
 * Whether a path names an executable file.
 * @param {string} path - candidate path.
 * @param {{platform?: NodeJS.Platform, probe?: (path: string, platform: NodeJS.Platform) => boolean}} [options] - injectable probe.
 * @returns {boolean} true when the candidate can be spawned.
 */
export function isExecutableFile(path, options = {}) {
    const platform = options.platform ?? process.platform
    const probe = options.probe ?? defaultProbe
    try {
        return probe(path, platform) === true
    } catch {
        return false
    }
}

/** Expand a leading `~/` against the given home directory. */
function expandHome(value, home) {
    if (value === '~') return home
    if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
    return value
}

/**
 * Resolve the Gemini CLI executable to spawn.
 *
 * @param {{
 *   command?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   platform?: NodeJS.Platform,
 *   probe?: (path: string, platform: NodeJS.Platform) => boolean,
 * }} [options] - `command` is the configured value (empty means auto-detect).
 * @returns {{ok: true, command: string, source: 'configured' | 'path' | 'search'}
 *   | {ok: false, error: string}} the executable, or an actionable error.
 */
export function resolveGeminiCommand(options = {}) {
    const env = options.env ?? process.env
    const home = options.home ?? homedir()
    const platform = options.platform ?? process.platform
    const probe = options.probe
    const configured = typeof options.command === 'string' ? options.command.trim() : ''

    if (configured !== '') {
        const expanded = expandHome(configured, home)
        if (isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
            if (isExecutableFile(expanded, { platform, probe })) return { ok: true, command: expanded, source: 'configured' }
            return {
                ok: false,
                error: `configured command is not an executable file: ${expanded}. Fix the "command" setting or clear it to auto-detect.`,
            }
        }
        // A bare name in the setting is treated like a PATH lookup, but the
        // operator explicitly asked for that name: report it when missing. A
        // configured name that is not one of the platform candidates is looked
        // up verbatim (e.g. a versioned wrapper such as `gemini-2.5`).
        const names = executableNames(platform)
        const lookupNames = names.includes(configured) ? names : [configured]
        for (const dir of searchDirectories({ env, home, platform })) {
            for (const name of lookupNames) {
                const candidate = join(dir, name)
                if (isExecutableFile(candidate, { platform, probe })) return { ok: true, command: candidate, source: 'configured' }
            }
        }
        return {
            ok: false,
            error: `configured command "${configured}" was not found in PATH or the usual install locations.`,
        }
    }

    const names = executableNames(platform)
    for (const dir of searchDirectories({ env, home, platform })) {
        for (const name of names) {
            const candidate = join(dir, name)
            if (isExecutableFile(candidate, { platform, probe })) {
                const onPath = String(env.PATH ?? env.Path ?? '').split(delimiter).includes(dir)
                return { ok: true, command: candidate, source: onPath ? 'path' : 'search' }
            }
        }
    }

    return {
        ok: false,
        error: 'Gemini CLI was not found. Install it with "npm install -g @google/gemini-cli" '
            + '(or the official installer from https://geminicli.com), then reload the profile; '
            + 'or set the provider\'s "command" option to the gemini executable path.',
    }
}
