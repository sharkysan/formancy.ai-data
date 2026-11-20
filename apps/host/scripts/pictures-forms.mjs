// The forms the host page's README pictures publish (0038), each through
// the administrator plane as ada, from the proposal the server answers and a
// policy derived from its bindings, as the getting-started guide derives its
// own (`fieldsFromOperations`):
//
// - `pg-order`, journey.json's first form, as the guide publishes it, when
//   the plane starts;
// - `pg-order-delete`, the getting-started job's second form, journey.json's
//   `deleting` -- pg-order with delete granted to whoever may read and every
//   key a delete of an order acts through named (0051) -- when host-delete's
//   scene starts;
// - when host-record-tabs' scene starts, `pg-order` again as version 2,
//   with ONLINE, a list view an administrator named, in its presentation
//   (0105), and `pg-delivery`, an order's deliveries: the one child table
//   the order form's own account may read, where it may not read
//   sales.order_line (0142).
//
// Every bundle's form is its base: a presentation of views alone leaves the
// form as the generator made it (0030, 0105), which the server checks.

import journey from '../../../scripts/getting-started/journey.json' with { type: 'json' }
import { EMPTY_PRESENTATION, fieldsFromOperations } from '../../../scripts/getting-started/journey.mjs'

export const [FORM] = journey.forms

/** The guide's request for the order form, as `formId`. */
export const orderRequest = (formId = FORM.formId) => {
  const { connection, root, title, lookups, pinned, versionColumn } = FORM
  return { connection, root, formId, title, lookups, pinned, versionColumn }
}

/** The guide's policy, its fields filled from the operations. */
export const guidePolicy = (bindings) => ({ version: 1, ...journey.policy, fields: fieldsFromOperations(journey.policy, bindings) })

/** The getting-started job's second form's policy: delete granted to whoever may read, and the keys it acts through named. */
export const deletingPolicy = (bindings) => ({
  ...guidePolicy(bindings),
  operations: { ...journey.policy.operations, delete: [...journey.policy.operations.read] },
  cascades: journey.deleting.cascades,
})

/**
 * The order form's one list view, its default: the orders taken online,
 * newest first. The fixture's edge-case order is in group A, so the view's
 * list is the invented orders alone, which the workspace's act holds.
 */
export const ONLINE = {
  name: 'Online orders',
  filter: [{ field: 'group', op: 'equals', value: 'Online' }],
  sort: [{ field: 'order_date', direction: 'desc' }],
  default: true,
}

/** The order form's presentation in version 2: ONLINE, and nothing else. */
export const VIEWED = { ...EMPTY_PRESENTATION, views: [ONLINE] }

/** The deliveries' form: an order's child, its tenant pinned from the token as the order's is, and its order one of that tenant's. */
export const DELIVERY = {
  connection: FORM.connection,
  root: { schema: 'sales', name: 'delivery' },
  formId: 'pg-delivery',
  title: 'Delivery',
  lookups: [{ foreignKey: 'fk_delivery_order', display: ['order_date'] }],
  pinned: ['tenant_id'],
  versionColumn: 'row_version',
}

/** The deliveries' policy: the guide's operations and row filter, and the order list filtered to the person's tenant. */
export const deliveryPolicy = (bindings) => {
  const policy = { ...journey.policy, lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] } }
  return { version: 1, ...policy, fields: fieldsFromOperations(policy, bindings) }
}

/**
 * `request` proposed as the administrator `token` holds, and published over
 * `expectedBase` with the policy `policyOf` derives from its bindings and
 * `presentation`; refused, with the server's answer, unless the proposal
 * answers 200 and the publish 201.
 */
export async function publish(server, token, request, { policyOf, presentation = EMPTY_PRESENTATION, expectedBase = null }) {
  const headers = { authorization: `Bearer ${token}` }
  const proposal = await server.inject({ method: 'POST', url: '/v1/form-proposals', headers, payload: request })
  if (proposal.statusCode !== 200) throw new Error(`the proposal for ${request.formId} answered ${String(proposal.statusCode)}: ${proposal.body}`)
  const { form, bindings, snapshot, generation } = proposal.json()
  const bundle = { format: 2, connection: request.connection, generation, base: form, presentation, form, bindings, policy: policyOf(bindings), snapshot }
  const published = await server.inject({ method: 'POST', url: `/v1/forms/${request.formId}/versions`, headers, payload: { expectedBase, bundle } })
  if (published.statusCode !== 201) throw new Error(`publishing ${request.formId} answered ${String(published.statusCode)}: ${published.body}`)
}
