import type { ApiValue } from '../codecs/codec.js'
import type { RowFilters } from '../lookup/types.js'
import type { NormalizedType, ObjectRef } from '../metadata.js'

/**
 * One column of a record operation: its name, which comes from approved
 * metadata and is quoted by the adapter, and its type, which tells the adapter
 * how to bind and how to read back.
 */
export interface RecordColumn {
  name: string
  type: NormalizedType
}

/**
 * A value on its way to the database: canonical, as a codec returned it
 * (0008). Never a JavaScript number for a decimal, never a Date, never a
 * Buffer: the adapter binds from this text, so a value is exactly what the
 * person entered and the codec accepted.
 */
export interface RecordValue extends RecordColumn {
  value: ApiValue
}

/** How a stale write is detected for this table. */
export interface RecordConcurrency {
  /**
   * `rowversion`: SQL Server writes the token; the adapter compares it.
   * `version-column`: an integer the adapter compares AND increments in the
   * same statement, so every writer through this module moves it.
   */
  kind: 'rowversion' | 'version-column'
  column: string
}

/** The table a form writes, and how one record of it is named and protected. */
export interface RecordTarget {
  table: ObjectRef
  /** The columns that identify one record, in key order. */
  identity: readonly RecordColumn[]
  /** `null` only for a target that is never updated — a create-only form. */
  concurrency: RecordConcurrency | null
}

/**
 * Read one record by its key, through the trusted filters.
 *
 * A record outside the filters does not exist for this call: another tenant's
 * row is `not-found`, never `forbidden`, so its existence is not disclosed.
 */
export interface ReadRequest {
  target: RecordTarget
  key: readonly RecordValue[]
  columns: readonly RecordColumn[]
  filters: RowFilters
}

/**
 * Insert one record. `values` already holds every pinned column — the tenant —
 * from trusted context; the adapter writes exactly these columns and no others,
 * so a column with a default gets it and a generated one is never named.
 */
export interface InsertRequest {
  target: RecordTarget
  values: readonly RecordValue[]
  /** What to read back from the inserted row: generated keys, defaults, computed columns. */
  returning: readonly RecordColumn[]
}

/**
 * Change exactly `set` on the record named by `key`, only if its version is
 * still `expectedVersion` and it is inside the filters — one statement, so
 * nothing can change between the check and the write.
 */
export interface UpdateRequest {
  target: RecordTarget & { concurrency: RecordConcurrency }
  key: readonly RecordValue[]
  set: readonly RecordValue[]
  /** The token a read returned: hex for a rowversion, a decimal string for a version column. */
  expectedVersion: string
  filters: RowFilters
  returning: readonly RecordColumn[]
}

/** A record as the API carries it: canonical values by column, and its current version token. */
export interface RecordRead {
  ok: true
  /** Canonical text and JSON values, exactly what `codecFor(column).parse` would return for them. */
  values: Record<string, ApiValue>
  /** The version token to send back with an update, or `null` when the target has no concurrency. */
  version: string | null
}

/**
 * Why a record operation did not happen, as a stable code.
 *
 * - `not-found` — no such record inside the filters.
 * - `stale` — the record changed since it was read. PostgreSQL's 40001 under
 *   repeatable read is this too (0006).
 * - `unique-violation`, `foreign-key-violation`, `not-null-violation`,
 *   `check-violation` — the database's constraints refused it; `constraint`
 *   names the one, when the engine says which.
 * - `too-long`, `out-of-range` — a value the codec accepted and the column
 *   did not: a single-byte `varchar`, a UTF-8 one counting bytes (0007).
 * - `permission-denied` — the connection's own grants refused it.
 * - `schema-changed` — a column or table the binding names is gone.
 * - `unavailable` — the database could not be reached; nothing was sent, or
 *   what was sent certainly did not commit.
 * - `unknown-outcome` — the connection failed after a write was sent and
 *   before its result arrived. It may have committed. Never retried
 *   automatically (plan section 12): the host reconciles.
 */
export type RecordFailureCode =
  | 'not-found'
  | 'stale'
  | 'unique-violation'
  | 'foreign-key-violation'
  | 'not-null-violation'
  | 'check-violation'
  | 'too-long'
  | 'out-of-range'
  | 'permission-denied'
  | 'schema-changed'
  | 'unavailable'
  | 'unknown-outcome'

export interface RecordFailure {
  ok: false
  code: RecordFailureCode
  /** The column at fault, when the engine says which. */
  column?: string
  /** The constraint at fault, when the engine says which. */
  constraint?: string
  /** A sentence for a log. Never contains a value the person entered. */
  message: string
}

export type RecordOutcome = RecordRead | RecordFailure

/**
 * The record half of the database port, which both adapters implement and one
 * conformance suite holds them to.
 *
 * Values arrive canonical and leave canonical: an adapter binds from text and
 * reads back as text converted in SQL, never through the driver's own number
 * or date handling — `tedious` returns `decimal(18,4)` as a lossy number and a
 * `date` as midnight UTC (0007), and `postgres.js` returns whatever the
 * composition root configured (0006). Identifiers come from this request and
 * are quoted by the adapter one part at a time, never with a helper that
 * splits on dots.
 *
 * A database error is translated to a `RecordFailure`, never thrown; only a
 * programming error throws.
 */
export interface RecordAdapter {
  read(request: ReadRequest): Promise<RecordOutcome>
  insert(request: InsertRequest): Promise<RecordOutcome>
  update(request: UpdateRequest): Promise<RecordOutcome>
}
