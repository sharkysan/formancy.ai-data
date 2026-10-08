import type { DatabaseKind } from './adapter.js'

/**
 * A table or view, as two strings and never one dotted string.
 *
 * `sales.order` is ambiguous the moment a schema or a table name contains a dot
 * or needs quoting, and both engines allow both. Two fields cannot be split
 * wrongly.
 */
export interface ObjectRef {
  schema: string
  name: string
}

/**
 * What a column holds, in terms both engines can be compared on.
 *
 * Ranges and lengths rather than type names, because the names do not line up:
 * PostgreSQL's `integer` and SQL Server's `int` are one thing, `char(2)` is a
 * text of fixed length two in both, and `nvarchar(200)` is two hundred
 * characters even though SQL Server's catalog says four hundred bytes. The
 * database's own spelling is kept beside this, in `ColumnMeta.databaseType`,
 * so nothing is lost by normalising.
 *
 * `unsupported` is a value and not an absence. A column of a type nobody has
 * written a tested codec for is still a column the form generator must report,
 * and a snapshot that dropped it would be indistinguishable from a table that
 * never had it.
 */
export type NormalizedType =
  | { kind: 'text'; maxLength: number | null; fixedLength: boolean }
  | { kind: 'boolean' }
  /** Bounds as decimal strings, because a 64-bit bound is not a JavaScript number. */
  | { kind: 'integer'; min: string; max: string }
  /** `null` precision is an unconstrained `numeric`, which PostgreSQL allows and SQL Server does not. */
  | { kind: 'decimal'; precision: number | null; scale: number | null }
  | { kind: 'float'; bits: 32 | 64 }
  | { kind: 'date' }
  | { kind: 'time'; precision: number | null }
  | { kind: 'timestamp'; withTimeZone: boolean; precision: number | null }
  | { kind: 'uuid' }
  | { kind: 'binary'; maxLength: number | null }
  /** SQL Server's `rowversion`: an opaque, database-generated concurrency token, never a clock. */
  | { kind: 'rowversion' }
  | { kind: 'unsupported' }

export type NormalizedTypeKind = NormalizedType['kind']

/** How a column gets its value when nobody supplies one. */
export type Generation = 'none' | 'identity' | 'computed' | 'rowversion'

export interface ColumnMeta {
  name: string
  /** The catalog's position, used for order only. Gaps are allowed: a dropped column leaves one. */
  ordinal: number
  /** As the database spells it — `numeric(18,4)`, `nvarchar(max)` — for a person reading a report. */
  databaseType: string
  type: NormalizedType
  nullable: boolean
  /**
   * Whether the column has a default. True with a `null` expression is a real
   * state: SQL Server shows that a default exists to an account that may not
   * read its definition. The snapshot's gaps say when that happened.
   */
  hasDefault: boolean
  defaultExpression: string | null
  generated: Generation
  comment: string | null
}

/** A primary or unique key. Column order is the key's order, which matters for a composite one. */
export interface KeyMeta {
  name: string
  columns: string[]
}

export type ReferentialAction = 'no-action' | 'restrict' | 'cascade' | 'set-null' | 'set-default'

export interface ForeignKeyTarget {
  table: ObjectRef
  /** Paired with `ForeignKeyMeta.columns` by position, and not necessarily the target's primary key. */
  columns: string[]
}

export interface ForeignKeyMeta {
  name: string
  columns: string[]
  /**
   * Where the key points, or `null` when this connection can see that a foreign
   * key exists but not what it references. A gap on the owning object says so.
   * Present-with-unknown-target is reported rather than dropped, because a
   * dropped key reads as "no relationship", which is the one wrong answer.
   */
  references: ForeignKeyTarget | null
  onUpdate: ReferentialAction
  onDelete: ReferentialAction
  /** Whether new writes are checked against it. */
  enforced: boolean
  /** Whether the rows that existed when it was added were checked. PostgreSQL `NOT VALID`; SQL Server `WITH NOCHECK`. */
  validated: boolean
}

export interface CheckMeta {
  name: string
  /** The expression as the catalog reports it, or `null` when this connection cannot read it. */
  expression: string | null
  validated: boolean
}

export interface ObjectMeta {
  ref: ObjectRef
  kind: 'table' | 'view'
  comment: string | null
  columns: ColumnMeta[]
  primaryKey: KeyMeta | null
  uniqueKeys: KeyMeta[]
  foreignKeys: ForeignKeyMeta[]
  checks: CheckMeta[]
}

/** The part of the catalog a gap is about. */
export type CoverageAspect = 'objects' | 'columns' | 'keys' | 'foreign-keys' | 'checks' | 'defaults' | 'comments'

/**
 * Something this connection could not establish.
 *
 * The reason the snapshot carries these at all: a permission-filtered catalog
 * looks exactly like a complete one with fewer things in it. PostgreSQL's
 * `information_schema` hides constraints from an account without privileges on
 * them, and SQL Server's catalog views show only securables the account has
 * some permission on. "No relationship exists" and "this connection cannot
 * tell" have to be different answers, so the second one is written down.
 */
export interface CoverageGap {
  /** The object the gap is about, or `null` when it is about the scope as a whole. */
  object: ObjectRef | null
  aspect: CoverageAspect
  /** A sentence for a person: what could not be read, and why if the adapter knows. */
  detail: string
}

/** The schemas an administrator approved for discovery. An adapter reads nothing outside them. */
export interface DiscoveryScope {
  schemas: string[]
}

export interface MetadataSnapshot {
  kind: DatabaseKind
  /** As `DatabaseAdapter.ping` reports it. Not part of the fingerprint: a patch upgrade is not drift. */
  serverVersion: string
  scope: DiscoveryScope
  objects: ObjectMeta[]
  gaps: CoverageGap[]
  /**
   * A hash of everything a form binding depends on: the kind, the objects and
   * the gaps. A change in what this connection can SEE changes it too, so a
   * revoked permission is noticed as a change — and reported by drift review as
   * an access problem rather than as a dropped table.
   */
  fingerprint: string
}
