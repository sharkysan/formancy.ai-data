import type { ApiValue } from '../codecs/codec.js'
import type { LookupKeyColumn, RowFilters } from '../lookup/types.js'
import type { ColumnMeta, NormalizedType, ObjectMeta, ObjectRef } from '../metadata.js'

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
 * A scope one foreign-key hop away (0043): a root row exists for the request
 * only when the row of `target` its `columns` reference is one `filters`
 * admits -- the target filter a policy's `through` lookup puts on it. An
 * adapter puts it in every statement that locates a record, beside the
 * root's own filters, as an EXISTS over the target, never as a second read.
 *
 * `columns` are the root's foreign-key columns and `targetColumns` the key
 * they reference, paired by position, each of a kind `isThroughKeyType`
 * accepts; the pair compares with the database's own equality, as the
 * foreign key does. Every name is approved metadata, from the bindings and
 * the lookup's config, and every filter value is typed and bound (0011).
 * A row whose foreign key is NULL references nothing, and is outside.
 */
export interface Through {
  columns: readonly RecordColumn[]
  target: ObjectRef
  targetColumns: readonly LookupKeyColumn[]
  filters: RowFilters
}

/**
 * Read one record by its key, through the trusted filters and every through.
 *
 * A record outside them does not exist for this call: another tenant's
 * row is `not-found`, never `forbidden`, so its existence is not disclosed.
 * `through` is `[]` for a form whose policy names none, and is said either
 * way, as the filters are.
 */
export interface ReadRequest {
  target: RecordTarget
  key: readonly RecordValue[]
  columns: readonly RecordColumn[]
  filters: RowFilters
  through: readonly Through[]
}

/** A column as `describe` reads it: what discovery says of its definition, without what the account may do or a comment. */
export type DescribedColumn = Omit<ColumnMeta, 'access' | 'comment'>

/**
 * A form's root as the catalog describes it within one request (0041): its
 * kind, columns, keys and foreign keys, normalised as discovery normalises
 * them, and `definition`, the adapter's own token for the catalog facts it
 * read them from. The core passes `definition` through to the writes decided
 * over this description and never parses or compares it.
 */
export type DescribedTable = Pick<ObjectMeta, 'kind' | 'primaryKey' | 'uniqueKeys' | 'foreignKeys'> & {
  columns: DescribedColumn[]
  definition: string
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
  /** The `definition` of the description this insert was decided over: it runs only while the table still has it (0041). */
  definition: string
}

/**
 * Change exactly `set` on the record named by `key`, only if its version is
 * still `expectedVersion` and it is inside the filters and every through —
 * one statement, so nothing can change between the check and the write. What
 * tells a stale update from one aimed at nothing is inside them too, so a
 * record outside them is `not-found` whatever version is sent.
 */
export interface UpdateRequest {
  target: RecordTarget & { concurrency: RecordConcurrency }
  key: readonly RecordValue[]
  set: readonly RecordValue[]
  /** The token a read returned: hex for a rowversion, a decimal string for a version column. */
  expectedVersion: string
  filters: RowFilters
  through: readonly Through[]
  returning: readonly RecordColumn[]
  /** The `definition` of the description this update was decided over: it runs only while the table still has it (0041). */
  definition: string
}

/** A record as the API carries it: canonical values by column, and its current version token. */
export interface RecordRead {
  ok: true
  /**
   * Canonical text and JSON values, exactly what `codecFor(column).parse` would
   * return for them. Two are named here because each engine's own spelling
   * differs (0026): a 32-bit float is the number `canonicalFloat32` gives — 0.1,
   * never 0.10000000149011612, the same the codec accepts it as — and a
   * zoneless timestamp, which has no codec, is `YYYY-MM-DDTHH:MM:SS` and then
   * its fraction with trailing zeros dropped, as `NormalizedType` describes.
   */
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
 * - `permission-denied` — the connection's own grants refused it, or row
 *   security did: a PostgreSQL policy's WITH CHECK (42501), a SQL Server
 *   block predicate (33504).
 * - `schema-changed` — a column or table the binding names is gone, or no
 *   longer takes what the binding writes: a generated column written (0028);
 *   or the table's definition is no longer the one the request was decided
 *   over (0041), and the record was not written. A table the catalog does
 *   not show as discovery would describe it — gone, out of sight, a foreign
 *   table, a partition — is this too: the runtime never says which (0010),
 *   drift review does.
 * - `refused` — the database refused the statement for a reason this port has no code for:
 *   a trigger's own error, a write it declined without one, an INSTEAD OF trigger this
 *   adapter cannot verify, an error it does not recognise. Nothing was written. The same
 *   request is expected to be refused again, so it is not a reason to retry (0028).
 * - `unavailable` — the database could not answer now: unreachable, no connection free, or a
 *   refusal the engine documents as passing (a deadlock it chose this statement to lose, a
 *   lock or resource it could not get in time). Nothing was sent, or it certainly did not commit.
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
  | 'refused'
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

/** A table described, or why it could not be: `schema-changed` for one the catalog does not show as discovery would describe it. */
export type Described = { ok: true; described: DescribedTable } | RecordFailure

/**
 * A read, with the table as that same statement found it: `record` is `null`
 * when no row is inside the filters, and the description is answered either
 * way, because the statement ran (0041).
 */
export type DescribedRead = { ok: true; described: DescribedTable; record: Omit<RecordRead, 'ok'> | null } | RecordFailure

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
 *
 * And the table is described where it is used (0041). `describe` reads the
 * root's definition in one statement, and every read returns it from the
 * statement that read the record. An insert or an update runs only while the
 * table's definition is `definition`; otherwise it is `schema-changed`, and
 * the record was not written. A read's description is of the table as that
 * read statement found it.
 */
export interface RecordAdapter {
  describe(table: ObjectRef): Promise<Described>
  read(request: ReadRequest): Promise<DescribedRead>
  insert(request: InsertRequest): Promise<RecordOutcome>
  update(request: UpdateRequest): Promise<RecordOutcome>
}
