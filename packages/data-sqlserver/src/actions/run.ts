import { LIST_PAGE_SIZE, rowFilterTerms, runFailure, throughTerms, unmovedFailure } from '@formancy/data-core'
import type { ActionAdapter, ActionFailure, ActionOutcome, ActionRequest, ApiValue, DescribedAction, RecordFailure } from '@formancy/data-core'
import mssql from 'mssql'
import type { ConnectionPool } from 'mssql'
import { describedFrom, definitionBytes } from '../records/definition.js'
import { failureFor } from '../records/errors.js'
import { attempt, checkKey, expectedVersion, whyNothingChanged } from '../records/explain.js'
import type { Row } from '../records/explain.js'
import { existsStatement } from '../records/statements.js'
import type { Statement } from '../sql/statement.js'
import { fromCanonicalText } from '../sql/values.js'
import { describeActionStatement, describedRoutineFrom, routineDigest } from './definition.js'
import { batchFailure } from './errors.js'
import type { Failed } from './errors.js'
import { BatchResults, keyColumns } from './results.js'
import { runBatch } from './statements.js'

/*
 * An action's run on SQL Server (0160): checked before anything is sent,
 * built into one batch (statements.ts), sent once with mssql's
 * per-request timeout at the run's deadline and never again, and answered
 * from what the batch selects -- the step CATCH recorded with SQL Server's
 * number, or the moved records' keys with their positions. A lock that
 * moved fewer records than were sent is explained after the batch, each
 * record it did not move by the read an update alone would ask, and
 * answered as `unmovedFailure` reads them, as PostgreSQL's is (0165).
 *
 * Where the engines differ on a deadline, written down here: each UPDATE of
 * the lock step waits at most LOCK_TIMEOUT, half the deadline -- chosen,
 * not measured -- and a wait past it is 1222, a known rollback,
 * `unavailable`; a selection's lock step as a whole, one UPDATE per record
 * (0165), is bounded by the deadline alone. Past the deadline mssql sends
 * an attention and the client's ETIMEOUT may follow a COMMIT (0031 P3):
 * `unknown-outcome`, which is what any run past its deadline reads here, a
 * selection's still in its lock step, nothing called, included. The attention is in-band and stops only this batch
 * (0061); no cancel is sent of the adapter's own.
 *
 * The batch's result sets are streamed, and every row of one that is not
 * the batch's own two is dropped as it arrives: a procedure's result set,
 * which mssql would otherwise hold whole until the batch ended (read in
 * mssql 12.7.4's lib/tedious/request.js, and measured,
 * actions.integration.test.ts). What is kept is results.ts's, held by
 * results.test.ts.
 */

/**
 * mssql's Request with the per-request timeout its constructor takes
 * (`lib/base/request.js`, mssql 12.7.4: `constructor (parent, overrides)`),
 * which @types/mssql 12.3.0 does not declare. 0061 measured that it bounds
 * its request and does not carry over to the next on the connection.
 */
const TimedRequest = mssql.Request as unknown as new (parent: ConnectionPool, overrides: { requestTimeout: number }) => mssql.Request

/**
 * Sends the batch once, its rows streamed: the batch's own two result sets
 * kept, which it selects last, and every other dropped (results.ts). What
 * the driver rejected the request with -- an error CATCH could not catch,
 * an attention, a connection lost -- is thrown, the first of them.
 */
function sendStreamed(
  pool: ConnectionPool,
  statement: Statement,
  request: ActionRequest,
  timeoutMs: number,
): Promise<{ failed: Failed[]; moved: Row[] } | 'unanswered'> {
  const sent = new TimedRequest(pool, { requestTimeout: timeoutMs })
  for (const parameter of statement.parameters) sent.input(parameter.name, parameter.type, parameter.value)
  sent.stream = true
  const results = new BatchResults([...keyColumns(request.target.identity), 'o'])
  let error: Error | undefined
  sent.on('recordset', (columns: Record<string, unknown>) => {
    results.recordset(Object.keys(columns))
  })
  sent.on('row', (row: Row) => {
    results.row(row)
  })
  // mssql emits each error of a request, then `done`: the first is the answer.
  sent.on('error', (failure: unknown) => {
    error ??= failure instanceof Error ? failure : new Error(String(failure))
  })
  return new Promise((resolve, reject) => {
    sent.on('done', () => {
      if (error !== undefined) return reject(error)
      resolve(results.answer())
    })
    void sent.query(statement.sql)
  })
}

/** A batch that ended without the result sets it selects last: it ran, and nothing says how far. */
const UNANSWERED: ActionFailure = {
  ok: false,
  code: 'unknown-outcome',
  message: 'SQL Server ended the run’s batch without what it selects last; it may have committed, and it is not retried.',
}

