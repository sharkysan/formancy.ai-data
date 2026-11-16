import { rowFilterTerms, runFailure, throughTerms } from '@formancy/data-core'
import type { ActionAdapter, ActionFailure, ActionOutcome, ActionRequest, ApiValue, DescribedAction, RecordValue } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { textUnitOf } from '../discovery/columns.js'
import { describedFrom, parseDefinition } from '../records/definition.js'
import type { Definition } from '../records/definition.js'
import { sqlState } from '../records/errors.js'
import { attempt, moved, pathOf, untilLost, whyNothingChanged } from '../records/explain.js'
import { checkKey, isVersion } from '../records/requests.js'
import { DESCRIBED_COLUMNS, rowExclusiveLock } from '../records/sql.js'
import type { RecordStatement, WritePath } from '../records/sql.js'
import { run } from '../sql/statement.js'
import type { TextRow } from '../sql/statement.js'
import { decodeCanonical } from '../sql/values.js'
import { describeActionStatement, describedRoutineFrom, routineDigest } from './definition.js'
import { actionFailure } from './errors.js'
import { callStatement, lockStatement, timeoutStatement } from './statements.js'

/*
 * An action's run on PostgreSQL (0160): one transaction, `sql.begin`, of two
 * statements, each guarded in itself, and never retried.
 *
 * 1. SET LOCAL statement_timeout to what remains of the deadline.
 * 2. On the locked path (0041), the root locked first, as a write's is.
 * 3. The lock: each record locked in key order and its version moved, its
 *    throughs' parents held FOR SHARE (statements.ts). Fewer rows than
 *    records and nothing is called: rolled back, and a read after tells
 *    `stale`, `not-found` and `version-ended` apart, as an update's nothing
 *    is (records/explain.ts).
 * 4. SET LOCAL statement_timeout to what remains, by this process's
 *    monotonic clock; nothing remaining is `action-timeout`, nothing
 *    called. The two statements together stay inside the deadline; the
 *    round trips between them and the COMMIT are on top of it.
 * 5. The call, under the routine's guard; fewer calls than records moved
 *    is `schema-changed`, rolled back.
 *
 * The root cannot change between the two statements: the lock holds its
 * rows and its table lock until COMMIT, and the module writes the root in
 * the lock alone. No cancel is ever sent: the statement timeout needs
 * none, and a late cancel can stop the next statement on its backend
 * (0061). The transaction_timeout PostgreSQL 17 has is not used: it is
 * FATAL, so an unknown outcome, and 15 and 16 lack it.
 */

/** Why a run stopped inside its transaction, thrown there so postgres.js rolls it back: a statement refused, a lock that moved fewer records than were sent, no deadline left for the call, or a call that did not run for every record moved. */
class Stopped extends Error {
  readonly at: 'lock' | 'call'
  readonly why: { refused: unknown } | 'unmoved' | 'deadline' | 'uncalled'

  constructor(at: Stopped['at'], why: Stopped['why']) {
    super('A run stopped inside its transaction, which rolled back.')
    this.at = at
    this.why = why
  }
}

const NO_TIME_LEFT: ActionFailure = {
  ok: false,
  code: 'action-timeout',
  message: 'Nothing of the run’s deadline remained for its next statement, so the routine was not called; it was rolled back.',
}
const UNCALLED: ActionFailure = {
  ok: false,
  code: 'schema-changed',
  message: 'The routine is not the one this run was decided over, so it was not called; the run was rolled back.',
}
const NOT_DESCRIBED = {
  ok: false,
  code: 'schema-changed',
  message: 'The catalog does not show the table, or the routine, as discovery describes them.',
} as const

/** A request no planner makes, refused before anything is sent: a programming error. */
function checkRequest(request: ActionRequest, deadlineMs: number): void {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new TypeError('A run deadline is a whole number of milliseconds above 0.')
  if (request.routine.kind !== 'function') throw new Error('A run on PostgreSQL calls a function: a procedure may COMMIT inside itself (0159).')
  if (request.target.concurrency.kind !== 'version-column') throw new Error('PostgreSQL has no rowversion; a run is guarded by a version column.')
  if (request.records.length !== 1) throw new Error('An action over the open record runs over exactly one record.')
  for (const record of request.records) checkKey(request.target, record.key)
}

/** Each moved record's key, from the canonical text the lock returned, as a bound key names it. */
function keysOf(request: ActionRequest, rows: readonly TextRow[]): { values: Array<Record<string, ApiValue>>; keys: RecordValue[][] } {
  const values: Array<Record<string, ApiValue>> = []
  const keys = rows.map((row) => {
    const value: Record<string, ApiValue> = {}
    const key = request.target.identity.map((column, index) => {
      const decoded = decodeCanonical(column.type, row[index] ?? null)
      value[column.name] = decoded
      return { ...column, value: decoded }
    })
    values.push(value)
    return key
  })
  return { values, keys }
}

