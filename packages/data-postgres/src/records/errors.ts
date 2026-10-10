import type { RecordFailure, RecordFailureCode } from '@formancy/data-core'

/** Whether the statement that failed could have written. */
export type Phase = 'read' | 'write'

/**
 * SQLSTATEs with a code of their own. Matched before the class table below,
 * so an exact code always wins over its class.
 */
const BY_STATE: ReadonlyMap<string, RecordFailureCode> = new Map([
  ['23505', 'unique-violation'],
  // An exclusion constraint is a generalised unique one: "conflicting key value".
  ['23P01', 'unique-violation'],
  ['23503', 'foreign-key-violation'],
  // ON UPDATE/DELETE RESTRICT: a foreign key refusing, checked immediately.
  ['23001', 'foreign-key-violation'],
  ['23502', 'not-null-violation'],
  ['23514', 'check-violation'],
  ['22001', 'too-long'],
  // Any program limit; the one a single value can reach through these
  // statements is "index row size exceeds maximum": too long for the index
  // on its column, though its column has no declared length.
  ['54000', 'too-long'],
  ['42501', 'permission-denied'],
  // What drift review exists to catch: a table or column gone, a column that
  // has become generated, or one whose type no longer converts the way the
  // bindings expect (no to_char for it, no assignment from the bound type).
  ['42P01', 'schema-changed'],
  ['42703', 'schema-changed'],
  ['428C9', 'schema-changed'],
  ['42883', 'schema-changed'],
  ['42804', 'schema-changed'],
  // "statement completion unknown": the server's own unknown-outcome.
  ['40003', 'unknown-outcome'],
])

/** SQLSTATE classes that say what was refused, for codes without an entry of their own. */
const BY_CLASS: ReadonlyMap<string, RecordFailureCode> = new Map([
  // Data exceptions: a value the codec accepted and the column did not.
  ['22', 'out-of-range'],
  // Any other integrity constraint.
  ['23', 'check-violation'],
])

/**
 * What passes, or what the deployment has to change, and so is `unavailable`
 * (0028): the server could not answer now, and the statement certainly did
 * not commit. By class — connection exceptions (08), transaction rollbacks
 * (40: a serialization failure, a deadlock this statement was chosen to lose),
 * insufficient resources (53), operator intervention (57), system errors
 * (58), a login refused (28) — and by state: a lock not available in time
 * (55P03), an object in use (55006), a read-only transaction (25006, a
 * standby), a database that does not exist (3D000).
 *
 * Of class 57, only a statement cancelled or timed out (57014) arrives here as
 * a SQLSTATE. A terminated backend, a server shutting down and PostgreSQL
 * 17's transaction_timeout (25P04) are FATAL: the server closes the
 * connection, postgres.js reports CONNECTION_CLOSED, and `IN_FLIGHT` below
 * answers it — `unknown-outcome` for a write, `unavailable` for a read. The
 * parity suite terminates a backend mid-write and lets a transaction time
 * out, and sees exactly that.
 *
 * An allowlist, not a default. Everything else the server sends — a
 * trigger's RAISE (P0), an error code only a function knows (38000, C11), a
 * feature not supported, an internal error — is `refused`: the same request
 * is expected to be refused again, so it is not a reason to try again.
 */
const PASSING_CLASSES: ReadonlySet<string> = new Set(['08', '40', '53', '57', '58', '28'])
const PASSING_STATES: ReadonlySet<string> = new Set(['55P03', '55006', '25006', '3D000'])

/**
 * Class 42 is syntax errors and access-rule violations. The ones a database
 * can cause are named above; any other — a syntax error, an ambiguous name,
 * a parameter of indeterminate type — is this adapter's own SQL at fault.
 */
const PROGRAMMING_ERROR_CLASS = '42'

/** Driver and socket errors that happen before a statement is sent: nothing reached the server. */
const NOT_SENT: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'CONNECT_TIMEOUT', 'CONNECTION_ENDED'])

