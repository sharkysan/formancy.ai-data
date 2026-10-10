import { createSecretKey } from 'node:crypto'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { SignJWT } from 'jose'
import type { EngineKey } from './results.js'
import { ENGINE_KEYS } from './results.js'
import { AUDIENCE, ISSUER } from './stack.js'

/*
 * Setup through the administrator's plane, as an administrator does it and
 * as the client suites' test plane does (0034): a proposal from the order
 * table with its customer lookup, published with a policy. Eight forms:
 * per engine, the tenant-filtered order form and a form with no tenant row
 * filter, each straight to the database and through the hop.
 */

/** A host token for this run's server, HS256 as a host signs one. */
export async function mintToken(secret: string, subject: string, claims: Record<string, unknown>, seconds: number): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${String(seconds)}s`)
    .sign(createSecretKey(Buffer.from(secret, 'utf8')))
}

/** The measured clerk: tenant 1, the role the policies grant. */
export const clerkClaims = { roles: ['clerk'], tid: 1 }

export type Policy = 'order' | 'order-unfiltered'

/**
 * The client suites' `clerkPolicy`, or the same with no tenant row filter
 * and no lookup filter: a form a single-tenant deployment publishes. Not the
 * tenant form with one rule removed -- `lookupProblems` refuses a lookup
 * that sets a row-filtered column unpinned -- but a different policy, which
 * the page names as such.
 */
export function policyFor(fields: readonly FieldBinding[], policy: Policy): FormPolicy {
  const tenant = [{ column: 'tenant_id', attribute: 'tenant' }]
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: policy === 'order' ? tenant : [],
    lookups: { customer: policy === 'order' ? tenant : [] },
  }
}

export interface PublishedForm {
  formId: string
  engine: EngineKey
  policy: Policy
  hop: boolean
  /** The customer lookup's source name, read from the published bindings rather than typed. */
  source: string
}

/** `<engine>[-hop]-<policy>`: `pg-order`, `ms-hop-order-unfiltered`. */
export const formIdOf = (engine: EngineKey, policy: Policy, hop: boolean): string => `${engine}${hop ? '-hop' : ''}-${policy}`

/** Publishes the eight forms; `admin` sends one request to the administrator's plane and is what the harness counts. */
export async function publishForms(admin: (path: string, body: unknown) => Promise<Record<string, unknown>>): Promise<PublishedForm[]> {
  const published: PublishedForm[] = []
  for (const engine of ENGINE_KEYS) {
    for (const hop of [false, true]) {
      for (const policy of ['order', 'order-unfiltered'] as const) {
        const formId = formIdOf(engine, policy, hop)
        const connection = `${engine}${hop ? '-hop' : ''}`
        const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
          connection,
          root: { schema: 'sales', name: 'order' },
          formId,
          title: 'Order',
          lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
          // PostgreSQL has no rowversion; the fixture's application-maintained column versions a row (0016).
          ...(engine === 'pg' ? { versionColumn: 'row_version' } : {}),
        })
        const fields = (bindings as { fields: FieldBinding[] }).fields
        const customer = fields.find((binding) => binding.field === 'customer')
        if (customer?.kind !== 'lookup') throw new Error(`${formId}'s proposal has no customer lookup`)
        await admin(`/v1/forms/${formId}/versions`, {
          expectedBase: null,
          bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy: policyFor(fields, policy), snapshot },
        })
        published.push({ formId, engine, policy, hop, source: customer.source })
      }
    }
  }
  return published
}
