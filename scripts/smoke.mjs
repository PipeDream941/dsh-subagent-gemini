#!/usr/bin/env node
/**
 * End-to-end smoke test for the Gemini subagent's data path.
 *
 * It exercises exactly what the provider exercises — the same executable
 * resolution, the same ACP handshake, the same auto-approved permission policy —
 * without booting a DSH host. Useful on a fresh machine to answer "is the CLI
 * installed, is the credential configured, and can it answer one prompt?".
 *
 *   npm run smoke
 *   npm run smoke -- --model gemini-2.5-flash
 *   npm run smoke -- --command /opt/homebrew/bin/gemini --json
 *
 * Exit codes: 0 = PASS, 1 = the ACP run failed, 2 = the machine is not set up
 * (CLI missing or no usable credential). The script never prints a credential.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveGeminiCommand } from '../lib/resolve.js'
import { credentialGuidance, geminiCredentialState } from '../lib/auth.js'

/** How long the whole ACP run may take. */
const RUN_TIMEOUT_MS = 180_000

/** Parse the tiny CLI surface without a dependency. */
function parseArguments(argv) {
    const options = { command: '', model: '', json: false, cwd: join(tmpdir(), 'dsh-subagent-gemini-smoke') }
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]
        if (argument === '--json') options.json = true
        else if (argument === '--command' && argv[index + 1] !== undefined) options.command = argv[(index += 1)]
        else if (argument === '--model' && argv[index + 1] !== undefined) options.model = argv[(index += 1)]
        else if (argument === '--cwd' && argv[index + 1] !== undefined) options.cwd = argv[(index += 1)]
    }
    return options
}

/** Print one result object either as JSON or as aligned text. */
function report(options, result) {
    if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
    }
    for (const [key, value] of Object.entries(result)) console.log(`${key.padEnd(12)}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
}

/** Run one ACP turn against `gemini --acp` and resolve the assistant's answer. */
function runAcpTurn({ command, args, cwd, prompt, timeoutMs }) {
    return new Promise(resolve => {
        const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
        let nextId = 1
        const pending = new Map()
        let buffer = ''
        const answer = []
        const stderr = []
        let settled = false
        const timer = setTimeout(() => finish({ ok: false, error: `ACP run timed out after ${timeoutMs}ms` }), timeoutMs)

        function send(message) {
            if (settled || !child.stdin.writable) return
            child.stdin.write(`${JSON.stringify(message)}\n`)
        }
        function request(method, params) {
            const id = nextId++
            return new Promise((resolveRequest, rejectRequest) => {
                pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
                send({ jsonrpc: '2.0', id, method, params })
            })
        }
        function finish(result) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            for (const waiter of pending.values()) waiter.reject(new Error('ACP run finished'))
            pending.clear()
            try {
                if (child.stdin.writable) child.stdin.end()
            } catch {
                /* already closed */
            }
            setTimeout(() => {
                try {
                    child.kill('SIGTERM')
                } catch {
                    /* already gone */
                }
            }, 300)
            resolve({ ...result, stderr: stderr.join('').slice(-4000) })
        }

        child.stderr.on('data', chunk => stderr.push(chunk.toString()))
        child.on('error', error => finish({ ok: false, error: `cannot start ${command}: ${error.message}` }))
        child.on('close', code => {
            if (!settled) finish({ ok: false, error: `the Gemini CLI exited before answering (code ${code})` })
        })

        child.stdout.on('data', chunk => {
            buffer += chunk.toString()
            let index
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, index).trim()
                buffer = buffer.slice(index + 1)
                if (line === '') continue
                let message
                try {
                    message = JSON.parse(line)
                } catch {
                    continue
                }
                if (message.id !== undefined && pending.has(message.id)) {
                    const waiter = pending.get(message.id)
                    pending.delete(message.id)
                    if (message.error) waiter.reject(Object.assign(new Error(message.error.message ?? 'ACP error'), { data: message.error.data }))
                    else waiter.resolve(message.result)
                } else if (message.method === 'session/update') {
                    const update = message.params?.update
                    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') answer.push(update.content.text)
                } else if (message.method !== undefined && message.id !== undefined) {
                    if (message.method === 'session/request_permission') {
                        const choices = message.params?.options ?? []
                        const allow = choices.find(choice => choice.kind === 'allow_once') ?? choices.find(choice => choice.kind === 'allow_always')
                        send({
                            jsonrpc: '2.0',
                            id: message.id,
                            result: { outcome: allow ? { outcome: 'selected', optionId: allow.optionId } : { outcome: 'cancelled' } },
                        })
                    } else {
                        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `client does not implement ${message.method}` } })
                    }
                }
            }
        })

        void (async () => {
            try {
                await request('initialize', {
                    protocolVersion: 1,
                    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
                })
                const session = await request('session/new', { cwd, mcpServers: [] })
                const result = await request('session/prompt', {
                    sessionId: session.sessionId,
                    prompt: [{ type: 'text', text: prompt }],
                })
                finish({ ok: true, stopReason: result.stopReason, answer: answer.join('').trim() })
            } catch (error) {
                finish({ ok: false, error: error.message })
            }
        })()
    })
}

const options = parseArguments(process.argv.slice(2))
const resolution = resolveGeminiCommand({ command: options.command })
if (!resolution.ok) {
    report(options, { ok: false, stage: 'resolve', error: resolution.error })
    process.exit(2)
}
const credential = geminiCredentialState()
if (credential.state !== 'api-key' && credential.state !== 'vertex-ai' && credential.state !== 'gca') {
    report(options, { ok: false, stage: 'credential', state: credential.state, source: credential.source, guidance: credentialGuidance(credential) })
    process.exit(2)
}

mkdirSync(options.cwd, { recursive: true })
const args = ['--acp', '--skip-trust']
if (options.model !== '') args.push('--model', options.model)
const startedAt = Date.now()
const result = await runAcpTurn({
    command: resolution.command,
    args,
    cwd: options.cwd,
    prompt: 'Reply with exactly this single word and nothing else: PONG',
    timeoutMs: RUN_TIMEOUT_MS,
})
const passed = result.ok === true && /PONG/i.test(result.answer ?? '')
report(options, {
    ok: passed,
    command: resolution.command,
    credential: credential.state,
    stopReason: result.stopReason ?? '',
    answer: result.answer ?? '',
    durationMs: Date.now() - startedAt,
    ...(passed ? {} : { error: result.error ?? 'the model did not answer PONG', stderr: result.stderr ?? '' }),
})
process.exit(passed ? 0 : 1)