/**
 * Driver and socket errors that can arrive after a statement was sent. The
 * server may have received it, run it and committed it; the answer is what
 * was lost. postgres.js names the first three; the `E…` ones are Node's.
 */
const IN_FLIGHT: ReadonlySet<string> = new Set(['CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'])

/** Whether a driver error is the connection failing, rather than the server refusing: what `recordFailure` answers as unavailable or unknown. */
export function connectionLost(error: unknown): boolean {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' && (IN_FLIGHT.has(code) || NOT_SENT.has(code))
}

const SQLSTATE = /^[0-9A-Z]{5}$/

interface ServerError {
  code: string
  constraint_name?: unknown
  column_name?: unknown
}

/**
 * Whether this is an error the server sent. Compared by name and shape, not
 * by class: the driver the composition root hands over may be another copy
 * of postgres.js than this package's, and `instanceof` would say no.
 */
function isServerError(error: unknown): error is ServerError {
  if (!(error instanceof Error) || error.name !== 'PostgresError') return false
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && SQLSTATE.test(code)
}

/** The SQLSTATE of an error the server sent, or `undefined`. */
export function sqlState(error: unknown): string | undefined {
  return isServerError(error) ? error.code : undefined
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The code for a SQLSTATE: an exact entry, then its class, then what passes, and `refused` for the rest. */
function codeOf(state: string): RecordFailureCode {
  const errorClass = state.slice(0, 2)
  const known = BY_STATE.get(state) ?? BY_CLASS.get(errorClass)
  if (known !== undefined) return known
  return PASSING_CLASSES.has(errorClass) || PASSING_STATES.has(state) ? 'unavailable' : 'refused'
}

/**
 * The failure for a refusal the server sent.
 *
 * Every error the server sends ends the statement, and outside an explicit
 * transaction its implicit one rolls back, so nothing was written whatever
 * the code: `unavailable` when it passes, `refused` when it will not.
 *
 * The message names the SQLSTATE and the constraint or column, which are
 * identifiers; never the server's own message or detail, which can quote the
 * value ("Key (id)=(42) already exists").
 */
function serverFailure(error: ServerError): RecordFailure {
  if (error.code.slice(0, 2) === PROGRAMMING_ERROR_CLASS && !BY_STATE.has(error.code)) throw error
  const code = codeOf(error.code)
  const constraint = identifier(error.constraint_name)
  const column = identifier(error.column_name)
  const about = [constraint === undefined ? '' : ` on constraint ${constraint}`, column === undefined ? '' : ` for column ${column}`].join('')
  return {
    ok: false,
    code,
    ...(constraint === undefined ? {} : { constraint }),
    ...(column === undefined ? {} : { column }),
    message: `PostgreSQL refused the statement with SQLSTATE ${error.code}${about}.`,
  }
}

/**
 * The `RecordFailure` for an error a record operation met (0015).
 *
 * A refusal the server sent is mapped by its SQLSTATE. A connection that
 * failed before the statement was sent is `unavailable`; one that failed
 * after it may have committed a write, so for a write it is
 * `unknown-outcome`, and this adapter never retries it. Anything else — a
 * TypeError, a driver error about how it was called, a SQLSTATE in class 42
 * — is a programming error and is thrown, not dressed as a database answer.
 */
export function recordFailure(error: unknown, phase: Phase): RecordFailure {
  if (isServerError(error)) return serverFailure(error)
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'string' && NOT_SENT.has(code)) {
    return { ok: false, code: 'unavailable', message: `The database could not be reached (${code}); nothing was sent.` }
  }
  if (typeof code === 'string' && IN_FLIGHT.has(code)) {
    return phase === 'write'
      ? { ok: false, code: 'unknown-outcome', message: `The connection failed (${code}) after the write was sent. It may have committed; it is not retried.` }
      : { ok: false, code: 'unavailable', message: `The connection failed (${code}) before the read was answered.` }
  }
  throw error
}
