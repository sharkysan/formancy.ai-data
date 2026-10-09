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
 * text of fixed length two in both, and `nvarchar(200)` is two hundred UTF-16
 * code units even though SQL Server's catalog says four hundred bytes —
 * `lengthUnit` says which unit a length counts (0026). The
 * database's own spelling is kept beside this, in `ColumnMeta.databaseType`,
 * so nothing is lost by normalising.
 *
 * `unsupported` is a value and not an absence. A column of a type nobody has
 * written a tested codec for is still a column the form generator must report,
 * and a snapshot that dropped it would be indistinguishable from a table that
 * never had it.
 */
export type NormalizedType =
  | {
      kind: 'text'
      /** In `lengthUnit`s; `null` is unbounded. */
      maxLength: number | null
      lengthUnit: TextLengthUnit
      fixedLength: boolean
    }
  | { kind: 'boolean' }
  /** Bounds as decimal strings, because a 64-bit bound is not a JavaScript number. */
  | { kind: 'integer'; min: string; max: string }
  /** `null` precision is an unconstrained `numeric`, which PostgreSQL allows and SQL Server does not. */
  | { kind: 'decimal'; precision: number | null; scale: number | null }
  | { kind: 'float'; bits: 32 | 64 }
  | { kind: 'date' }
  | { kind: 'time'; precision: number | null }
  /**
   * `withTimeZone` false is a wall clock in no zone: read-only (0009), read as
   * `YYYY-MM-DDTHH:MM:SS`, then — when the value has a fraction of a second —
   * `.` and its digits with trailing zeros dropped, as many as the column
   * holds, never rounded: `2026-10-08T12:34:56.5`. Both adapters spell it so
   * (0026). One exception: SQL Server's `datetime` keeps 1/300 s and SQL
   * Server itself spells it to the millisecond — a stored .00666… reads
   * `.007` — so that type's read is rounded, as SQL Server rounds it. Outside
   * years 1–9999 (PostgreSQL only) the era is spelled, as for a date.
   */
  | { kind: 'timestamp'; withTimeZone: boolean; precision: number | null }
  | { kind: 'uuid' }
  /**
   * `fixedLength`: binary(n) pads a shorter value with zero bytes to n, so what
   * is read is not what was written. PostgreSQL's bytea never is. Binary has no
   * codec yet; the flag is for drift, and for the binary codec that will need
   * it, which must refuse or pad.
   */
  | { kind: 'binary'; maxLength: number | null; fixedLength: boolean }
  /** SQL Server's `rowversion`: an opaque, database-generated concurrency token, never a clock. */
  | { kind: 'rowversion' }
  | { kind: 'unsupported' }

export type NormalizedTypeKind = NormalizedType['kind']

/**
 * What a text column's declared length counts. The engines do not agree, and
 * neither always agrees with the browser, whose `maxLength` counts UTF-16 code
 * units (JavaScript's `length`):
 *
 * - `code-points` — PostgreSQL varchar(n)/char(n) in a UTF8 database: n
 *   characters. Two emoji are two.
 * - `utf16-code-units` — SQL Server nvarchar(n)/nchar(n), under every
 *   collation, a UTF-8 one included: n byte pairs. An emoji is two;
 *   nvarchar(4) holds two and refuses a third (2628).
 * - `utf8-bytes` — SQL Server varchar(n)/char(n) under a UTF-8 collation
 *   (code page 65001): n bytes. `é` is two; varchar(4) refuses three (2628).
 *   Also PostgreSQL in a SQL_ASCII database, which stores the client's UTF-8
 *   bytes unconverted and counts each byte as a character.
 * - `code-page-bytes` — a text in an encoding that is not Unicode: SQL Server
 *   varchar(n)/char(n) under any other collation, n bytes of its code page —
 *   one per character on a single-byte page such as 1252, one or two on 932,
 *   936, 949 and 950; PostgreSQL in a database of any other encoding, such as
 *   LATIN1, n characters of it. Nothing here holds an encoding's table, so a
 *   value is checked by characters — a lower bound — and the save refuses
 *   what is longer in bytes or holds a character the encoding lacks:
 *   PostgreSQL itself (22P05), and on SQL Server, which stores `?` or a best
 *   fit without an error, the adapter's check that the text was stored as
 *   sent.
 */
