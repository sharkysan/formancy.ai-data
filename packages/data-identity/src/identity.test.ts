import { createSecretKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT } from 'jose'
import type { JWTHeaderParameters } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createIdentityVerifier } from './identity.js'
import type { IdentityOptions } from './identity.js'
import { KeySet, readKeySet } from './identity-keys.js'

const SECRET = 'a-shared-secret-of-at-least-thirty-two-bytes'
const BASE: IdentityOptions = {
  key: { kind: 'secret', secret: SECRET },
  issuer: 'https://host.example',
  audience: 'formancy-data',
  attributes: { tenant: 'tid' },
}

async function token(claims: Record<string, unknown>, options: { secret?: string; issuer?: string; audience?: string; expires?: string } = {}): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? BASE.issuer)
    .setAudience(options.audience ?? BASE.audience)
  if (options.expires !== '') jwt = jwt.setExpirationTime(options.expires ?? '5m')
  return jwt.sign(createSecretKey(Buffer.from(options.secret ?? SECRET, 'utf8')))
}

describe('createIdentityVerifier', () => {
  // The whole point: the identity is exactly what the host signed.
  test('a valid token becomes an actor with roles and mapped attributes', async () => {
    const verify = await createIdentityVerifier(BASE)
    const outcome = await verify(await token({ sub: 'u-1', roles: ['clerk'], tid: 'acme', other: 'ignored' }))
    expect(outcome).toEqual({ ok: true, identity: { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: 'acme' } } })
  })

  // A tenant id is often numeric in a token. The same tenant must not become
  // two different attribute values depending on how the host serialised it.
  test('a whole-number claim becomes its decimal string; anything else is refused', async () => {
    const verify = await createIdentityVerifier(BASE)
    expect(await verify(await token({ sub: 'u', tid: 42 }))).toMatchObject({ ok: true, identity: { attributes: { tenant: '42' } } })
    expect(await verify(await token({ sub: 'u', tid: 4.2 }))).toMatchObject({ ok: false })
    expect(await verify(await token({ sub: 'u', tid: { id: 1 } }))).toMatchObject({ ok: false })
  })

  // A missing attribute is absent, not empty: the policy layer refuses an
  // operation that needs it, where an empty string would match nothing — or,
  // worse, a row whose tenant column is the empty string.
  test('a missing claim leaves the attribute absent, and missing roles mean none', async () => {
    const verify = await createIdentityVerifier(BASE)
    expect(await verify(await token({ sub: 'u' }))).toEqual({ ok: true, identity: { actor: { id: 'u', roles: [] }, attributes: {} } })
    expect(await verify(await token({ sub: 'u', roles: 'admin' }))).toMatchObject({ ok: false, reason: /not a list of strings/ })
  })

  // Each of these is a token somebody other than the host could produce, or one
  // the host produced for somebody else. Every one must be refused.
  test('refuses wrong signature, issuer, audience, expiry and missing subject', async () => {
    const verify = await createIdentityVerifier(BASE)
    expect(await verify(await token({ sub: 'u' }, { secret: 'another-secret-of-at-least-thirty-two-bytes' }))).toMatchObject({ ok: false })
    expect(await verify(await token({ sub: 'u' }, { issuer: 'https://evil.example' }))).toMatchObject({ ok: false })
    expect(await verify(await token({ sub: 'u' }, { audience: 'someone-else' }))).toMatchObject({ ok: false })
    expect(await verify(await token({ sub: 'u' }, { expires: '-5m' }))).toMatchObject({ ok: false })
    expect(await verify(await token({ sub: 'u' }, { expires: '' }))).toMatchObject({ ok: false })
    expect(await verify(await token({ roles: ['admin'] }))).toMatchObject({ ok: false })
    expect(await verify('not.a.token')).toMatchObject({ ok: false })
  })

  // The classic forgery: an unsigned token, alg "none". The algorithm is pinned,
  // so the token cannot choose it.
  test('refuses an unsigned token', async () => {
    const verify = await createIdentityVerifier(BASE)
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ sub: 'u', iss: BASE.issuer, aud: BASE.audience, exp: 9_999_999_999 })).toString('base64url')
    expect(await verify(`${header}.${body}.`)).toMatchObject({ ok: false })
  })

  // A compact JWS is three base64url parts and nothing else, without padding
  // (RFC 7515, 7.1 and 2). jose decodes a part with an `=` after it to the
  // same bytes, so the host's token with one more character verified as the
  // host's own: two spellings of one credential, which a cache, a log or a
  // list of revoked tokens keyed by the token's text would tell apart. Each
  // spelling but the one the host signed is refused as malformed, before any
  // key is asked (0100). Watched failing with the signature's `=` accepted.
  test('refuses a token that is not its compact form exactly', async () => {
    const verify = await createIdentityVerifier(BASE)
    const signed = await token({ sub: 'u' })
    expect(await verify(signed)).toMatchObject({ ok: true })
    const [header = '', body = '', signature = ''] = signed.split('.')
    for (const spelling of [`${header}.${body}.${signature}=`, `${header}=.${body}.${signature}`, `${header}.${body}=.${signature}`, ` ${signed}`, `${signed}\n`, `${header}.${body}.${signature.replaceAll('-', '+').replaceAll('_', '/')}+`]) {
      expect(await verify(spelling), JSON.stringify(spelling.slice(-3))).toEqual({ ok: false, reason: 'ERR_JWS_INVALID' })
    }
  })

  // A short HMAC secret is a weaker key than HS256 claims. Refused at startup,
  // not discovered after the server has been accepting tokens.
  test('refuses a secret shorter than 32 bytes at construction', async () => {
    await expect(createIdentityVerifier({ ...BASE, key: { kind: 'secret', secret: 'short' } })).rejects.toThrow(/at least 32 bytes/)
  })

  // The asymmetric path, and the key-confusion attack against it: a token
  // HMAC-signed with the public key's text must not verify.
  test('verifies against a public key, and refuses an HS256 token signed with that key', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const verify = await createIdentityVerifier({ ...BASE, key: { kind: 'public-key', pem, algorithm: 'ES256' } })
    const signed = await new SignJWT({ sub: 'u', tid: 't' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(BASE.issuer)
      .setAudience(BASE.audience)
      .setExpirationTime('5m')
      .sign(pair.privateKey)
    expect(await verify(signed)).toMatchObject({ ok: true, identity: { attributes: { tenant: 't' } } })
    expect(await verify(await token({ sub: 'u' }, { secret: pem }))).toMatchObject({ ok: false })
  })
})

