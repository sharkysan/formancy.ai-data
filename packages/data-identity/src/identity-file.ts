import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { KeySetRefusal, readKeySet } from './identity-keys.js'
import type { KeySet, KeySetAlgorithm, LeftOutKey } from './identity-keys.js'

/**
 * What one read again of a key set file did, which the log line is built from
 * (data-server's identity-settings.ts). `problem` is readKeySet's sentence,
 * so it holds no text of the file.
 */
export type KeySetReadAgain =
  | { read: true; changed: true; kids: readonly string[]; added: readonly string[]; removed: readonly string[]; replaced: readonly string[]; leftOut: readonly LeftOutKey[] }
  | { read: true; changed: false; kids: readonly string[]; leftOut: readonly LeftOutKey[] }
  | { read: false; kids: readonly string[]; problem: string }

export interface KeySetFile {
  /** The set in force. The verifier asks for it on every token. */
  readonly current: () => KeySet
  /**
   * Reads the file again. A set readKeySet accepts replaces the one in force
   * at once; anything else leaves it as it was. Reads run one at a time, in
   * the order they were asked for, and none ever rejects.
   */
  readonly readAgain: () => Promise<KeySetReadAgain>
}

/**
 * A key set file's text, read the way a read always finishes: opened without
 * waiting for a writer, and refused unless it is a regular file. readFile on
 * a FIFO waited for a writer, and a read again that never finished held every
 * later one behind it, SIGTERM's shutdown too. A file on a network mount that
 * stalls still stalls the read: nothing here can tell a slow server from a
 * lost one.
 */
export async function readKeySetText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  try {
    if (!(await handle.stat()).isFile()) throw new KeySetRefusal(`the identity key set file ${path} is not a regular file`)
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

async function readSet(path: string, algorithm: KeySetAlgorithm, read: (path: string) => Promise<string>): Promise<KeySet> {
  let text: string
  try {
    text = await read(path)
  } catch (error) {
    if (error instanceof KeySetRefusal) throw error
    // The path is configuration and is named, as resolveSecret names a secret file's; the error's own text is not passed on.
    throw new KeySetRefusal(`the identity key set file ${path} cannot be read`)
  }
  return readKeySet(text, algorithm)
}

/**
 * The key set in `path`, read now -- a refused set throws, which stops the
 * server at start -- and read again whenever `readAgain` is called: on SIGHUP
 * in the running server (data-server's main.ts), and by an embedder wherever
 * it chooses.
 *
 * A read that fails keeps the set in force, a key removed from the file
 * included, because a typo or a half-written file must not refuse every
 * token; the outcome says so, and the same file then stops the next start
 * until it is fixed. `read` is injected for the tests; the server and the
 * tool read through readKeySetText.
 */
export async function openKeySetFile(path: string, algorithm: KeySetAlgorithm, read: (path: string) => Promise<string> = readKeySetText): Promise<KeySetFile> {
  let current = await readSet(path, algorithm, read)

  const readOnce = async (): Promise<KeySetReadAgain> => {
    let next: KeySet
    try {
      next = await readSet(path, algorithm, read)
    } catch (error) {
      return { read: false, kids: current.kids, problem: error instanceof KeySetRefusal ? error.message : 'the identity key set file could not be read as a key set' }
    }
    const { added, removed, replaced } = current.compare(next)
    current = next
    if (added.length === 0 && removed.length === 0 && replaced.length === 0) return { read: true, changed: false, kids: next.kids, leftOut: next.leftOut }
    return { read: true, changed: true, kids: next.kids, added, removed, replaced, leftOut: next.leftOut }
  }

  let queue: Promise<unknown> = Promise.resolve()
  return {
    current: () => current,
    readAgain: () => {
      const outcome = queue.then(readOnce)
      queue = outcome
      return outcome
    },
  }
}