export type TextLengthUnit = 'code-points' | 'utf16-code-units' | 'utf8-bytes' | 'code-page-bytes'

/**
 * How a column gets its value when nobody supplies one.
 *
 * - `identity-always` — numbered by the database, and an explicit value is
 *   refused in an ordinary write: PostgreSQL GENERATED ALWAYS AS IDENTITY (only
 *   OVERRIDING SYSTEM VALUE gets past it), SQL Server IDENTITY (only
 *   IDENTITY_INSERT, which needs ALTER on the table; an UPDATE of it is
 *   refused, 8102).
 * - `identity-by-default` — numbered from a sequence when a write leaves it
 *   out, and an explicit value accepted: PostgreSQL GENERATED BY DEFAULT AS
 *   IDENTITY, and on either engine a default that is exactly a sequence's
 *   next value — PostgreSQL's `serial`, `nextval('…'::regclass)`, and SQL
 *   Server's `NEXT VALUE FOR`, which has no BY DEFAULT identity and uses this
 *   instead. They behave alike, so they are named alike. Such a column still
 *   reports the default it has (`hasDefault`); an identity has none.
 * - `computed` — derived by the database from other columns of the row.
 * - `rowversion` — SQL Server's concurrency token, written on every change.
 *
 * Both identities are read-only in a form (0026): a number chosen by hand does
 * not advance the sequence, and a later create collides with it (measured on
 * both engines: PostgreSQL 23505, SQL Server 2627).
 */
export type Generation = 'none' | 'identity-always' | 'identity-by-default' | 'computed' | 'rowversion'

/**
 * What the account that took the snapshot may do with one column, as the
 * database's own privilege check answered at discovery (0027).
 *
 * What was true then, not a promise about the next request: a grant revoked
 * afterwards still fails at runtime as `permission-denied`, and drift review
 * reports it once a later snapshot sees it.
 */
export interface ColumnAccess {
  /** It may read the column: SELECT on the object or the column; on PostgreSQL also USAGE on its schema. */
  select: boolean
  /**
   * It may name the column in an INSERT. SQL Server grants INSERT on whole
   * objects only (a column list is refused, 1020), so every column of an
   * object it may insert into says yes.
   */
  insert: boolean
  /**
   * It may name the column in an UPDATE's SET. Reading it — in SET's
   * right-hand side, a WHERE, a RETURNING/OUTPUT — needs `select` as well
   * (measured on both engines).
   */
  update: boolean
}

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
  /**
   * Privileges, not generation: an identity column the account may INSERT
   * into says `insert: true`, and `generated` says the database fills it.
   * Both are consulted; neither implies the other.
   */
  access: ColumnAccess
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
  /**
   * Whether a write from an ordinary session is checked against it.
   *
   * Not every session is ordinary. PostgreSQL skips foreign-key triggers when
   * `session_replication_role = replica` (the logical-replication apply
   * worker, `pg_restore --disable-triggers`), and SQL Server skips a NOT FOR
   * REPLICATION key for replication agents. No catalog says which sessions do
   * either, and this module never sets them.
   */
  enforced: boolean
  /** Whether the rows that existed when it was added were checked. PostgreSQL `NOT VALID`; SQL Server `WITH NOCHECK`. */
  validated: boolean
}

