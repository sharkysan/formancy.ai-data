/*
 * The live demo's tokens: HS256 over a key's UTF-8 bytes, signed with
 * WebCrypto, so one function serves the Worker -- which signs a persona's
 * token with the key it started that visitor's container with -- and the
 * image's build, which signs its administrator's token with a key that
 * lives as long as one RUN. The server verifies them as it verifies any
 * host's (packages/data-server/src/identity.ts), and as the composed
 * stack's minter signs them (deploy/mint-token.mjs).
 *
 * The image's FORMANCY_DATA_ISSUER, FORMANCY_DATA_AUDIENCE and
 * FORMANCY_DATA_ATTRIBUTES are held to these constants by
 * image/dockerfile.test.ts; token.test.ts has data-server's own verifier
 * judge what this signs.
 */

/** Who signs the demo's tokens, and for whom: the server accepts nothing else. */
export const ISSUER = 'formancy-data-demo'
export const AUDIENCE = 'formancy-data-demo'

/** The claim the server reads a person's tenant from: the image's FORMANCY_DATA_ATTRIBUTES is `tenant=tid`. */
export const TENANT_CLAIM = 'tid'

/**
 * How long a token is good for: an hour. Ten minutes is how long a
 * visitor's server outlives their last request, not how long a visit lasts:
 * every request keeps the server running, so a visit that goes on past the
 * hour has its token refused, 401, by a server that still runs. The page
 * signs nobody in again by itself; Sign out and a new sign-in asks the same
 * Durable Object, which signs the new token with the key it stored, so the
 * visitor reaches the same server and what they changed (0070).
 */
export const TOKEN_SECONDS = 3600

/** The shortest key the server starts with, in UTF-8 bytes (KeySet.fromSecret): nothing shorter is signed with. */
export const MIN_KEY_BYTES = 32

/** What a token says about its holder: the server's actor and, for a person, their tenant. */
export interface TokenClaims {
  subject: string
  roles: readonly string[]
  /** A whole number, which the server reads as its decimal string. Absent for the image's administrator. */
  tenant?: number
}

export interface MintedToken {
  token: string
  /** When it stops being accepted, in milliseconds since the epoch. */
  expiresAt: number
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const part = (value: unknown): string => base64url(encoder.encode(JSON.stringify(value)))

/**
 * A token for `claims`, signed with `key`, issued at `now` and good for
 * TOKEN_SECONDS. Refuses a key the server would refuse to start with. The
 * error never holds the key.
 */
export async function mintToken(key: string, claims: TokenClaims, now: number = Date.now()): Promise<MintedToken> {
  const secret = encoder.encode(key)
  if (secret.byteLength < MIN_KEY_BYTES) throw new Error(`A demo token's key is at least ${String(MIN_KEY_BYTES)} bytes, as the server's is.`)
  const issuedAt = Math.floor(now / 1000)
  const expires = issuedAt + TOKEN_SECONDS
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: claims.subject,
    roles: [...claims.roles],
    ...(claims.tenant === undefined ? {} : { [TENANT_CLAIM]: claims.tenant }),
    iat: issuedAt,
    exp: expires,
  }
  const signed = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}`
  const hmac = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(signed)))
  return { token: `${signed}.${base64url(signature)}`, expiresAt: expires * 1000 }
}
