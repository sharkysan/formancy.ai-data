import { LIST_PAGE_SIZE, rowFilterTerms, runFailure, throughTerms, unmovedFailure } from '@formancy/data-core'
import type { ActionAdapter, ActionFailure, ActionOutcome, ActionRequest, ApiValue, DescribedAction, RecordFailure, RecordValue } from '@formancy/data-core'
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
 * 2. On the locked path (0041), the root locked first, as a write's is,
 *    and SET LOCAL statement_timeout again to what remains: the table lock
 *    waits behind DDL as the record's lock waits behind a row, and each
 *    statement is bounded by what the one before left.
 * 3. The lock: each record locked in key order and its version moved, its
 *    throughs' parents held FOR SHARE (statements.ts) -- every record of a
 *    selection in one statement, sorted before it is locked, so two runs
 *    over overlapping selections wait for each other rather than deadlock
 *    on them (0165). Fewer rows than records and nothing is called: rolled
 *    back, and a read after tells `stale`, `not-found` and `version-ended`
 *    apart for each record the lock did not return, as an update's nothing
 *    is (records/explain.ts), answered as `unmovedFailure` reads them.
 *    Which records each row it returned answers to is the lock's own
 *    answer, the positions of the records whose key the row equals by the
 *    key's own equality; a row two of them name -- two spellings a
 *    nondeterministic collation makes one -- is `duplicate-record` naming
 *    them, rolled back before any call, as SQL Server's batch finds it.
 * 4. SET LOCAL statement_timeout to what remains, by this process's
 *    monotonic clock; nothing remaining is `action-timeout`, nothing
 *    called. The statements together stay inside the deadline, each set to
 *    what the ones before it left; the round trips between them and the
 *    COMMIT are on top of it.
 * 5. The call, under the routine's guard, once per record moved, in an
 *    order PostgreSQL does not promise; fewer calls than records moved is
 *    `schema-changed`, rolled back, and any call's refusal rolls back every
 *    record.
 *
 * The root cannot change between the two statements: the lock holds its
 * rows and its table lock until COMMIT, and the module writes the root in
 * the lock alone. No cancel is ever sent: the statement timeout needs
 * none, and a late cancel can stop the next statement on its backend
 * (0061). The transaction_timeout PostgreSQL 17 has is not used: it is
 * FATAL, so an unknown outcome, and 15 and 16 lack it.
 */

