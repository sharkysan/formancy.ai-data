// The known limitations the decision records state (0035): one sentence per
// cost a user, integrator or operator of a release will meet, each "stated
// by" its record, in docs/release/limitations.json -- the register the
// release report prints after the limitations it derives from the run.
//
// The register is held to the records by hash. Each entry's `reviewed` is
// the sha256 of its record as it was read (check-cla.mjs's formula, over
// the text with CRLF made LF), so ANY edit to a record -- a later record
// changing its Status line included -- fails limitations.test.mjs until
// somebody reads it again and stamps it:
//
//   node scripts/release-report/limitations.mjs --changed     records edited since they were read
//   node scripts/release-report/limitations.mjs --missing     records with no entry
//   node scripts/release-report/limitations.mjs --stamp 0030  rewrite that one hash, after reading 0030
//
// The fence detects change, not meaning: a stamp without a reading passes.
// And a line can outlive its truth until its record changes; CLAUDE.md asks
// for a record whenever a decision changes, and `heldBy`, where a test
// already shows a line still holds, makes the run say so.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agreementHash as recordHash } from '../check-cla.mjs'
import { coveredPackages } from '../codecov-config.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const REGISTER = 'docs/release/limitations.json'
export const DECISIONS = 'docs/decisions'

/** Where a limitation is met. Closed, so the report's grouping is the register's. */
export const AREAS = ['licence', 'databases', 'forms', 'access', 'writes', 'server', 'studio', 'host', 'operations', 'testing']

/** Every decision record: its number, file, title, Status line and hash. */
export function readRecords(root = repo) {
  return readdirSync(join(root, DECISIONS))
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort()
    .map((file) => {
      const text = readFileSync(join(root, DECISIONS, file), 'utf8')
      const title = /^# \d{4} — (.+)$/m.exec(text)?.[1]
      const status = /^- \*\*Status:\*\* (.+)$/m.exec(text)?.[1]
      if (title === undefined || status === undefined) throw new Error(`${DECISIONS}/${file} has no "# NNNN — Title" or no "- **Status:**" line`)
      return { number: file.slice(0, 4), file, title, status, hash: recordHash(text) }
    })
}

/** The register, parsed. */
export function readRegister(root = repo) {
  return JSON.parse(readFileSync(join(root, REGISTER), 'utf8'))
}

const TEST_FILE = /\.test\.tsx?$/

/**
 * What is wrong with `register` against `records`, as sentences. Pure: the
 * tests hand it registers and records the repository does not have.
 * `covered` is the repository paths of the packages with a test:coverage
 * script; `exists` says whether a repository path is a file.
 */
export function registerProblems(register, records, { covered, exists }) {
  const problems = []
  const entries = register?.records ?? {}
  const numbers = new Set(records.map((record) => record.number))
  for (const record of records) {
    const entry = entries[record.number]
    if (entry === undefined) {
      problems.push(`${record.number} has no entry: read it and add its limitations, or why it has none`)
      continue
    }
    if (entry.reviewed !== record.hash) {
      problems.push(`${record.number} changed since it was read: read it again, then run node scripts/release-report/limitations.mjs --stamp ${record.number}`)
    }
    const listed = Array.isArray(entry.limitations) && entry.limitations.length > 0
    const none = typeof entry.none === 'string' && entry.none.trim() !== ''
    if (listed === none) problems.push(`${record.number} has ${listed ? 'both limitations and none' : 'neither limitations nor none'}; it needs exactly one`)
    if (/^(superseded by|reversed)/.test(record.status) && listed) problems.push(`${record.number} is ${record.status.split(';')[0]}, so its limitations are a later record's: give it none`)
  }
  for (const number of Object.keys(entries)) if (!numbers.has(number)) problems.push(`${number} is in the register and no record has that number`)

  const seen = new Set()
  for (const [number, entry] of Object.entries(entries)) {
    for (const [index, limitation] of (entry.limitations ?? []).entries()) {
      const where = `${number}'s limitation ${String(index + 1)}`
      if (!AREAS.includes(limitation.area)) problems.push(`${where} has the area ${String(limitation.area)}, which is not one of ${AREAS.join(', ')}`)
      const says = typeof limitation.says === 'string' ? limitation.says.trim() : ''
      if (says === '' || !says.endsWith('.')) problems.push(`${where} must say one sentence, ending with a full stop`)
      if (seen.has(says)) problems.push(`${where} says what another line already says`)
      seen.add(says)
      if (limitation.heldBy !== undefined) {
        const file = String(limitation.heldBy)
        const inPackage = covered.some((path) => file.startsWith(`${path}/`))
        if (!TEST_FILE.test(file) || !inPackage || !exists(file)) problems.push(`${where} is held by ${file}, which is not a test file of a package with a suite`)
      }
    }
  }
  return problems
}

