import { createSnapshot, validatePolicy } from '@formancy/data-core'
import type { FormBindings, FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'

/**
 * Everything one published version of a form needs at runtime, as one
 * immutable document in the configuration store (0013).
 *
 * The four concerns plan section 9 keeps apart travel together here and stay
 * separate inside: the portable formancy document, the database bindings, the
 * access policy, and the snapshot the bindings were generated from — which the
 * request planner reads column types from and drift review compares against.
 */
export interface PublishedBundle {
  format: 1
  /** The connection the form is bound to, by the name the deployment's allowlist gives it. */
  connection: string
  form: FormSchema
  bindings: FormBindings
  policy: FormPolicy
  snapshot: MetadataSnapshot
}

export type BundleValidation = { ok: true; bundle: PublishedBundle } | { ok: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a document can be served as a published form, with every reason it
 * cannot.
 *
 * Run on publish and again on every read from the store, because the store is
 * files on a volume and a file can be edited by hand (0013). Each check is one
 * a hand edit could break silently:
 *
 * - the form must be one formancy's own validator accepts;
 * - the snapshot must still hash to its own fingerprint — an edited column
 *   type would otherwise reach the planner, which trusts it;
 * - the bindings must have been generated from that snapshot;
 * - every bound field must exist in the form, and the policy must fit the
 *   bindings (`validatePolicy`), so a rule nobody enforces cannot be published.
 */
export function validateBundle(document: unknown): BundleValidation {
  if (!isRecord(document)) return { ok: false, problems: ['a bundle is an object'] }
  const problems: string[] = []
  if (document['format'] !== 1) problems.push('format must be 1')
  if (typeof document['connection'] !== 'string' || document['connection'] === '') problems.push('connection must name a connection')

  const form = validateSchema(document['form'])
  if (!form.valid) problems.push(...form.errors.map((error) => `form: ${error.message}`))

  const snapshot = document['snapshot'] as MetadataSnapshot | undefined
  const bindings = document['bindings'] as FormBindings | undefined
  const policy = document['policy'] as FormPolicy | undefined
  if (!isRecord(snapshot) || !isRecord(bindings) || !isRecord(policy)) {
    problems.push('snapshot, bindings and policy must all be present')
    return { ok: false, problems }
  }

  try {
    const { fingerprint, ...rest } = snapshot
    if (createSnapshot(rest).fingerprint !== fingerprint) {
      problems.push('the snapshot does not hash to its own fingerprint: it was edited after it was taken')
    }
  } catch (error) {
    problems.push(`the snapshot is not one a catalog could produce: ${(error as Error).message}`)
  }

  if (bindings.snapshotFingerprint !== snapshot.fingerprint) {
    problems.push('the bindings were not generated from this snapshot')
  }

  if (form.valid && Array.isArray(bindings.fields)) {
    const keys = new Set(form.schema.model.fields.map((field) => field.key))
    for (const binding of bindings.fields) {
      if (!keys.has(binding.field)) problems.push(`the bindings name ${binding.field}, which the form does not have`)
    }
  }

  const fitted = validatePolicy(policy, bindings)
  if (!fitted.ok) problems.push(...fitted.problems.map((problem) => `policy: ${problem}`))

  return problems.length === 0 ? { ok: true, bundle: document as unknown as PublishedBundle } : { ok: false, problems }
}
