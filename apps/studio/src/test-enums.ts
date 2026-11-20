import { createSnapshot } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'

/*
 * The owner's snapshot with the order's status a PostgreSQL enum (0170),
 * for the Policy step's state field over one. Made here, never captured:
 * the sales fixture spells a status as text under a check, and the states
 * schema whose enums the adapter's suites discover is no part of the
 * captures. What PostgreSQL discovery makes of an enum column is held by
 * `packages/data-postgres/src/states.integration.test.ts`.
 */

/** The labels of `sales.order_status`, in the type's order: the values the fixture's check lists. */
export const ORDER_STATUS_LABELS = ['draft', 'placed', 'shipped'] as const

/** `base` with `sales.order.status` of the enum `sales.order_status`, defaulting to its first label, and the check that listed its text gone. */
export function withEnumStatus(base: MetadataSnapshot): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const order = contents.objects.find((object) => object.ref.schema === 'sales' && object.ref.name === 'order')
  const status = order?.columns.find((column) => column.name === 'status')
  if (order === undefined || status === undefined) throw new Error('the snapshot has no sales.order.status')
  status.databaseType = 'sales.order_status'
  status.type = { kind: 'enum', name: { schema: 'sales', name: 'order_status' }, labels: [...ORDER_STATUS_LABELS] }
  status.defaultExpression = "'draft'::sales.order_status"
  order.checks = order.checks.filter((check) => check.name !== 'ck_order_status')
  return createSnapshot(contents)
}
