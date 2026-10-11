import type { DatabaseKind, Generation, NormalizedTypeKind, ObjectRef, ReferentialAction, RowSecurity, TextLengthUnit } from '@formancy/data-core'

/**
 * A type, as far as the model cares about it: the kind, and whichever of that
 * kind's properties are specified. A property left out is not compared, which
 * is how the model says "the engines may differ here and that is fine" — the
 * precision of a timestamp, say — without saying it per engine.
 */
export interface ExpectedType {
  readonly kind: NormalizedTypeKind
  readonly [property: string]: unknown
}

export interface ExpectedColumnFacts {
  type?: ExpectedType
  nullable?: boolean
  generated?: Generation
  hasDefault?: boolean
}

export interface ExpectedColumn extends ExpectedColumnFacts {
  name: string
  /**
   * Where the two engines genuinely differ, written down rather than smoothed
   * over. Merged over the facts above for the engine named.
   */
  byKind?: Partial<Record<DatabaseKind, ExpectedColumnFacts>>
}

export interface ExpectedForeignKey {
  name: string
  columns: string[]
  references: { table: ObjectRef; columns: string[] }
  onDelete: ReferentialAction
  validated: boolean
}

/** What a check does, as far as the model pins it. A fact left out is not compared. */
export interface ExpectedCheckFacts {
  enforced?: boolean
  validated?: boolean
}

export interface ExpectedCheck extends ExpectedCheckFacts {
  name: string
  /** Where the engines differ — SQL Server can disable a check, PostgreSQL 17 cannot — merged over the facts above. */
  byKind?: Partial<Record<DatabaseKind, ExpectedCheckFacts>>
}

export interface ExpectedObject {
  ref: ObjectRef
  kind: 'table' | 'view'
  comment?: string | null
  columns: ExpectedColumn[]
  primaryKey: string[] | null
  uniqueKeys: Record<string, string[]>
  foreignKeys: ExpectedForeignKey[]
  checks: ExpectedCheck[]
  /**
   * Whether row security applies to the owner, who discovers the model (0027).
   * Required, so an object cannot be left out of it silently; per engine where
   * the engines genuinely differ.
   */
  rowSecurity: RowSecurity | Record<DatabaseKind, RowSecurity>
}

const sales = (name: string): ObjectRef => ({ schema: 'sales', name })

const INT16 = { kind: 'integer', min: '-32768', max: '32767' } as const
const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const INT64 = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const
const BYTEA = { kind: 'binary', maxLength: null, fixedLength: false } as const
const text = (maxLength: number | null, fixedLength: boolean, lengthUnit: TextLengthUnit): ExpectedType => ({ kind: 'text', maxLength, fixedLength, lengthUnit })
const decimal = (precision: number, scale: number): ExpectedType => ({ kind: 'decimal', precision, scale })

/**
 * A text column's type on each engine. PostgreSQL, in the fixture's UTF8 database,
 * counts characters; SQL Server counts UTF-16 code units for nvarchar, and bytes for a
 * varchar — of UTF-8 or of its code page, by collation (0026). The length is
 * the same number on both, which is what makes the column one column.
 */
const textOn = (maxLength: number | null, fixedLength: boolean, sqlserver: TextLengthUnit): Pick<ExpectedColumn, 'byKind'> => ({
  byKind: { postgres: { type: text(maxLength, fixedLength, 'code-points') }, sqlserver: { type: text(maxLength, fixedLength, sqlserver) } },
})

