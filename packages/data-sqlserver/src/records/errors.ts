import type { RecordFailure, RecordFailureCode, RecordValue } from '@formancy/data-core'
import {
  DECIDED_BY_TRIGGER,
  DECIDED_BY_TRIGGER_MESSAGE,
  DEFINITION_MOVED,
  DEFINITION_MOVED_MESSAGE,
  NOT_ONE_ROW,
  NOT_ONE_ROW_MESSAGE,
  TEXT_NOT_STORED,
  TEXT_NOT_STORED_MESSAGE,
  TRANSACTION_ENDED,
  TRANSACTION_ENDED_MESSAGE,
  TRANSACTION_REPLACED,
  TRANSACTION_REPLACED_MESSAGE,
} from './statements.js'

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
 *
 * Two codes for a refusal nothing else names, as PostgreSQL's adapter has
 * them (0028):
 *
 * - `refused`, the default: the database refused the statement for a reason
 *   the port has no code for — a trigger's THROW or RAISERROR, an INSTEAD OF
 *   trigger the adapter cannot verify, a number nobody mapped. Nothing was
 *   written, and the same request would be refused again.
 * - `unavailable`, only for what SQL Server documents as passing: a deadlock
 *   it chose this statement to lose, a lock or resource it could not get in
 *   time, a log or filegroup that is full, a database that is read-only or
 *   an availability replica that is not accessible now. Nothing was written,
 *   and a retry may succeed. Anything not on that list is `refused`, because promising a
 *   retry for a business rule invites a person to send it again.
 */

/** Whether the operation could have changed anything: a write was sent, a read never changes a row. */
export type Phase = 'read' | 'write'

interface ServerError {
  number: number
  message: string
}

const UNIQUE_KEY = /^Violation of (?:PRIMARY KEY|UNIQUE KEY) constraint '(.+?)'\. Cannot insert duplicate key in object '/
const UNIQUE_INDEX = /^Cannot insert duplicate key row in object '.+?' with unique index '(.+?)'\. The duplicate key value is /
/** A foreign key to its own table is FOREIGN KEY SAME TABLE for a reference to no row, SAME TABLE REFERENCE for a row still referenced. */
const CONFLICT = /^The [A-Z]+ statement conflicted with the (FOREIGN KEY(?: SAME TABLE)?|(?:SAME TABLE )?REFERENCE|CHECK) constraint "(.+?)"\. The conflict occurred in /
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

/**
 * A column the database writes itself, which a binding named for a write: an
 * identity (544 on insert, 8102 on update), a computed column (271), a
 * rowversion (273 on insert, 272 on update — measured, not 273 for both), a
 * GENERATED ALWAYS column such as a system-versioning period's start or end
 * (13536 on insert, 13537 on update). A
 * binding comes to name one when the column became one after discovery, so
 * it is `schema-changed`, as PostgreSQL's 428C9 is (C8, 0028). The parity
 * suite provokes every number here.
 */
const GENERATED_COLUMN: ReadonlySet<number> = new Set([544, 8102, 271, 273, 272, 13536, 13537])

/**
 * The refusals SQL Server documents as passing, and the only `unavailable`
 * ones. 1205, a deadlock victim, and 3906, a database switched to read-only,
 * are provoked by the parity suite; the others are by documentation, not
 * provoked.
 */
const PASSING: ReadonlySet<number> = new Set([
  1205, // chosen as a deadlock victim
  1222, // lock request timed out
  1204, // no more locks available
  701, // not enough memory to run the query
  8645, // timed out waiting for memory to run the query
  8651, // the memory grant could not be met
  9002, // the transaction log is full
  1105, // the filegroup is full
  3960, // a snapshot isolation update conflict: another transaction changed the row
  3906, // the database is read-only: PostgreSQL's 25006, a read-only transaction or a standby
  976, // an availability group database that is not accessible for queries now
  983, // an availability group database whose replica is in neither role yet
])

/** The first number SQL Server leaves to users: THROW's and RAISERROR's own. */
const FIRST_USER_ERROR = 50000

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

/** A trigger ended the transaction the write ran in. Whether by COMMIT or by ROLLBACK, nothing the batch can read says. */
const ENDED_BY_TRIGGER = 'it may have committed, and it is not retried.'

/**
 * The write batch's own errors (statements.ts), recognised by number AND
 * message: a customer's trigger may THROW the same number, and its error is
 * then an unrecognised refusal like any other.
 *
 * - An INSTEAD OF trigger that decides the write is `refused`: the batch
 *   rolled it back, and the same write would be refused again (0028). Not
 *   `schema-changed`, which would claim a binding names something gone, and
 *   send someone to a drift review that cannot show a trigger (0017).
 * - A transaction a trigger replaced is `unknown-outcome`: it may have
 *   committed the write before beginning another. So is one a trigger ended
 *   and then raised an error in: the error is not a refusal of a write the
 *   COMMIT stored (0031).
 * - A table whose definition moved is `schema-changed` (0041): the batch
 *   found, after its statement or in CATCH, that the table is not the one
 *   the write was decided over, and rolled it back.
 */
