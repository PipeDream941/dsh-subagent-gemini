import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_ARGS,
    DEFAULT_DISPOSE_EOF_GRACE_MS,
    DEFAULT_DISPOSE_GRACE_MS,
    DEFAULT_PERMISSION,
    DEFAULT_PROVIDER_NAME,
    Config,
    acpProviderConfig,
    resolveConfig,
} from '../lib/config.js'

test('the schema resolves an empty config to the documented defaults', () => {
    const resolved = Config({})
    assert.equal(resolved.providerName, DEFAULT_PROVIDER_NAME)
    assert.equal(resolved.command, '')
    assert.deepEqual(resolved.args, [...DEFAULT_ARGS])
    assert.equal(resolved.model, '')
    assert.equal(resolved.permission, DEFAULT_PERMISSION)
    assert.deepEqual(resolved.env, {})
    assert.equal(resolved.disposeEofGraceMs, DEFAULT_DISPOSE_EOF_GRACE_MS)
    assert.equal(resolved.disposeGraceMs, DEFAULT_DISPOSE_GRACE_MS)
})

test('resolveConfig is total for missing or wrong-typed fields', () => {
    const resolved = resolveConfig(undefined)
    assert.equal(resolved.providerName, DEFAULT_PROVIDER_NAME)
    assert.equal(resolveConfig(null).permission, DEFAULT_PERMISSION)
    assert.equal(resolveConfig({ providerName: '   ' }).providerName, DEFAULT_PROVIDER_NAME)
    assert.deepEqual(resolveConfig({ env: 'nope' }).env, {})
    assert.deepEqual(resolveConfig({ env: [] }).env, {})
    assert.deepEqual(resolveConfig({ env: { A: '1', B: 2, C: null } }).env, { A: '1' })
    assert.equal(resolveConfig({ providerName: ' custom ' }).providerName, 'custom')
})

test('--acp is always present and --skip-trust is not duplicated', () => {
    assert.deepEqual(resolveConfig({}).args, ['--acp', '--skip-trust'])
    assert.deepEqual(resolveConfig({ args: [] }).args, ['--acp', '--skip-trust'])
    assert.deepEqual(resolveConfig({ args: ['--skip-trust'] }).args, ['--acp', '--skip-trust'])
    assert.deepEqual(resolveConfig({ args: ['--acp', '--skip-trust', '--debug'] }).args, ['--acp', '--skip-trust', '--debug'])
    assert.deepEqual(resolveConfig({ args: ['--experimental-acp'] }).args, ['--experimental-acp', '--skip-trust'])
})

test('a configured model becomes a CLI model flag exactly once', () => {
    assert.deepEqual(resolveConfig({ model: 'gemini-2.5-flash' }).args, ['--acp', '--skip-trust', '--model', 'gemini-2.5-flash'])
    assert.deepEqual(
        resolveConfig({ model: 'gemini-2.5-pro', args: ['--acp', '-m', 'custom'] }).args,
        ['--acp', '-m', 'custom', '--skip-trust'],
    )
    assert.deepEqual(resolveConfig({ model: '  ' }).args, ['--acp', '--skip-trust'])
})

test('permission accepts only the two ACP policies', () => {
    assert.equal(resolveConfig({ permission: 'reject' }).permission, 'reject')
    assert.equal(resolveConfig({ permission: 'allow' }).permission, 'allow')
    assert.equal(resolveConfig({ permission: 'yes' }).permission, 'allow')
    assert.equal(resolveConfig({ permission: null }).permission, DEFAULT_PERMISSION)
})

test('dispose graces must stay positive finite numbers', () => {
    assert.equal(resolveConfig({ disposeGraceMs: 1500 }).disposeGraceMs, 1500)
    assert.equal(resolveConfig({ disposeGraceMs: 0 }).disposeGraceMs, DEFAULT_DISPOSE_GRACE_MS)
    assert.equal(resolveConfig({ disposeGraceMs: -1 }).disposeGraceMs, DEFAULT_DISPOSE_GRACE_MS)
    assert.equal(resolveConfig({ disposeGraceMs: Number.NaN }).disposeGraceMs, DEFAULT_DISPOSE_GRACE_MS)
    assert.equal(resolveConfig({ disposeEofGraceMs: Number.POSITIVE_INFINITY }).disposeEofGraceMs, DEFAULT_DISPOSE_EOF_GRACE_MS)
})

test('the ACP backend config carries exactly the fields that backend reads', () => {
    const config = resolveConfig({ providerName: 'gemini-test', model: 'gemini-2.5-flash', permission: 'reject' })
    const mapped = acpProviderConfig(config, '/usr/local/bin/gemini')
    assert.deepEqual(mapped, {
        providerName: 'gemini-test',
        command: '/usr/local/bin/gemini',
        args: ['--acp', '--skip-trust', '--model', 'gemini-2.5-flash'],
        permission: 'reject',
        env: {},
        disposeEofGraceMs: DEFAULT_DISPOSE_EOF_GRACE_MS,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
    })
})

test('the mapped config is a detached copy (mutating it cannot corrupt the settings)', () => {
    const config = resolveConfig({ args: ['--acp'] })
    const mapped = acpProviderConfig(config, 'gemini')
    mapped.args.push('--extra')
    mapped.env.INJECTED = '1'
    assert.deepEqual(config.args, ['--acp', '--skip-trust'])
    assert.deepEqual(config.env, {})
})
