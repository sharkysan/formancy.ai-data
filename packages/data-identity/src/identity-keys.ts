import { createPublicKey, createSecretKey, KeyObject } from 'node:crypto'
import type { JsonWebKey } from 'node:crypto'
import { errors, exportJWK, importSPKI, jwtVerify } from 'jose'
import type { CryptoKey, JWTHeaderParameters, JWTVerifyOptions, JWTVerifyResult } from 'jose'
import { ed25519Point } from './ed25519.js'

/**
 * The keys a host identity token is verified with (0014, 0059): one shared
 * secret, one public key, or a JSON Web Key Set read from a file, each of its
 * keys selected by the kid a token names.
 *
 * A `KeySet` is opaque. Its constructor refuses every caller but the
 * builders below, which check what they are given, so a set the verifier
 * meets is always one that `readKeySet`, `KeySet.fromSecret` or
 * `KeySet.fromPem` made: one algorithm, public keys or long secrets, every kid
 * distinct.
 *
 * Nothing a sentence here says comes from the file. JSON.parse's own message
 * quotes the text around the error, and the text may be a secret, so a file
 * that does not parse gets one fixed sentence; every other sentence names a
 * key by its kid, when that is in the alphabet below and could not be a
 * secret, or by its place in the file, and names a member, never its value.
 *
 * The class, its prototype and every set are frozen, and a set is verified
 * with only through `verifyWithKeySet`, which index.ts does not export: code
 * that reaches the class can replace none of its methods, and no caller can
 * verify under a set with looser options than identity.ts passes.
 */

export const KEY_SET_ALGORITHMS = ['RS256', 'ES256', 'EdDSA', 'HS256'] as const
export type KeySetAlgorithm = (typeof KEY_SET_ALGORITHMS)[number]

export function isKeySetAlgorithm(value: unknown): value is KeySetAlgorithm {
  return KEY_SET_ALGORITHMS.some((algorithm) => algorithm === value)
}

/** 256 bits, the strength HS256 offers (0014). A shorter secret is a weaker key than the algorithm claims. */
export const MIN_SECRET_BYTES = 32

/** jose's floor for RS256, which it checks only when a token arrives; a set is refused for it when it is read. */
const MIN_RSA_BITS = 2048

/**
 * The least RSA public exponent a key in force may have: FIPS 186's floor for
 * an RSA key pair is an odd e above 2^16. createPublicKey imports e = 1, under
 * which a signature is its own message's padding and anyone signs any token.
 */
const MIN_RSA_EXPONENT = 65537n

/** The member that left a key out of force. Never its value. */
export type LeftOutBecause = 'kty' | 'crv' | 'use' | 'key_ops' | 'alg'

/** A key the file holds that cannot verify the pinned algorithm: by its kid, or by its place in the file (`#3`). */
export interface LeftOutKey {
  readonly key: string
  readonly because: LeftOutBecause
}

/** What changed between two sets, by kid; `replaced` is a kid whose key is not the same key. */
export interface KeySetChange {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly replaced: readonly string[]
}

/** A sentence saying why a set was refused. It holds no text of the file, so it may be logged. */
export class KeySetRefusal extends Error {
  override readonly name = 'KeySetRefusal'
}

/**
 * The alphabet of a kid that may be named in a sentence: base64 and base64url,
 * and the punctuation providers use. Anchored, one class, so nothing in it
 * backtracks.
 */
const KID = /^[A-Za-z0-9._~+/=-]+$/

/** The key types of a public key. A kid beside one is a name, often a 43-character thumbprint, as Keycloak's are. */
const PUBLIC_KEY_TYPES: readonly unknown[] = ['RSA', 'EC', 'OKP']

/** As many base64 characters as a secret HS256 takes: 32 bytes are 43 of them. */
const SECRET_CHARACTERS = Math.ceil((MIN_SECRET_BYTES * 8) / 6)
const BASE64_CHARACTER = /[A-Za-z0-9_+/-]/g

/** Private key members (RFC 7518 section 6, and AKP's `priv`). Their presence in a verifier's file refuses the whole set. */
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'priv'] as const

