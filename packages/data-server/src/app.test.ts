import { describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { IdentityVerifier } from './identity.js'

/**
 * A verifier that accepts one literal token. The real one has its own suite;
 * what is under test here is what the HTTP layer does with each outcome.
 */
const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'good'
    ? { ok: true, identity: { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: 'acme' } } }
    : { ok: false, reason: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }

describe('the data server', () => {
  // A container orchestrator needs a route that answers without credentials.
  test('health answers without a token', async () => {
    const app = await createDataServer({ verifyIdentity })
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  // The person wiring a host in sees exactly the identity the server derived.
  test('whoami returns the verified identity', async () => {
    const app = await createDataServer({ verifyIdentity })
    const response = await app.inject({ method: 'GET', url: '/v1/whoami', headers: { authorization: 'Bearer good' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: 'acme' } })
  })

  // No token, a bad token, and a header that is not a bearer token are all the
  // same answer: 401, with the scheme named, and no detail an attacker could use.
  test('whoami refuses a missing, bad or malformed token with 401', async () => {
    const app = await createDataServer({ verifyIdentity })
    for (const headers of [{}, { authorization: 'Bearer bad' }, { authorization: 'Basic dTpw' }, { authorization: 'Bearer a b' }]) {
      const response = await app.inject({ method: 'GET', url: '/v1/whoami', headers })
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.json()).toEqual({ code: 'unauthenticated', message: 'A valid host token is required.' })
    }
  })

  // The routes the plan describes and this release does not have must not
  // answer as if they did.
  test('a route that does not exist yet is a 404, not a placeholder', async () => {
    const app = await createDataServer({ verifyIdentity })
    const response = await app.inject({ method: 'POST', url: '/v1/forms/x/records/read', headers: { authorization: 'Bearer good' } })
    expect(response.statusCode).toBe(404)
  })
})
