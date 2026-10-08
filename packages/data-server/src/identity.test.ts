import { createSecretKey, generateKeyPairSync } from 'node:crypto'
import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { createIdentityVerifier } from './identity.js'
import type { IdentityOptions } from './identity.js'

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