/** What a key must be to verify each algorithm. */
const VERIFIES: Record<KeySetAlgorithm, { kty: string; crv?: string; kind: string }> = {
  RS256: { kty: 'RSA', kind: 'an RSA' },
  ES256: { kty: 'EC', crv: 'P-256', kind: 'an EC' },
  EdDSA: { kty: 'OKP', crv: 'Ed25519', kind: 'an Ed25519' },
  HS256: { kty: 'oct', kind: 'a secret' },
}

/** Only the builders hold this, so only they can call the constructor. */
const BUILD = Symbol('KeySet builder')

interface InForce {
  readonly kid: string
  readonly key: KeyObject
}

type Entry = Record<string, unknown>

function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a kid could be key material: one beside a key that is not a public
 * key, that is its own `k` or holds as many base64 characters as a secret.
 * Every kid fits the alphabet a secret is written in, and a kid is logged --
 * in a sentence, and on the planes and SIGHUP lines -- so a secret pasted
 * where the kid belongs would reach the log through it.
 */
function kidCouldBeSecret(entry: Entry): boolean {
  const kid = entry['kid']
  if (typeof kid !== 'string' || PUBLIC_KEY_TYPES.includes(entry['kty'])) return false
  return kid === entry['k'] || (kid.match(BASE64_CHARACTER)?.length ?? 0) >= SECRET_CHARACTERS
}

/** A key as a sentence names it: `"kid"` when its kid is in the alphabet and could not be a secret, otherwise `#n`, its place in the file from 1. */
function nameOf(entry: Entry, index: number): string {
  return typeof entry['kid'] === 'string' && KID.test(entry['kid']) && !kidCouldBeSecret(entry) ? entry['kid'] : `#${String(index + 1)}`
}

function quoted(name: string): string {
  return name.startsWith('#') ? name : `"${name}"`
}

/**
 * Why a key cannot verify `algorithm`, or why its publisher says it is not for
 * that, as the member that says so; undefined when it is in force. `use` is
 * asked before `alg`, because what a key is for is what its publisher says
 * first: Keycloak's encryption key says both.
 */
function leftOutBecause(entry: Entry, algorithm: KeySetAlgorithm): LeftOutBecause | undefined {
  const wanted = VERIFIES[algorithm]
  if (entry['kty'] !== wanted.kty) return 'kty'
  if (wanted.crv !== undefined && entry['crv'] !== wanted.crv) return 'crv'
  if (entry['use'] !== undefined && entry['use'] !== 'sig') return 'use'
  const ops = entry['key_ops']
  if (ops !== undefined && !(Array.isArray(ops) && ops.includes('verify'))) return 'key_ops'
  if (entry['alg'] !== undefined && entry['alg'] !== algorithm) return 'alg'
  return undefined
}

/**
 * The key, imported now and synchronously, so a set that cannot verify is
 * refused when it is read rather than at its first token: an off-curve point
 * is refused by createPublicKey, where jose would refuse it only then, and an
 * RSA modulus is measured from the imported key, because createPublicKey
 * imports one of no bits at all (M4). A key under which anyone can sign --
 * an RSA exponent of 1, an Ed25519 point of small order -- imports too, and is
 * refused here.
 */
function importKey(entry: Entry, algorithm: KeySetAlgorithm, kid: string): KeyObject {
  const name = quoted(kid)
  if (algorithm === 'HS256') {
    const k = entry['k']
    if (typeof k !== 'string') throw new KeySetRefusal(`key ${name} has no "k"`)
    // Node's decoder skips what is not base64url; a value that does not
    // encode back to itself is not the key its writer meant.
    const bytes = Buffer.from(k, 'base64url')
    if (bytes.toString('base64url') !== k) throw new KeySetRefusal(`key ${name}'s "k" is not base64url without padding`)
    if (bytes.length < MIN_SECRET_BYTES) throw new KeySetRefusal(`key ${name} is shorter than ${String(MIN_SECRET_BYTES)} bytes, which HS256 needs (0014)`)
    return createSecretKey(bytes)
  }
  let key: KeyObject
  try {
    key = createPublicKey({ key: entry as JsonWebKey, format: 'jwk' })
  } catch {
    throw new KeySetRefusal(`key ${name} does not import as ${VERIFIES[algorithm].kind} public key`)
  }
  if (algorithm === 'RS256') {
    const details = key.asymmetricKeyDetails
    if ((details?.modulusLength ?? 0) < MIN_RSA_BITS)
      throw new KeySetRefusal(`key ${name} is an RSA key of fewer than ${String(MIN_RSA_BITS)} bits, which RS256 refuses`)
    const exponent = details?.publicExponent ?? 0n
    if (exponent < MIN_RSA_EXPONENT || exponent % 2n === 0n) {
      throw new KeySetRefusal(
        `key ${name}'s RSA public exponent is not an odd number of at least ${String(MIN_RSA_EXPONENT)}: under an exponent of 1 anyone signs any token`,
      )
    }
  }
  if (algorithm === 'EdDSA') {
    const point = ed25519Point(Buffer.from(String(entry['x']), 'base64url'))
    if (point === 'no point') throw new KeySetRefusal(`key ${name} does not import as ${VERIFIES[algorithm].kind} public key`)
    if (point === 'small order') throw new KeySetRefusal(`key ${name} is an Ed25519 point of small order, under which a signature nobody made verifies`)
  }
  return key
}

