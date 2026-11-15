import type { DeleteOutcome, RecordAdapter, RecordFailure } from '@formancy/data-core'
import { deleteTerms, listTerms, rowFilterTerms, throughTerms } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { deleteStatement } from './delete.js'
import { definitionBytes, describedFrom } from './definition.js'
import {
  attempt,
  checkAssigned,
  checkKey,
  DEFINITION_MOVED,
  expectedVersion,
  names,
  NOT_FOUND,
  onlyRow,
  recordFrom,
  STALE,
  whyNothingChanged,
} from './explain.js'
import type { Row } from './explain.js'
import { listStatement } from './list.js'
import { saveSqlServer } from './save.js'
import { describeStatement, existsStatement, insertStatement, readStatement, updateStatement } from './statements.js'
import { supersedeStatement } from './versions.js'

const CHAIN_EXISTS: RecordFailure = {
  ok: false,
  code: 'chain-exists',
  message: 'The chain this create would start has a version already: its open version is changed from a date instead (0113).',
}
/** An object the catalog does not show this account as discovery describes one: gone, out of sight, or not a table or a view. Which, drift review says (0010). */
const NOT_DESCRIBED: RecordFailure = { ok: false, code: 'schema-changed', message: 'The catalog does not show this table as discovery describes one.' }
/** The facts arrived shorter than they were hashed: a TEXTSIZE the connection set. Nothing can be decided over them. */
const CUT: RecordFailure = {
  ok: false,
  code: 'unavailable',
  message: "The table's description arrived cut short, so nothing can be decided over it: the connection's TEXTSIZE is smaller than the description.",
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
      return {
        ok: true,
        described,
        rows: rows.filter((row) => row.found !== null).map((row) => recordFrom(row, request.columns, request.target.concurrency)),
        after,
      }
    },

    async insert(request) {
      checkAssigned(request.values, null, request.clock)
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
      checkAssigned(request.set, target.concurrency.column, request.clock)
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
      // A column stamped with the clock (0153) is one the next version is written with too.
      const written = [...request.chain.map((entry) => entry.name), request.start.name, ...names(request.values), ...names(request.clock ?? [])]
      if (new Set(written).size !== written.length || written.includes(request.ends))
        throw new Error('A change from a date writes each column of the next version once, and never its end')
      checkAssigned([request.start, ...request.values], target.concurrency.column, request.clock)
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

    // A record and its rows in one batch (0155): save.ts.
    save: (request) => saveSqlServer(pool, request),
  }
}
