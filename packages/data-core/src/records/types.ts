import type { ApiValue } from '../codecs/codec.js'
import type { LookupKeyColumn, LookupSearchColumn, LookupSearchType, RowFilters, RowFilterType } from '../lookup/types.js'
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

/**
 * One column of a list's order (0044). `nulls` is `'last'` for a column the
 * snapshot says is nullable -- a NULL comes after every value, whichever the
 * direction, as in a lookup -- and `null` for a NOT NULL one, which holds
 * none and is spelled with no placement, so an index on it can serve the
 * order on either engine. `listOrder` makes it from the snapshot.
 */
export interface RecordSort {
  column: string
  direction: 'asc' | 'desc'
  nulls: 'last' | null
}

/** A list's search: the trimmed text, never empty, and the columns it is matched against, each of a kind both engines spell alike as text (0028). */
export interface ListSearch {
  text: string
  columns: readonly LookupSearchColumn[]
}

/** What an equals filter compares (0104): a row filter's kinds, whose values have one spelling, and a boolean. */
export type EqualsFilterType = RowFilterType | { kind: 'boolean' }

/** What a range compares (0104): numbers and days, which both engines order alike. */
export type RangeFilterType = Extract<NormalizedType, { kind: 'integer' | 'decimal' | 'date' | 'timestamp' }>

/**
 * One column a list is narrowed by at a person's request (0104), as
 * `columnFilter` plans it from the column's type. Every value is canonical
 * text, bound as its column's type.
 *
 * - `equals`: the column's canonical value is exactly `value`, as a row
 *   filter compares it (0028) -- text unit for unit, whatever the column's
 *   collation -- or the boolean `true` or `false`.
 * - `range`: at least `from`, at most `to`, below `before`; a bound that is
 *   `null` is not there. An integer, a decimal or a date has `from` and
 *   `to`, values its column can hold. A timestamp has `from` and `before`,
 *   midnights spelled `YYYY-MM-DDT00:00:00`, with `Z` for an instant: its
 *   range is whole days, compared with the stored value, never with the
 *   value cut to the second a page shows.
 * - `contains`: the column holds `text`, matched as a search matches it.
 * - `null`, `not-null`: the column is NULL, or not. Text of no characters
 *   is a value.
 */
export type RecordFilter =
  | { op: 'equals'; column: string; type: EqualsFilterType; value: string }
  | { op: 'range'; column: string; type: RangeFilterType; from: string | null; to: string | null; before: string | null }
  | { op: 'contains'; column: string; type: Extract<LookupSearchType, { kind: 'text' }>; text: string }
  | { op: 'null' | 'not-null'; column: string }

/**
 * One page of the records the trusted filters and every through admit
 * (0044): the rows a read by each one's token would find, in `sort`, which
 * ends with every identity column it does not already name and so is total.
 *
 * `equal` narrows to one parent: the root's foreign-key columns a lookup
 * binds, each with the value the parent's token names, compared with the
 * database's own equality as the foreign key compares them; `[]` for none.
 * `filter` narrows by the person's own conditions, each column once (0104);
 * `[]` for none. Neither adds a permission -- the filters and the throughs
 * still decide which rows exist. `search` is `null` for none. The adapter
 * fetches `limit + 1` rows, so `recordPage` can tell whether more follow
 * without a COUNT.
 *
 * Where the page starts (0108): `after`, the key of the row the page
 * continues after, every identity column in the identity's order, or `null`
 * for the first page; then `offset` rows on from there. A form's list pages
 * by `after` alone, its offset always 0; a browse (0099), which may have no
 * key to find a row by, pages by `offset` alone. The row `after` names is
 * found under the trusted filters and every through, as a read finds it,
 * and never under `equal`, `filter` or `search`: it is a place in the order,
 * which a row that stopped matching them still has.
 */
export interface ListRequest {
  target: RecordTarget
  columns: readonly RecordColumn[]
  filters: RowFilters
  through: readonly Through[]
  equal: readonly RecordValue[]
  filter: readonly RecordFilter[]
  search: ListSearch | null
  sort: readonly RecordSort[]
  after: readonly RecordValue[] | null
  offset: number
  limit: number
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
  /**
   * A form over versions (0113): the chain's key columns, each among
   * `values`. The insert starts a chain, so it holds only while no row has
   * these values; otherwise it inserts nothing and is `chain-exists`.
   */
  fresh?: readonly string[]
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
  /**
   * A form over versions (0113): the column a version ends at, NULL while it
   * is open. The update holds only while it is NULL, so a version that has
   * ended is `version-ended` rather than changed.
   */
  open?: string
}

/**
 * A change from a date (0113): end the open version `key` names -- set
 * `ends` to `start`'s value, under everything an update is guarded by and
 * only while `ends` is NULL -- and insert the next version: the chain's
 * key copied from the row ended, `start` where it begins, and `values`. One
 * write that does both or neither, so a chain never has a gap, an overlap
 * or two open versions made by it. Nothing ended is `stale`, `not-found` or
 * `version-ended`, as an update's nothing is.
 */