function signatureFailed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'
}

/** jwtVerify's options but the algorithm, which the set pins. */
export type KeySetVerifyOptions = Omit<JWTVerifyOptions, 'algorithms'>

// Set by KeySet's static block, the only code that can read a set's private
// fields, and reached through the functions below, which nothing outside
// this module can replace.
let branded!: (value: unknown) => value is KeySet
let verifyUnder!: (set: KeySet, token: string, options: KeySetVerifyOptions) => Promise<JWTVerifyResult>

export class KeySet {
  readonly #algorithm: KeySetAlgorithm
  /** A set read from a file: its keys in force, in file order, each selected by its kid. */
  readonly #keys: readonly InForce[]
  readonly #leftOut: readonly LeftOutKey[]
  /** A one-key setting's key, which ignores a token's kid as it always has. */
  readonly #single: KeyObject | CryptoKey | undefined

  private constructor(
    build: symbol,
    algorithm: KeySetAlgorithm,
    keys: readonly InForce[],
    leftOut: readonly LeftOutKey[],
    single: KeyObject | CryptoKey | undefined,
  ) {
    if (build !== BUILD) throw new TypeError('a KeySet is made by readKeySet, KeySet.fromSecret or KeySet.fromPem')
    this.#algorithm = algorithm
    this.#keys = keys
    this.#leftOut = leftOut
    this.#single = single
    Object.freeze(this)
  }

  static {
    branded = (value): value is KeySet => typeof value === 'object' && value !== null && #keys in value
    verifyUnder = (set, token, options) => set.#verify(token, options)
  }

  /**
   * A JSON Web Key Set, `{"keys":[…]}`, read for one algorithm. Throws a
   * `KeySetRefusal` for an algorithm not one of the four, a file that does
   * not parse, an entry that is not an object, any key holding a private
   * member, a key in force without a kid in the alphabet, with another's kid
   * or with one that could be a secret, one that does not import, an RSA key
   * under 2048 bits or with an exponent under 65537 or even, an Ed25519 point
   * of small order, a secret under 32 bytes, and a file with no key in force.
   * A key that cannot verify the algorithm is left out and named.
   */
  static read(text: string, algorithm: KeySetAlgorithm): KeySet {
    // An embedder's algorithm, which nothing else has checked: VERIFIES has
    // no entry for "hs256", and one for "toString".
    if (!isKeySetAlgorithm(algorithm)) throw new KeySetRefusal('the algorithm of a key set is RS256, ES256, EdDSA or HS256')
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      throw new KeySetRefusal('the identity key set file is not JSON')
    }
    const entries = isEntry(document) ? document['keys'] : undefined
    if (!Array.isArray(entries) || entries.length === 0) throw new KeySetRefusal('the identity key set is not an object with a non-empty "keys" array')

    // Every key, in force or not, before any is classified: a verifier's file
    // holding private material is a key in the wrong place, whatever it is for.
    const checked: Entry[] = entries.map((entry: unknown, index) => {
      if (!isEntry(entry)) throw new KeySetRefusal(`key #${String(index + 1)} of the identity key set is not an object`)
      const member = PRIVATE_MEMBERS.find((candidate) => entry[candidate] !== undefined)
      if (member !== undefined)
        throw new KeySetRefusal(`key ${quoted(nameOf(entry, index))} holds the private member "${member}": a verifier's file holds public keys only`)
      return entry
    })

