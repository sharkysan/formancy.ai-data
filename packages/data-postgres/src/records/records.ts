import { rowFilterTerms } from '@formancy/data-core'
import type { ApiValue, RecordAdapter, RecordColumn, RecordFailure, RecordOutcome, RecordTarget, RowFilterTerm, UpdateRequest } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { run } from '../sql/statement.js'
import type { TextResult, TextRow } from '../sql/statement.js'
import { decodeCanonical } from '../sql/values.js'
import { recordFailure, sqlState } from './errors.js'
import type { Phase } from './errors.js'
import { checkInsert, checkKey, checkUpdate, isVersion } from './requests.js'
import { existsStatement, insertStatement, readStatement, updateStatement } from './sql.js'
import type { RecordStatement } from './sql.js'

const NOT_FOUND: RecordFailure = { ok: false, code: 'not-found', message: 'No such record exists inside the filters.' }
const STALE: RecordFailure = { ok: false, code: 'stale', message: 'The record changed after it was read; its version is no longer the one sent.' }

/** The outcome of one statement: its rows, or the failure the error translates to. */
type Ran = { ok: true; result: TextResult } | { ok: false; failure: RecordFailure; state: string | undefined }

async function attempt(sql: Sql, statement: RecordStatement, phase: Phase): Promise<Ran> {
  try {
    return { ok: true, result: await run(sql, statement.text, statement.params) }
  } catch (error) {
    // Translated, or thrown again when it is a programming error.
    return { ok: false, failure: recordFailure(error, phase), state: sqlState(error) }
  }
}

/** A record from the row a statement returned, in the order `outputs` wrote its columns. */
function recordOf(target: RecordTarget, columns: readonly RecordColumn[], row: TextRow): RecordOutcome {
  const values: Record<string, ApiValue> = {}
  columns.forEach((entry, index) => {
    values[entry.name] = decodeCanonical(entry.type, row[index] ?? null)
  })
  return { ok: true, values, version: target.concurrency === null ? null : (row[columns.length] ?? null) }
}

/**
 * The single row a statement addressed by key. Never more than one against a
 * real key; more is a binding whose identity is not one, and is thrown.
 */
function onlyRow(result: TextResult): TextRow | undefined {
  if (result.rows.length > 1) throw new Error('The identity matched more than one row; it is not a key of this table.')
  return result.rows[0]
}

/**
 * `stale` or `not-found`, for an update that changed nothing: one more
 * statement, inside the same filters, so a record outside them is not-found
 * here too and its existence is not disclosed. The update's outcome is known
 * by now — nothing was written — so this is a read.
 */
async function whyNothingChanged(sql: Sql, request: UpdateRequest, terms: readonly RowFilterTerm[]): Promise<RecordFailure> {
  const exists = await attempt(sql, existsStatement(request, terms), 'read')
  if (!exists.ok) return exists.failure
  return exists.result.rows.length > 0 ? STALE : NOT_FOUND
}

/**
 * The record half of the operations port on PostgreSQL (0015, 0016).
 *
 * Values are bound from canonical text and read back as canonical text made
 * by the server; identifiers are quoted one part at a time; the filters are
 * read with `rowFilterTerms` and applied in the same statement. A database
 * refusal is a `RecordFailure`; a malformed request or filters is thrown,
 * before anything is sent.
 */
export function createPostgresRecords(sql: Sql): RecordAdapter {
  return {
    async read(request) {
      const terms = rowFilterTerms(request.filters)
      checkKey(request.target, request.key)
      const ran = await attempt(sql, readStatement(request, terms), 'read')
      if (!ran.ok) return ran.failure
      const row = onlyRow(ran.result)
      return row === undefined ? NOT_FOUND : recordOf(request.target, request.columns, row)
    },

    async insert(request) {
      checkInsert(request)
      const ran = await attempt(sql, insertStatement(request), 'write')
      if (!ran.ok) return ran.failure
      return recordOf(request.target, request.returning, ran.result.rows[0] ?? [])
    },

    async update(request) {
      const terms = rowFilterTerms(request.filters)
      checkUpdate(request, terms)
      // A version that is not a number names no state the record was ever
      // in. Bound, it would be an error; it is answered as any other
      // mismatch, without sending it.
      if (!isVersion(request.expectedVersion)) return whyNothingChanged(sql, request, terms)

      const ran = await attempt(sql, updateStatement(request, terms), 'write')
      // Under REPEATABLE READ, which a composition root may make the
      // default, PostgreSQL answers a lost race with 40001 instead of 0 rows
      // (0006). Nothing was written either way, so it is answered the same way.
      if (!ran.ok) return ran.state === '40001' ? whyNothingChanged(sql, request, terms) : ran.failure
      const row = onlyRow(ran.result)
      return row === undefined ? whyNothingChanged(sql, request, terms) : recordOf(request.target, request.returning, row)
    },
  }
}