export interface CheckMeta {
  name: string
  /** The expression as the catalog reports it, or `null` when this connection cannot read it. */
  expression: string | null
  /**
   * Whether new writes are checked against it. SQL Server: not `is_disabled`
   * (ALTER TABLE … NOCHECK CONSTRAINT). PostgreSQL 17: always — NOT VALID only
   * skips the rows already there.
   */
  enforced: boolean
  /**
   * Whether the rows that existed when it was added or re-enabled were
   * checked. PostgreSQL NOT VALID; SQL Server WITH NOCHECK, and every disabled
   * check, which SQL Server marks untrusted.
   */
  validated: boolean
}

/**
 * Whether the database itself limits which rows of this object the account may
 * see or write, beyond its grants: PostgreSQL row-level security, SQL Server
 * security policies (0027).
 *
 * - `none`: established that none of the object's own policies applies to
 *   this account.
 * - `applies`: some does. Which rows is the policy's; the snapshot does not
 *   say. PostgreSQL answers for this account (an owner without FORCE, a
 *   BYPASSRLS role or a superuser get `none`); SQL Server has no exemption, so
 *   an enabled policy on the object applies to every account, `dbo` included.
 * - `unknown`: this connection cannot tell; a `row-security` gap covering the
 *   object says why.
 *
 * About the object's own policies only: a view is not followed to its tables,
 * whose policies SQL Server applies through the view, and PostgreSQL does when
 * the view is security_invoker.
 */
export type RowSecurity = 'none' | 'applies' | 'unknown'

export interface ObjectMeta {
  ref: ObjectRef
  kind: 'table' | 'view'
  comment: string | null
  columns: ColumnMeta[]
  primaryKey: KeyMeta | null
  uniqueKeys: KeyMeta[]
  foreignKeys: ForeignKeyMeta[]
  checks: CheckMeta[]
  rowSecurity: RowSecurity
}

/** The part of the catalog a gap is about. `row-security`: whether a policy applies could not be established (0027). */
export type CoverageAspect = 'objects' | 'columns' | 'keys' | 'foreign-keys' | 'checks' | 'defaults' | 'comments' | 'row-security'

/**
 * What a gap is about: the whole scope (it cannot be placed), one schema, or
 * one object. Schema and object names are the catalog's spelling, as
 * ObjectRef's are — on a case-insensitive SQL Server database that may differ
 * from how the scope spells the schema, and it is not compared with it.
 */
export type CoverageSubject = { kind: 'scope' } | { kind: 'schema'; schema: string } | { kind: 'object'; object: ObjectRef }

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
  /** What the gap is about (0027): before it, `object: null` meant both "the scope" and "a schema". */
  subject: CoverageSubject
  aspect: CoverageAspect
  /** A sentence for a person: what could not be read, and why if the adapter knows. */
  detail: string
}

/** The schemas an administrator approved for discovery. An adapter reads nothing outside them. */
export interface DiscoveryScope {
  schemas: string[]
}

/** Whose snapshot this is (0027). */
export interface DiscoveryAccount {
  /**
   * The principal privileges and policies are evaluated for: PostgreSQL
   * `current_user`, SQL Server `USER_NAME()`. In the fingerprint: the same
   * connection under another principal reads other rows.
   */
  user: string
  /**
   * Who connected: PostgreSQL `session_user`, SQL Server `ORIGINAL_LOGIN()`.
   * For a person reading the report; not in the fingerprint, because a login
   * mapped to the same user is the same principal.
   */
  login: string
}

export interface MetadataSnapshot {
  kind: DatabaseKind
  /** As `DatabaseAdapter.ping` reports it. Not part of the fingerprint: a patch upgrade is not drift. */
  serverVersion: string
  account: DiscoveryAccount
  scope: DiscoveryScope
  objects: ObjectMeta[]
  gaps: CoverageGap[]
  /**
   * A hash of everything a form binding depends on: the kind, the account's
   * user, the objects — their columns' privileges and row security included —
   * and the gaps. A change in what this connection can see or do changes it
   * too, so a revoked permission is noticed as a change — and reported by
   * drift review as a privilege or access problem rather than as a dropped
   * table.
   */
  fingerprint: string
}
