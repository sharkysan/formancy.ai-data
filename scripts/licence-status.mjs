// What a document says of the licence's state, derived from LICENSE.md
// (0048, 0054).
//
// LICENSE.md opens, under its title, with a version line --
//
//   **Version 1.1 — in force from 11 October 2026. Not reviewed by a lawyer.**
//
// -- its version a whole number or one with a minor number, N or N.N, kept
// as written -- and its section "Obtaining a production licence" names the
// address a production licence is requested from. Every tracked Markdown
// document that holds this generator's block, in scripts/generated-block.mjs's
// grammar, says what those two say, rendered here; README.md must hold one.
// So no document can name another version, date or address than the
// licence's: licence-status.test.mjs fails in `pnpm test:repo` until `node
// scripts/licence-status.mjs --write` has rewritten the blocks. A sentence
// about the licence outside a block is held by review.
//
// Since Version 1.1 that section names its address for the agreement
// Redistribution requires too (0054). A block says what the heading names,
// a production licence, and no more; the section may name only one address,
// so the two cannot be given different ones there.
//
// It reads one shape of version line: a licence in force that says no lawyer
// has reviewed it. Any other throws rather than rendering a guess -- a
// draft's, because the licence is in force and a LICENSE.md put back to a
// draft must fail rather than re-render; a reviewed licence's, because what
// the documents say of one is decided when it exists. Because the one line it
// reads says no lawyer has reviewed the text, gate 10 of
// docs/release/gates.json, which waits for that review, must stay open, and
// `gateProblems` says when it is not.
//
// Node's built-ins only.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blocks, readBlock, replaceBlock } from './generated-block.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

export const GENERATOR = 'scripts/licence-status.mjs'
export const LICENCE = 'LICENSE.md'
/** The document that must hold the block, whichever others do. */
const REQUIRED = 'README.md'
/** The release gate that waits for a lawyer's review of LICENSE.md, among other things people do. */
const LEGAL_GATE = 10

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
const VERSION_LINE = new RegExp(`^\\*\\*Version (\\d+(?:\\.\\d+)?) — in force from (\\d{1,2} (?:${MONTHS}) \\d{4})\\. Not reviewed by a lawyer\\.\\*\\*$`)
const PRODUCTION_SECTION = /^## (\d+)\. Obtaining a production licence$/m
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

/**
 * LICENSE.md's state: `{ version, date, section, address }`, `version` as
 * the line writes it (`'1.1'`; a number would make 1.1 of a 1.10), `date`
 * the day it is in force from, `section` the number of the section on
 * obtaining a production licence and `address` the one address it names.
 * Throws on a version line it does not read -- a draft's and a reviewed
 * licence's among them -- on none under the title, on no section on
 * obtaining a production licence, and on that section naming no address, or
 * several.
 */
export function readLicence(text) {
  const source = text.replaceAll('\r\n', '\n')
  const lines = source.split('\n').filter((line) => line.trim() !== '')
  const head = lines[0]?.startsWith('# ') ? lines[1] : undefined
  if (head === undefined || !head.startsWith('**Version ')) throw new Error(`${LICENCE} has no version line under its title`)
  const match = VERSION_LINE.exec(head)
  if (match === null) {
    throw new Error(
      `${LICENCE}'s version line, ${head}, is not one ${GENERATOR} reads: it reads a licence in force that no lawyer has reviewed (0048); teach it the line, and what a document says of it`,
    )
  }

  const heading = PRODUCTION_SECTION.exec(source)
  if (heading === null) throw new Error(`${LICENCE} has no section "Obtaining a production licence"`)
  const section = Number(heading[1])
  const body = source.slice(heading.index + heading[0].length).split(/^## /m)[0]
  const addresses = [...new Set(body.match(ADDRESS) ?? [])]
  if (addresses.length === 0) throw new Error(`${LICENCE}'s section ${String(section)} names no address a production licence is requested from`)
  if (addresses.length > 1) throw new Error(`${LICENCE}'s section ${String(section)} names ${String(addresses.length)} addresses: ${addresses.join(', ')}; a document can name only one`)
  return { version: match[1], date: match[2], section, address: addresses[0] }
}

/** The link to LICENSE.md from the repository-relative Markdown `file`. */
export function linkFrom(file) {
  const link = posix.relative(posix.dirname(file), LICENCE)
  return link.startsWith('../') ? link : `./${link}`
}

/** The block's body: the licence's version, date, review and address, and nothing else. */
export function render(licence, link) {
  return `[\`${LICENCE}\`](${link}) has the terms. It is Version ${licence.version}, in force from ${licence.date}, and says at the top that no lawyer has reviewed it. A production licence is requested from [${licence.address}](mailto:${licence.address}), as its section ${String(licence.section)} says.`
}

/** Every tracked Markdown document holding this generator's block, README.md always among them. */
export function documents(root = repo) {
  const tracked = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '')
  const holding = tracked.filter((file) => blocks(readFileSync(join(root, file), 'utf8')).some((entry) => entry.generator === GENERATOR))
  return [...new Set([REQUIRED, ...holding])]
}

/** The documents whose block differs from what LICENSE.md renders: `{ file, current, next }`. Throws when README.md holds none. */
export function stale(root = repo) {
  const licence = readLicence(readFileSync(join(root, LICENCE), 'utf8'))
  return documents(root).flatMap((file) => {
    const current = readFileSync(join(root, file), 'utf8')
    const body = render(licence, linkFrom(file))
    return readBlock(current, GENERATOR) === body ? [] : [{ file, current, next: replaceBlock(current, GENERATOR, body, { from: LICENCE }) }]
  })
}

/**
 * What is wrong with the gates register (docs/release/gates.json, parsed)
 * against a licence no lawyer has reviewed -- the only one `readLicence`
 * reads. Whether gate 10's open reason names that review is not read here.
 */
export function gateProblems(register) {
  const gate = (register.gates ?? []).find((entry) => entry.gate === LEGAL_GATE)
  if (gate === undefined) return [`gate ${String(LEGAL_GATE)} is not in docs/release/gates.json`]
  if (gate.evidence !== undefined) {
    return [
      `gate ${String(LEGAL_GATE)} has evidence, but ${LICENCE} says no lawyer has reviewed it, and that review is what gate ${String(LEGAL_GATE)} waits for: give it its open reason back`,
    ]
  }
  return []
}

// `node scripts/licence-status.mjs [--write]`
if (process.argv[1]?.replaceAll('\\', '/').endsWith(GENERATOR)) {
  const differing = stale(repo)
  if (process.argv.includes('--write')) {
    for (const { file, next } of differing) writeFileSync(join(repo, file), next, 'utf8')
    console.log(differing.length === 0 ? 'every licence block is current' : `rewrote ${differing.map(({ file }) => file).join(', ')}`)
  } else if (differing.length > 0) {
    console.error(`stale: ${differing.map(({ file }) => file).join(', ')}; run node scripts/licence-status.mjs --write`)
    process.exitCode = 1
  } else {
    console.log('every licence block is current')
  }
}
