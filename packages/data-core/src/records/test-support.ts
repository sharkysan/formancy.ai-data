import type { DatabaseKind } from '../adapter.js'
import { generateForm } from '../generate/generate.js'
import type { FieldBinding, FormBindings, GeneratedForm } from '../generate/types.js'
import type { ColumnAccess, ColumnMeta, DiscoveryAccount, ForeignKeyMeta, MetadataSnapshot, NormalizedType, ObjectMeta, ObjectRef, TextLengthUnit } from '../metadata.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { createSnapshot } from '../snapshot.js'
import type { RecordColumn, RecordValue } from './types.js'

/*
 * What the request planner's tests share, and nothing else uses: it is not
 * exported from the package, and the build, whose entry is index.ts, never
 * reaches it.
 *
 * The fixture's sales schema as discovery reports it — @formancy/data-fixtures'
 * model, restated because data-core cannot depend on that package — with two
 * additions the fixture lacks: an employee belongs to a tenant, so a lookup
 * keyed by a surrogate id is per tenant, the case the planner cannot see
 * into; and an order has a nullable `paid` flag, the three-state boolean.
 * Bindings are what the real generator makes of it.
 */
export const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
export const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
export const DATE: NormalizedType = { kind: 'date' }
export const BOOLEAN: NormalizedType = { kind: 'boolean' }
export const AMOUNT: NormalizedType = { kind: 'decimal', precision: 18, scale: 4 }
// One length unit for every text: these suites test planning, not units, which codec.test.ts covers (0026).
export const text = (maxLength: number | null, fixedLength = false, lengthUnit: TextLengthUnit = 'utf16-code-units'): NormalizedType => ({ kind: 'text', maxLength, lengthUnit, fixedLength })

/** 2^53 + 1, the fixture's sales.order.id. */
export const ORDER_ID = '9007199254740993'
export const ORDER_TOKEN = `k1:${ORDER_ID}`

export const sales = (name: string): ObjectRef => ({ schema: 'sales', name })

/** Everything an owner may do: the default, so a test narrows only the privilege it is about (0027). */
export const FULL_ACCESS: ColumnAccess = { select: true, insert: true, update: true }

export function col(name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { ...FULL_ACCESS }, ...extra }
}

/** Narrow what the account may do with one column of one table, as a revoked grant would. */
export function restrict(objects: ObjectMeta[], table: string, column: string, access: Partial<ColumnAccess>): void {
  const found = objects.find((object) => object.ref.name === table)?.columns.find((candidate) => candidate.name === column)
  if (found === undefined) throw new Error(`the fixture has no ${table}.${column}`)
  found.access = { ...found.access, ...access }
}

export function fk(name: string, columns: string[], target: string, targetColumns: string[]): ForeignKeyMeta {
  return { name, columns, references: { table: sales(target), columns: targetColumns }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }
}

export function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return { ref: sales(name), kind: 'table', comment: null, columns, primaryKey: null, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none', ...extra }
}

export const OWNER: DiscoveryAccount = { user: 'owner', login: 'owner' }

export function snapshot(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}, account: DiscoveryAccount = OWNER): MetadataSnapshot {
  const objects: ObjectMeta[] = [
    table('country', [col('id', 1, INT32, { generated: 'identity-always' }), col('iso_code', 2, text(2, true)), col('name', 3, text(100))], {
      primaryKey: { name: 'pk_country', columns: ['id'] },
      uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }],
    }),
    table(
      'customer',
      [
        col('tenant_id', 1, INT32),
        col('customer_no', 2, INT32),
        col('name', 3, text(200)),
        col('country_code', 4, text(2, true), { nullable: true }),
        col('credit_limit', 5, { kind: 'decimal', precision: 14, scale: 2 }, { nullable: true }),
        col('active', 6, BOOLEAN, { hasDefault: true }),
        col('created_at', 7, { kind: 'timestamp', withTimeZone: true, precision: 6 }, { hasDefault: true }),
      ],
      { primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] }, foreignKeys: [fk('fk_customer_country', ['country_code'], 'country', ['iso_code'])] },
    ),
    table('employee', [col('id', 1, INT32), col('tenant_id', 2, INT32), col('name', 3, text(200)), col('manager_id', 4, INT32, { nullable: true })], {
      primaryKey: { name: 'pk_employee', columns: ['id'] },
    }),
    table(
      'order',
      [
        col('id', 1, INT64, { generated: 'identity-always' }),
        col('tenant_id', 2, INT32),
        col('customer_no', 3, INT32),
        col('order_date', 4, DATE),
        col('status', 5, text(20), { hasDefault: true }),
        col('amount', 6, AMOUNT),
        col('notes', 7, text(null), { nullable: true }),
        col('group', 8, text(50), { nullable: true }),
        col('created_by', 9, INT32, { nullable: true }),
        col('approved_by', 10, INT32, { nullable: true }),
        col('paid', 11, BOOLEAN, { nullable: true }),
        kind === 'sqlserver' ? col('row_version', 12, { kind: 'rowversion' }, { generated: 'rowversion' }) : col('row_version', 12, INT64, { hasDefault: true }),
      ],
      {
        primaryKey: { name: 'pk_order', columns: ['id'] },
        foreignKeys: [
          fk('fk_order_customer', ['tenant_id', 'customer_no'], 'customer', ['tenant_id', 'customer_no']),
          fk('fk_order_created_by', ['created_by'], 'employee', ['id']),
          fk('fk_order_approved_by', ['approved_by'], 'employee', ['id']),
        ],
      },
    ),
    table('customer_summary', [col('tenant_id', 1, INT32), col('customer_no', 2, INT32), col('order_count', 3, INT64)], { kind: 'view' }),
  ]
  edit(objects)
  return createSnapshot({ kind, serverVersion: 'x', account, scope: { schemas: ['sales'] }, objects, gaps: [] })
}

