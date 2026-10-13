import type { JWTPayload } from 'jose'
import { isKeySet, KeySet, verifyWithKeySet } from './identity-keys.js'

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

/** A setting that names one key: a shared secret, or a public key's PEM. Its tokens' kid is ignored. */
export type OneKey = { kind: 'secret'; secret: string } | { kind: 'public-key'; pem: string; algorithm: 'RS256' | 'ES256' | 'EdDSA' }

export interface IdentityOptions {
  /**
   * How tokens are signed. A shared secret (HS256), a public key the host
   * signs against with its private one, or a key set read from a file and
   * read again on SIGHUP, whose `keys` is asked on every token. Never a URL,
   * and never a key or a URL a token names: an outbound request from inside
   * a customer's network, and a key the token chooses (0014, 0059).
   */
  key: OneKey | { kind: 'key-set'; keys: () => KeySet }
  issuer: string
  audience: string
  /** Attribute name to claim name, e.g. `{ tenant: 'tid' }`. Only these claims are read. */
  attributes: Readonly<Record<string, string>>
  /** The claim holding the actor's roles. Default `roles`. */
  rolesClaim?: string
  /** Seconds of clock skew tolerated on `exp` and `nbf`. Default 30. */
  clockToleranceSeconds?: number
}

/** Why a token is refused when the verifier is handed something that is not a set the builders made. */
const NOT_A_KEY_SET = 'the identity key set is not one readKeySet made'

/**
 * The set a one-key setting verifies with: a secret's UTF-8 bytes, at least
 * 32 of them, or the PEM as jose imports it. What `identity-keys-cli.mjs
 * convert` writes is this set's key, so the two never differ.
 */
export async function oneKeySet(key: OneKey): Promise<KeySet> {
  return key.kind === 'secret' ? KeySet.fromSecret(key.secret) : KeySet.fromPem(key.pem, key.algorithm)
}

/**
 * A verifier for the host application's tokens, built once at startup.
 *
 * Fails at construction on a configuration that would accept forgeries — a
 * short secret, a key that does not parse, a key set no builder checked —
 * rather than on the first request. The algorithm is pinned per key kind, and
 * for a whole key set, so a token cannot choose `none` or swap an asymmetric
 * key for a shared one.
 *
 * A key set's `keys` is asked once per token, so a set read again replaces
 * the one in force between tokens, and a verification that has begun
 * finishes on the set it began with.
 */
export async function createIdentityVerifier(options: IdentityOptions): Promise<IdentityVerifier> {
  let keys: () => unknown
  if (options.key.kind === 'key-set') {
    keys = options.key.keys
    if (!isKeySet(keys())) throw new Error(NOT_A_KEY_SET)
  } else {
    const set = await oneKeySet(options.key)
    keys = () => set
  }

  const rolesClaim = options.rolesClaim ?? 'roles'
  const tolerance = options.clockToleranceSeconds ?? 30

  return async (token) => {
    let set: unknown
    try {
      set = keys()
    } catch {
      set = undefined
    }
    if (!isKeySet(set)) return { ok: false, reason: NOT_A_KEY_SET }

    let payload: JWTPayload
    try {
      // Never a method looked up on the set: its class is frozen, and its
      // verification is reached only through this module function (0059).
      ;({ payload } = await verifyWithKeySet(set, token, {
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