function ownError(error: ServerError, written: readonly RecordValue[]): RecordFailure | undefined {
  if (error.number === NOT_ONE_ROW && error.message === NOT_ONE_ROW_MESSAGE) {
    // The bindings named an identity that is not a key; the batch rolled back.
    throw new Error('The record identity matched more than one row, so the update was rolled back: the bindings do not name a key.')
  }
  if (error.number === DECIDED_BY_TRIGGER && error.message === DECIDED_BY_TRIGGER_MESSAGE) {
    return failure(
      'refused',
      'An INSTEAD OF trigger would decide what this write stores, so the adapter refused it; nothing was written.',
    )
  }
  if (error.number === TRANSACTION_REPLACED && error.message === TRANSACTION_REPLACED_MESSAGE) {
    return failure('unknown-outcome', `A trigger ended the transaction of the write and began another; ${ENDED_BY_TRIGGER}`)
  }
  if (error.number === TRANSACTION_ENDED && error.message === TRANSACTION_ENDED_MESSAGE) {
    return failure('unknown-outcome', `A trigger ended the transaction of the write and then raised an error; ${ENDED_BY_TRIGGER}`)
  }
  if (error.number === DEFINITION_MOVED && error.message === DEFINITION_MOVED_MESSAGE) {
    // The batch rolled the write back, its triggers' work with it (0041).
    return failure('schema-changed', "The table's definition is not the one this write was decided over; nothing was written.")
  }
  const index = error.number === TEXT_NOT_STORED ? TEXT_NOT_STORED_MESSAGE.exec(error.message)?.[1] : undefined
  if (index === undefined) return undefined
  return failure('out-of-range', 'SQL Server did not store this text as sent: its code page lacks a character, or the column drops trailing spaces, and the write was rolled back.', {
    column: written[Number(index)]?.name,
  })
}

/**
 * A refusal the server reported for this statement, which therefore did not
 * commit: the write batch rolls back on every error it is told of, a
 * trigger's RAISERROR included, and on the errors it cannot catch xact_abort
 * does (statements.ts). Except 3609: a trigger ended the write's transaction
 * itself, and SQL Server raises it alike after a COMMIT, which stored the
 * write, and after a ROLLBACK, which did not. A trigger that commits and then
 * raises an error of its own never reaches here as that error: the batch's
 * CATCH sees its transaction gone and raises its own instead (statements.ts,
 * 0031).
 */
function refusal(error: ServerError, written: readonly RecordValue[]): RecordFailure {
  const own = ownError(error, written)
  if (own !== undefined) return own
  const { number, message } = error
  switch (number) {
    case 3609:
      return failure('unknown-outcome', `A trigger ended the transaction of the write (3609); ${ENDED_BY_TRIGGER}`)
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
    case 33504:
      // A security policy's block predicate refused the row, for every
      // principal: the counterpart of PostgreSQL's row-level security WITH
      // CHECK, which is 42501 there (0027). The message names the table, and
      // no column.
      return failure('permission-denied', 'A security policy on this table refused the row this write would store (33504).')
    case 207:
    case 208:
      return failure('schema-changed', `A table or column the binding names is not there any more (${String(number)}).`, {
        column: named(INVALID_COLUMN, message),
      })
    default:
      if (OUT_OF_RANGE.has(number)) return failure('out-of-range', `SQL Server could not hold a value in its column's type (${String(number)}).`)
      if (GENERATED_COLUMN.has(number)) {
        return failure('schema-changed', `A column the binding writes is one SQL Server now generates itself (${String(number)}); nothing was written.`)
      }
      if (PASSING.has(number)) return failure('unavailable', `SQL Server could not complete this now (${String(number)}), and nothing was written.`)
      if (number >= FIRST_USER_ERROR) {
        return failure('refused', `The database refused the statement with an error of its own (${String(number)}), a trigger's or a procedure's, and nothing was written.`)
      }
      // A refusal this adapter does not recognise. It was reported for the
      // statement, and the batch rolled back on it; nothing says it will pass,
      // so it is not `unavailable`. The number is the lead for the log.
      return failure('refused', `SQL Server refused the statement with error ${String(number)}, and nothing was written.`)
  }
}

/**
 * A refusal SQL Server reported for the statement, with the connection still
 * alive — severity 20 and above end the session.
 *
 * `typeof number === 'number'` is the test, not `number !== undefined`: when
 * the driver's error has no `info` — a socket that closed, a request that
 * timed out — mssql's lib/error/request-error.js copies its `code` into
 * `number`, so a lost answer is a `RequestError` whose number is the string
 * `'ECONNRESET'` or `'ETIMEOUT'`. Read as a number, it would be a refusal,
 * `refused`, a claim that nothing was written over a write that may have
 * committed. records-lost-answer.integration.test.ts pins both (0031).
 */
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