const NOT_DESCRIBED: RecordFailure = {
  ok: false,
  code: 'schema-changed',
  message: 'The catalog does not show the table, or the procedure, as discovery describes them.',
}

/** A request no planner makes, refused before anything is sent: a programming error. */
function checkRequest(request: ActionRequest, deadlineMs: number): void {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 2)
    throw new TypeError('A run deadline is a whole number of milliseconds above 1, half of which the lock may wait.')
  if (request.routine.kind !== 'procedure') throw new Error('A run on SQL Server calls a procedure: a function cannot write (0159).')
  if (request.records.length < 1 || request.records.length > LIST_PAGE_SIZE)
    throw new Error(`A run addresses from 1 to ${String(LIST_PAGE_SIZE)} records: the open record, or a selection of one page (0165).`)
  for (const record of request.records) checkKey(request.target, record.key)
}

/** Each moved record's key, from the canonical text the batch's OUTPUT read, in the order sent. */
function keysOf(request: ActionRequest, rows: readonly Row[]): Array<Record<string, ApiValue>> {
  return rows.map((row) =>
    Object.fromEntries(
      request.target.identity.map((column, index) => {
        const text = row[`k${String(index)}`]
        return [column.name, fromCanonicalText(column.type, typeof text === 'string' ? text : null)]
      }),
    ),
  )
}

/**
 * The action half of the operations port on SQL Server (0160): the root and
 * the procedure described in one statement, and a run as one batch, never
 * retried.
 */
export function createSqlServerActions(pool: ConnectionPool): ActionAdapter {
  return {
    async describe(table, routine): Promise<DescribedAction> {
      const rows = await attempt(pool, describeActionStatement(table, routine), 'read')
      if (!Array.isArray(rows)) return rows
      const row = rows[0] ?? {}
      const root = describedFrom((row.facts ?? null) as string | null, (row.digest ?? null) as Buffer | null)
      const callable = describedRoutineFrom(
        (row.routine ?? null) as string | null,
        (row.routine_digest ?? null) as Buffer | null,
        (row.catalog ?? null) as string | null,
      )
      if (root === 'cut' || callable === 'cut') {
        return { ok: false, code: 'unavailable', message: 'The catalog facts arrived cut short of what was hashed: a TEXTSIZE shorter than them.' }
      }
      if (root === undefined || callable === undefined) return NOT_DESCRIBED
      return { ok: true, table: root, routine: callable }
    },

    async run(request, deadlineMs): Promise<ActionOutcome> {
      checkRequest(request, deadlineMs)
      const terms = rowFilterTerms(request.filters)
      const through = throughTerms(request.through)
      const definition = definitionBytes(request.definitions.table)
      const routine = routineDigest(request.definitions.routine)
      const ended = (expected: NonNullable<ReturnType<typeof expectedVersion>>) =>
        request.open === undefined ? undefined : { open: request.open, concurrency: request.target.concurrency, expected }
      const expected = request.records.map((record) => expectedVersion(request.target.concurrency, record.expectedVersion))
      /** Why the record at `position` was not moved, by the read an update alone would ask; one by one, the records `explain` names. */
      const explained = async (explain: (position: number) => boolean): Promise<ActionFailure> => {
        const failures: Array<RecordFailure | undefined> = []
        for (const [position, record] of request.records.entries()) {
          const version = expected[position]
          failures.push(
            explain(position)
              ? await whyNothingChanged(
                  pool,
                  existsStatement({ target: request.target, key: record.key }, terms, through, definition, version === undefined ? undefined : ended(version)),
                )
              : undefined,
          )
        }
        return unmovedFailure(failures)
      }
      // A version no record can hold is never bound: answered as any other mismatch, nothing sent.
      if (expected.some((version) => version === undefined)) return explained((position) => expected[position] === undefined)
      const batch = runBatch(request, terms, through, expected as NonNullable<(typeof expected)[number]>[], definition, routine, Math.floor(deadlineMs / 2))
      let answer: Awaited<ReturnType<typeof sendStreamed>>
      try {
        answer = await sendStreamed(pool, batch, request, deadlineMs)
      } catch (error) {
        // What CATCH could not catch, an attention at the deadline, and every connection failure: rolled back by xact_abort, or unknown once sent.
        return runFailure(failureFor(error, 'write'))
      }
      if (answer === 'unanswered') return UNANSWERED
      if (answer.failed.length > 0) {
        const failure: ActionFailure | 'unmoved' = batchFailure(answer.failed, request)
        if (failure !== 'unmoved') return failure
        // The positions the lock moved, which the rollback took back and @moved kept.
        const moved = new Set(answer.moved.map((row) => Number(row['o'])))
        return explained((position) => !moved.has(position))
      }
      return { ok: true, records: keysOf(request, answer.moved) }
    },
  }
}