/** The order form: the customer and the creating employee as lookups; on PostgreSQL the version column confirmed, as an administrator would. */
export function orderForm(source: MetadataSnapshot, confirm = true): GeneratedForm {
  return generateForm(source, {
    connection: 'erp',
    root: sales('order'),
    formId: 'sales-order',
    title: 'Order',
    lookups: [
      { foreignKey: 'fk_order_customer', display: ['name'] },
      { foreignKey: 'fk_order_created_by', display: ['name'] },
    ],
    ...(source.kind === 'postgres' && confirm ? { versionColumn: 'row_version' } : {}),
  })
}

/** A customer table with a rowversion, so its form — whose key is a field a person types — offers update. */
export function customerSource(): MetadataSnapshot {
  return snapshot('sqlserver', (objects) => {
    objects.find((object) => object.ref.name === 'customer')?.columns.push(col('row_version', 8, { kind: 'rowversion' }, { generated: 'rowversion' }))
  })
}

export function customerForm(source: MetadataSnapshot): GeneratedForm {
  return generateForm(source, {
    connection: 'erp',
    root: sales('customer'),
    formId: 'sales-customer',
    title: 'Customer',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
  })
}

export const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
export const CLERK_RW = { read: ['clerk'], write: ['clerk'] }

/** Clerks do everything; an auditor reads some fields; an intake role creates and never reads. */
export const ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'auditor'], create: ['clerk', 'intake'], update: ['clerk'] },
  fields: {
    id: { read: ['clerk', 'auditor'], write: [] },
    customer: { read: ['clerk'], write: ['clerk', 'intake'] },
    order_date: { read: ['clerk', 'auditor'], write: ['clerk', 'intake'] },
    status: { read: ['clerk', 'auditor'], write: ['clerk'] },
    amount: { read: ['clerk'], write: ['clerk', 'intake'] },
    notes: CLERK_RW,
    group: CLERK_RW,
    employee: CLERK_RW,
    approved_by: CLERK_RW,
    paid: CLERK_RW,
  },
  rowFilters: TENANT,
  lookups: { customer: TENANT, employee: TENANT },
}

export const CUSTOMER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: {
    tenant_id: { read: ['clerk'], write: [] },
    customer_no: CLERK_RW,
    name: CLERK_RW,
    country: CLERK_RW,
    credit_limit: CLERK_RW,
    active: CLERK_RW,
    created_at: { read: ['clerk'], write: [] },
  },
  rowFilters: TENANT,
  lookups: { country: [] },
}

export const actor = (roles: string[], attributes: Record<string, string> = { tenant: '1' }): PolicyContext => ({ actor: { id: 'u-1', roles }, attributes })
export const CLERK = actor(['clerk'])
export const AUDITOR = actor(['auditor'])
export const INTAKE = actor(['intake'])

export const column = (name: string, type: NormalizedType): RecordColumn => ({ name, type })
export const value = (name: string, type: NormalizedType, held: RecordValue['value']): RecordValue => ({ name, type, value: held })
export const TENANT_ONE = { kind: 'restricted', equal: [{ column: 'tenant_id', value: '1' }] } as const

/** Every order column a clerk may see, in catalog order: the key, then the columns of every field the policy lets them read. */
export const CLERK_COLUMNS = [
  column('id', INT64),
  column('tenant_id', INT32),
  column('customer_no', INT32),
  column('order_date', DATE),
  column('status', text(20)),
  column('amount', AMOUNT),
  column('notes', text(null)),
  column('group', text(50)),
  column('created_by', INT32),
  column('approved_by', INT32),
  column('paid', BOOLEAN),
]
export const CLERK_FIELDS = ['id', 'customer', 'order_date', 'status', 'amount', 'notes', 'group', 'employee', 'approved_by', 'paid']

export const ORDER_TARGET = {
  postgres: { table: sales('order'), identity: [column('id', INT64)], concurrency: { kind: 'version-column', column: 'row_version' } },
  sqlserver: { table: sales('order'), identity: [column('id', INT64)], concurrency: { kind: 'rowversion', column: 'row_version' } },
} as const

/** A copy to change, as a stored file can be changed, so one test's edit never reaches another's bindings. */
export function edited(bindings: FormBindings, change: (draft: FormBindings) => void): FormBindings {
  const draft = JSON.parse(JSON.stringify(bindings)) as FormBindings
  change(draft)
  return draft
}

/** The binding for a field key. A key the form lacks fails the test that asked, at its first use. */
export function fieldOf(bindings: FormBindings, key: string): FieldBinding {
  return bindings.fields.find((binding) => binding.field === key) as FieldBinding
}

export const PG = snapshot('postgres')
export const PG_ORDER = orderForm(PG).bindings
export const MS = snapshot('sqlserver')
export const MS_ORDER = orderForm(MS).bindings

/** An order keyed by a timestamp: a key the generator accepts and no token can carry. */
export const STAMPED = snapshot('postgres', (objects) => {
  const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
  order.primaryKey = { name: 'pk_order', columns: ['created_at'] }
  order.columns.push(col('created_at', 13, { kind: 'timestamp', withTimeZone: true, precision: 6 }, { hasDefault: true }))
})

/** What a clerk enters for a new order: every kind of answer the form produces. */
export const ANSWERS = {
  customer: 'k1:1,1001',
  order_date: '2026-10-08',
  amount: '99999999999999.9999',
  notes: null,
  group: 'A',
  employee: 'k1:1',
  approved_by: 2,
  paid: 'true',
}
