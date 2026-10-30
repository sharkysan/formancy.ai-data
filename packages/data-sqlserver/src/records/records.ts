import type { DeleteOutcome, RecordAdapter, RecordColumn, RecordConcurrency, RecordFailure, RecordRead, RecordTarget, RecordValue } from '@formancy/data-core'
import { decodeRowversion, deleteTerms, encodeRowversion, listTerms, rowFilterTerms, throughTerms } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { prepare, send } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { fromCanonicalText } from '../sql/values.js'
import { deleteStatement } from './delete.js'
import { definitionBytes, describedFrom } from './definition.js'
import { failureFor } from './errors.js'
import type { Phase } from './errors.js'
import { listStatement } from './list.js'
import { describeStatement, existsStatement, insertStatement, readStatement, updateStatement } from './statements.js'
import { supersedeStatement } from './versions.js'
import type { ExpectedVersion } from './statements.js'

/** A row as every record statement selects it: `[found]`, `[c0]…` canonical text, and `[version]`. */
type Row = Record<string, unknown>

const NOT_FOUND: RecordFailure = { ok: false, code: 'not-found', message: 'No such record is visible to this request.' }
const STALE: RecordFailure = { ok: false, code: 'stale', message: 'The record has changed since it was read.' }
const VERSION_ENDED: RecordFailure = { ok: false, code: 'version-ended', message: 'The version has ended, at the version sent: only the open version of a chain is changed (0113).' }
const CHAIN_EXISTS: RecordFailure = { ok: false, code: 'chain-exists', message: 'The chain this create would start has a version already: its open version is changed from a date instead (0113).' }
/** The table moved under an update that matched nothing, or that was never sent (0041). */
const DEFINITION_MOVED: RecordFailure = { ok: false, code: 'schema-changed', message: "The table's definition is not the one this write was decided over; nothing was written." }
/** An object the catalog does not show this account as discovery describes one: gone, out of sight, or not a table or a view. Which, drift review says (0010). */
const NOT_DESCRIBED: RecordFailure = { ok: false, code: 'schema-changed', message: 'The catalog does not show this table as discovery describes one.' }
/** The facts arrived shorter than they were hashed: a TEXTSIZE the connection set. Nothing can be decided over them. */
const CUT: RecordFailure = { ok: false, code: 'unavailable', message: "The table's description arrived cut short, so nothing can be decided over it: the connection's TEXTSIZE is smaller than the description." }

/** The largest bigint: a version column's token is compared as one. */
const BIGINT_MAX = 9223372036854775807n
const CANONICAL_INTEGER = /^-?(?:0|[1-9][0-9]*)$/

function names(values: readonly RecordColumn[]): string[] {
  return values.map((value) => value.name)
}

/**
 * The key names exactly the target's identity, each column once. Anything
 * else could match several records — or, with no identity at all, every
 * record — so it is a programming error, refused before anything is sent.
 */
function checkKey(target: RecordTarget, key: readonly RecordValue[]): void {
  const identity = names(target.identity)
  const given = names(key)
  if (identity.length === 0 || given.length !== identity.length || new Set(given).size !== given.length || !identity.every((name) => given.includes(name))) {
    throw new Error(`A record key names exactly its identity (${identity.join(', ')}), and this one names (${given.join(', ')})`)
  }
}

/** The values a write assigns: each column once, which SQL Server would otherwise refuse with an error that is not a refusal. */
function checkAssigned(values: readonly RecordValue[], reserved: string | null): void {
  const given = names(values)
  if (new Set(given).size !== given.length) throw new Error('A write names each column once')
  if (reserved !== null && given.includes(reserved)) throw new Error(`${reserved} is the concurrency column; the database or the adapter writes it`)
}

/**
 * The version as it is compared, or `undefined` for a token no record can
 * hold — not 16 lower-case hex digits for a rowversion, not a canonical
 * integer within bigint for a version column. Such a token is never bound; it
 * gets the answer a token that does not match gets.
 */
function expectedVersion(concurrency: RecordConcurrency, token: string): ExpectedVersion | undefined {
  if (concurrency.kind === 'rowversion') {
    const bytes = decodeRowversion(token)
    return bytes === undefined ? undefined : { kind: 'rowversion', bytes: Buffer.from(bytes) }
  }
  if (typeof token !== 'string' || !CANONICAL_INTEGER.test(token) || token === '-0') return undefined
  const value = BigInt(token)
  return value > BIGINT_MAX || value < -BIGINT_MAX - 1n ? undefined : { kind: 'version-column', value: token }
}

/**
 * Why an update or a change from a date changed nothing, from one more read
 * inside the same filters and throughs (0043): the table moved, a version
 * that had ended at the version sent (0113), the version moved, or no such
 * record for this actor -- in that order. The write changed nothing, so the
 * read's failure is the answer.
 */
