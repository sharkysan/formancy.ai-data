import type { RecordFailure, RecordFailureCode, RecordValue } from '@formancy/data-core'
import { NOT_ONE_ROW, NOT_ONE_ROW_MESSAGE, TEXT_NOT_STORED, TEXT_NOT_STORED_MESSAGE } from './statements.js'

/**
 * What SQL Server's refusals mean, as the stable codes of the record port.
 *
 * The code always comes from the error NUMBER, which does not change with the
 * session's language. The constraint or column a failure names is taken from
 * the message only where it is English — which it is unless the composition
 * root set `options.language`, because `tedious` asks for us_english at login —
 * and is left out otherwise rather than guessed.
 *
 * The server's message is never passed on: it repeats the values a person
 * typed ("The duplicate key value is (CH)", "Truncated value: 'AB'"), and a
 * failure's message goes to a log. Every sentence here is the adapter's own,
 * and names nothing but the error number, a constraint and a column.
 */

/** Whether the operation could have changed anything: a write was sent, a read never changes a row. */
export type Phase = 'read' | 'write'

interface ServerError {
  number: number
  message: string
}

const UNIQUE_KEY = /^Violation of (?:PRIMARY KEY|UNIQUE KEY) constraint '(.+?)'\. Cannot insert duplicate key in object '/
const UNIQUE_INDEX = /^Cannot insert duplicate key row in object '.+?' with unique index '(.+?)'\. The duplicate key value is /
const CONFLICT = /^The [A-Z]+ statement conflicted with the (FOREIGN KEY|REFERENCE|CHECK) constraint "(.+?)"\. The conflict occurred in /
/** Every translation of 547 keeps these SQL keywords: checked by hand in the 34 languages of SQL Server 2022 on 2026-10-09, and in German by the failures suite. */
const FOREIGN_KEY_WORDS = /\b(?:FOREIGN KEY|REFERENCE)\b/
const NULL_COLUMN = /^Cannot insert the value NULL into column '(.+?)', table '/
const TRUNCATED_COLUMN = /^String or binary data would be truncated in table '.+?', column '(.+?)'\. Truncated value: /
const DENIED_COLUMN = /^The [A-Z ]+ permission was denied on the column '(.+?)' of the object '/
const INVALID_COLUMN = /^Invalid column name '(.+)'\.$/

/** Conversions and overflows: a value the codec accepted and the column, or the column's type, could not hold. */
const OUT_OF_RANGE: ReadonlySet<number> = new Set([
  220, // arithmetic overflow for a tinyint or smallint
  232, // arithmetic overflow for a type
  244, // a text value overflowed a tinyint or smallint column
  245, // text that is not a number of the column's type
  248, // a text value overflowed an int column
  8114, // text that cannot be converted to the column's type
  8115, // arithmetic overflow converting to the column's type: money past its range, a version column past its largest value
])

function named(pattern: RegExp, message: string): string | undefined {
  return pattern.exec(message)?.[1]
}

function failure(code: RecordFailureCode, message: string, names: { constraint?: string | undefined; column?: string | undefined } = {}): RecordFailure {
  return {
    ok: false,
    code,
    ...(names.column === undefined ? {} : { column: names.column }),
    ...(names.constraint === undefined ? {} : { constraint: names.constraint }),
    message,
  }
}

/**
 * Error 547 is a foreign key and a check alike; which one is the constraint
 * the message names. In English the message says so in a fixed sentence; in
 * any other language the kind is the SQL keyword the translation keeps, and
 * the name is left out because its quoting differs per language.
 */
function constraintConflict(message: string): RecordFailure {
  const match = CONFLICT.exec(message)
  const kind = match?.[1]
  const foreignKey = kind === undefined ? FOREIGN_KEY_WORDS.test(message) : kind !== 'CHECK'
  return foreignKey
    ? failure('foreign-key-violation', 'SQL Server refused the write: a foreign key has no row to reference, or a referenced row is still referenced (547).', {
        constraint: match?.[2],
      })
    : failure('check-violation', 'SQL Server refused the write: a check constraint does not accept a value (547).', { constraint: match?.[2] })
}

/**
 * The write batch's own errors (statements.ts), recognised by number AND
 * message: a customer's trigger may THROW the same number, and its error is
 * then an unrecognised refusal like any other.
 */