/**
 * Frozen all the way down. The model is shared by every suite in a process,
 * and a test that edited it to build a broken snapshot would quietly make
 * every later comparison compare the model with itself. Frozen, that test
 * throws instead.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

/** What discovery of the fixture must report, on either engine, as its owner. */
export const FIXTURE_MODEL: readonly ExpectedObject[] = deepFreeze([
  {
    ref: sales('country'),
    kind: 'table',
    columns: [
      // An identity has no default: the database generates it. Pinned because a
      // reader of pg_attrdef would see an expression there and call it one.
      // GENERATED ALWAYS on PostgreSQL and IDENTITY on SQL Server both refuse a value.
      { name: 'id', type: INT32, nullable: false, generated: 'identity-always', hasDefault: false },
      // char(2) on both: two characters, and on SQL Server two bytes of code page 1252.
      { name: 'iso_code', nullable: false, ...textOn(2, true, 'code-page-bytes') },
      { name: 'name', nullable: false, ...textOn(100, false, 'utf16-code-units') },
      // bytea and varbinary(max): neither pads.
      { name: 'flag', type: BYTEA, nullable: true },
      // point and geography: a type with no codec is reported, not dropped.
      { name: 'shape', type: { kind: 'unsupported' }, nullable: true },
    ],
    primaryKey: ['id'],
    uniqueKeys: { uq_country_iso_code: ['iso_code'] },
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
  },
  {
    ref: sales('customer'),
    kind: 'table',
    comment: 'A buyer, numbered within its tenant.',
    columns: [
      { name: 'tenant_id', type: INT32, nullable: false, generated: 'none' },
      { name: 'customer_no', type: INT32, nullable: false },
      // Two hundred on both engines, though SQL Server's catalog says 400 bytes:
      // characters on PostgreSQL, UTF-16 code units on SQL Server.
      { name: 'name', nullable: false, ...textOn(200, false, 'utf16-code-units') },
      { name: 'country_code', nullable: true, ...textOn(2, true, 'code-page-bytes') },
      { name: 'credit_limit', type: decimal(14, 2), nullable: true },
      { name: 'active', type: { kind: 'boolean' }, nullable: false, hasDefault: true },
      { name: 'created_at', type: { kind: 'timestamp', withTimeZone: true }, nullable: false, hasDefault: true },
    ],
    primaryKey: ['tenant_id', 'customer_no'],
    uniqueKeys: {},
    foreignKeys: [
      {
        // To a UNIQUE key that is not the primary key.
        name: 'fk_customer_country',
        columns: ['country_code'],
        references: { table: sales('country'), columns: ['iso_code'] },
        onDelete: 'no-action',
        validated: true,
      },
    ],
    checks: [],
    // A policy binds formancy_writer to tenant 1 (0027). The PostgreSQL owner
    // is the container's superuser, whom row-level security never applies to;
    // SQL Server has no such exemption, and its policy applies to dbo too.
    rowSecurity: { postgres: 'none', sqlserver: 'applies' },
  },
  {
    ref: sales('customer_summary'),
    kind: 'view',
    columns: [{ name: 'tenant_id' }, { name: 'customer_no' }, { name: 'name' }, { name: 'order_count' }],
    primaryKey: null,
    uniqueKeys: {},
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
  },
  {
    ref: sales('employee'),
    kind: 'table',
    columns: [
      { name: 'id', type: INT32, nullable: false, generated: 'none' },
      { name: 'name', nullable: false, ...textOn(200, false, 'utf16-code-units') },
      { name: 'manager_id', type: INT32, nullable: true },
    ],
    primaryKey: ['id'],
    uniqueKeys: {},
    foreignKeys: [
      {
        name: 'fk_employee_manager',
        columns: ['manager_id'],
        references: { table: sales('employee'), columns: ['id'] },
        onDelete: 'no-action',
        validated: false,
      },
    ],
    checks: [],
    rowSecurity: 'none',
  },
  {
    ref: sales('order'),
    kind: 'table',
    columns: [
      { name: 'id', type: INT64, nullable: false, generated: 'identity-always', hasDefault: false },
      { name: 'tenant_id', type: INT32, nullable: false },
      { name: 'customer_no', type: INT32, nullable: false },
      { name: 'order_date', type: { kind: 'date' }, nullable: false },
      { name: 'status', nullable: false, hasDefault: true, ...textOn(20, false, 'code-page-bytes') },
      { name: 'amount', type: decimal(18, 4), nullable: false },
      { name: 'notes', nullable: true, ...textOn(null, false, 'utf16-code-units') },
      { name: 'group', nullable: true, ...textOn(50, false, 'utf16-code-units') },
      { name: 'created_by', type: INT32, nullable: true },
      { name: 'approved_by', type: INT32, nullable: true },
      {
        name: 'row_version',
        nullable: false,
        // Where the two engines are deliberately different, here and on
        // order_line: PostgreSQL has no rowversion, so the fixture uses an
        // application-maintained version column there.
        byKind: {
          postgres: { type: INT64, generated: 'none', hasDefault: true },
          sqlserver: { type: { kind: 'rowversion' }, generated: 'rowversion' },
        },
      },
    ],
    primaryKey: ['id'],
    uniqueKeys: {},
    foreignKeys: [
      {
        name: 'fk_order_approved_by',
        columns: ['approved_by'],
        references: { table: sales('employee'), columns: ['id'] },
        onDelete: 'no-action',
        validated: true,
      },
      {
        name: 'fk_order_created_by',
        columns: ['created_by'],
        references: { table: sales('employee'), columns: ['id'] },
        onDelete: 'no-action',
        validated: true,
      },
      {
        // Composite, and its column order is the pairing.
        name: 'fk_order_customer',
        columns: ['tenant_id', 'customer_no'],
        references: { table: sales('customer'), columns: ['tenant_id', 'customer_no'] },
        onDelete: 'no-action',
        validated: true,
      },
    ],
    checks: [{ name: 'ck_order_status', enforced: true, validated: true }],
    rowSecurity: 'none',
  },
  {
    ref: sales('order_line'),
    kind: 'table',
    columns: [
      { name: 'order_id', type: INT64, nullable: false },
      { name: 'line_no', type: INT32, nullable: false },
      { name: 'quantity', type: INT32, nullable: false },
      { name: 'unit_price', type: decimal(12, 2), nullable: false },
      // Computed on both; the precision each engine derives for it differs, so only the kind is pinned.
      // PostgreSQL files a stored generated column's expression in pg_attrdef,
      // where defaults live; a naive reader would report it as a default. It is not
      // one, and the model says so for both engines.
      { name: 'line_total', type: { kind: 'decimal' }, generated: 'computed', hasDefault: false },
      // A line is updated as a child of its order, through it (0043), and needs
      // a version of its own for that: the engines differ here as on order.
      {
        name: 'row_version',
        nullable: false,
        byKind: {
          postgres: { type: INT64, generated: 'none', hasDefault: true },
          sqlserver: { type: { kind: 'rowversion' }, generated: 'rowversion' },
        },
      },
    ],
    primaryKey: ['order_id', 'line_no'],
    uniqueKeys: {},
    foreignKeys: [
      {
        name: 'fk_order_line_order',
        columns: ['order_id'],
        references: { table: sales('order'), columns: ['id'] },
        onDelete: 'cascade',
        validated: true,
      },
    ],
    checks: [],
    rowSecurity: 'none',
  },
  {
    ref: sales('shipment'),
    kind: 'table',
    columns: [
      // PostgreSQL's BY DEFAULT identity, and on SQL Server, which has no such
      // identity, a default of NEXT VALUE FOR a sequence. Both number a row a
      // create leaves out, take a value given by hand and collide with it
      // later, so both are identity-by-default (0026). The SQL Server one is a
      // default constraint and says so; an identity has no default.
      {
        name: 'id',
        type: INT32,
        nullable: false,
        generated: 'identity-by-default',
        byKind: { postgres: { hasDefault: false }, sqlserver: { hasDefault: true } },
      },
      { name: 'tenant_id', type: INT32, nullable: false, generated: 'none' },
      { name: 'tracking_no', type: { kind: 'uuid' }, nullable: false },
      { name: 'carrier_code', type: INT16, nullable: false },
      // varchar(20) on both; under SQL Server's UTF-8 collation, twenty bytes.
      { name: 'reference', nullable: false, ...textOn(20, false, 'utf8-bytes') },
      { name: 'pickup_time', type: { kind: 'time', precision: 0 }, nullable: false },
      { name: 'dispatched_at', type: { kind: 'timestamp', withTimeZone: false, precision: 3 }, nullable: true },
      { name: 'weight_kg', type: { kind: 'float', bits: 64 }, nullable: true },
      { name: 'temperature_c', type: { kind: 'float', bits: 32 }, nullable: true },
      // binary(32) pads and varbinary does not; PostgreSQL has bytea for both.
      {
        name: 'manifest_hash',
        nullable: true,
        byKind: { postgres: { type: BYTEA }, sqlserver: { type: { kind: 'binary', maxLength: 32, fixedLength: true } } },
      },
      {
        name: 'signature',
        nullable: true,
        byKind: { postgres: { type: BYTEA }, sqlserver: { type: { kind: 'binary', maxLength: 256, fixedLength: false } } },
      },
    ],
    primaryKey: ['id'],
    uniqueKeys: { uq_shipment_tracking: ['tenant_id', 'tracking_no'] },
    foreignKeys: [],
    checks: [
      // Added NOT VALID / WITH NOCHECK over a row it refuses: enforced for new rows, never checked against that one.
      { name: 'ck_shipment_carrier', enforced: true, validated: false },
      // SQL Server's file disables it, which also marks it untrusted. PostgreSQL 17 cannot disable a check.
      { name: 'ck_shipment_reference', enforced: true, validated: true, byKind: { sqlserver: { enforced: false, validated: false } } },
      { name: 'ck_shipment_weight', enforced: true, validated: true },
    ],
    rowSecurity: 'none',
  },
])

/** The scope the fixture lives in. */
export const FIXTURE_SCOPE = { schemas: ['sales'] }