async function whyNothingChanged(pool: ConnectionPool, statement: Statement): Promise<RecordFailure> {
  const found = await attempt(pool, statement, 'read')
  if (!Array.isArray(found)) return found
  if (Number(found[0]?.same ?? 0) !== 1) return DEFINITION_MOVED
  if (Number(found[0]?.ended ?? 0) > 0) return VERSION_ENDED
  return Number(found[0]?.found ?? 0) > 0 ? STALE : NOT_FOUND
}

/** The token for the version a row came back with: `encodeRowversion`'s hex, or a version column's decimal string. */
function versionToken(concurrency: RecordConcurrency | null, row: Row): string | null {
  if (concurrency === null) return null
  const version = row.version
  if (concurrency.kind === 'rowversion') {
    if (!(version instanceof Uint8Array)) throw new Error(`${concurrency.column} did not come back as a rowversion`)
    return encodeRowversion(version)
  }
  if (typeof version !== 'string') throw new Error(`${concurrency.column} did not come back as a version`)
  return version
}

function recordFrom(row: Row, columns: readonly RecordColumn[], concurrency: RecordConcurrency | null): Omit<RecordRead, 'ok'> {
  return {
    // fromEntries, so a column called __proto__ is a value like any other.
    values: Object.fromEntries(
      columns.map((column, index) => {
        const text = row[`c${String(index)}`]
        return [column.name, fromCanonicalText(column.type, typeof text === 'string' ? text : null)]
      }),
    ),
    version: versionToken(concurrency, row),
  }
}

/** Runs one statement, and turns what the driver rejected it with into a failure. A request it would not even take is thrown. */
async function attempt(pool: ConnectionPool, statement: Statement, phase: Phase, written: readonly RecordValue[] = []): Promise<Row[] | RecordFailure> {
  const request = prepare(pool, statement)
  try {
    return await send<Row>(request, statement)
  } catch (error) {
    return failureFor(error, phase, written)
  }
}

function onlyRow(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) throw new Error('The record identity matched more than one row: the bindings do not name a key.')
  return rows[0]
}

/**
 * The record half of the SQL Server adapter, through a pool the composition
 * root connected (0015).
 *
 * Values arrive canonical and are bound as text the server converts; they
 * leave as text the server produced (`../sql/values.ts`). Each write is one
 * batch: the statement, a check that its transaction is still the one it
 * began and that no INSTEAD OF trigger decided what it stored, a check that
 * every text value was stored as sent, the version read back from the row
 * once its triggers ran, and a commit, all rolled back on any error — so a
 * single-byte varchar cannot quietly keep `LA` for `ŁA`, neither an INSTEAD
 * OF trigger nor one that swaps the transaction can make a write that was not
 * stored look done, and a refusal is not reported over a write the batch
 * committed. A trigger that ends the transaction itself is `unknown-outcome`,
 * whether or not it then raises an error, because whether it committed cannot
 * be told. A database error is a
 * `RecordFailure`, never thrown; a malformed request — a key that is not the
 * identity, a column named twice, a value no codec returns — is a programming
 * error and is.
 */
/** The description a row of `describeStatement` or `readStatement` carries, or why there is none. */
function describedBy(row: Row): ReturnType<typeof describedFrom> {
  const facts = row.facts
  const digest = row.digest
  return describedFrom(typeof facts === 'string' ? facts : null, digest instanceof Uint8Array ? Buffer.from(digest) : null)
}

