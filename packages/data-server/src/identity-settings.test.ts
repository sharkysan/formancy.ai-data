import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openKeySetFile } from './identity-file.js'
import { identityKeySource, openIdentity, readAgainOnSignal } from './identity-settings.js'
import type { IdentityKeySource } from './identity-settings.js'

/*
 * How the server's environment names its identity key (0014, 0059), and what
 * a SIGHUP does with it. Both are outside main.ts, which reads the
 * environment and exits, so that this suite can drive them.
 */

const SECRET = 'env:HOST_SECRET'

describe('identityKeySource', () => {
  // Every case here is a configuration main.ts must refuse before it opens
  // anything, with a sentence naming the setting. A server that started on
  // a guess -- the secret when a key set was also named, HS256 over a PEM's
  // text -- would accept tokens nobody meant it to.
  const refused: Array<{ why: string; env: Record<string, string>; says: RegExp }> = [
    { why: 'no key at all', env: {}, says: /^Set exactly one of FORMANCY_DATA_IDENTITY_SECRET, FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE and FORMANCY_DATA_IDENTITY_KEYS_FILE\.$/ },
    { why: 'a secret and a public key', env: { FORMANCY_DATA_IDENTITY_SECRET: SECRET, FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: '/run/keys/host.pem' }, says: /^Set exactly one of/ },
    { why: 'a secret and a key set', env: { FORMANCY_DATA_IDENTITY_SECRET: SECRET, FORMANCY_DATA_IDENTITY_KEYS_FILE: '/run/identity/keys.json', FORMANCY_DATA_IDENTITY_ALGORITHM: 'HS256' }, says: /^Set exactly one of/ },
    { why: 'all three', env: { FORMANCY_DATA_IDENTITY_SECRET: SECRET, FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: '/k.pem', FORMANCY_DATA_IDENTITY_KEYS_FILE: '/k.json' }, says: /^Set exactly one of/ },
    { why: 'a key set without its algorithm', env: { FORMANCY_DATA_IDENTITY_KEYS_FILE: '/run/identity/keys.json' }, says: /^FORMANCY_DATA_IDENTITY_ALGORITHM is required with FORMANCY_DATA_IDENTITY_KEYS_FILE/ },
    { why: 'a key set with an empty algorithm', env: { FORMANCY_DATA_IDENTITY_KEYS_FILE: '/run/identity/keys.json', FORMANCY_DATA_IDENTITY_ALGORITHM: '' }, says: /^FORMANCY_DATA_IDENTITY_ALGORITHM is required with FORMANCY_DATA_IDENTITY_KEYS_FILE/ },
    { why: 'a key set with another algorithm', env: { FORMANCY_DATA_IDENTITY_KEYS_FILE: '/run/identity/keys.json', FORMANCY_DATA_IDENTITY_ALGORITHM: 'PS256' }, says: /^FORMANCY_DATA_IDENTITY_ALGORITHM is RS256, ES256, EdDSA or HS256 for a key set\.$/ },
    { why: 'a key set at a relative path', env: { FORMANCY_DATA_IDENTITY_KEYS_FILE: 'identity/keys.json', FORMANCY_DATA_IDENTITY_ALGORITHM: 'RS256' }, says: /^FORMANCY_DATA_IDENTITY_KEYS_FILE is an absolute path/ },
    { why: 'a public key without its algorithm', env: { FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: '/run/keys/host.pem' }, says: /^FORMANCY_DATA_IDENTITY_ALGORITHM is required\.$/ },
    // The key-confusion attack 0014 refuses: a PEM's text as an HMAC secret
    // verifies any token its reader signs with it.
    { why: 'HS256 with a public key file', env: { FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: '/run/keys/host.pem', FORMANCY_DATA_IDENTITY_ALGORITHM: 'HS256' }, says: /^HS256 is a shared secret: it is FORMANCY_DATA_IDENTITY_SECRET or a key set, never a public key file\.$/ },
    { why: 'a public key with another algorithm', env: { FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: '/run/keys/host.pem', FORMANCY_DATA_IDENTITY_ALGORITHM: 'PS256' }, says: /^FORMANCY_DATA_IDENTITY_ALGORITHM is RS256, ES256 or EdDSA\.$/ },
  ]

  test.each(refused)('refuses $why', ({ env, says }) => {
    const setting = identityKeySource(env)
    expect(setting.ok).toBe(false)
    expect(setting.ok === false && setting.problem).toMatch(says)
  })

  // The two settings every deployment before 0059 has behave exactly as
  // they did: the secret's algorithm is never read, so a stale
  // FORMANCY_DATA_IDENTITY_ALGORITHM beside it changes nothing.
  test('names each kind, and reads no algorithm beside the secret', () => {
    expect(identityKeySource({ FORMANCY_DATA_IDENTITY_SECRET: SECRET, FORMANCY_DATA_IDENTITY_ALGORITHM: 'nonsense' })).toEqual({ ok: true, source: { kind: 'secret', reference: SECRET } })
    expect(identityKeySource({ FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: 'keys/host.pem', FORMANCY_DATA_IDENTITY_ALGORITHM: 'EdDSA' })).toEqual({ ok: true, source: { kind: 'public-key', path: 'keys/host.pem', algorithm: 'EdDSA' } })
    for (const algorithm of ['RS256', 'ES256', 'EdDSA', 'HS256']) {
      expect(identityKeySource({ FORMANCY_DATA_IDENTITY_KEYS_FILE: '/run/identity/keys.json', FORMANCY_DATA_IDENTITY_ALGORITHM: algorithm })).toEqual({ ok: true, source: { kind: 'key-set', path: '/run/identity/keys.json', algorithm } })
    }
  })
})