function ownError(error: ServerError, written: readonly RecordValue[]): RecordFailure | undefined {
  if (error.number === NOT_ONE_ROW && error.message === NOT_ONE_ROW_MESSAGE) {
    // The bindings named an identity that is not a key; the batch rolled back.
    throw new Error('The record identity matched more than one row, so the update was rolled back: the bindings do not name a key.')
  }
  const index = error.number === TEXT_NOT_STORED ? TEXT_NOT_STORED_MESSAGE.exec(error.message)?.[1] : undefined
  if (index === undefined) return undefined
  return failure('out-of-range', "SQL Server could not store a character of this text in its column's code page, and the write was rolled back.", {
    column: written[Number(index)]?.name,
  })
}

/**
 * A refusal the server reported for this statement, which therefore did not
 * commit: the write batch rolls back on every error it is told of, a
 * trigger's RAISERROR included, and on the errors it cannot catch xact_abort
 * does (statements.ts).
 */
function refusal(error: ServerError, written: readonly RecordValue[]): RecordFailure {
  const own = ownError(error, written)
  if (own !== undefined) return own
  const { number, message } = error
  switch (number) {
    case 2627:
    case 2601:
      return failure('unique-violation', `SQL Server refused the write: a unique key already holds this value (${String(number)}).`, {
        constraint: named(number === 2627 ? UNIQUE_KEY : UNIQUE_INDEX, message),
      })
    case 547:
      return constraintConflict(message)
    case 515:
      return failure('not-null-violation', 'SQL Server refused the write: a column that does not allow NULL was given none (515).', {
        column: named(NULL_COLUMN, message),
      })
    case 2628:
      return failure('too-long', 'SQL Server refused the write: a value is longer than its column (2628).', { column: named(TRUNCATED_COLUMN, message) })
    case 8152:
      // 2628's predecessor, at compatibility levels below 150: it does not say which column.
      return failure('too-long', 'SQL Server refused the write: a value is longer than its column (8152).')
    case 229:
    case 230:
      return failure('permission-denied', `SQL Server refused this account the operation (${String(number)}).`, { column: named(DENIED_COLUMN, message) })
    case 207:
    case 208:
      return failure('schema-changed', `A table or column the binding names is not there any more (${String(number)}).`, {
        column: named(INVALID_COLUMN, message),
      })
    default:
      if (OUT_OF_RANGE.has(number)) return failure('out-of-range', `SQL Server could not hold a value in its column's type (${String(number)}).`)
      // A refusal this adapter does not recognise. It was reported for the
      // statement, and the batch rolled back on it, which is what
      // `unavailable` promises; the number is the lead for whoever reads the log.
      return failure('unavailable', `SQL Server refused the statement with error ${String(number)}, and nothing was written.`)
  }
}

/** A refusal SQL Server reported for the statement, with the connection still alive — severity 20 and above end the session. */
function serverError(error: Error): ServerError | undefined {
  const { number, class: severity } = error as Error & { number?: unknown; class?: unknown }
  if (error.name !== 'RequestError' || typeof number !== 'number') return undefined
  if (typeof severity === 'number' && severity >= 20) return undefined
  return { number, message: error.message }
}

/**
 * The failure for what the driver rejected one statement with.
 *
 * - Anything but a `RequestError` is the pool's, from before it handed out a
 *   connection: `mssql` turns every failure after that into a `RequestError`
 *   (lib/tedious/request.js), and before it passes on what the pool rejected
 *   with — its own `ConnectionError` for a pool that is closed or cannot
 *   connect, and tarn's `TimeoutError`, unwrapped, when no connection came
 *   free within `acquireTimeoutMillis`. Nothing was sent, so even a write is
 *   `unavailable`.
 * - The server refused the statement: the code for its error number.
 * - Any other `RequestError` — a timeout, a socket that closed, a session
 *   killed (596, severity 21) — after a write was sent is `unknown-outcome`: it
 *   may have committed, and it is never retried (plan section 12). After a
 *   read it is `unavailable`, because a read changed nothing.
 *
 * A request the driver would not take is thrown before it is sent, and never
 * reaches this. `written` is the values the statement assigned, in its order,
 * so a text value that was not stored can be named.
 */
export function failureFor(error: unknown, phase: Phase, written: readonly RecordValue[] = []): RecordFailure {
  if (!(error instanceof Error)) throw error
  if (error.name !== 'RequestError') return failure('unavailable', 'SQL Server could not be reached, or no connection came free in time, and nothing was sent.')
  const server = serverError(error)
  if (server !== undefined) return refusal(server, written)
  return phase === 'write'
    ? failure('unknown-outcome', 'The connection failed after the write was sent; it may have committed. It is not retried.')
    : failure('unavailable', 'The connection failed during the read, which changed nothing.')
}