/** Why a run stopped inside its transaction, thrown there so postgres.js rolls it back: a statement refused, a lock that moved fewer records than were sent -- the positions it did move -- a row two records name, no deadline left for the call, or a call that did not run for every record moved. */
class Stopped extends Error {
  readonly at: 'lock' | 'call'
  readonly why: { refused: unknown } | { unmoved: ReadonlySet<number> } | { duplicate: readonly number[] } | 'deadline' | 'uncalled'

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
const STRICT = {
  ok: false,
  code: 'refused',
  message:
    'The routine is STRICT: PostgreSQL does not call it when an argument is NULL, and a run would answer done for a call that never ran, so no run calls it (0160).',
} as const

/** A request no planner makes, refused before anything is sent: a programming error. */
function checkRequest(request: ActionRequest, deadlineMs: number): void {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new TypeError('A run deadline is a whole number of milliseconds above 0.')
  if (request.routine.kind !== 'function') throw new Error('A run on PostgreSQL calls a function: a procedure may COMMIT inside itself (0159).')
  if (request.target.concurrency.kind !== 'version-column') throw new Error('PostgreSQL has no rowversion; a run is guarded by a version column.')
  if (request.records.length < 1 || request.records.length > LIST_PAGE_SIZE)
    throw new Error(`A run addresses from 1 to ${String(LIST_PAGE_SIZE)} records: the open record, or a selection of one page (0165).`)
  for (const record of request.records) checkKey(request.target, record.key)
}

/** A two-keys refusal: the database's equality makes two records of the selection one row. */
const DUPLICATE: Omit<ActionFailure, 'records'> = {
  ok: false,
  code: 'duplicate-record',
  message: 'Two keys of the selection name one row under the key’s equality; nothing was called, and the run was rolled back.',
}

/** The positions in the request of the records a row the lock returned answers to: its last column, an array's text, ascending. */
function positionsOf(request: ActionRequest, row: TextRow): number[] {
  const text = row[request.target.identity.length + 1] ?? '{}'
  return text === '{}' ? [] : text.slice(1, -1).split(',').map(Number)
}

/**
 * Each moved record's key, from the canonical text the lock returned, as a
 * bound key names it, in the order the records were sent, by the position
 * the lock said each row answers to: the lock returns them in an order
 * PostgreSQL does not promise.
 */
function keysOf(request: ActionRequest, rows: readonly TextRow[]): { values: Array<Record<string, ApiValue>>; keys: RecordValue[][] } {
  const moved = rows.map((row) => {
    const value: Record<string, ApiValue> = {}
    const key = request.target.identity.map((column, index) => {
      const decoded = decodeCanonical(column.type, row[index] ?? null)
      value[column.name] = decoded
      return { ...column, value: decoded }
    })
    return { value, key, at: positionsOf(request, row)[0] ?? request.records.length }
  })
  const ordered = [...moved].sort((left, right) => left.at - right.at)
  return { values: ordered.map((entry) => entry.value), keys: ordered.map((entry) => entry.key) }
}

/** What locates a record, and the read that explains it, as `whyNothingChanged` takes them. */
interface Explaining {
  request: ActionRequest
  scope: { terms: ReturnType<typeof rowFilterTerms>; through: ReturnType<typeof throughTerms> }
  definition: Definition
  path: WritePath
}

/**
 * Why each record `explain` names was not moved, one read after another,
 * as an update's nothing is explained -- `withVersion` as
 * `whyNothingChanged` takes it -- and the run's answer as `unmovedFailure`
 * reads them, the same reading SQL Server's adapter asks (0165).
 */
async function explained(sql: Sql, on: Explaining, withVersion: boolean, explain: (position: number) => boolean): Promise<ActionFailure> {
  const failures: Array<RecordFailure | undefined> = []
  for (const [position, record] of on.request.records.entries()) {
    const located = {
      target: on.request.target,
      key: record.key,
      expectedVersion: record.expectedVersion,
      ...(on.request.open === undefined ? {} : { open: on.request.open }),
    }
    failures.push(explain(position) ? await whyNothingChanged(sql, located, on.scope, withVersion, on.definition, on.path) : undefined)
  }
  return unmovedFailure(failures)
}

/** What a run that stopped inside its transaction is answered with, once postgres.js rolled it back. */
async function answered(sql: Sql, stop: Stopped, on: Explaining): Promise<ActionFailure> {
  const { request, definition, path } = on
  if (stop.why === 'deadline') return NO_TIME_LEFT
  if (stop.why === 'uncalled') return UNCALLED
  if ('duplicate' in stop.why) return { ...DUPLICATE, records: [...stop.why.duplicate] }
  if ('unmoved' in stop.why) {
    const moved = stop.why.unmoved
    return explained(sql, on, true, (position) => !moved.has(position))
  }
  // Under REPEATABLE READ a lost race at the lock is 40001, as an update's is (0006): a race, whatever the version reads now.
  if (stop.at === 'lock' && sqlState(stop.why.refused) === '40001') return explained(sql, on, false, () => true)
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
      const [routineFacts, routineDigestText, routineSpellings, current] = row.slice(DESCRIBED_COLUMNS) as [
        string | null,
        string | null,
        string | null,
        string | null,
      ]
      const callable = describedRoutineFrom(
        routine,
        { facts: routineFacts, digest: routineDigestText, spellings: routineSpellings, current },
        textUnitOf(encoding),
      )
      if (described === undefined || callable === undefined) return NOT_DESCRIBED
      if (callable === 'strict') return STRICT
      return { ok: true, table: described, routine: callable }
    },

    async run(request, deadlineMs): Promise<ActionOutcome> {
      checkRequest(request, deadlineMs)
      const terms = rowFilterTerms(request.filters)
      const scope = { terms, through: throughTerms(request.through) }
      const definition = parseDefinition(request.definitions.table)
      const digest = routineDigest(request.definitions.routine)
      const path = pathOf(definition)
      const on: Explaining = { request, scope, definition, path }
      // A version that is not a number names no state the record was ever in: answered as any other mismatch, nothing sent.
      if (request.records.some((record) => !isVersion(record.expectedVersion)))
        return explained(sql, on, false, (position) => !isVersion((request.records[position] as ActionRequest['records'][number]).expectedVersion))
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
          if (path === 'locked') {
            await send('lock', rowExclusiveLock([request.target.table]))
            if (left() < 1) throw new Stopped('lock', 'deadline')
            await send('lock', timeoutStatement(left()))
          }
          sent = true
          const moved = await send('lock', lock)
          const answering = moved.rows.map((row) => positionsOf(request, row))
          const twice = answering.filter((positions) => positions.length > 1).flat()
          if (twice.length > 0) throw new Stopped('lock', { duplicate: [...new Set(twice)].sort((a, b) => a - b) })
          if (moved.rows.length !== request.records.length) throw new Stopped('lock', { unmoved: new Set(answering.flat()) })
          const { values: found, keys } = keysOf(request, moved.rows)
          if (left() < 1) throw new Stopped('call', 'deadline')
          await send('call', timeoutStatement(left()))
          const called = await send('call', callStatement(request, keys, digest, path))
          if (called.rows.length !== keys.length) throw new Stopped('call', 'uncalled')
          return found
        })
        return { ok: true, records: values }
      } catch (error) {
        if (error instanceof Stopped) return answered(sql, error, on)
        // The COMMIT refused with the connection still there -- a deferred
        // constraint the routine broke, 40001 under SERIALIZABLE -- rolled
        // back, and that refusal is the answer; a connection lost is
        // unknown once the lock was sent.
        return actionFailure(error, sent)
      }
    },
  }
}