describe('openIdentity', () => {
  const claims = { issuer: 'https://host.example', audience: 'formancy-data', attributes: {} }
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'formancy-data-open-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const io = (env: Record<string, string> = {}) => ({ env, readFile: (path: string) => readFile(path, 'utf8') })

  // main.ts prints the problem and exits 1. A short secret and a public key
  // that did not import were thrown by createIdentityVerifier, outside main's
  // handling, and printed a stack trace; every refusal of the key at start is
  // now one sentence, the CHANGELOG's promise, and none holds the secret.
  test('every refusal of the key at start is one sentence, never an exception', async () => {
    const short = 'Fd1-short'
    const notPem = join(directory, 'not.pem')
    await writeFile(notPem, 'nope')
    const rsaPem = join(directory, 'rsa.pem')
    await writeFile(rsaPem, generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }))
    const keys = join(directory, 'keys.json')
    await writeFile(keys, JSON.stringify({ keys: [{ kty: 'oct', kid: 'a', k: 'c2hvcnQ' }] }))
    const cases: Array<{ why: string; source: IdentityKeySource; env?: Record<string, string>; says: string }> = [
      { why: 'a secret file that cannot be read', source: { kind: 'secret', reference: `file:${join(directory, 'none')}` }, says: `the secret file ${join(directory, 'none')} cannot be read` },
      { why: 'a secret under 32 bytes', source: { kind: 'secret', reference: 'env:SHORT' }, env: { SHORT: short }, says: 'the identity secret must be at least 32 bytes' },
      { why: 'a public key file that cannot be read', source: { kind: 'public-key', path: join(directory, 'none.pem'), algorithm: 'ES256' }, says: `the identity public key file ${join(directory, 'none.pem')} cannot be read` },
      { why: 'a public key that is not a PEM', source: { kind: 'public-key', path: notPem, algorithm: 'ES256' }, says: 'the identity public key is not an SPKI PEM public key for ES256' },
      { why: 'a public key of another algorithm', source: { kind: 'public-key', path: rsaPem, algorithm: 'ES256' }, says: 'the identity public key is not an SPKI PEM public key for ES256' },
      { why: 'a key set file that cannot be read', source: { kind: 'key-set', path: join(directory, 'none.json'), algorithm: 'HS256' }, says: `the identity key set file ${join(directory, 'none.json')} cannot be read` },
      { why: 'a key set refused', source: { kind: 'key-set', path: keys, algorithm: 'HS256' }, says: 'key "a" is shorter than 32 bytes, which HS256 needs (0014)' },
    ]
    for (const { why, source, env, says } of cases) {
      const opened = await openIdentity(source, io(env), claims)
      expect(opened, why).toEqual({ ok: false, problem: says })
      expect(JSON.stringify(opened), why).not.toContain(short)
    }
  })

  // What main.ts serves with: a verifier over the key the setting names, and
  // the key set file to read again on SIGHUP only when the setting is one.
  test('opens each kind, with the key set file only for a key set', async () => {
    const secret = randomBytes(32).toString('base64url')
    const token = await new SignJWT({ sub: 'u' }).setProtectedHeader({ alg: 'HS256', kid: 'a' }).setIssuer(claims.issuer).setAudience(claims.audience).setExpirationTime('5m').sign(new TextEncoder().encode(secret))
    const underSecret = await openIdentity({ kind: 'secret', reference: 'env:SECRET' }, io({ SECRET: secret }), claims)
    expect(underSecret).toMatchObject({ ok: true, file: undefined })
    expect(underSecret.ok && (await underSecret.verifyIdentity(token))).toMatchObject({ ok: true })

    const keys = join(directory, 'keys.json')
    await writeFile(keys, JSON.stringify({ keys: [{ kty: 'oct', kid: 'a', k: Buffer.from(secret, 'utf8').toString('base64url') }] }))
    const underSet = await openIdentity({ kind: 'key-set', path: keys, algorithm: 'HS256' }, io(), claims)
    expect(underSet.ok && underSet.file?.current().kids).toEqual(['a'])
    expect(underSet.ok && (await underSet.verifyIdentity(token))).toMatchObject({ ok: true })
  })
})

