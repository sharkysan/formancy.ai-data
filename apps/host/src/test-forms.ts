import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import type { Engine } from './test-plane.js'

/*
 * What the forms `startPlane` publishes are published with, for tenant 1's
 * clerk: each form's policy, derived from the bindings its proposal
 * answered, and the child forms of `ENGINES` -- their tables, the lookups
 * the generator makes of their foreign keys and the labels a person gave
 * two of them in the studio. test-plane.ts starts the server and publishes
 * them.
 */

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
  policy: (bindings: Proposed) => FormPolicy
}

/**
 * What each child form of `ENGINES` is published with: an order's lines,
 * employees and orders by who created and approved them, and -- with
 * `deliveries` -- an order's deliveries, the one child form a person may
 * update whose records a crumb names by a field (0090): its carrier.
 */
export function childForms(engine: Engine, { deletes, deliveries }: { deletes: boolean; deliveries: boolean }): ChildPublication[] {
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
            // No delete: one takes its parcels with it, a cascade this policy does not accept (0051).
            policy: (bindings: Proposed): FormPolicy => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings), lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] } }),
          },
        ]
      : []),
  ]
}
