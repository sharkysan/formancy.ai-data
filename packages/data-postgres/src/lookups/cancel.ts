import type { LookupSignal } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { start } from '../sql/statement.js'
import type { Param, TextResult } from '../sql/statement.js'

/** PostgreSQL's query_canceled: a cancel request, or a statement_timeout. */
const QUERY_CANCELED = '57014'

const canceled = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === QUERY_CANCELED

/**
 * How long a statement has to settle after a cancel request was delivered
 * once its execute was written before it is sent another, and how many it
 * is sent so at most (0121): past the 100 ms this package's lookups-limits
 * suite holds every answer for, so a statement the cancel did stop has
 * answered there before another is due. Chosen over the suite's held
 * answers, not measured on a real network.
 */
const CANCEL_AGAIN_AFTER_MS = 250
const CANCELS_AFTER_EXECUTE = 4

interface LookupStatement {
  readonly text: string
  readonly params: readonly Param[]
}

/**
 * A signal already aborted: its reason, thrown before anything is built or
 * sent (0061) -- also by a resolve or a membership check with no key worth
 * asking about, which sends nothing anyway and still owes a caller already
 * gone the reason rather than an answer, as on SQL Server.
 */
export function stopIfAborted(signal: LookupSignal): void {
  if (signal.aborted) throw signal.reason as Error
}

/**
 * Runs one lookup statement until it answers or `signal` aborts (0061).
 *
 * PostgreSQL takes a cancel request on a connection of its own and stops
 * whatever the backend is running when it arrives, so a cancel sent as a
 * statement finished can land on the next statement on that backend. On the
 * lookups' own client that is another lookup, which then fails with 57014
 * while its own signal has not aborted; it is run once more, and a second
 * such failure is thrown. 0015's "never retried" is about record operations,
 * whose second run can write twice; a lookup is a read, the same statement
 * under the same filters. An operator's role-level statement_timeout also
 * ends in 57014 and is retried once too, which 0061 states as a cost.
 */
export async function runLookup(sql: Sql, statement: LookupStatement, signal: LookupSignal): Promise<TextResult> {
  try {
    return await untilAborted(sql, statement, signal)
  } catch (error) {
    if (signal.aborted || !canceled(error)) throw error
    return untilAborted(sql, statement, signal)
  }
}

/**
 * One run of the statement, answered with its rows or, the moment `signal`
 * aborts, with `signal.reason`; the statement is then cancelled once the
 * driver has sent it, and once it has sent its execute, again for as long as
 * a delivered cancel leaves it running (`cancelUntilStopped`), and its late
 * answer or error goes nowhere. The pooled connection comes back when the
 * driver settles the statement, as it does for every other.
 */
function untilAborted(sql: Sql, statement: LookupStatement, signal: LookupSignal): Promise<TextResult> {
  if (signal.aborted) return Promise.reject(signal.reason)
  const { query, rows } = start(sql, statement.text, statement.params)
  const cancel = cancellerOf(query)
  let settled = false
  /** A cancel request unless the statement has settled: whether it was delivered, or `null` where none was sent. */
  const unlessSettled = (): Promise<boolean> | null => (settled ? null : cancel())
  const once = (): void => void unlessSettled()
  const persist = (): void => cancelUntilStopped(unlessSettled, CANCELS_AFTER_EXECUTE)
  return new Promise<TextResult>((resolve, reject) => {
    const stop = (): void => {
      reject(signal.reason)
      // Past its execute, the cancel sent now is the one that has to land.
      const written = executeWritten(query)
      whenSent(query, written ? persist : once)
      if (!written) whenExecuteSent(query, persist)
    }
    rows.then(
      (result) => {
        settled = true
        signal.removeEventListener('abort', stop)
        resolve(result)
      },
      (error: unknown) => {
        settled = true
        signal.removeEventListener('abort', stop)
        reject(error)
      },
    )
    signal.addEventListener('abort', stop, { once: true })
  })
}

/**
 * What sends `query` a cancel request, each time it is called, with the
 * request's own failure handled, and says whether it was delivered: the
 * request's connection closed by the server, which has read it.
 *
 * postgres.js's `query.cancel()` sends one cancel request on a connection it
 * opens for it, and reports that connection's failure -- a database that
 * stopped accepting while its open sessions still answer, which is when a
 * deadline fires -- by rejecting a promise it never returns. Node ends the
 * process on that rejection: the whole server, and every write in flight on
 * either engine (2026-10-15 review; held by this package's lookups-limits
 * suite with the cancel's connection refused at the hop). So this calls the
 * canceller the query holds, which `cancel()` calls and then forgets, and
 * handles what it returns: a cancel that could not be delivered stopped
 * nothing, and the statement finishes as it would have. It may call it
 * again, where `cancel()` would not (`cancelUntilStopped`). Like `state`
 * below, `canceller` is the driver's own, not its API; a postgres.js that
 * renamed it fails the suite as the cases whose statement is never stopped.
 */
function cancellerOf(query: object): () => Promise<boolean> {
  const internal = query as { canceller?: ((query: object) => Promise<unknown>) | null }
  const canceller = internal.canceller
  internal.canceller = null
  return () =>
    canceller === null || canceller === undefined
      ? Promise.resolve(false)
      : canceller(query).then(
          () => true,
          () => false,
        )
}