describe('readAgainOnSignal', () => {
  interface Line {
    level: 'info' | 'warn' | 'error'
    message: string
    fields?: unknown
  }
  const secret = (): string => randomBytes(32).toString('base64url')
  const set = (...keys: Array<[string, string]>): string => JSON.stringify({ keys: keys.map(([kid, k]) => ({ kty: 'oct', kid, k })) })

  let directory: string
  let path: string
  let lines: Line[]
  const log = {
    info: (fields: Record<string, unknown>, message: string) => lines.push({ level: 'info', message, fields }),
    warn: (message: string) => lines.push({ level: 'warn', message }),
    error: (fields: Record<string, unknown>, message: string) => lines.push({ level: 'error', message, fields }),
  }
  const settled = async (count: number): Promise<void> => {
    for (let wait = 0; lines.length < count && wait < 200; wait++) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'formancy-data-signal-'))
    path = join(directory, 'keys.json')
    lines = []
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  // A SIGHUP is the operator's act, and the log line is all it answers
  // with: one line for each signal, saying what was read, that nothing
  // changed, or that nothing was read and the set in force stands. None
  // holds a byte of either file, because the log is read by whoever runs
  // the collector, and the file may be a set of secrets.
  test('each SIGHUP is one line: read again, nothing changed, or not read; none holds material', async () => {
    const [ka, kb] = [secret(), secret()]
    await writeFile(path, set(['a', ka]))
    const signals = new EventEmitter()
    readAgainOnSignal(signals, await openKeySetFile(path, 'HS256'), log)

    await writeFile(join(directory, 'next.json'), set(['a', ka], ['b', kb]))
    await rename(join(directory, 'next.json'), path)
    signals.emit('SIGHUP')
    await settled(1)
    signals.emit('SIGHUP')
    await settled(2)
    await writeFile(path, `{"keys":[{"kty":"oct","kid":"c","k":${kb}}]}`)
    signals.emit('SIGHUP')
    await settled(3)

    expect(lines).toEqual([
      { level: 'info', message: 'identity keys read again', fields: { identityKeys: { kids: ['a', 'b'], added: ['b'], removed: [], replaced: [], leftOut: [] } } },
      { level: 'info', message: 'identity keys read again; nothing changed', fields: { identityKeys: { kids: ['a', 'b'], leftOut: [] } } },
      { level: 'error', message: 'identity keys not read again; the set in force is unchanged', fields: { identityKeys: { kids: ['a', 'b'], problem: 'the identity key set file is not JSON' } } },
    ])
    const written = JSON.stringify(lines)
    for (const material of [ka, kb]) for (let start = 0; start + 8 <= material.length; start++) expect(written).not.toContain(material.slice(start, start + 8))
  })

  // With a one-key setting there is nothing to read again, and the signal
  // says so rather than doing nothing silently -- and rather than stopping
  // the server, which is what SIGHUP does to a Node process with no
  // listener.
  test('with a one-key setting, a SIGHUP is one warning and reads nothing', () => {
    const signals = new EventEmitter()
    readAgainOnSignal(signals, undefined, log)
    signals.emit('SIGHUP')
    expect(lines).toEqual([{ level: 'warn', message: 'SIGHUP: the identity key is not a key set file; nothing was read again' }])
  })

  // The signal itself, sent to this process: Node's default for SIGHUP is to
  // terminate, and a listener removes it. So a server started in a terminal
  // keeps running when the terminal closes, and a `kill -HUP` to a container
  // whose PID 1 is Node reads the keys instead of stopping it. Without the
  // listener, this test's process ends here.
  test('a real SIGHUP reaches the listener and the process keeps running', async () => {
    if (process.platform === 'win32') return
    await writeFile(path, set(['a', secret()]))
    const before = process.listeners('SIGHUP')
    readAgainOnSignal(process, await openKeySetFile(path, 'HS256'), log)
    try {
      process.kill(process.pid, 'SIGHUP')
      await settled(1)
      expect(lines).toMatchObject([{ level: 'info', message: 'identity keys read again; nothing changed' }])
    } finally {
      for (const listener of process.listeners('SIGHUP')) if (!before.includes(listener)) process.off('SIGHUP', listener)
    }
  })
})
