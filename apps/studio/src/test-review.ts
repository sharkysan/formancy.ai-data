import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormPolicy, ReassignedKey } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Bundle, ProposalRequest } from './api.js'
import { TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Publication under review (0065), as the suite sets it up: drafts submitted
 * and approved through the studio's own client against a reviewed plane,
 * by the people the plane's tokens name -- never written into the store by
 * hand, so a draft a test reads is one the server accepted.
 */

/** The governance sentences, as the server words them. */
export const REVIEW_REQUIRED = 'This deployment reviews publication: submit this version as a draft, and a publisher other than you approves it.'
export const PUBLISHER_REQUIRED = "This needs a publisher role: restoring a version, and approving or rejecting someone else's draft, are a publisher's."
export const OWN_DRAFT = 'You submitted this draft: a publisher other than you approves it.'

export const ORDER: ProposalRequest = {
  connection: 'fixture',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'row_version',
}

/** Clerks read the order; `readers` changes who, which is how two drafts over one base are told apart. */
export function readOnly(readers: string[] = ['clerk']): FormPolicy {
  return { version: 1, operations: { read: readers, create: [], update: [] }, fields: {}, rowFilters: [], lookups: {} }
}

export const client = (plane: TestPlane, token: string): AdminClient => createAdminClient({ token, fetch: plane.fetch })

/** The order as the generator makes it on `plane` now, with `policy` and nothing chosen over it. */
export async function orderBundle(plane: TestPlane, policy: FormPolicy = readOnly(), request: ProposalRequest = ORDER): Promise<Bundle> {
  const proposal = await client(plane, TOKENS.admin).propose(request)
  if (!proposal.ok) throw new Error(proposal.message)
  const { form, bindings, snapshot, generation } = proposal.value
  return { format: 2, connection: request.connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot }
}

/** A draft submitted by `token` over `expectedBase`: its number. */
export async function submit(plane: TestPlane, token: string, expectedBase: number | null, bundle: Bundle, keysConfirmed?: readonly ReassignedKey[]): Promise<number> {
  const outcome = await client(plane, token).submitDraft(bundle.form.id, expectedBase, bundle, keysConfirmed)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value.draft
}

/** A version published the one way a reviewed plane publishes: submitted by an author, approved by a publisher. */
export async function publishReviewed(plane: TestPlane, expectedBase: number | null, bundle: Bundle): Promise<number> {
  const draft = await submit(plane, TOKENS.admin, expectedBase, bundle)
  const approved = await client(plane, TOKENS.publisher).approveDraft(bundle.form.id, draft)
  if (!approved.ok) throw new Error(approved.message)
  return approved.value.version
}
