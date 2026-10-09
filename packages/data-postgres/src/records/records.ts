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

/**
 * A write the server completed without writing the row, and without an
 * error: a BEFORE trigger that returned NULL, a rule that did something
 * else instead, or — for an update — a row security policy that lets the
 * actor see the row and not change it. The contract has no code of its
 * own for a rule the database enforces without declaring it as a
 * constraint; a trigger's RAISE is `check-violation` too (errors.ts).
 */
const DECLINED_INSERT: RecordFailure = {
  ok: false,
  code: 'check-violation',
  message: 'PostgreSQL completed the insert without writing the row: a trigger or a rule on the table declined it.',
}
const DECLINED_UPDATE: RecordFailure = {
  ok: false,
  code: 'check-violation',
  message: 'PostgreSQL completed the update without writing the row, though it exists at the version sent: a trigger, a rule or a row security policy declined it.',
}

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
 * `stale`, `not-found` or declined, for an update that changed nothing: one
 * more statement, inside the same filters, so a record outside them is
 * not-found here too and its existence is not disclosed. The update's
 * outcome is known by now — nothing was written — so this is a read.
 *
 * A record that is there with the version the update was sent with was not
 * changed by anybody else: versions only move forward, by one per write. The
 * database declined the update itself, and answering `stale` would send the
 * person back to reload a record that has not changed, to be told the same
 * thing again. `withVersion` is false where the version says nothing about
 * that: one that was never bound names no state the record was ever in, and
 * a serialization failure is a race whatever the version reads now.
 */
async function whyNothingChanged(sql: Sql, request: UpdateRequest, terms: readonly RowFilterTerm[], withVersion: boolean): Promise<RecordFailure> {
  const exists = await attempt(sql, existsStatement(request, terms, withVersion), 'read')
  if (!exists.ok) return exists.failure
  const row = exists.result.rows[0]
  if (row === undefined) return NOT_FOUND
  return row[0] === 'true' ? DECLINED_UPDATE : STALE
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
      // INSERT 0 0, and no error. Without RETURNING there is no row to read
      // either way, so the command tag is what says whether one was written.
      if (ran.result.count !== 1) return DECLINED_INSERT
      return recordOf(request.target, request.returning, ran.result.rows[0] ?? [])
    },

    async update(request) {
      const terms = rowFilterTerms(request.filters)
      checkUpdate(request, terms)
      // A version that is not a number names no state the record was ever
      // in. Bound, it would be an error; it is answered as any other
      // mismatch, without sending it.
      if (!isVersion(request.expectedVersion)) return whyNothingChanged(sql, request, terms, false)

      const ran = await attempt(sql, updateStatement(request, terms), 'write')
      // Under REPEATABLE READ, which a composition root may make the
      // default, PostgreSQL answers a lost race with 40001 instead of 0 rows
      // (0006). Nothing was written either way, so it is answered the same
      // way — as a race, whatever the version reads now: under SERIALIZABLE
      // a conflict over other rows is 40001 too, with this one unchanged.
      if (!ran.ok) return ran.state === '40001' ? whyNothingChanged(sql, request, terms, false) : ran.failure
      const row = onlyRow(ran.result)
      return row === undefined ? whyNothingChanged(sql, request, terms, true) : recordOf(request.target, request.returning, row)
    },
  }
}
