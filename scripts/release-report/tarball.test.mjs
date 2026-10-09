import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, test } from 'vitest'
import { distHash, distOfTarball, filesUnder } from './dist-hash.mjs'
import { readTarball } from './tarball.mjs'
import { header, tgz } from './test-archive.mjs'

/**
 * The built-in `.tgz` reader and the dist hash (0035), over an archive the
 * tests write themselves (test-archive.mjs), so every field the reader
 * depends on is one the test set: a real packer's output is read by the
 * install gate in every run.
 */
let dirs = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

const LONG = `package/dist/${'nested/'.repeat(14)}module.mjs`

const FILES = [
  ['package/package.json', Buffer.from('{"name":"@formancy/data-core"}')],
  ['package/dist/index.mjs', Buffer.from('export const a = 1\n')],
  [LONG, Buffer.from('export const deep = true\n'.repeat(40))],
]

describe('a packed tarball', () => {
  // npm's packer puts a path past a hundred bytes in the ustar prefix. A
  // reader that ignored it would see `module.mjs` where the archive holds
  // `package/dist/nested/.../module.mjs`: a dist with a file at its root
  // that no build made, and a hash that differs from every job's.
  test('reads every file, a name longer than a hundred bytes included', () => {
    expect(Buffer.byteLength(LONG)).toBeGreaterThan(100)
    const entries = readTarball(tgz(FILES))
    expect([...entries.keys()]).toEqual(FILES.map(([path]) => path))
    for (const [path, bytes] of FILES) expect(entries.get(path)?.equals(bytes), path).toBe(true)
  })

  // The report compares the dist/ of the tarball npm receives with the dist/
  // every job built on disk. The same files must hash alike from either.
  test("hashes its dist/ as the same files on disk hash", () => {
    const dir = mkdtempSync(join(tmpdir(), 'formancy-data-dist-'))
    dirs.push(dir)
    for (const [path, bytes] of FILES.filter(([path]) => path.startsWith('package/dist/'))) {
      const file = join(dir, path.slice('package/dist/'.length))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes)
    }
    const fromTarball = distHash(distOfTarball(readTarball(tgz(FILES))))
    expect(fromTarball).toBe(distHash(filesUnder(dir)))
    // And a changed byte changes it, or the comparison proves nothing.
    writeFileSync(join(dir, 'index.mjs'), 'export const a = 2\n')
    expect(distHash(filesUnder(dir))).not.toBe(fromTarball)
  })

  // A truncated or altered download whose header no longer adds up is not
  // read as an archive with fewer files.
  test('refuses a header that does not hold its checksum', () => {
    const archive = Buffer.concat([header('package/x', 0), Buffer.alloc(1024)])
    archive[0] = 'q'.charCodeAt(0)
    expect(() => readTarball(gzipSync(archive))).toThrow(/checksum/)
  })
})
