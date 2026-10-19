import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    executableNames,
    isExecutableFile,
    resolveGeminiCommand,
    searchDirectories,
} from '../lib/resolve.js'

/** Create a temp root used as a fake home or PATH directory. */
function temporaryRoot(label) {
    return mkdtempSync(join(tmpdir(), `dsh-gemini-resolve-${label}-`))
}

/** Create an executable stub named `name` inside `dir`. */
function executableStub(dir, name) {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, 0o755)
    return path
}

test('platform-specific executable names', () => {
    assert.deepEqual(executableNames('darwin'), ['gemini'])
    assert.deepEqual(executableNames('linux'), ['gemini'])
    assert.deepEqual(executableNames('win32'), ['gemini.cmd', 'gemini.exe', 'gemini.bat', 'gemini'])
})

test('searchDirectories is PATH first, then the usual install locations, deduplicated', () => {
    const home = '/Users/example'
    const dirs = searchDirectories({ env: { PATH: '/usr/bin:/bin:/usr/bin' }, home, platform: 'darwin' })
    assert.equal(dirs[0], '/usr/bin')
    assert.equal(dirs.includes(join(home, '.local', 'bin')), true)
    assert.equal(new Set(dirs).size, dirs.length)
})

test('an absolute configured command is used verbatim', () => {
    const dir = temporaryRoot('absolute')
    const stub = executableStub(dir, 'gemini')
    const resolved = resolveGeminiCommand({ command: stub, env: {}, home: dir, platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
    assert.equal(resolved.source, 'configured')
})

test('a missing absolute configured command fails with an actionable error', () => {
    const dir = temporaryRoot('missing-absolute')
    const resolved = resolveGeminiCommand({ command: join(dir, 'nope', 'gemini'), env: {}, home: dir, platform: 'darwin' })
    assert.equal(resolved.ok, false)
    assert.match(resolved.error, /configured command is not an executable file/)
})

test('~/ is expanded in a configured command', () => {
    const home = temporaryRoot('tilde-home')
    const stub = executableStub(join(home, '.local', 'bin'), 'gemini')
    const resolved = resolveGeminiCommand({ command: '~/.local/bin/gemini', env: {}, home, platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
})

test('PATH lookup finds the CLI', () => {
    const dir = temporaryRoot('path')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'gemini')
    const home = join(dir, 'home')
    const resolved = resolveGeminiCommand({ env: { PATH: `${bin}:/usr/bin` }, home, platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
    assert.equal(resolved.source, 'path')
})

test('the fallback search finds ~/.local/bin even when the host PATH does not include it', () => {
    const home = temporaryRoot('fallback-home')
    const stub = executableStub(join(home, '.local', 'bin'), 'gemini')
    const resolved = resolveGeminiCommand({ env: { PATH: '/usr/bin:/bin' }, home, platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
    assert.equal(resolved.source, 'search')
})

test('a bare named command is resolved through the search space', () => {
    const dir = temporaryRoot('bare')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'gemini')
    const resolved = resolveGeminiCommand({ command: 'gemini', env: { PATH: bin }, home: join(dir, 'home'), platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
    assert.equal(resolved.source, 'configured')
})

test('not finding the CLI produces the install hint', () => {
    const dir = temporaryRoot('nothing')
    const resolved = resolveGeminiCommand({ env: { PATH: '/usr/bin:/bin' }, home: dir, platform: 'darwin' })
    assert.equal(resolved.ok, false)
    assert.match(resolved.error, /Gemini CLI was not found/)
    assert.match(resolved.error, /npm install -g @google\/gemini-cli/)
})

test('windows candidate names are honoured', () => {
    const dir = temporaryRoot('win')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'gemini.cmd')
    const resolved = resolveGeminiCommand({ env: { PATH: bin }, home: join(dir, 'home'), platform: 'win32' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
})

test('a configured value without path separators searches for that exact basename', () => {
    const dir = temporaryRoot('exact-name')
    const bin = join(dir, 'bin')
    executableStub(bin, 'gemini')
    executableStub(bin, 'gemini-other')
    const resolved = resolveGeminiCommand({ command: 'gemini-other', env: { PATH: bin }, home: join(dir, 'home'), platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, join(bin, 'gemini-other'))
})

test('isExecutableFile rejects directories and missing paths', () => {
    const dir = temporaryRoot('probe')
    assert.equal(isExecutableFile(dir, { platform: 'darwin' }), false)
    assert.equal(isExecutableFile(join(dir, 'nope'), { platform: 'darwin' }), false)
    const stub = executableStub(dir, 'gemini')
    assert.equal(isExecutableFile(stub, { platform: 'darwin' }), true)
})

test('a non-executable file is not accepted on POSIX', () => {
    const dir = temporaryRoot('noexec')
    const path = join(dir, 'gemini')
    writeFileSync(path, 'not executable')
    chmodSync(path, 0o644)
    assert.equal(isExecutableFile(path, { platform: 'darwin' }), false)
})
