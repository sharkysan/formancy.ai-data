import type { RecordAdapter, RecordColumn, RecordConcurrency, RecordFailure, RecordOutcome, RecordTarget, RecordValue } from '@formancy/data-core'
import { decodeRowversion, encodeRowversion, rowFilterTerms } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { prepare, send } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { fromCanonicalText } from '../sql/values.js'
import { failureFor } from './errors.js'
import type { Phase } from './errors.js'
import { existsStatement, insertStatement, readStatement, updateStatement } from './statements.js'
import type { ExpectedVersion } from './statements.js'

/** A row as every record statement selects it: `[found]`, `[c0]…` canonical text, and `[version]`. */
type Row = Record<string, unknown>

const NOT_FOUND: RecordFailure = { ok: false, code: 'not-found', message: 'No such record is visible to this request.' }
const STALE: RecordFailure = { ok: false, code: 'stale', message: 'The record has changed since it was read.' }

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

function recordFrom(row: Row, columns: readonly RecordColumn[], concurrency: RecordConcurrency | null): RecordOutcome {
  return {
    ok: true,
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
export function createSqlServerRecords(pool: ConnectionPool): RecordAdapter {
  return {
    async read(request) {
      const terms = rowFilterTerms(request.filters)
      checkKey(request.target, request.key)
      const rows = await attempt(pool, readStatement(request, terms), 'read')
      if (!Array.isArray(rows)) return rows
      const row = onlyRow(rows)
      return row === undefined ? NOT_FOUND : recordFrom(row, request.columns, request.target.concurrency)
    },

    async insert(request) {
      checkAssigned(request.values, null)
      const rows = await attempt(pool, insertStatement(request), 'write', request.values)
      if (!Array.isArray(rows)) return rows
      const row = rows[0]
      // An INSERT … VALUES writes one row, and the batch selects it back.
      if (row === undefined) throw new Error('SQL Server reported no inserted row')
      return recordFrom(row, request.returning, request.target.concurrency)
    },

    async update(request) {
      const { target } = request
      const terms = rowFilterTerms(request.filters)
      checkKey(target, request.key)
      if (request.set.length === 0) throw new Error('An update sets at least one column')
      checkAssigned(request.set, target.concurrency.column)

      const expected = expectedVersion(target.concurrency, request.expectedVersion)
      if (expected !== undefined) {
        const rows = await attempt(pool, updateStatement(request, terms, expected), 'write', request.set)
        if (!Array.isArray(rows)) return rows
        const row = onlyRow(rows)
        if (row !== undefined) return recordFrom(row, request.returning, target.concurrency)
      }

      // Nothing matched: either the version moved, or there is no such record
      // for this actor. A second query tells them apart; the write changed
      // nothing, so its failure is a read's.
      const found = await attempt(pool, existsStatement(target.table, request.key, terms), 'read')
      if (!Array.isArray(found)) return found
      return Number(found[0]?.found ?? 0) > 0 ? STALE : NOT_FOUND
    },
  }
}