/** What a run that stopped inside its transaction is answered with, once postgres.js rolled it back. */
async function answered(
  sql: Sql,
  stop: Stopped,
  request: ActionRequest,
  scope: { terms: ReturnType<typeof rowFilterTerms>; through: ReturnType<typeof throughTerms> },
  definition: Definition,
  path: WritePath,
): Promise<ActionFailure> {
  const record = request.records[0] as ActionRequest['records'][number]
  const located = {
    target: request.target,
    key: record.key,
    expectedVersion: record.expectedVersion,
    ...(request.open === undefined ? {} : { open: request.open }),
  }
  if (stop.why === 'deadline') return NO_TIME_LEFT
  if (stop.why === 'uncalled') return UNCALLED
  if (stop.why === 'unmoved') return runFailure(await whyNothingChanged(sql, located, scope, true, definition, path))
  // Under REPEATABLE READ a lost race at the lock is 40001, as an update's is (0006): a race, whatever the version reads now.
  if (stop.at === 'lock' && sqlState(stop.why.refused) === '40001') return runFailure(await whyNothingChanged(sql, located, scope, false, definition, path))
  const failure = actionFailure(stop.why.refused, true)
  if (
    stop.at !== 'lock' ||
    failure.code === 'unavailable' ||
    failure.code === 'unknown-outcome' ||
    failure.code === 'action-timeout' ||
    failure.code === 'schema-changed'
  )
    return failure
  // A refusal at the lock may be the moved table's, which fails while the statement is planned, before its guard (records/explain.ts).
  const shifted = await moved(sql, request.target.table, definition, path)
  return shifted?.code === 'schema-changed' ? runFailure(shifted) : failure
}

/**
 * The action half of the operations port on PostgreSQL (0160): the root and
 * the routine described in one statement, and a run as one transaction of
 * two guarded statements, never retried. A connection lost once the lock
 * was sent is `unknown-outcome`, though PostgreSQL commits only when the
 * COMMIT this adapter sends after the call arrives: the save's rule (0155)
 * for the same fact.
 */
export function createPostgresActions(sql: Sql): ActionAdapter {
  return {
    async describe(table, routine): Promise<DescribedAction> {
      const ran = await attempt(sql, describeActionStatement(table, routine), 'read')
      if (!ran.ok) return ran.failure
      const row = ran.result.rows[0] as TextRow
      const [facts, digest, spellings, encoding, isolation] = row as [string | null, string | null, string | null, string, string]
      const described = facts === null ? undefined : describedFrom(facts, spellings, encoding, { digest: digest as string, isolation })
      const [routineFacts, routineDigestText, routineSpellings] = row.slice(DESCRIBED_COLUMNS) as [string | null, string | null, string | null]
      const callable = describedRoutineFrom(routine, routineFacts, routineDigestText, routineSpellings, textUnitOf(encoding))
      if (described === undefined || callable === undefined) return NOT_DESCRIBED
      return { ok: true, table: described, routine: callable }
    },

    async run(request, deadlineMs): Promise<ActionOutcome> {
      checkRequest(request, deadlineMs)
      const terms = rowFilterTerms(request.filters)
      const scope = { terms, through: throughTerms(request.through) }
      const definition = parseDefinition(request.definitions.table)
      const digest = routineDigest(request.definitions.routine)
      const path = pathOf(definition)
      const record = request.records[0] as ActionRequest['records'][number]
      // A version that is not a number names no state the record was ever in: answered as any other mismatch, nothing sent.
      if (!isVersion(record.expectedVersion)) {
        const located = { target: request.target, key: record.key, expectedVersion: record.expectedVersion }
        return runFailure(await whyNothingChanged(sql, located, scope, false, definition, path))
      }
      const lock = lockStatement(request, terms, scope.through, definition, path)
      const start = performance.now()
      const left = (): number => Math.floor(deadlineMs - (performance.now() - start))
      let sent = false
      try {
        const values = await sql.begin(async (tx) => {
          const send = async (at: Stopped['at'], statement: RecordStatement) => {
            try {
              return await untilLost(run(tx, statement.text, statement.params))
            } catch (error) {
              throw new Stopped(at, { refused: error })
            }
          }
          if (left() < 1) throw new Stopped('lock', 'deadline')
          await send('lock', timeoutStatement(left()))
          if (path === 'locked') await send('lock', rowExclusiveLock([request.target.table]))
          sent = true
          const moved = await send('lock', lock)
          if (moved.rows.length !== request.records.length) throw new Stopped('lock', 'unmoved')
          const { values: found, keys } = keysOf(request, moved.rows)
          if (left() < 1) throw new Stopped('call', 'deadline')
          await send('call', timeoutStatement(left()))
          const called = await send('call', callStatement(request, keys, digest))
          if (called.rows.length !== keys.length) throw new Stopped('call', 'uncalled')
          return found
        })
        return { ok: true, records: values }
      } catch (error) {
        if (error instanceof Stopped) return answered(sql, error, request, scope, definition, path)
        // The COMMIT refused with the connection still there -- a deferred
        // constraint the routine broke, 40001 under SERIALIZABLE -- rolled
        // back, and that refusal is the answer; a connection lost is
        // unknown once the lock was sent.
        return actionFailure(error, sent)
      }
    },
  }
}
