import type { FieldBinding, FormPolicy, ListView } from '@formancy/data-core'
import type { Engine } from './test-plane.js'

/*
 * What the forms `startPlane` publishes are published with, for tenant 1's
 * clerk: each form's policy, derived from the bindings its proposal
 * answered, the child forms of `ENGINES` -- their tables, the lookups the
 * generator makes of their foreign keys and the labels a person gave two of
 * them in the studio -- and, with `views`, the list views an administrator
 * named (0105). test-plane.ts starts the server and publishes them.
 */

/**
 * What the orders a view lists are noted with: words no other file's orders
 * carry, so what a view lists is what the file that uses it made. A hyphen,
 * which no `stamp` holds.
 */
export const VIEWED = 'viewed-orders'

/**
 * The order form's views, with `views`: the grid opens on the newest of
 * the orders noted `VIEWED`, and offers the large ones, largest first. Each
 * differs from the other in its filter and its sort, so picking one asks a
 * new datasource and a new order of the grid at once (0105).
 */
export const ORDER_VIEWS: ListView[] = [
  { name: 'Marked, newest first', filter: [{ field: 'notes', op: 'contains', text: VIEWED }], sort: [{ field: 'id', direction: 'desc' }], default: true },
  {
    name: 'Marked and large',
    filter: [
      { field: 'notes', op: 'contains', text: VIEWED },
      { field: 'amount', op: 'range', from: '100', to: null },
    ],
    sort: [
      { field: 'amount', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
  },
]

/**
 * The views of the order form published again as `withheld` of `ENGINES`,
 * whose clerk may not read Amount: the default is the large orders', on
 * Amount, so it is not offered, and the clerk's grid opens on every record
 * with the other view still offered (0105).
 */
export const WITHHELD_VIEWS: ListView[] = [
  { ...(ORDER_VIEWS[1] as ListView), default: true },
  { name: 'Marked, newest first', filter: (ORDER_VIEWS[0] as ListView).filter, sort: (ORDER_VIEWS[0] as ListView).sort },
]

/** An order's deliveries' views, with `views`: the section opens on those shipped, latest first, and offers those not shipped, by carrier. */
export const DELIVERY_VIEWS: ListView[] = [
  { name: 'Shipped, latest first', filter: [{ field: 'shipped_at', op: 'not-null' }], sort: [{ field: 'shipped_at', direction: 'desc' }], default: true },
  { name: 'Not shipped', filter: [{ field: 'shipped_at', op: 'null' }], sort: [{ field: 'carrier', direction: 'asc' }] },
]

/** The keys a delete of an order acts through on the fixture, with their actions: its lines and deliveries, and the deliveries' parcels (0051, 0056). */
export const ORDER_CASCADES: NonNullable<FormPolicy['cascades']> = [
  { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'delivery' }, foreignKey: 'fk_delivery_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'parcel' }, foreignKey: 'fk_parcel_delivery', onDelete: 'cascade' },
]

/** A clerk may do everything the form offers, on the fields it writes, inside their tenant: the end-to-end journey's policy. */
export function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

/** The bindings as a proposal answers them: what the policy below is derived from. */
export interface Proposed {
  fields: FieldBinding[]
  operations: { create?: unknown; update?: unknown; delete?: unknown }
}

/** The lookup fields of a proposal, each with its foreign key. */
export const lookupsOf = (bindings: Proposed): Array<{ field: string; foreignKey: string }> =>
  bindings.fields.flatMap((binding) => (binding.kind === 'lookup' ? [{ field: binding.field, foreignKey: binding.foreignKey }] : []))

/** Each operation the form offers, granted to the clerk, unless `readOnly` -- delete only when `deletes` asks for it (0053). */
export function offered(bindings: Proposed, readOnly = false, deletes = false): FormPolicy['operations'] {
  const grant = (operation: unknown): string[] => (readOnly || operation === false || operation === undefined ? [] : ['clerk'])
  return { read: ['clerk'], create: grant(bindings.operations.create), update: grant(bindings.operations.update), ...(deletes ? { delete: grant(bindings.operations.delete) } : {}) }
}

/** One child form of `ENGINES`, as `startPlane` publishes it. */
export interface ChildPublication {
  formId: string
  title: string
  table: string
  lookups: Array<{ foreignKey: string; display: string[] }>
  versionColumn?: string
  pinned?: string[]
  labels?: Record<string, string>
  /** Its list views, in its presentation (0105). */
  views?: ListView[]
  policy: (bindings: Proposed) => FormPolicy
}

/**
 * What each child form of `ENGINES` is published with: an order's lines,
 * employees and orders by who created and approved them, and -- with
 * `deliveries` -- an order's deliveries, the one child form a person may
 * update whose records a crumb names by a field (0090): its carrier; with
 * `views` too, with `DELIVERY_VIEWS` (0105).
 */
export function childForms(engine: Engine, { deletes, deliveries, views = false }: { deletes: boolean; deliveries: boolean; views?: boolean }): ChildPublication[] {
  // On SQL Server these tables carry a rowversion, which the generator finds itself.
  const version = engine.connection === 'pg' ? { versionColumn: 'row_version' } : {}
  return [
    {
      formId: engine.lines,
      title: 'Order line',
      table: 'order_line',
      lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
      ...version,
      // No tenant column of its own: its rows are its tenant's orders' lines, through the order lookup's filter (0043).
      policy: (bindings) => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings, false, deletes), rowFilters: [], lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['order'] }),
    },
    {
      formId: engine.employees,
      title: 'Employee',
      table: 'employee',
      lookups: [{ foreignKey: 'fk_employee_manager', display: ['name'] }],
      // Employees are nobody's tenant: no row filter, and a manager may be any of them.
      policy: (bindings) => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings), rowFilters: [], lookups: Object.fromEntries(lookupsOf(bindings).map(({ field }) => [field, []])) }),
    },
    {
      formId: engine.staff,
      title: 'Order',
      table: 'order',
      lookups: [
        { foreignKey: 'fk_order_created_by', display: ['name'] },
        { foreignKey: 'fk_order_approved_by', display: ['name'] },
      ],
      ...version,
      // Its tenant comes from the token, as the row filter says.
      pinned: ['tenant_id'],
      // The generator labels both lookups by their table, "Employee"; a person tells them apart.
      labels: { fk_order_created_by: 'Created by', fk_order_approved_by: 'Approved by' },
      // Read only, so the page draws a record of it with every field disabled.
      policy: (bindings) => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings, true), lookups: Object.fromEntries(lookupsOf(bindings).map(({ field }) => [field, []])) }),
    },
    ...(deliveries
      ? [
          {
            formId: engine.deliveries,
            title: 'Delivery',
            table: 'delivery',
            lookups: [{ foreignKey: 'fk_delivery_order', display: ['order_date'] }],
            ...version,
            // Its tenant comes from the token, as the row filter says, and its order is one of that tenant's.
            pinned: ['tenant_id'],
            ...(views ? { views: DELIVERY_VIEWS } : {}),
            // No delete: one takes its parcels with it, a cascade this policy does not accept (0051).
            policy: (bindings: Proposed): FormPolicy => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings), lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] } }),
          },
        ]
      : []),
  ]
}
