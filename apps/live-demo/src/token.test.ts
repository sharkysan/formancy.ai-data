import { randomBytes } from 'node:crypto'
import { createIdentityVerifier } from '@formancy/data-server'
import { describe, expect, test } from 'vitest'
import { AUDIENCE, ISSUER, MIN_KEY_BYTES, mintToken, TENANT_CLAIM, TOKEN_SECONDS } from './token.js'

/**
 * The demo's tokens, signed with WebCrypto as the Worker and the image's
 * publish signs them, and judged by data-server's own verifier configured
 * as the image configures the server -- FORMANCY_DATA_ISSUER,
 * FORMANCY_DATA_AUDIENCE and FORMANCY_DATA_ATTRIBUTES=tenant=tid, which
 * image/dockerfile.test.ts holds to these constants -- not by a second
 * reading of what a token should look like. As scripts/mint-token.test.mjs
 * judges the composed stack's minter.
 */

// Random per run, as the Durable Object makes one per start: a test that
// passed for one fixed key would say nothing about the next.
const KEY = randomBytes(32).toString('base64url')

function verifier(key: string = KEY) {
  return createIdentityVerifier({ key: { kind: 'secret', secret: key }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: TENANT_CLAIM } })
}

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('a demo token', () => {
  // A signature over other bytes than the server's -- the key's base64url
  // decoded rather than its UTF-8, say -- is a token the server refuses with
  // a 401 and nothing else to say why, and no visitor could sign in.
  test("verifies under the server's own verifier as the persona, with its roles and tenant", async () => {
    const { token } = await mintToken(KEY, { subject: 'clara', roles: ['clerk'], tenant: 1 })
    const outcome = await (await verifier())(token)
    expect(outcome).toEqual({ ok: true, identity: { actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } } })
  })

  // The image's build signs its administrator's token with no tenant: one
  // carrying a tenant would scope nothing at publish, and one carrying a
  // made-up claim the server does not read would be a token that says more
  // than anybody checked.
  test('carries exactly the claims the server reads, and no tenant when none is given', async () => {
    // A whole second, inside the hour the verifier below still accepts.
    const now = Math.floor(Date.now() / 1000) * 1000
    const { token, expiresAt } = await mintToken(KEY, { subject: 'image-build', roles: ['data-admin'] }, now)
    const issuedAt = now / 1000
    expect(claims(token)).toEqual({ iss: ISSUER, aud: AUDIENCE, sub: 'image-build', roles: ['data-admin'], iat: issuedAt, exp: issuedAt + TOKEN_SECONDS })
    expect(JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'))).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(expiresAt).toBe((issuedAt + TOKEN_SECONDS) * 1000)
    expect(await (await verifier())(token)).toEqual({ ok: true, identity: { actor: { id: 'image-build', roles: ['data-admin'] }, attributes: {} } })
  })

  // An hour: long enough for a visit, which a container outlives by ten
  // minutes at most, and a token from before a restart dies with its key
  // anyway. A lifetime counted in milliseconds would be a token valid for
  // a thousand hours.
  test('expires an hour after it is issued', async () => {
    const now = Date.now()
    const { token } = await mintToken(KEY, { subject: 'otto', roles: ['clerk'], tenant: 2 }, now)
    const { iat, exp } = claims(token)
    expect(TOKEN_SECONDS).toBe(3600)
    expect(exp).toBe(Number(iat) + 3600)
    expect(iat).toBe(Math.floor(now / 1000))
  })

  // Each start's key is new; a token signed by the last one must stop
  // working with it, which is how a visitor's token dies with the instance.
  test('is refused under another key', async () => {
    const { token } = await mintToken(KEY, { subject: 'vera', roles: ['auditor'], tenant: 1 })
    const outcome = await (await verifier(randomBytes(32).toString('base64url')))(token)
    expect(outcome.ok).toBe(false)
  })

  // The server refuses to start on a key shorter than 32 bytes
  // (KeySet.fromSecret); a minter that signed with one would hand out
  // tokens for a server that never answers. Both refuse it.
  test('is not signed with a key the server would refuse to start with', async () => {
    const short = 'k'.repeat(MIN_KEY_BYTES - 1)
    await expect(mintToken(short, { subject: 'clara', roles: ['clerk'], tenant: 1 })).rejects.toThrow(`at least ${String(MIN_KEY_BYTES)} bytes`)
    await expect(verifier(short)).rejects.toThrow()
    // Counted in UTF-8 bytes, as the server counts: 16 two-byte characters are 32 bytes.
    const accented = 'é'.repeat(16)
    await expect(verifier(accented)).resolves.toBeTypeOf('function')
    const { token } = await mintToken(accented, { subject: 'clara', roles: ['clerk'], tenant: 1 })
    expect((await (await verifier(accented))(token)).ok).toBe(true)
  })
})
