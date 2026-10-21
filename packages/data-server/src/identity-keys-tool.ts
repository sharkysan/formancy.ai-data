import { isKeySetAlgorithm, oneKeySet, openKeySetFile } from '@formancy/data-identity'
import { identityKeySource, oneKey } from './identity-settings.js'

/**
 * The key set file tool the image ships as `dist/identity-keys-cli.mjs`
 * (0059), over the server's own functions:
 *
 *   check <file> <algorithm>   readKeySet over the file: what is in force, what is left out; exit 1 with its sentence if refused
 *   convert <kid>              the key FORMANCY_DATA_IDENTITY_SECRET or _PUBLIC_KEY_FILE names, as a one-key set on stdout
 *
 * `check` is what an operator's job runs before it renames a file into place:
 * a refused file left there stops the server's next start. `convert` reads
 * the setting through identityKeySource and resolveSecret, as main.ts does,
 * so the key it writes is the key the server verifies with today.
 *
 * Nothing it prints to stderr holds key material; `convert`'s stdout is key
 * material, the file the operator asked for.
 */

export interface KeysToolIo {
  stdout(text: string): void
  stderr(text: string): void
  readFile(path: string): Promise<string>
}

const USAGE = 'Usage: identity-keys-cli.mjs check <file> <RS256|ES256|EdDSA|HS256>\n       identity-keys-cli.mjs convert <kid>'

/** The server's own sentence: readKeySet's, resolveSecret's, jose's or the file system's, none of which repeats a key or a secret. */
function sentence(error: unknown): string {
  return error instanceof Error ? error.message : 'the key could not be read'
}

async function check(path: string, algorithm: string, io: KeysToolIo): Promise<number> {
  if (!isKeySetAlgorithm(algorithm)) {
    io.stderr('The algorithm is RS256, ES256, EdDSA or HS256, as FORMANCY_DATA_IDENTITY_ALGORITHM will say.\n')
    return 1
  }
  try {
    // Read as the server reads it, through readKeySetText: a path that is
    // not a regular file is refused here as it would be on SIGHUP.
    const set = (await openKeySetFile(path, algorithm)).current()
    const leftOut = set.leftOut.map((key) => `${key.key} (${key.because})`).join(', ')
    io.stdout(`in force: ${set.kids.join(', ')}\nleft out: ${leftOut === '' ? 'none' : leftOut}\n`)
    return 0
  } catch (error) {
    io.stderr(`${sentence(error)}\n`)
    return 1
  }
}

async function convert(kid: string, env: Readonly<Record<string, string | undefined>>, io: KeysToolIo): Promise<number> {
  const setting = identityKeySource(env)
  if (!setting.ok) {
    io.stderr(`${setting.problem}\n`)
    return 1
  }
  const { source } = setting
  if (source.kind === 'key-set') {
    io.stderr('This environment already names a key set file (FORMANCY_DATA_IDENTITY_KEYS_FILE); convert writes one from FORMANCY_DATA_IDENTITY_SECRET or FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE.\n')
    return 1
  }
  try {
    const set = await oneKeySet(await oneKey(source, { env, readFile: (path) => io.readFile(path) }))
    const document = await set.document(kid)
    const was = source.kind === 'secret' ? 'FORMANCY_DATA_IDENTITY_SECRET' : 'FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE'
    io.stdout(document)
    io.stderr(`Set FORMANCY_DATA_IDENTITY_KEYS_FILE to where this set is, FORMANCY_DATA_IDENTITY_ALGORITHM=${set.algorithm}, and unset ${was}.\n`)
    return 0
  } catch (error) {
    io.stderr(`${sentence(error)}\n`)
    return 1
  }
}

/** The tool's exit status for `argv` (without node and the script). */
export async function runKeysTool(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: KeysToolIo): Promise<number> {
  const [command, ...rest] = argv
  if (command === 'check' && rest.length === 2) return check(rest[0] as string, rest[1] as string, io)
  if (command === 'convert' && rest.length === 1) return convert(rest[0] as string, env, io)
  io.stderr(`${USAGE}\n`)
  return 1
}
