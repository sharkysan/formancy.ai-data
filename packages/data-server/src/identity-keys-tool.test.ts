import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createIdentityVerifier } from './identity.js'
import { readKeySet } from './identity-keys.js'
import { runKeysTool } from './identity-keys-tool.js'

/*
 * `node dist/identity-keys-cli.mjs`, the tool the image ships beside the
 * server (0059): `check` runs the server's own readKeySet over a file before
 * an operator renames it into place, and `convert` writes the key the server
 * verifies with today as a one-key set. Both are the server's functions, so
 * neither holds a second reading of a key file or a secret.
 */

const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

let directory: string
let out: string
let err: string
const io = {
  stdout: (text: string) => {
    out += text
  },
  stderr: (text: string) => {
    err += text
  },
  readFile: (path: string) => readFile(path, 'utf8'),
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'formancy-data-keys-tool-'))
  out = ''
  err = ''
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('check', () => {
  // The operator's job runs it before every rename: what it prints is what
  // the server would hold in force, and what it would leave out, by kid and
  // by the member that left it out.
  test('exits 0 and lists what is in force and what is left out', async () => {
    const path = join(directory, 'keys.json')
    const signing = { ...generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' }), kid: 'sig-1', use: 'sig' }
    const encryption = { ...generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' }), kid: 'rsa-enc', use: 'enc', alg: 'RSA-OAEP' }
    await writeFile(path, JSON.stringify({ keys: [signing, encryption] }))
    expect(await runKeysTool(['check', path, 'RS256'], {}, io)).toBe(0)
    expect(out).toBe('in force: sig-1\nleft out: rsa-enc (use)\n')
    expect(err).toBe('')
  })

  // A refused file is exit status 1, so the job stops before the rename,
  // and the sentence -- which goes to the job's log -- holds none of the
  // file: here a secret pasted in without its quotes.
  test('exits 1 on a refused file, with the sentence and no material', async () => {
    const secret = randomBytes(32).toString('base64url')
    const path = join(directory, 'keys.json')
    await writeFile(path, `{"keys":[{"kty":"oct","kid":"a","k":${secret}}]}`)
    expect(await runKeysTool(['check', path, 'HS256'], {}, io)).toBe(1)
    expect(err).toBe('the identity key set file is not JSON\n')
    expect(out).toBe('')
    expect(await runKeysTool(['check', join(directory, 'none.json'), 'HS256'], {}, io)).toBe(1)
    expect(err).toContain('cannot be read')
  })

  // An operator's job that mistyped the command, or named an algorithm the
  // server would not run on, must stop, not rename an unchecked file into
  // place.
  test('exits 1 with the usage on anything else', async () => {
    for (const argv of [[], ['check', 'keys.json'], ['check', 'keys.json', 'PS256'], ['convert'], ['rotate', 'a']]) {
      err = ''
      expect(await runKeysTool(argv, {}, io)).toBe(1)
      expect(err).toMatch(/check <file> <RS256\|ES256\|EdDSA\|HS256>|is RS256, ES256, EdDSA or HS256/)
    }
    expect(out).toBe('')
  })
})

describe('convert', () => {
  // The secret the server verifies with is its UTF-8 bytes after
  // resolveSecret has taken one trailing newline off a file. The obvious
  // one-liner gets that wrong twice, and nothing would notice: the secret's
  // text is itself valid base64url, another key (M2), and a file's bytes as
  // read keep the newline. Either way the set is valid and every token is
  // refused. So the set convert writes must verify the token the minter
  // signs, the way it signs (TextEncoder over the resolved secret), as the
  // secret itself does.
  test('from a file: secret with a trailing newline, writes the key the server verifies with', async () => {
    const secret = `Fd1-${randomBytes(33).toString('base64url')}`
    const file = join(directory, 'host-token-secret')
    await writeFile(file, `${secret}\n`)
    const env = { FORMANCY_DATA_IDENTITY_SECRET: `file:${file}` }
    expect(await runKeysTool(['convert', 'host-1'], env, io)).toBe(0)
    expect(err).toBe('Set FORMANCY_DATA_IDENTITY_KEYS_FILE to where this set is, FORMANCY_DATA_IDENTITY_ALGORITHM=HS256, and unset FORMANCY_DATA_IDENTITY_SECRET.\n')

    const token = await new SignJWT({ sub: 'u' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(secret))
    const set = readKeySet(out, 'HS256')
    expect(set.kids).toEqual(['host-1'])
    const underSet = await createIdentityVerifier({ key: { kind: 'key-set', keys: () => set }, issuer: ISSUER, audience: AUDIENCE, attributes: {} })
    const underSecret = await createIdentityVerifier({ key: { kind: 'secret', secret }, issuer: ISSUER, audience: AUDIENCE, attributes: {} })
    expect(await underSecret(token)).toMatchObject({ ok: true })
    expect(await underSet(token)).toMatchObject({ ok: true })
  })

  // A public key moves into a set as itself: the same key, with the
  // algorithm the server pinned, so nothing about which tokens verify
  // changes but the file it is read from.
  test('from a public key file, writes that key', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = join(directory, 'host.pem')
    await writeFile(pem, pair.publicKey.export({ type: 'spki', format: 'pem' }))
    expect(await runKeysTool(['convert', 'es-1'], { FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: pem, FORMANCY_DATA_IDENTITY_ALGORITHM: 'ES256' }, io)).toBe(0)
    const written = (JSON.parse(out) as { keys: Array<Record<string, unknown>> }).keys
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ kty: 'EC', kid: 'es-1', alg: 'ES256', crv: 'P-256' })
    expect(createPublicKey({ key: written[0] as never, format: 'jwk' }).equals(pair.publicKey)).toBe(true)
    expect(err).toContain('FORMANCY_DATA_IDENTITY_ALGORITHM=ES256')
  })

  // A set is converted already; writing another over it from the same
  // environment would be the operator's typo, and the server would not
  // start with both settings anyway.
  test('refuses an environment that names a key set file', async () => {
    const env = { FORMANCY_DATA_IDENTITY_KEYS_FILE: '/run/identity/keys.json', FORMANCY_DATA_IDENTITY_ALGORITHM: 'HS256' }
    expect(await runKeysTool(['convert', 'a'], env, io)).toBe(1)
    expect(err).toMatch(/already names a key set file/)
    expect(out).toBe('')
  })

  // The public key file itself is not checked for a key under which anyone
  // signs, as it was not before (0059); the set convert writes from it is
  // read back first, so moving such a key into a set stops here, with the
  // sentence the server would log.
  test('refuses a public key under which anyone signs', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' })
    const weak = [
      { algorithm: 'RS256', key: createPublicKey({ key: { ...rsa, e: 'AQ' }, format: 'jwk' }), says: /RSA public exponent is not an odd number of at least 65537/ },
      { algorithm: 'EdDSA', key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64url') }, format: 'jwk' }), says: /is an Ed25519 point of small order/ },
    ]
    for (const { algorithm, key, says } of weak) {
      const pem = join(directory, `${algorithm}.pem`)
      await writeFile(pem, key.export({ type: 'spki', format: 'pem' }))
      out = ''
      err = ''
      expect(await runKeysTool(['convert', 'weak'], { FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: pem, FORMANCY_DATA_IDENTITY_ALGORITHM: algorithm }, io), algorithm).toBe(1)
      expect(err, algorithm).toMatch(says)
      expect(out, algorithm).toBe('')
    }
  })

  // What the server would refuse, convert refuses with the server's own
  // sentence and never the secret: a short one, an unset one, a bad kid.
  test('refuses what the server refuses, without the secret', async () => {
    const short = 'Fd1-short-secret'
    expect(await runKeysTool(['convert', 'a'], { FORMANCY_DATA_IDENTITY_SECRET: 'env:SHORT', SHORT: short }, io)).toBe(1)
    expect(err).toMatch(/at least 32 bytes/)
    expect(await runKeysTool(['convert', 'a b'], { FORMANCY_DATA_IDENTITY_SECRET: 'env:LONG', LONG: `${short}${short}${short}` }, io)).toBe(1)
    expect(err).toMatch(/a kid is a non-empty string/)
    expect(await runKeysTool(['convert', 'a'], {}, io)).toBe(1)
    expect(err).toMatch(/Set exactly one of/)
    expect(err).not.toContain(short)
    expect(out).toBe('')
  })
})
