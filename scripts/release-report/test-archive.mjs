// A gzipped ustar archive written by hand, for the tests of what reads one:
// tarball.mjs, verify-publish.mjs and publish.mjs. Test support only. Every
// field the reader depends on is one the test sets; a real packer's output is
// read by the install gate in every run.

import { gzipSync } from 'node:zlib'

/** One ustar header for a regular file, the name split into prefix and name when it is past a hundred bytes. */
export function header(path, size) {
  const block = Buffer.alloc(512)
  let prefix = ''
  let name = path
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf('/', 155)
    prefix = path.slice(0, cut)
    name = path.slice(cut + 1)
  }
  const put = (value, start, length) => block.write(value, start, length, 'utf8')
  const number = (value, start, length) => put(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length)
  put(name, 0, 100)
  number(0o644, 100, 8)
  number(0, 108, 8)
  number(0, 116, 8)
  number(size, 124, 12)
  number(0, 136, 12)
  put('0', 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  put(prefix, 345, 155)
  block.fill(0x20, 148, 156)
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  return block
}

/** A gzipped tar of `files`, as pairs of path and bytes. */
export function tgz(files) {
  const parts = []
  for (const [path, bytes] of files) {
    parts.push(header(path, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

/** A package's tarball as `pnpm pack` lays it out: its manifest, its licence files unless left out, and one module. */
export function packageTarball(manifest, { without = [] } = {}) {
  const files = [
    ['package/package.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['package/LICENSE.md', Buffer.from('# Licence\n')],
    ['package/NOTICE', Buffer.from('Notices.\n')],
    ['package/dist/index.mjs', Buffer.from(`export const name = ${JSON.stringify(manifest.name)}\n`)],
  ]
  return tgz(files.filter(([path]) => !without.includes(path.slice('package/'.length))))
}
