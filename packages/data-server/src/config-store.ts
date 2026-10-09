import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type PublishOutcome =
  | { ok: true; version: number }
  /** Somebody published first. `current` is what they published, so the caller can rebase and retry. */
  | { ok: false; reason: 'conflict'; current: number | null }

/**
 * Where published form bundles live: outside every customer's business tables.
 *
 * A port because a second implementation is already planned — a shared store
 * with compare-and-swap for more than one server instance (plan section 5) —
 * and `config-store.test.ts` is written against this interface so that store
 * can run the same cases. Today there is one, on a directory.
 *
 * Versions are immutable once published, as formancy's are
 * (formancy.ai 0025): publishing never edits, it adds the next number.
 */
export interface ConfigurationStore {
  /** The newest published version, or `null` before the first. */
  latest(id: string): Promise<number | null>
  /** Every published version, ascending; `[]` for an id never published (0030). */
  versions(id: string): Promise<number[]>
  /** One published version, or `undefined` if it does not exist. */
  read(id: string, version: number): Promise<unknown>
  /**
   * Publish the next version, only if the newest is still `expectedBase`.
   * Two administrators publishing from the same base: one wins, the other is
   * told, and nothing is overwritten.
   */
  publish(id: string, expectedBase: number | null, value: unknown): Promise<PublishOutcome>
  /** Every id with at least one version, in codepoint order. */
  list(): Promise<string[]>
}

/**
 * An id is a directory name, so it is checked before it touches a path: a
 * lower-case letter or digit first, then those, dot, hyphen, underscore. `..`
 * cannot start with a letter or digit, and nothing here has a slash.
 *
 * **Lower case only**, because NTFS and APFS are case-insensitive: there,
 * `Order` and `order` are one directory, and reading one id would silently
 * return the other's bundle. Found by this suite on Windows; Linux CI would
 * never have shown it.
 */
export const CONFIGURATION_ID_MAX_LENGTH = 128
export const CONFIGURATION_ID = new RegExp(`^[a-z0-9][a-z0-9._-]{0,${String(CONFIGURATION_ID_MAX_LENGTH - 1)}}$`)
const VERSION_FILE = /^([1-9][0-9]*)\.json$/

function assertId(id: string): void {
  if (!CONFIGURATION_ID.test(id)) throw new Error(`${JSON.stringify(id)} is not a configuration id`)
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/**
 * A configuration store on a directory — a persistent volume in a container.
 *
 * Layout: `<root>/<id>/<version>.json`, pretty-printed, one file per version,
 * so an export is a copy of the directory and a review is a diff.
 *
 * **Compare-and-swap without a lock.** A version is written to a temporary file,
 * flushed, and then hard-linked to its final name. `link` fails if the name
 * exists, atomically, so of two writers that both read version 3 as the newest,
 * exactly one creates 4.json and the other gets a conflict. Nobody ever sees a
 * half-written version, because the final name only appears once the bytes are
 * on disk. A crash leaves a temporary file that nothing reads.
 *
 * On a local filesystem — ext4, xfs, NTFS — `link` is atomic. Over NFS it is
 * atomic on the server but the error a client sees after a retransmission can
 * be wrong, which is why the plan limits this store to a single-instance pilot.
 */
export function createFileConfigurationStore(root: string): ConfigurationStore {
  /**
   * Whether the root does not exist yet — a fresh volume, an empty store — and
   * a loud failure if it exists and is not a directory.
   *
   * Asked whenever something under the root is missing, because "missing"
   * means two different things. On Windows a path through a FILE reports
   * ENOENT, not ENOTDIR, so a volume path that names a file would otherwise
   * make every published form look unpublished.
   */
  async function rootIsMissing(): Promise<boolean> {
    try {
      if (!(await stat(root)).isDirectory()) throw new Error(`${root} is not a directory; the configuration store needs one`)
      return false
    } catch (error) {
      if (isCode(error, 'ENOENT')) return true
      throw error
    }
  }

  async function versions(id: string): Promise<number[]> {
    assertId(id)
    let names: string[]
    try {
      names = await readdir(join(root, id))
    } catch (error) {
      if (!isCode(error, 'ENOENT') && !isCode(error, 'ENOTDIR')) throw error
      await rootIsMissing()
      return []
    }
    // Only the final names: a `.publishing-*` leftover of a crashed publish is never a version.
    const found: number[] = []
    for (const name of names) {
      const match = VERSION_FILE.exec(name)
      if (match?.[1] !== undefined) found.push(Number(match[1]))
    }
    return found.sort((a, b) => a - b)
  }

  async function latest(id: string): Promise<number | null> {
    return (await versions(id)).at(-1) ?? null
  }

  return {
    latest,
    versions,

    async read(id, version) {
      assertId(id)
      if (!Number.isSafeInteger(version) || version < 1) throw new Error(`${String(version)} is not a version`)
      const path = join(root, id, `${String(version)}.json`)
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        if (!isCode(error, 'ENOENT') && !isCode(error, 'ENOTDIR')) throw error
        await rootIsMissing()
        return undefined
      }
      try {
        return JSON.parse(text) as unknown
      } catch {
        // A published version that does not parse was edited by hand or
        // damaged. Serving something in its place would be guessing.
        throw new Error(`${path} is not valid JSON; a published version must never be edited`)
      }
    },

    async publish(id, expectedBase, value) {
      const current = await latest(id)
      if (current !== expectedBase) return { ok: false, reason: 'conflict', current }

      const directory = join(root, id)
      await mkdir(directory, { recursive: true })
      const next = (current ?? 0) + 1
      const temporary = join(directory, `.publishing-${randomUUID()}`)
      const handle = await open(temporary, 'wx')
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
        // On disk before it has a name: a version that exists must be whole.
        await handle.sync()
      } finally {
        await handle.close()
      }

      try {
        await link(temporary, join(directory, `${String(next)}.json`))
        return { ok: true, version: next }
      } catch (error) {
        if (isCode(error, 'EEXIST')) return { ok: false, reason: 'conflict', current: await latest(id) }
        throw error
      } finally {
        await rm(temporary, { force: true })
      }
    },

    async list() {
      if (await rootIsMissing()) return []
      const names = await readdir(root)
      const ids: string[] = []
      for (const name of names) {
        if (CONFIGURATION_ID.test(name) && (await latest(name)) !== null) ids.push(name)
      }
      return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    },
  }
}
