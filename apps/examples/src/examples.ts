import { generateForm } from '@formancy/data-core'
import type { GeneratedForm, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'

/** One generated form and the request that produced it. */
export interface Example {
  request: GenerationRequest
  generated: GeneratedForm
}

/**
 * The connection name every request carries. A lookup's option-source name is
 * derived from it (0009), so the in-memory source is registered under whatever
 * name this produces and never under one typed separately.
 */
const CONNECTION = 'fixture'

/**
 * What the page generates: the order, which has the composite customer lookup,
 * the exact decimal at its limit and the integer past 2^53; and the customer,
 * the lookup's target, with a composite primary key and no version column.
 */
export const REQUESTS: readonly GenerationRequest[] = [
  {
    connection: CONNECTION,
    root: { schema: 'sales', name: 'order' },
    formId: 'sales-order',
    title: 'Order',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
  },
  {
    connection: CONNECTION,
    root: { schema: 'sales', name: 'customer' },
    formId: 'sales-customer',
    title: 'Customer',
    lookups: [],
  },
]

/**
 * Every example, generated from `snapshot` by `generateForm` -- here, in
 * whatever runs this, which on the page is the browser. data-core has no
 * Node dependency (formancy.ai 0008), and this is where that is used rather
 * than asserted.
 */
export function generateExamples(snapshot: MetadataSnapshot): Example[] {
  return REQUESTS.map((request) => ({ request, generated: generateForm(snapshot, request) }))
}