export function createSqlServerRecords(pool: ConnectionPool): RecordAdapter {
  return {
    async describe(table) {
      const rows = await attempt(pool, describeStatement(table), 'read')
      if (!Array.isArray(rows)) return rows
      // One row: a SELECT of expressions over one derived row.
      const described = describedBy(rows[0] as Row)
      if (described === 'cut') return CUT
      return described === undefined ? NOT_DESCRIBED : { ok: true, described }
    },

    async read(request) {
      const terms = rowFilterTerms(request.filters)
      const through = throughTerms(request.through)
      checkKey(request.target, request.key)
      const rows = await attempt(pool, readStatement(request, terms, through), 'read')
      if (!Array.isArray(rows)) return rows
      // Always a row, the description's, with the record beside it or not.
      const row = onlyRow(rows) as Row
      const described = describedBy(row)
      if (described === 'cut') return CUT
      if (described === undefined) return NOT_DESCRIBED
      return { ok: true, described, record: row.found === null ? null : recordFrom(row, request.columns, request.target.concurrency) }
    },

    async list(request) {
      const terms = listTerms(request)
      const rows = await attempt(pool, listStatement(request, terms), 'read')
      if (!Array.isArray(rows)) return rows
      // Always a row: the description's, on the page's first record or beside none.
      const described = describedBy(rows[0] as Row)
      if (described === 'cut') return CUT
      if (described === undefined) return NOT_DESCRIBED
      // Whether the row the page continues after was found (0108), on every row.
      const after = request.after === null ? null : (rows[0] as Row).anchored === 1 ? 'found' : 'gone'
      return { ok: true, described, rows: rows.filter((row) => row.found !== null).map((row) => recordFrom(row, request.columns, request.target.concurrency)), after }
    },

    async insert(request) {
      checkAssigned(request.values, null)
      const definition = definitionBytes(request.definition)
      const rows = await attempt(pool, insertStatement(request, definition), 'write', request.values)
      if (!Array.isArray(rows)) return rows
      const row = rows[0]
      // An INSERT … VALUES writes one row, and the batch selects it back. One
      // that starts a chain inserts none where the chain has a version (0113).
      if (row === undefined && request.fresh !== undefined) return CHAIN_EXISTS
      if (row === undefined) throw new Error('SQL Server reported no inserted row')
      return { ok: true, ...recordFrom(row, request.returning, request.target.concurrency) }
    },

    async update(request) {
      const { target } = request
      const terms = rowFilterTerms(request.filters)
      const through = throughTerms(request.through)
      checkKey(target, request.key)
      if (request.set.length === 0) throw new Error('An update sets at least one column')
      checkAssigned(request.set, target.concurrency.column)
      const definition = definitionBytes(request.definition)

      const expected = expectedVersion(target.concurrency, request.expectedVersion)
      if (expected !== undefined) {
        const rows = await attempt(pool, updateStatement(request, terms, through, expected, definition), 'write', request.set)
        if (!Array.isArray(rows)) return rows
        const row = onlyRow(rows)
        if (row !== undefined) return { ok: true, ...recordFrom(row, request.returning, target.concurrency) }
      }

      // Nothing matched: the table moved, the version moved, or there is no
      // such record for this actor. A second query tells them apart, in that
      // order, inside the same filters and throughs; the write changed
      // nothing, so its failure is a read's.
      const ended = request.open === undefined || expected === undefined ? undefined : { open: request.open, concurrency: target.concurrency, expected }
      return whyNothingChanged(pool, existsStatement(request, terms, through, definition, ended))
    },

    async supersede(request) {
      const { target } = request
      const terms = rowFilterTerms(request.filters)
      const through = throughTerms(request.through)
      checkKey(target, request.key)
      const written = [...request.chain.map((entry) => entry.name), request.start.name, ...request.values.map((value) => value.name)]
      if (new Set(written).size !== written.length || written.includes(request.ends)) throw new Error('A change from a date writes each column of the next version once, and never its end')
      checkAssigned([request.start, ...request.values], target.concurrency.column)
      const definition = definitionBytes(request.definition)
      const expected = expectedVersion(target.concurrency, request.expectedVersion)
      if (expected !== undefined) {
        const rows = await attempt(pool, supersedeStatement(request, terms, through, expected, definition), 'write', [request.start, ...request.values])
        if (!Array.isArray(rows)) return rows
        const row = onlyRow(rows)
        if (row !== undefined) return { ok: true, ...recordFrom(row, request.returning, target.concurrency) }
      }
      // Nothing was ended: read once more, as for an update, whether it had ended already.
      const ended = expected === undefined ? undefined : { open: request.ends, concurrency: target.concurrency, expected }
      return whyNothingChanged(pool, existsStatement(request, terms, through, definition, ended))
    },

    async delete(request): Promise<DeleteOutcome> {
      const { target } = request
      const terms = deleteTerms(request)
      checkKey(target, terms.key)
      const definition = definitionBytes(request.definition)
      const expected = expectedVersion(target.concurrency, terms.expectedVersion)
      if (expected !== undefined) {
        const rows = await attempt(pool, deleteStatement(request, terms, expected, definition), 'write')
        if (!Array.isArray(rows)) return rows
        const row = onlyRow(rows)
        if (row !== undefined) {
          const removed = recordFrom(row, target.identity, target.concurrency)
          return { ok: true, deleted: { values: removed.values, version: removed.version as string } }
        }
      }
      // Nothing was deleted: as for an update, a second query tells a moved
      // definition, a stale version and no such record apart, inside the
      // same filters and throughs. A reach that moved was refused by the
      // batch itself, which raised it (delete.ts).
      const found = await attempt(pool, existsStatement({ target, key: terms.key }, terms.terms, terms.through, definition), 'read')
      if (!Array.isArray(found)) return found
      if (Number(found[0]?.same ?? 0) !== 1) return DEFINITION_MOVED
      return Number(found[0]?.found ?? 0) > 0 ? STALE : NOT_FOUND
    },
  }
}
