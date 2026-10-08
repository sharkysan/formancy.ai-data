import type { DatabaseKind, Generation, NormalizedTypeKind, ObjectRef, ReferentialAction } from '@formancy/data-core'

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

export interface ExpectedObject {
  ref: ObjectRef
  kind: 'table' | 'view'
  comment?: string | null
  columns: ExpectedColumn[]
  primaryKey: string[] | null
  uniqueKeys: Record<string, string[]>
  foreignKeys: ExpectedForeignKey[]
  checks: string[]
}

const sales = (name: string): ObjectRef => ({ schema: 'sales', name })

const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const INT64 = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const
const text = (maxLength: number | null, fixedLength = false): ExpectedType => ({ kind: 'text', maxLength, fixedLength })
const decimal = (precision: number, scale: number): ExpectedType => ({ kind: 'decimal', precision, scale })

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
      { name: 'id', type: INT32, nullable: false, generated: 'identity' },
      { name: 'iso_code', type: text(2, true), nullable: false },
      { name: 'name', type: text(100), nullable: false },
      { name: 'flag', type: { kind: 'binary', maxLength: null }, nullable: true },
      // point and geography: a type with no codec is reported, not dropped.
      { name: 'shape', type: { kind: 'unsupported' }, nullable: true },
    ],
    primaryKey: ['id'],
    uniqueKeys: { uq_country_iso_code: ['iso_code'] },
    foreignKeys: [],
    checks: [],
  },
  {
    ref: sales('customer'),
    kind: 'table',
    comment: 'A buyer, numbered within its tenant.',
    columns: [
      { name: 'tenant_id', type: INT32, nullable: false, generated: 'none' },
      { name: 'customer_no', type: INT32, nullable: false },
      // Two hundred characters on both engines, though SQL Server's catalog says 400 bytes.
      { name: 'name', type: text(200), nullable: false },
      { name: 'country_code', type: text(2, true), nullable: true },
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
  },
  {
    ref: sales('customer_summary'),
    kind: 'view',
    columns: [{ name: 'tenant_id' }, { name: 'customer_no' }, { name: 'name' }, { name: 'order_count' }],
    primaryKey: null,
    uniqueKeys: {},
    foreignKeys: [],
    checks: [],
  },
  {
    ref: sales('employee'),
    kind: 'table',
    columns: [
      { name: 'id', type: INT32, nullable: false, generated: 'none' },
      { name: 'name', type: text(200), nullable: false },
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
  },
  {
    ref: sales('order'),
    kind: 'table',
    columns: [
      { name: 'id', type: INT64, nullable: false, generated: 'identity' },
      { name: 'tenant_id', type: INT32, nullable: false },
      { name: 'customer_no', type: INT32, nullable: false },
      { name: 'order_date', type: { kind: 'date' }, nullable: false },
      { name: 'status', type: text(20), nullable: false, hasDefault: true },
      { name: 'amount', type: decimal(18, 4), nullable: false },
      { name: 'notes', type: text(null), nullable: true },
      { name: 'group', type: text(50), nullable: true },
      { name: 'created_by', type: INT32, nullable: true },
      { name: 'approved_by', type: INT32, nullable: true },
      {
        name: 'row_version',
        nullable: false,
        // The one place the two engines are deliberately different: PostgreSQL
        // has no rowversion, so the fixture uses an application-maintained
        // version column there.
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
    checks: ['ck_order_status'],
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
      { name: 'line_total', type: { kind: 'decimal' }, generated: 'computed' },
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
  },
])

/** The scope the fixture lives in. */
export const FIXTURE_SCOPE = { schemas: ['sales'] }