    const inForce: InForce[] = []
    const leftOut: LeftOutKey[] = []
    for (const [index, entry] of checked.entries()) {
      const because = leftOutBecause(entry, algorithm)
      if (because !== undefined) {
        leftOut.push({ key: nameOf(entry, index), because })
        continue
      }
      const kid = entry['kid']
      if (kid === undefined) throw new KeySetRefusal(`key #${String(index + 1)} has no "kid": a key in force is selected by it`)
      if (typeof kid !== 'string' || !KID.test(kid))
        throw new KeySetRefusal(`key #${String(index + 1)}'s "kid" is not a non-empty string of A-Z, a-z, 0-9 and . _ ~ + / = -`)
      if (kidCouldBeSecret(entry)) {
        throw new KeySetRefusal(
          `key #${String(index + 1)}'s "kid" could be a secret -- it is its "k", or ${String(SECRET_CHARACTERS)} base64 characters or more -- and a kid is logged, so it is a name, never key material`,
        )
      }
      if (inForce.some((other) => other.kid === kid)) throw new KeySetRefusal(`two keys in force are both "${kid}": a kid selects one key`)
      inForce.push({ kid, key: importKey(entry, algorithm, kid) })
    }
    if (inForce.length === 0) {
      const named = leftOut.map((key) => `${key.key} (${key.because})`).join(', ')
      throw new KeySetRefusal(`no key in the file can verify ${algorithm} (left out: ${named})`)
    }
    return new KeySet(BUILD, algorithm, inForce, leftOut, undefined)
  }

  /** A shared secret's key, as the server's `FORMANCY_DATA_IDENTITY_SECRET` names one: HS256 over the secret's UTF-8 bytes, at least 32 of them. */
  static fromSecret(secret: string): KeySet {
    if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) throw new KeySetRefusal(`the identity secret must be at least ${String(MIN_SECRET_BYTES)} bytes`)
    return new KeySet(BUILD, 'HS256', [], [], createSecretKey(Buffer.from(secret, 'utf8')))
  }

  /** A public key's, as the server's `FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE` names one: an SPKI PEM, imported by jose as it always was, for RS256, ES256 or EdDSA and never HS256. */
  static async fromPem(pem: string, algorithm: string): Promise<KeySet> {
    if (algorithm !== 'RS256' && algorithm !== 'ES256' && algorithm !== 'EdDSA') {
      throw new KeySetRefusal('a public key verifies RS256, ES256 or EdDSA: HS256 is a shared secret, never a public key')
    }
    let key: CryptoKey
    try {
      key = await importSPKI(pem, algorithm)
    } catch {
      // jose's message is about its argument ("spki" must be...), not the setting.
      throw new KeySetRefusal(`the identity public key is not an SPKI PEM public key for ${algorithm}`)
    }
    return new KeySet(BUILD, algorithm, [], [], key)
  }

  /** Whether `value` is a set the builders made. A brand check, so neither a look-alike nor an object made from the prototype passes. */
  static is(value: unknown): value is KeySet {
    return branded(value)
  }

  get algorithm(): KeySetAlgorithm {
    return this.#algorithm
  }

  /** The kids in force, in file order; none for a one-key setting, which ignores kids. */
  get kids(): readonly string[] {
    return this.#keys.map((entry) => entry.kid)
  }

  get leftOut(): readonly LeftOutKey[] {
    return this.#leftOut
  }

  /** The type of each key in force, `public` or `secret`: what a test can ask of a key without being handed it. */
  get keyTypes(): readonly string[] {
    return this.#single === undefined ? this.#keys.map((entry) => entry.key.type) : [this.#single.type]
  }

  /** What `next` adds, removes and replaces of this set's kids. A key is replaced when its kid stays and its key does not. */
  compare(next: KeySet): KeySetChange {
    const before = new Map(this.#keys.map((entry) => [entry.kid, entry.key]))
    const after = new Map(next.#keys.map((entry) => [entry.kid, entry.key]))
    return {
      added: [...after.keys()].filter((kid) => !before.has(kid)),
      removed: [...before.keys()].filter((kid) => !after.has(kid)),
      replaced: [...after].filter(([kid, key]) => before.has(kid) && !(before.get(kid) as KeyObject).equals(key)).map(([kid]) => kid),
    }
  }

  /**
   * A one-key setting's key as a key set file holding it under `kid`: what
   * the server's `identity-keys-cli.mjs convert` writes. The secret's key is
   * the base64url of the bytes this set verifies with, not the secret's text,
   * which is also valid base64url and another key (M2). Read back before it is returned.
   * This is key material; nothing logs it.
   */
  async document(kid: string): Promise<string> {
    const single = this.#single
    if (single === undefined) throw new KeySetRefusal('a set read from a file is a key set file already')
    if (!KID.test(kid)) throw new KeySetRefusal('a kid is a non-empty string of A-Z, a-z, 0-9 and . _ ~ + / = -')
    const { kty, ...material } =
      single instanceof KeyObject && single.type === 'secret' ? { kty: 'oct', k: single.export().toString('base64url') } : await exportJWK(single)
    const text = `${JSON.stringify({ keys: [{ kty, kid, alg: this.#algorithm, ...material }] }, null, 2)}\n`
    KeySet.read(text, this.#algorithm)
    return text
  }

  /**
   * jwtVerify under this set, its algorithm pinned. A one-key setting's key is
   * the key, as it always was. A set's key is chosen inside jwtVerify by its
   * key resolver, which jose calls only after it has refused a malformed
   * token or another algorithm, so those keep their codes (M5):
   *
   * - a kid that is a string selects that key and no other, and one the set
   *   does not hold is `ERR_JWKS_NO_MATCHING_KEY`, even when another key
   *   would verify;
   * - no kid: each key in force in file order, moving on only past a
   *   signature that does not verify, as PostgREST does; any other refusal
   *   (expired, another audience, a missing claim) is the answer.
   *
   * No member of the token's header but its kid chooses a key: one that
   * carries a `jwk`, or names a `jku` or `x5u`, is verified against the set
   * alone (identity.test.ts).
   */
  async #verify(token: string, options: KeySetVerifyOptions): Promise<JWTVerifyResult> {
    const pinned: JWTVerifyOptions = { ...options, algorithms: [this.#algorithm] }
    if (this.#single !== undefined) return jwtVerify(token, this.#single, pinned)
    const keys = this.#keys
    let kidless = false
    const select = (header: JWTHeaderParameters): KeyObject => {
      const { kid } = header
      if (kid === undefined) {
        kidless = true
        return (keys[0] as InForce).key
      }
      if (typeof kid !== 'string') throw new errors.JWSInvalid('the token\'s "kid" is not a string')
      const selected = keys.find((entry) => entry.kid === kid)
      if (selected === undefined) throw new errors.JWKSNoMatchingKey()
      return selected.key
    }
    try {
      return await jwtVerify(token, select, pinned)
    } catch (error) {
      if (!kidless || !signatureFailed(error)) throw error
    }
    for (const { key } of keys.slice(1)) {
      try {
        return await jwtVerify(token, key, pinned)
      } catch (error) {
        if (!signatureFailed(error)) throw error
      }
    }
    throw new errors.JWSSignatureVerificationFailed()
  }
}

Object.freeze(KeySet.prototype)
Object.freeze(KeySet)

/** The one function that checks a key set file's text; see `KeySet.read`. */
export function readKeySet(text: string, algorithm: KeySetAlgorithm): KeySet {
  return KeySet.read(text, algorithm)
}

/** Whether `value` is a set the builders made: identity.ts's check, which nothing outside this module can replace. */
export function isKeySet(value: unknown): value is KeySet {
  return branded(value)
}

/**
 * jwtVerify under a set the builders made, its algorithm pinned (see
 * `KeySet#verify`). identity.ts's one way to verify; index.ts does not export
 * it, so an embedder cannot call it with looser options than identity.ts's.
 */
export function verifyWithKeySet(set: KeySet, token: string, options: KeySetVerifyOptions): Promise<JWTVerifyResult> {
  return verifyUnder(set, token, options)
}
