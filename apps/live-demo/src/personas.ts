/*
 * The people a visitor signs in as, and what each may do.
 *
 * ROLE_GRANTS is the one statement of it. image/forms.ts derives each
 * form's policy operations from it, the server refuses a grant a form does
 * not offer when the image's build publishes (validatePolicy), and
 * image/publish.integration.test.ts reads each persona's menu back from the
 * real server against it. The sentence the page shows for a persona is
 * derived from it here, so the page cannot say a persona does what the
 * policy does not grant.
 *
 * Names after the getting-started guide's clerks, no surnames. No
 * administrator: the running container has no administrator's plane.
 */
import type { PolicyOperation } from '@formancy/data-core'
import { TENANTS } from './data/model.js'
import type { Tenant } from './data/model.js'

/** The forms the image publishes, by id, in the order a sentence names them, with what it calls their records. */
export const DEMO_FORMS = [
  { id: 'customer', records: 'customers' },
  { id: 'order', records: 'orders' },
  { id: 'order-line', records: 'order lines' },
  { id: 'delivery', records: 'deliveries' },
] as const

export type DemoFormId = (typeof DEMO_FORMS)[number]['id']

/** What one role may do on each form. */
export type FormGrants = Readonly<Record<DemoFormId, readonly PolicyOperation[]>>

export type DemoRole = 'clerk' | 'auditor'

/**
 * Each role's title and grants. A clerk does what each form offers -- the
 * customer form offers no update or delete and the order-line form no
 * delete, as the generator notes for this database -- and an auditor reads.
 */
export const ROLE_GRANTS: Readonly<Record<DemoRole, { title: string; may: FormGrants }>> = {
  clerk: {
    title: 'Order clerk',
    may: {
      customer: ['read', 'create'],
      order: ['read', 'create', 'update', 'delete'],
      'order-line': ['read', 'create', 'update'],
      delivery: ['read', 'create', 'update', 'delete'],
    },
  },
  auditor: {
    title: 'Auditor',
    may: { customer: ['read'], order: ['read'], 'order-line': ['read'], delivery: ['read'] },
  },
}

export interface Persona {
  /** The token's subject, and what the page's sign-in sends. */
  id: string
  name: string
  roles: readonly DemoRole[]
  tenant: Tenant
  /** What the page says this person may do: describeGrants of their role. */
  description: string
}

const VERBS = { create: 'adds', update: 'changes', delete: 'deletes' } as const
const WRITES = ['create', 'update', 'delete'] as const

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`
}

/**
 * The sentence for a role's grants in one tenant: what it reads, then each
 * set of changes with the records it makes them to, in DEMO_FORMS' order.
 */
export function describeGrants(title: string, may: FormGrants, tenant: Tenant): string {
  const others = TENANTS.filter((other) => other !== tenant).map((other) => `tenant ${String(other)}'s`)
  const read = DEMO_FORMS.filter((form) => may[form.id].includes('read')).map((form) => form.records)
  const changes = new Map<string, string[]>()
  for (const form of DEMO_FORMS) {
    const verbs = WRITES.filter((operation) => may[form.id].includes(operation)).map((operation) => VERBS[operation])
    if (verbs.length > 0) changes.set(listed(verbs), [...(changes.get(listed(verbs)) ?? []), form.records])
  }
  const clauses = [`reads tenant ${String(tenant)}'s ${listed(read)}, and nothing of ${listed(others)}`]
  for (const [verbs, records] of changes) clauses.push(`${verbs} ${listed(records)}`)
  if (changes.size === 0) clauses.push('changes nothing')
  return `${title} of tenant ${String(tenant)}: ${clauses.join('; ')}.`
}

function persona(id: string, name: string, role: DemoRole, tenant: Tenant): Persona {
  return { id, name, roles: [role], tenant, description: describeGrants(ROLE_GRANTS[role].title, ROLE_GRANTS[role].may, tenant) }
}

/** Two clerks, one per tenant, so isolation is something a visitor sees, and an auditor, so is a refused write. */
export const PERSONAS: readonly Persona[] = [persona('clara', 'Clara', 'clerk', 1), persona('otto', 'Otto', 'clerk', 2), persona('vera', 'Vera', 'auditor', 1)]
