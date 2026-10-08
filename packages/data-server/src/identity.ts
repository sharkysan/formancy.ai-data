import { createSecretKey } from 'node:crypto'
import { importSPKI, jwtVerify } from 'jose'
import type { CryptoKey, JWTPayload, KeyObject } from 'jose'

/**
 * Who is asking, as the host application vouched for it.
 *
 * Built only from a token whose signature verified. Nothing in a request body,
 * query or header other than that token contributes to it — a tenant named in a
 * request is a claim by the browser, and the browser is the party policy exists
 * to constrain.
 */
export interface HostIdentity {
  actor: { id: string; roles: string[] }
  attributes: Record<string, string>
}

export type IdentityOutcome = { ok: true; identity: HostIdentity } | { ok: false; reason: string }

export type IdentityVerifier = (token: string) => Promise<IdentityOutcome>

export interface IdentityOptions {
  /**
   * How tokens are signed. A shared secret (HS256), or a public key the host
   * signs against with its private one. Never a URL to fetch keys from: that
   * would be an outbound request from inside a customer's network on every
   * cold start, and a key set that changes under a running server.
   */
  key: { kind: 'secret'; secret: string } | { kind: 'public-key'; pem: string; algorithm: 'RS256' | 'ES256' | 'EdDSA' }
  issuer: string
  audience: string
  /** Attribute name to claim name, e.g. `{ tenant: 'tid' }`. Only these claims are read. */
  attributes: Readonly<Record<string, string>>
  /** The claim holding the actor's roles. Default `roles`. */
  rolesClaim?: string
  /** Seconds of clock skew tolerated on `exp` and `nbf`. Default 30. */
  clockToleranceSeconds?: number
}

/** 256 bits, the strength HS256 offers. A shorter secret is a weaker key than the algorithm claims. */
const MIN_SECRET_BYTES = 32

/**
 * A verifier for the host application's tokens, built once at startup.
 *
 * Fails at construction on a configuration that would accept forgeries — a
 * short secret, a key that does not parse — rather than on the first request.
 * The algorithm is pinned per key kind, so a token cannot choose `none` or
 * swap an asymmetric key for a shared one.
 */
export async function createIdentityVerifier(options: IdentityOptions): Promise<IdentityVerifier> {
  let key: KeyObject | CryptoKey
  let algorithm: string
  if (options.key.kind === 'secret') {
    if (Buffer.byteLength(options.key.secret, 'utf8') < MIN_SECRET_BYTES) {
      throw new Error(`the identity secret must be at least ${String(MIN_SECRET_BYTES)} bytes`)
    }
    key = createSecretKey(Buffer.from(options.key.secret, 'utf8'))
    algorithm = 'HS256'
  } else {
    key = await importSPKI(options.key.pem, options.key.algorithm)
    algorithm = options.key.algorithm
  }

  const rolesClaim = options.rolesClaim ?? 'roles'
  const tolerance = options.clockToleranceSeconds ?? 30

  return async (token) => {
    let payload: JWTPayload
    try {
      ;({ payload } = await jwtVerify(token, key, {
        algorithms: [algorithm],
        issuer: options.issuer,
        audience: options.audience,
        clockTolerance: tolerance,
        requiredClaims: ['sub', 'exp'],
      }))
    } catch (error) {
      // The reason is jose's code, never the token: a token in a log is a
      // credential in a log.
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'ERR_JWT_INVALID'
      return { ok: false, reason: code }
    }

    const id = payload.sub
    if (typeof id !== 'string' || id === '') return { ok: false, reason: 'the token has no subject' }

    const roles = payload[rolesClaim] ?? []
    if (!Array.isArray(roles) || !roles.every((role) => typeof role === 'string')) {
      return { ok: false, reason: `the ${rolesClaim} claim is not a list of strings` }
    }

    const attributes: Record<string, string> = {}
    for (const [attribute, claim] of Object.entries(options.attributes)) {
      const value = payload[claim]
      if (value === undefined) continue
      // A tenant id is often a number in a token. A whole number is the same
      // tenant as its decimal string; anything else is not an identifier.
      if (typeof value === 'string') attributes[attribute] = value
      else if (typeof value === 'number' && Number.isSafeInteger(value)) attributes[attribute] = String(value)
      else return { ok: false, reason: `the ${claim} claim is not a string or a whole number` }
    }

    return { ok: true, identity: { actor: { id, roles: [...roles] }, attributes } }
  }
}
