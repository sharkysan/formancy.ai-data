import { bindingsVersionProblem, createSnapshot, findObject, validatePolicy } from '@formancy/data-core'
import type { FormBindings, FormPolicy, MetadataSnapshot, ObjectMeta, ObjectRef } from '@formancy/data-core'
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
 * - the bindings must be a version this release reads — one published before
 *   0027 cannot say which operation a field is written on, and is republished;
 * - every bound field must exist in the form, and the policy must fit the
 *   bindings (`validatePolicy`), so a rule nobody enforces cannot be published;
 * - every column a row filter compares — the root's, and each lookup's on its
 *   target — must be one the snapshot's account may read (0027), or every
 *   request the filter scopes fails with permission-denied.
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

  let wellFormed = false
  try {
    const { fingerprint, ...rest } = snapshot
    if (createSnapshot(rest).fingerprint !== fingerprint) {
      problems.push('the snapshot does not hash to its own fingerprint: it was edited after it was taken')
    }
    wellFormed = true
  } catch (error) {
    problems.push(`the snapshot is not one a catalog could produce: ${(error as Error).message}`)
  }

  // Before the policy: fitting it reads what each field writes per operation,
  // which a version-1 file does not say.
  const version = bindingsVersionProblem(bindings.version)
  if (version !== null) {
    problems.push(version)
    return { ok: false, problems }
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
  if (wellFormed) problems.push(...unreadableFilters(snapshot, bindings, policy))

  return problems.length === 0 ? { ok: true, bundle: document as unknown as PublishedBundle } : { ok: false, problems }
}

/** The filter rules of a policy as stored, whatever shape a hand edit left them in; `validatePolicy` reports a bad shape. */
function rulesOf(value: unknown): Array<{ column: string }> {
  return Array.isArray(value) ? value.filter((rule): rule is { column: string } => isRecord(rule) && typeof rule['column'] === 'string') : []
}

/**
 * Row filters on columns the snapshot's account may not read (0027). The
 * root's filter is the WHERE of every read and update and is written on every
 * create; a lookup's is the WHERE of every search on its target. Either way
 * the database refuses the statement, so the policy cannot be applied by this
 * connection, and saying so at publish is cheaper than at every request. A
 * root filter column the account may not INSERT refuses every create in the
 * same way, so it is a problem while the form offers create.
 */
function unreadableFilters(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string[] {
  const problems: string[] = []
  const unreadable = (where: string, ref: ObjectRef, rules: Array<{ column: string }>) => {
    const object: ObjectMeta | undefined = findObject(snapshot, ref)
    for (const { column } of rules) {
      if (object?.columns.find((candidate) => candidate.name === column)?.access.select === false) {
        problems.push(`policy: ${where} ${column} is a column this connection's account may not read`)
      }
    }
  }
  unreadable('rowFilters', bindings.root, rulesOf(policy.rowFilters))
  // The planner writes every root filter column from the context on create.
  if (isRecord(bindings.operations) && bindings.operations.create === true) {
    const root = findObject(snapshot, bindings.root)
    for (const { column } of rulesOf(policy.rowFilters)) {
      if (root?.columns.find((candidate) => candidate.name === column)?.access.insert === false) {
        problems.push(`policy: rowFilters ${column} is a column this connection's account may not insert, and every create writes it`)
      }
    }
  }
  const lookups: Record<string, unknown> = isRecord(policy.lookups) ? policy.lookups : {}
  for (const binding of Array.isArray(bindings.fields) ? bindings.fields : []) {
    if (binding.kind === 'lookup') unreadable(`lookups.${binding.field}`, binding.target.table, rulesOf(lookups[binding.field]))
  }
  return problems
}