/**
 * The register's lines as the report prints them, grouped by area in AREAS'
 * order, each with the record that states it -- title, Status line, and a
 * link to its consequences at `commit` -- and, when it names one, whether
 * its `heldBy` test passed in this run (`outcome(file)`: passed, failed or
 * absent). They present what the records state, not a claim of the run's.
 */
export function statedLimitations({ register, records, outcome, repository, commit }) {
  const lines = []
  for (const record of records) {
    for (const limitation of register.records?.[record.number]?.limitations ?? []) {
      lines.push({
        area: limitation.area,
        says: limitation.says,
        number: record.number,
        title: record.title,
        // The Status line links later records relatively, which from a report is nowhere.
        status: record.status.replaceAll(/\]\((\d{4}-[^)]+\.md)\)/g, `](${repository}/blob/${commit}/${DECISIONS}/$1)`),
        link: `${repository}/blob/${commit}/${DECISIONS}/${record.file}#consequences`,
        ...(limitation.heldBy === undefined ? {} : { heldBy: limitation.heldBy, held: outcome(limitation.heldBy) }),
      })
    }
  }
  return AREAS.map((area) => ({ area, lines: lines.filter((line) => line.area === area) })).filter((group) => group.lines.length > 0)
}

/** The register's problems, against this repository. */
export function problemsHere(root = repo) {
  return registerProblems(readRegister(root), readRecords(root), {
    covered: coveredPackages(root).map((entry) => entry.path),
    exists: (path) => existsSync(join(root, path)),
  })
}

/**
 * `text` (the register) with the `reviewed` hash of record `number` -- and
 * nothing else -- replaced by `hash`. Throws when the entry is not there.
 */
export function stamp(text, number, hash) {
  const entry = new RegExp(`("${number}":\\s*\\{\\s*"reviewed":\\s*")sha256:[0-9a-f]*(")`)
  if (!entry.test(text)) throw new Error(`${REGISTER} has no entry for ${number} opening with "reviewed": add it first`)
  return text.replace(entry, `$1${hash}$2`)
}

// `node scripts/release-report/limitations.mjs --changed | --missing | --stamp NNNN`
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/release-report/limitations.mjs')) {
  const records = readRecords()
  const register = readRegister()
  const argv = process.argv.slice(2)
  if (argv[0] === '--stamp') {
    const record = records.find((candidate) => candidate.number === argv[1])
    if (record === undefined) throw new Error(`no record is numbered ${String(argv[1])}`)
    const file = join(repo, REGISTER)
    writeFileSync(file, stamp(readFileSync(file, 'utf8'), record.number, record.hash), 'utf8')
    console.log(`${REGISTER}: ${record.number} stamped as read, ${record.hash}`)
  } else if (argv[0] === '--changed') {
    for (const record of records) if (register.records[record.number] !== undefined && register.records[record.number].reviewed !== record.hash) console.log(`${record.number} ${record.file}`)
  } else if (argv[0] === '--missing') {
    for (const record of records) if (register.records[record.number] === undefined) console.log(`${record.number} ${record.file}`)
  } else {
    const problems = problemsHere()
    for (const problem of problems) console.error(problem)
    if (problems.length === 0) console.log(`${REGISTER}: every record read, as it stands`)
    process.exitCode = problems.length === 0 ? 0 : 1
  }
}
