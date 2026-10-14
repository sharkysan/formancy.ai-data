import type { LookupSignal } from '@formancy/data-core'
import type { ConnectionPool, ISqlType, Request } from 'mssql'

/** One bound value: a generated name, the driver type it travels as, and the value. */
export interface Parameter {
  readonly name: string
  readonly type: ISqlType | (() => ISqlType)
  readonly value: unknown
}

/** SQL text that holds no value, and the values it names. */
export interface Statement {
  readonly sql: string
  readonly parameters: readonly Parameter[]
}

/**
 * The parameters of one statement as it is built: each value gets the next
 * generated name, `@p0`, `@p1`, and only that name reaches the SQL text. A
 * value is never spliced into a statement, whatever it holds.
 */
export class Parameters {
  readonly #list: Parameter[] = []

  /** Binds a value and returns its name, for the SQL being built. */
  add(type: ISqlType | (() => ISqlType), value: unknown): string {
    const name = `p${String(this.#list.length)}`
    this.#list.push({ name, type, value })
    return `@${name}`
  }

  statement(sql: string): Statement {
    return { sql, parameters: [...this.#list] }
  }
}

/** A request for one statement, its values bound. A value the driver will not take is thrown here, before anything is sent. */
export function prepare(pool: ConnectionPool, statement: Statement): Request {
  const request = pool.request()
  for (const parameter of statement.parameters) request.input(parameter.name, parameter.type, parameter.value)
  return request
}

/**
 * Sends a prepared statement and returns its last result set: a write batch
 * selects what it wrote after its own bookkeeping, and a read selects once.
 *
 * Every statement travels as `sp_executesql`, with or without parameters —
 * `tedious` sends a query no other way — which is what keeps the values out of
 * the SQL text, and what ends a `SET` with the request. What this rejects
 * with is always the driver's.
 */
export async function send<Row>(request: Request, statement: Statement): Promise<Row[]> {
  const result = await request.query<Row>(statement.sql)
  return [...(result.recordsets.at(-1) ?? [])]
}

/**
 * Runs one statement. Errors are the driver's own and reach the caller as they
 * are: the lookup half lets them propagate, because a lookup that cannot
 * answer refuses (0012). The record half prepares and sends apart, so that it
 * translates only what the driver rejected with.
 */
export async function run<Row>(pool: ConnectionPool, statement: Statement): Promise<Row[]> {
  return send<Row>(prepare(pool, statement), statement)
}

/**
 * Runs one lookup statement until `signal` aborts (0061). Already aborted: it
 * throws `signal.reason` and builds and sends nothing -- the check that also
 * stops a resolve between two key groups, since a listener added to a signal
 * that has already aborted is never called. Aborted while the statement is on
 * its way or running: `request.cancel()` sends a TDS attention on the
 * statement's own connection, and this rejects with exactly `signal.reason`
 * at once, without waiting for the server's acknowledgement. An answer read
 * before the abort is returned as it came.
 *
 * Attention is in-band: tedious waits for the server to acknowledge it
 * before the connection takes another request, so a cancel can only ever
 * stop its own statement. Measured on 2026-10-14 against SQL Server 2022
 * with mssql 12.7.4 and tedious 20.3.3: of 300 trials, the 99 cancels sent
 * as the statement completed reached 0 next requests on the connection. An
 * abort before mssql holds a connection marks the request cancelled, and
 * mssql gives the connection back without sending the statement.
 *
 * The driver's own rejection of a cancelled statement, ECANCEL, comes after
 * this has rejected, and is dropped: by then nobody is waiting for it. The
 * connection goes back to the pool when it arrives.
 *
 * No `requestTimeout` is set here: the deadline is the caller's signal, one
 * timer the same on both engines that also counts the wait for a pooled
 * connection, which tedious's timer, started at send, does not. mssql's
 * default request timeout of 15 s, which it hands tedious for every request
 * (lib/tedious/connection-pool.js), still bounds every statement, a
 * lookup's included.
 */
export function runUntil<Row>(pool: ConnectionPool, statement: Statement, signal: LookupSignal): Promise<Row[]> {
  stopIfAborted(signal)
  const request = prepare(pool, statement)
  const answer = send<Row>(request, statement)
  return new Promise<Row[]>((resolve, reject) => {
    const stop = (): void => {
      request.cancel()
      reject(signal.reason)
    }
    signal.addEventListener('abort', stop, { once: true })
    answer.then(
      (rows) => {
        signal.removeEventListener('abort', stop)
        resolve(rows)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop)
        reject(error)
      },
    )
  })
}

/** Throws `signal.reason` when the caller has already gone, so nothing is built or sent for it. */
export function stopIfAborted(signal: LookupSignal): void {
  if (signal.aborted) throw signal.reason
}
