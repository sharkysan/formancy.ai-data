// One hash for a package's built `dist/` (0035), so the report can say that
// the tarball npm receives holds the bytes every other job built.
//
// sha256 over the sorted lines `relative/path\0<sha256 of the file>\n`, one
// per file: the same files with the same bytes give the same hash wherever
// they were built, whatever order a directory listing or an archive holds
// them in, and a renamed, added or changed file changes it.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The hash of `files`: a Map, or pairs, of `/`-separated path relative to dist/ and its bytes. */
export function distHash(files) {
  const lines = [...files]
    .map(([path, bytes]) => [path.replaceAll('\\', '/'), sha256(bytes)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, digest]) => `${path}\0${digest}\n`)
  return `sha256:${sha256(lines.join(''))}`
}

/** Every file under `dir`, keyed by its `/`-separated path relative to it; undefined when there is no such directory. */
export function filesUnder(dir) {
  if (!existsSync(dir)) return undefined
  const files = new Map()
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.set(relative(dir, full).replaceAll('\\', '/'), readFileSync(full))
    }
  }
  walk(dir)
  return files
}

/** The files of a packed tarball's `package/dist/`, as `filesUnder` gives a directory's. */
export function distOfTarball(entries) {
  const files = new Map()
  for (const [path, bytes] of entries) if (path.startsWith('package/dist/')) files.set(path.slice('package/dist/'.length), bytes)
  return files
}