export interface SupersedeRequest {
  target: RecordTarget & { concurrency: RecordConcurrency }
  key: readonly RecordValue[]
  expectedVersion: string
  filters: RowFilters
  through: readonly Through[]
  /** The column a version ends at, NULL while it is open. */
  ends: string
  /** The column the next version starts at, and where: the ended version's end too. */
  start: RecordValue
  /** The chain's key, copied from the row ended into the next version. */
  chain: readonly RecordColumn[]
  /** The next version's other values, as a create's: the person's answers and the pinned columns outside the chain's key. */
  values: readonly RecordValue[]
  /** What to read back from the next version. */
  returning: readonly RecordColumn[]
  /** The `definition` of the description this change was decided over (0041). */
  definition: string
}

/**
 * What a delete of one record reaches through foreign keys (0050, 0051), as
 * the planner decided it from the snapshot and the policy: the tables it
 * removes rows of, through every cascade the policy accepts and on from
 * there, those whose references it sets NULL or to a default, and each key
 * it acts through. What each adapter's statement holds the database to:
 * the adapters lock and guard what it names, ask the account's DELETE on
 * every table past the root, and refuse a delete through any key it does
 * not name rather than follow it.
 */
export interface DeleteReach {
  /** The tables a delete removes rows of, the root first, then the rest in codepoint order of schema and name. */
  removed: readonly ObjectRef[]
  /** The tables whose referencing columns a delete sets NULL or to their default, and those columns. */
  cleared: ReadonlyArray<{ table: ObjectRef; columns: readonly string[] }>
  /** Each foreign key the policy accepts a delete acting through: the table it is on, its name, the table it refers to, and its action. */
  accepted: ReadonlyArray<{ from: ObjectRef; name: string; onto: ObjectRef; onDelete: 'cascade' | 'set-null' | 'set-default' }>
}

/**
 * Delete the record named by `key`, only if its version is still
 * `expectedVersion` and it is inside the filters and every through, as an
 * update locates it (0050) -- one guarded statement, so nothing can change
 * between the check and the delete. A record outside them is `not-found`
 * whatever version is sent. The statement deletes one row or none: a key
 * that matches more is refused inside it, with nothing deleted. And it
 * deletes only while the table's definition is `definition` (0041) and
 * nothing refers to the tables of `reach` in a way the reach does not name.
 */
export interface DeleteRequest {
  target: RecordTarget & { concurrency: RecordConcurrency }
  key: readonly RecordValue[]
  /** The token a read returned: hex for a rowversion, a decimal string for a version column. */
  expectedVersion: string
  filters: RowFilters
  through: readonly Through[]
  reach: DeleteReach
  definition: string
}

/**
 * What a delete removed (0050): the identity columns as the statement
 * deleted them, canonical, so the token answered is the row's own -- under
 * a case-insensitive key collation it may be spelled otherwise than the one
 * sent (0028) -- and the version it had. No other value: nothing of a
 * deleted record is kept for a resend to answer with (0031).
 */
export type DeleteOutcome = { ok: true; deleted: { values: Record<string, ApiValue>; version: string } } | RecordFailure

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
 * - `version-ended` — an update or a change from a date of a version that
 *   has ended (0113): its end is no longer NULL. Nothing was written.
 * - `chain-exists` — a create of a chain's first version where the chain
 *   already has one (0113). Nothing was written.
 */
export type RecordFailureCode =
  | 'not-found'
  | 'stale'
  | 'version-ended'
  | 'chain-exists'
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
 * A list's rows, up to `limit + 1` in the request's order, with the table as
 * that same statement found it, answered whether any row was found (0041).
 *
 * `after` says whether the statement found the row the request continues
 * after (0108): `found`, `gone` when no row inside the trusted filters and
 * every through has that key -- deleted, or moved out of them -- and `null`
 * for a request with no `after`. A page after a row that is gone has no
 * place to start, and holds no rows.
 */
export type ListOutcome = { ok: true; described: DescribedTable; rows: Array<Omit<RecordRead, 'ok'>>; after: 'found' | 'gone' | null } | RecordFailure

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
 * read statement found it, and so is a list's (0044): one statement for the
 * page and the table it was read from. A delete runs only while the
 * definition holds too, and while nothing refers to the tables it reaches in
 * a way its request does not name (0050).
 */
export interface RecordAdapter {
  describe(table: ObjectRef): Promise<Described>
  read(request: ReadRequest): Promise<DescribedRead>
  list(request: ListRequest): Promise<ListOutcome>
  insert(request: InsertRequest): Promise<RecordOutcome>
  update(request: UpdateRequest): Promise<RecordOutcome>
  /** A change from a date (0113): the next version as read back, or why nothing was ended. */
  supersede(request: SupersedeRequest): Promise<RecordOutcome>
  /** One record, by its key and the version its person read (0050): one guarded statement, never retried. */
  delete(request: DeleteRequest): Promise<DeleteOutcome>
}
