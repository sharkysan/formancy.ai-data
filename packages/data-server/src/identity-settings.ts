import { isAbsolute } from 'node:path'
import { createIdentityVerifier } from './identity.js'
import type { IdentityOptions, IdentityVerifier, OneKey } from './identity.js'
import { openKeySetFile } from './identity-file.js'
import type { KeySetFile } from './identity-file.js'
import { isKeySetAlgorithm } from './identity-keys.js'
import type { KeySetAlgorithm, PublicKeyAlgorithm } from './identity-keys.js'
import { resolveSecret } from './secrets.js'
import type { SecretSource } from './secrets.js'

/**
 * Where the host identity's key comes from, as the environment names it, and
 * what a SIGHUP does with it (0014, 0059). Read by the composition root
 * (main.ts) and by `identity-keys-cli.mjs convert`, so the two never read the
 * settings differently, and parsed and opened here, so the rules and every
 * refusal at start are tested without starting a process.
 *
 *   FORMANCY_DATA_IDENTITY_SECRET           a secret reference, env:NAME or file:/path (HS256)
 *   FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE  or a PEM public key, with FORMANCY_DATA_IDENTITY_ALGORITHM RS256, ES256 or EdDSA
 *   FORMANCY_DATA_IDENTITY_KEYS_FILE        or the absolute path of a JSON Web Key Set, with FORMANCY_DATA_IDENTITY_ALGORITHM
 *                                           RS256, ES256, EdDSA or HS256, pinned for the whole set and read again on SIGHUP
 *
 * Exactly one of the three; "set" means defined, as it always has. No
 * sentence repeats a setting's value.
 */
export type IdentityKeySource =
  | { kind: 'secret'; reference: string }
  | { kind: 'public-key'; path: string; algorithm: PublicKeyAlgorithm }
  | { kind: 'key-set'; path: string; algorithm: KeySetAlgorithm }

export type IdentityKeySetting = { ok: true; source: IdentityKeySource } | { ok: false; problem: string }

type Environment = Readonly<Record<string, string | undefined>>

export function identityKeySource(env: Environment): IdentityKeySetting {
  const reference = env['FORMANCY_DATA_IDENTITY_SECRET']
  const publicKeyFile = env['FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE']
  const keysFile = env['FORMANCY_DATA_IDENTITY_KEYS_FILE']
  const algorithm = env['FORMANCY_DATA_IDENTITY_ALGORITHM']
  if ([reference, publicKeyFile, keysFile].filter((value) => value !== undefined).length !== 1) {
    return { ok: false, problem: 'Set exactly one of FORMANCY_DATA_IDENTITY_SECRET, FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE and FORMANCY_DATA_IDENTITY_KEYS_FILE.' }
  }
  if (reference !== undefined) return { ok: true, source: { kind: 'secret', reference } }

  if (publicKeyFile !== undefined) {
    if (algorithm === undefined || algorithm === '') return { ok: false, problem: 'FORMANCY_DATA_IDENTITY_ALGORITHM is required.' }
    // A PEM's text taken as an HMAC secret verifies any token its reader signs with it.
    if (algorithm === 'HS256') return { ok: false, problem: 'HS256 is a shared secret: it is FORMANCY_DATA_IDENTITY_SECRET or a key set, never a public key file.' }
    if (algorithm !== 'RS256' && algorithm !== 'ES256' && algorithm !== 'EdDSA') return { ok: false, problem: 'FORMANCY_DATA_IDENTITY_ALGORITHM is RS256, ES256 or EdDSA.' }
    return { ok: true, source: { kind: 'public-key', path: publicKeyFile, algorithm } }
  }

  const path = keysFile as string
  if (algorithm === undefined || algorithm === '') {
    return { ok: false, problem: 'FORMANCY_DATA_IDENTITY_ALGORITHM is required with FORMANCY_DATA_IDENTITY_KEYS_FILE: RS256, ES256, EdDSA or HS256, for every key in the set.' }
  }
  if (!isKeySetAlgorithm(algorithm)) return { ok: false, problem: 'FORMANCY_DATA_IDENTITY_ALGORITHM is RS256, ES256, EdDSA or HS256 for a key set.' }
  if (!isAbsolute(path)) return { ok: false, problem: 'FORMANCY_DATA_IDENTITY_KEYS_FILE is an absolute path: the file is read again, on SIGHUP, from wherever the server then runs.' }
  return { ok: true, source: { kind: 'key-set', path, algorithm } }
}

