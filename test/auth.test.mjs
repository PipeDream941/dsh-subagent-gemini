import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    CREDENTIAL_STATES,
    credentialGuidance,
    geminiCredentialState,
    parseDotEnv,
} from '../lib/auth.js'

/** Create a temp directory to act as a fake home. */
function temporaryHome(label) {
    return mkdtempSync(join(tmpdir(), `dsh-gemini-auth-${label}-`))
}

/** Write `~/.gemini/.env` under the fake home. */
function writeEnvFile(home, contents) {
    const dir = join(home, '.gemini')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.env'), contents)
}

test('an empty environment and an empty home report a missing credential', () => {
    const home = temporaryHome('empty')
    const state = geminiCredentialState({ env: {}, home })
    assert.equal(state.state, CREDENTIAL_STATES.MISSING)
    assert.match(state.hint, /No Gemini credential/)
})

test('GEMINI_API_KEY in the process environment is recognised', () => {
    const state = geminiCredentialState({ env: { GEMINI_API_KEY: 'redacted' }, home: temporaryHome('env-key') })
    assert.equal(state.state, CREDENTIAL_STATES.API_KEY)
    assert.match(state.source, /process environment/)
    assert.deepEqual(credentialGuidance(state), [])
})

test('a blank environment variable does not count as a credential', () => {
    const state = geminiCredentialState({ env: { GEMINI_API_KEY: '   ' }, home: temporaryHome('blank-key') })
    assert.equal(state.state, CREDENTIAL_STATES.MISSING)
})

test('GEMINI_API_KEY in ~/.gemini/.env is recognised and attributed to that file', () => {
    const home = temporaryHome('file-key')
    writeEnvFile(home, 'GEMINI_API_KEY="from-the-file"\n')
    const state = geminiCredentialState({ env: {}, home })
    assert.equal(state.state, CREDENTIAL_STATES.API_KEY)
    assert.match(state.source, /\.gemini\/\.env/)
})

test('the process environment wins over the dotenv file', () => {
    const home = temporaryHome('precedence')
    writeEnvFile(home, 'GEMINI_API_KEY=from-file\n')
    const state = geminiCredentialState({ env: { GEMINI_API_KEY: 'from-env' }, home })
    assert.equal(state.state, CREDENTIAL_STATES.API_KEY)
    assert.match(state.source, /process environment/)
})

test('Vertex AI needs both its switch and its key', () => {
    const home = temporaryHome('vertex')
    assert.equal(
        geminiCredentialState({ env: { GOOGLE_GENAI_USE_VERTEXAI: 'true' }, home }).state,
        CREDENTIAL_STATES.MISSING,
    )
    assert.equal(
        geminiCredentialState({ env: { GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_API_KEY: 'redacted' }, home }).state,
        CREDENTIAL_STATES.VERTEX,
    )
})

test('a Code Assist license switch is recognised', () => {
    const state = geminiCredentialState({ env: { GOOGLE_GENAI_USE_GCA: 'true' }, home: temporaryHome('gca') })
    assert.equal(state.state, CREDENTIAL_STATES.GCA)
})

test('a leftover browser login is reported as retired, not usable', () => {
    const home = temporaryHome('oauth')
    const dir = join(home, '.gemini')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'oauth_creds.json'), '{"access_token":"redacted"}')
    const state = geminiCredentialState({ env: {}, home })
    assert.equal(state.state, CREDENTIAL_STATES.OAUTH_RETIRED)
    const guidance = credentialGuidance(state).join('\n')
    assert.match(guidance, /retired/)
    assert.match(guidance, /aistudio\.google\.com\/apikey/)
    assert.match(guidance, /\.gemini\/\.env/)
})

test('guidance for a missing credential explains the whole setup', () => {
    const guidance = credentialGuidance(geminiCredentialState({ env: {}, home: temporaryHome('guidance') })).join('\n')
    assert.match(guidance, /aistudio\.google\.com\/apikey/)
    assert.match(guidance, /GEMINI_API_KEY/)
    assert.match(guidance, /chmod 600/)
})

test('parseDotEnv handles comments, export, quotes and CRLF', () => {
    const parsed = parseDotEnv([
        '# a comment',
        '',
        'GEMINI_API_KEY=plain',
        'export GOOGLE_API_KEY="quoted"',
        "GOOGLE_GENAI_USE_VERTEXAI='single'",
        'IGNORED_LINE',
        'WITH_SPACES = value with spaces ',
    ].join('\r\n'))
    assert.deepEqual(parsed, {
        GEMINI_API_KEY: 'plain',
        GOOGLE_API_KEY: 'quoted',
        GOOGLE_GENAI_USE_VERTEXAI: 'single',
        WITH_SPACES: 'value with spaces',
    })
})

test('dotenv files with no Gemini variables fall through to missing', () => {
    const home = temporaryHome('unrelated-env')
    writeEnvFile(home, 'SOME_OTHER_KEY=value\n')
    assert.equal(geminiCredentialState({ env: {}, home }).state, CREDENTIAL_STATES.MISSING)
})