/**
 * Cancels the statement, and again while a delivered cancel leaves it
 * running: `CANCEL_AGAIN_AFTER_MS` after each that was delivered, while it
 * has not settled, `remaining` times in all (0121).
 *
 * A cancel request travels on a connection of its own, and nothing orders it
 * after the execute it was sent after. On a loaded network it can reach
 * PostgreSQL while the backend still waits for the execute, which drops it
 * as it drops one during the first round trip, and the statement then runs
 * to its end -- as this package's lookups-limits suite shows with the
 * execute held at the hop until the cancel had crossed, and as a loaded CI
 * runner did to its queued case twice on PostgreSQL 18. PostgreSQL gives
 * the client no sign of when the execute has arrived, so a cancel delivered
 * and not answered is sent again. One still in transit is not: it has not
 * failed, and another would only add a late cancel to land on the next
 * lookup on that backend, which runs once more for one (`runLookup`).
 */
function cancelUntilStopped(send: () => Promise<boolean> | null, remaining: number): void {
  const sent = send()
  if (sent === null || remaining <= 1) return
  void sent.then((delivered) => {
    if (delivered) setTimeout(() => cancelUntilStopped(send, remaining - 1), CANCEL_AGAIN_AFTER_MS).unref()
  })
}

/**
 * Calls `cancel` once postgres.js has sent `query`: at once if it has, or in
 * the turn after it does.
 *
 * postgres.js 3.4.9 refuses a query it was asked to cancel before sending it,
 * and the connection it then hands that query to never returns to the pool:
 * the one it gives it in the microtask after it is first awaited, or the one
 * it is opening for it. A query waiting in the pool's queue would be safe to
 * cancel, but nothing public tells it from one a connection is being opened
 * for. Measured on 2026-10-14 by this package's lookups-limits suite: an
 * abort in the same tick as the call, and one while the connection was being
 * opened, each left a pool of one that never answered again. So a query is
 * cancelled only once sent, and a lookup abandoned while it waited for a
 * connection is sent and then stopped: the database starts it, and is sent a
 * cancel request, or two (`whenExecuteSent`), where it could have been sent
 * nothing.
 *
 * The driver marks the moment it sends a query by setting the query's
 * `state` to the backend's key, and by nothing public. This reads that
 * property, and on a query not yet sent watches its assignment. A
 * postgres.js that moved it fails the suite as the cases whose statement is
 * never stopped.
 */
function whenSent(query: object, cancel: () => void): void {
  const internal = query as { state?: unknown }
  if (internal.state) {
    cancel()
    return
  }
  let state = internal.state
  Object.defineProperty(query, 'state', {
    configurable: true,
    enumerable: true,
    get: () => state,
    set(value: unknown) {
      state = value
      // Assigned before the driver makes the query its connection's current
      // one; a cancel in between would be kept as for a query queued behind
      // another on the connection, and never sent.
      if (value) setImmediate(cancel)
    },
  })
}

/**
 * Calls `cancel` once postgres.js has written the execute of a `query` it
 * had PostgreSQL describe first, unless that was written already: in the
 * turn after the write, so the execute leaves before the cancel request's
 * connection is opened.
 *
 * Every lookup has parameters and is unprepared, so postgres.js sends its
 * parse and describe, waits for the answer, and only then its parameters and
 * execute. Between the two the backend waits for the client, and PostgreSQL
 * drops a cancel request that arrives then. A cancel sent when the query was
 * sent stops a statement that waits in its parse -- for a lock, as the
 * suite's blocked lookups do -- but over a network it can arrive in that wait
 * instead, and the scan starts after it and runs to its end: 10 of 10 with
 * every answer held 5 or 20 ms, in the 2026-10-15 review, and in each of
 * two runs of this package's lookups-limits suite with answers held 100 ms,
 * the same day, without the second cancel. So a
 * statement still unsettled once its execute is written is sent another
 * cancel request, and again while a delivered one leaves it running
 * (`cancelUntilStopped`, 0121). A first one that stopped the parse ends the
 * query before the execute is written, so then there is no second; a first
 * that arrives during the execute stops it as well, and the second, arriving
 * after the statement ended, can stop the next lookup on that backend, which
 * then runs once more (`runLookup`).
 *
 * `describeFirst` is the driver's flag for that first round trip, set when
 * the query is built and cleared right after the execute is written; like
 * `state`, it is not the driver's API.
 */
function whenExecuteSent(query: object, cancel: () => void): void {
  if (executeWritten(query)) return
  const internal = query as { describeFirst?: unknown }
  let describeFirst: unknown = internal.describeFirst
  Object.defineProperty(query, 'describeFirst', {
    configurable: true,
    enumerable: true,
    get: () => describeFirst,
    set(value: unknown) {
      const waited = Boolean(describeFirst)
      describeFirst = value
      if (waited && !value) setImmediate(cancel)
    },
  })
}

/** Whether postgres.js has written the execute of `query`: its `describeFirst`, set when it is built, cleared once the execute is out. */
function executeWritten(query: object): boolean {
  const { describeFirst } = query as { describeFirst?: unknown }
  return describeFirst !== undefined && !describeFirst
}