/*
 * A key set (0059): each key selected by the kid a token names, a token
 * without one tried against each key, the algorithm pinned for the whole set,
 * and no member of a token's header but its kid choosing a key.
 */
describe('createIdentityVerifier with a key set', () => {
  interface Held {
    kid: string
    secret: KeyObject
    jwk: Record<string, unknown>
  }
  const hs = (kid: string): Held => {
    const bytes = randomBytes(32)
    return { kid, secret: createSecretKey(bytes), jwk: { kty: 'oct', kid, k: bytes.toString('base64url') } }
  }
  const [a, b, c] = [hs('a'), hs('b'), hs('c')]
  const verifierOf = (...held: Held[]) => createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => readKeySet(JSON.stringify({ keys: held.map((key) => key.jwk) }), 'HS256') } })

  async function signed(key: KeyObject, header: Partial<JWTHeaderParameters> = {}, expires = '5m', alg = 'HS256'): Promise<string> {
    return new SignJWT({ sub: 'u', tid: 't' }).setProtectedHeader({ alg, ...header }).setIssuer(BASE.issuer).setAudience(BASE.audience).setExpirationTime(expires).sign(key)
  }

  // A kid is the token saying which key it was signed with. Selecting that
  // key and no other means a host whose kid is wrong fails loudly, rather
  // than verifying under whichever key happens to fit.
  test('a kid selects that key and no other', async () => {
    const verify = await verifierOf(a, b)
    expect(await verify(await signed(a.secret, { kid: 'a' }))).toMatchObject({ ok: true })
    expect(await verify(await signed(a.secret, { kid: 'b' }))).toEqual({ ok: false, reason: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })
  })

  // An unknown kid is a key the server does not hold, even when another key
  // would verify the signature: an operator reading the reason learns the
  // set is missing a key, not that the token was forged.
  test('a kid the set does not hold is ERR_JWKS_NO_MATCHING_KEY', async () => {
    const verify = await verifierOf(a, b)
    expect(await verify(await signed(a.secret, { kid: 'z' }))).toEqual({ ok: false, reason: 'ERR_JWKS_NO_MATCHING_KEY' })
  })

  // A kid that is not a string names no key at all: the token is malformed,
  // not signed by a key the set lacks.
  test('a kid that is not a string is ERR_JWS_INVALID', async () => {
    const verify = await verifierOf(a, b)
    expect(await verify(await signed(a.secret, { kid: 7 as unknown as string }))).toEqual({ ok: false, reason: 'ERR_JWS_INVALID' })
  })

  // A host that signs its own HS256 tokens has never sent a kid. Rotating
  // must not first need its signer changed: the key that signed it
  // verifies, wherever it is in the set, and one that no key signed is a
  // signature failure, not a choice jose refuses to make (J1).
  test('without a kid, the key that signed it verifies wherever it is in the set', async () => {
    const verify = await verifierOf(a, b, c)
    expect(await verify(await signed(c.secret))).toMatchObject({ ok: true, identity: { actor: { id: 'u' } } })
    expect(await verify(await signed(hs('x').secret))).toEqual({ ok: false, reason: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })
  })

  // Only a signature that does not verify moves on to the next key. A token
  // the second key verifies and that has expired is expired: trying the third
  // would turn its reason into a signature failure, and an operator reading
  // the log would look for the wrong mistake.
  test('an expired token signed by the second key is refused as expired, and not tried further', async () => {
    const verify = await verifierOf(a, b, c)
    expect(await verify(await signed(b.secret, {}, '-5m'))).toEqual({ ok: false, reason: 'ERR_JWT_EXPIRED' })
  })

  // An RSA key without alg fits any RSA algorithm in jose (J2). The set pins
  // one, so a token cannot choose PS256 over an RS256 key.
  test('a PS256 token over an RSA key without alg is refused', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const verify = await createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => readKeySet(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'r' }] }), 'RS256') } })
    expect(await verify(await signed(pair.privateKey, { kid: 'r' }, '5m', 'RS256'))).toMatchObject({ ok: true })
    expect(await verify(await signed(pair.privateKey, { kid: 'r' }, '5m', 'PS256'))).toEqual({ ok: false, reason: 'ERR_JOSE_ALG_NOT_ALLOWED' })
  })

  // A malformed token keeps the code it has under one key (M5): the key is
  // chosen inside jwtVerify, after jose has refused what is not a JWS, where
  // decodeProtectedHeader would throw a TypeError with no code at all.
  test('a malformed token is ERR_JWS_INVALID under a set, as under one key', async () => {
    const underSet = await verifierOf(a, b)
    const underOne = await createIdentityVerifier(BASE)
    for (const token of ['', 'abc', 'a.b.c', '!!.e30.x']) {
      expect(await underSet(token)).toEqual({ ok: false, reason: 'ERR_JWS_INVALID' })
      expect(await underOne(token)).toEqual({ ok: false, reason: 'ERR_JWS_INVALID' })
    }
  })

  // The key a token carries, or a URL it names, is the forger's (0014): a
  // token signed by an attacker's key that brings that key along in `jwk`,
  // or points at it with `jku`, verifies only against the set, and the
  // server it points at hears nothing -- no outbound request, and no SSRF.
  describe('a token that carries a key or names a URL', () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests++
      response.end('{"keys":[]}')
    })
    beforeAll(async () => {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    })
    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve))
    })

    test('verifies only against the set, and nothing is fetched', async () => {
      const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const ours = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const verify = await createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => readKeySet(JSON.stringify({ keys: [{ ...ours.publicKey.export({ format: 'jwk' }), kid: 'a' }] }), 'ES256') } })
      const jwk = pair.publicKey.export({ format: 'jwk' })
      const jku = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/jwks`
      const forged = [
        await signed(pair.privateKey, { kid: 'a', jwk }, '5m', 'ES256'),
        await signed(pair.privateKey, { jwk }, '5m', 'ES256'),
        await signed(pair.privateKey, { kid: 'a', jku }, '5m', 'ES256'),
        await signed(pair.privateKey, { kid: 'theirs', jku, x5u: jku }, '5m', 'ES256'),
      ]
      for (const token of forged) expect(await verify(token)).toMatchObject({ ok: false })
      expect(await verify(await signed(ours.privateKey, { kid: 'a', jwk }, '5m', 'ES256'))).toMatchObject({ ok: true })
      expect(requests).toBe(0)
    })
  })

  // identity.ts promises that a configuration that would accept forgeries
  // fails at construction. An embedder's hand-built set -- mixed
  // algorithms, a private key, a short secret -- is one no builder checked,
  // so it verifies nothing: refused at construction, and refused per token
  // when a later call hands one over.
  test('a hand-built set verifies nothing', async () => {
    const lookalike = { kids: ['a'], leftOut: [], algorithm: 'HS256', keyTypes: ['secret'], verify: async () => ({ payload: { sub: 'u', exp: 9_999_999_999 } }) } as unknown as KeySet
    await expect(createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => lookalike } })).rejects.toThrow(/not one readKeySet made/)
    await expect(createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => Object.create(KeySet.prototype) as KeySet } })).rejects.toThrow(/not one readKeySet made/)

    const real = readKeySet(JSON.stringify({ keys: [a.jwk] }), 'HS256')
    let handed: () => KeySet = () => real
    const verify = await createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => handed() } })
    const token = await signed(a.secret, { kid: 'a' })
    expect(await verify(token)).toMatchObject({ ok: true })
    handed = () => lookalike
    expect(await verify(token)).toEqual({ ok: false, reason: 'the identity key set is not one readKeySet made' })
    handed = () => {
      throw new Error('the embedder failed')
    }
    expect(await verify(token)).toEqual({ ok: false, reason: 'the identity key set is not one readKeySet made' })
  })

  // A set is checked by its builders and verified by this module alone. Were
  // its verification a method looked up on the set, code that reached the
  // class -- an own property on a set, or the prototype's -- would turn every
  // verifier into one that accepts anything, the one-key ones the server's
  // main.ts builds included; and a public verify would let an embedder pass
  // looser options than these. Each attempt below is refused, or changes nothing.
  test('replacing a set’s methods, or the class’s, changes nothing the verifier accepts', async () => {
    const forged = async () => ({ payload: { sub: 'forged', exp: 9_999_999_999 }, protectedHeader: { alg: 'HS256' } })
    const real = readKeySet(JSON.stringify({ keys: [a.jwk] }), 'HS256')
    const restores: Array<() => void> = []
    const replace = (target: object, name: string, value: unknown): void => {
      const before = Object.getOwnPropertyDescriptor(target, name)
      try {
        Object.defineProperty(target, name, { value, configurable: true, writable: true })
      } catch {
        return // frozen: nothing was replaced
      }
      restores.push(() => {
        if (before === undefined) Reflect.deleteProperty(target, name)
        else Object.defineProperty(target, name, before)
      })
    }
    try {
      replace(real, 'verify', forged)
      replace(KeySet.prototype, 'verify', forged)
      replace(KeySet, 'is', () => true)
      replace(KeySet, 'fromSecret', () => real)
      const underSet = await createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => real } })
      const underSecret = await createIdentityVerifier(BASE)
      expect(await underSet('x.y.z')).toEqual({ ok: false, reason: 'ERR_JWS_INVALID' })
      expect(await underSecret('x.y.z')).toEqual({ ok: false, reason: 'ERR_JWS_INVALID' })
      await expect(createIdentityVerifier({ ...BASE, key: { kind: 'key-set', keys: () => ({}) as KeySet } })).rejects.toThrow(/not one readKeySet made/)
      expect(await underSecret(await signed(createSecretKey(Buffer.from(SECRET, 'utf8'))))).toMatchObject({ ok: true })
      expect('verify' in Object.getPrototypeOf(real)).toBe(false)
    } finally {
      for (const restore of restores.reverse()) restore()
    }
  })

  // The one-key settings are what every deployment before 0059 runs: a kid
  // in their tokens was ignored, and selecting by it now would refuse every
  // token of a provider that names one under a pinned PEM.
  test('the one-key settings ignore a kid, as before', async () => {
    const pair = generateKeyPairSync('ed25519')
    const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const underPem = await createIdentityVerifier({ ...BASE, key: { kind: 'public-key', pem, algorithm: 'EdDSA' } })
    expect(await underPem(await signed(pair.privateKey, { kid: 'anything' }, '5m', 'EdDSA'))).toMatchObject({ ok: true })
    const underSecret = await createIdentityVerifier(BASE)
    expect(await underSecret(await signed(createSecretKey(Buffer.from(SECRET, 'utf8')), { kid: 'anything' }))).toMatchObject({ ok: true })
  })
})