/** The one key a secret or a public key file names, read as main.ts reads it: the secret through resolveSecret, the PEM as the file's text. */
export async function oneKey(source: Exclude<IdentityKeySource, { kind: 'key-set' }>, io: SecretSource): Promise<OneKey> {
  if (source.kind === 'secret') return { kind: 'secret', secret: await resolveSecret(source.reference, io) }
  let pem: string
  try {
    pem = await io.readFile(source.path)
  } catch {
    // Named as resolveSecret names a secret file; the error's own text is not passed on.
    throw new Error(`the identity public key file ${source.path} cannot be read`)
  }
  return { kind: 'public-key', pem, algorithm: source.algorithm }
}

export type OpenedIdentity = { ok: true; verifyIdentity: IdentityVerifier; file: KeySetFile | undefined } | { ok: false; problem: string }

/**
 * The verifier main.ts serves with, and the key set file it reads again on
 * SIGHUP when the setting names one. Every refusal of the key at start -- a
 * secret or a file that cannot be read, a secret under 32 bytes, a public key
 * that does not import, a key set refused -- is the problem, one sentence
 * main.ts prints before it exits 1, never an exception: a short secret and a
 * PEM that did not import used to be thrown by createIdentityVerifier, outside
 * main's handling, as a stack trace. The key set file is read through
 * readKeySetText, never `io`, so a path that is not a regular file is refused
 * at start as it is on SIGHUP.
 */
export async function openIdentity(source: IdentityKeySource, io: SecretSource, claims: Omit<IdentityOptions, 'key'>): Promise<OpenedIdentity> {
  try {
    let key: IdentityOptions['key']
    let file: KeySetFile | undefined
    if (source.kind === 'key-set') {
      file = await openKeySetFile(source.path, source.algorithm)
      key = { kind: 'key-set', keys: file.current }
    } else {
      key = await oneKey(source, io)
    }
    return { ok: true, verifyIdentity: await createIdentityVerifier({ ...claims, key }), file }
  } catch (error) {
    // Each sentence above is resolveSecret's, readKeySet's or the builders',
    // none of which repeats a key or a secret.
    return { ok: false, problem: error instanceof Error ? error.message : 'the identity key could not be opened' }
  }
}

/** Where a signal comes from: `process` in the server, an EventEmitter in a test. */
export interface SignalSource {
  on(signal: 'SIGHUP', listener: () => void): unknown
}

/** The server's log, as much of it as this writes to. */
export interface KeysLog {
  info(fields: Record<string, unknown>, message: string): void
  warn(message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

/**
 * Reads the key set file again on every SIGHUP, and says what happened in
 * one line on the server's log: the kids in force and what was added,
 * removed and replaced; that nothing changed; or, at `error`, that nothing
 * was read and why, the set in force unchanged. No line holds key material,
 * and none a hash of the file, which for HS256 would let a reader of the log
 * check a guess at the secret.
 *
 * The listener is installed whatever the setting, so a SIGHUP never stops
 * the server -- Node's default for it is to terminate -- and with a one-key
 * setting it says that nothing was read.
 */
export function readAgainOnSignal(signals: SignalSource, file: KeySetFile | undefined, log: KeysLog): void {
  signals.on('SIGHUP', () => {
    if (file === undefined) {
      log.warn('SIGHUP: the identity key is not a key set file; nothing was read again')
      return
    }
    void file.readAgain().then((outcome) => {
      if (!outcome.read) {
        log.error({ identityKeys: { kids: outcome.kids, problem: outcome.problem } }, 'identity keys not read again; the set in force is unchanged')
      } else if (outcome.changed) {
        const { kids, added, removed, replaced, leftOut } = outcome
        log.info({ identityKeys: { kids, added, removed, replaced, leftOut } }, 'identity keys read again')
      } else {
        log.info({ identityKeys: { kids: outcome.kids, leftOut: outcome.leftOut } }, 'identity keys read again; nothing changed')
      }
    })
  })
}
