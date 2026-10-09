// A packed `.tgz` read with Node's built-ins (0035): gunzip, then the tar
// format -- ustar, with the `prefix` field a name longer than a hundred bytes
// is split into, and the pax and GNU records a packer may put a long name in.
//
// So the install gate, the report and the release can each read what a
// tarball holds -- its `package/dist/`, its manifest, its licence files --
// without a tar program, which Windows does not reliably have, or a
// dependency, which the release's check job would have to install.

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const BLOCK = 512

/** A NUL-terminated field of a header, as text. */
const text = (header, start, length) => {
  const field = header.subarray(start, start + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? length : end).toString('utf8')
}

/** An octal number field. Throws on the base-256 form, which only a file past 8 GiB needs. */
const octal = (header, start, length) => {
  if ((header[start] & 0x80) !== 0) throw new Error('a tar entry uses the base-256 size form, which a package tarball never needs')
  const digits = text(header, start, length).trim()
  return digits === '' ? 0 : Number.parseInt(digits, 8)
}

/** The header's checksum, summed with the checksum field read as spaces, as the format defines it. */
function checksumHolds(header) {
  let sum = 0
  for (let at = 0; at < BLOCK; at += 1) sum += at >= 148 && at < 156 ? 0x20 : header[at]
  return sum === octal(header, 148, 8)
}

/** The `path` record of a pax extended header, if it has one. */
function paxPath(body) {
  let at = 0
  const records = body.toString('utf8')
  while (at < records.length) {
    const space = records.indexOf(' ', at)
    const length = Number.parseInt(records.slice(at, space), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = records.slice(space + 1, at + length - 1)
    if (record.startsWith('path=')) return record.slice('path='.length)
    at += length
  }
  return undefined
}

/** Every regular file in a `.tgz` (a path or its bytes), keyed by its path in the archive. */
export function readTarball(source) {
  const archive = gunzipSync(typeof source === 'string' ? readFileSync(source) : source)
  const files = new Map()
  let longName
  for (let at = 0; at + BLOCK <= archive.length; ) {
    const header = archive.subarray(at, at + BLOCK)
    if (header.every((byte) => byte === 0)) break
    if (!checksumHolds(header)) throw new Error(`the tar header at byte ${String(at)} does not hold its own checksum`)
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 0x30)
    const body = archive.subarray(at + BLOCK, at + BLOCK + size)
    const prefix = text(header, 257, 6) === 'ustar' ? text(header, 345, 155) : ''
    const name = longName ?? (prefix === '' ? text(header, 0, 100) : `${prefix}/${text(header, 0, 100)}`)
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    if (type === 'x') {
      longName = paxPath(body)
      continue
    }
    if (type === 'L') {
      longName = text(body, 0, body.length)
      continue
    }
    longName = undefined
    if (type === '0' || type === '7') files.set(name, Buffer.from(body))
  }
  return files
}
