import { bindingsVersionProblem, createSnapshot, findObject, rowFilterColumnProblem, throughProblems, validatePolicy } from '@formancy/data-core'
import type { FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot, ObjectRef, PresentationOverrides } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { format2Problems } from './bundle-format2.js'
import { servedSchema } from './served-schema.js'

/**
 * Everything one published version of a form needs at runtime, as one
 * immutable document in the configuration store (0013).
 *
 * The four concerns plan section 9 keeps apart travel together here and stay
 * separate inside: the portable formancy document, the database bindings, the
 * access policy, and the snapshot the bindings were generated from — which the
 * request planner reads column types from and drift review compares against.
 */
interface BundleParts {
  /** The connection the form is bound to, by the name the deployment's allowlist gives it. */
  connection: string
  form: FormSchema
  bindings: FormBindings
  policy: FormPolicy
  snapshot: MetadataSnapshot
}

/** Published before 0030: served as it is; it kept no base, so a regeneration cannot carry its presentation. */
export interface BundleV1 extends BundleParts {
  format: 1
}

/**
 * Since 0030. `form` is `applyPresentation(base, presentation, bindings)`;
 * `base` and `bindings` are `generateForm(snapshot, generation)`'s, which is
 * checked at publish (`generatedProblems`) and not on read.
 */
export interface BundleV2 extends BundleParts {
  format: 2
  generation: GenerationRequest
  base: FormSchema
  presentation: PresentationOverrides
}

export type PublishedBundle = BundleV1 | BundleV2

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
 * - the form must be one formancy's own validator accepts, in the spec
 *   version the generator writes (`servedSchema`, 0042) -- the validator
 *   alone accepts every version its release speaks;
 * - the snapshot must still hash to its own fingerprint — an edited column
 *   type would otherwise reach the planner, which trusts it;
 * - the bindings must have been generated from that snapshot;
 * - the bindings must be a version this release reads — one published before
 *   0027 cannot say which operation a field is written on, and is republished;
 * - every bound field must exist in the form, and the policy must fit the
 *   bindings and the snapshot (`policyProblems`), so a rule nobody enforces
 *   cannot be published;
 * - in format 2 (0030), the form must be its base with its presentation
 *   applied, and the generation request the one this server would store and
 *   the one its base and bindings say they came from (`bundle-format2.ts`).
 *
 * Format 1 is still read, so every version published before 0030 is served.
 */
export function validateBundle(document: unknown): BundleValidation {
  if (!isRecord(document)) return { ok: false, problems: ['a bundle is an object'] }
  const problems: string[] = []
  const format = document['format']
  if (format !== 1 && format !== 2) problems.push('format must be 1 or 2')
  if (typeof document['connection'] !== 'string' || document['connection'] === '') problems.push('connection must name a connection')

  const form = servedSchema('form', document['form'])
  if (!form.valid) problems.push(...form.problems)

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

  // A snapshot no catalog could produce cannot be searched for filter columns.
  if (wellFormed) problems.push(...policyProblems(snapshot, bindings, policy))
  else problems.push(...fitProblems(policy, bindings))
  if (format === 2 && form.valid && Array.isArray(bindings.fields)) problems.push(...format2Problems(document, form.schema, bindings, wellFormed ? snapshot : null))

  return problems.length === 0 ? { ok: true, bundle: document as unknown as PublishedBundle } : { ok: false, problems }
}

/**
 * Everything a policy does not fit: the bindings (`validatePolicy`), the
 * snapshot's columns a row filter compares (`unfilterableColumns`), and what
 * the snapshot says of each lookup a through names (`throughProblems`, 0043),
 * which the planner asks too. One function for the bundle check and for the
 * regeneration route's report, so the two cannot disagree about one policy.
 */
export function policyProblems(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string[] {
  return [
    ...fitProblems(policy, bindings),
    ...unfilterableColumns(snapshot, bindings, policy),
    ...throughProblems(snapshot, bindings, policy).map((problem) => `policy: ${problem}`),
  ]
}

function fitProblems(policy: FormPolicy, bindings: FormBindings): string[] {
  const fitted = validatePolicy(policy, bindings)
  return fitted.ok ? [] : fitted.problems.map((problem) => `policy: ${problem}`)
}

/** The filter rules of a policy as stored, whatever shape a hand edit left them in; `validatePolicy` reports a bad shape. */
function rulesOf(value: unknown): Array<{ column: string }> {
  return Array.isArray(value) ? value.filter((rule): rule is { column: string } => isRecord(rule) && typeof rule['column'] === 'string') : []
}

/**
 * Row filter columns a filter cannot compare, as `rowFilterColumnProblem`
 * names them: absent, not readable by the snapshot's account (0027), or of a
 * kind with no spelling both engines compare alike — a boolean, a float, a
 * time or a timestamp (0028). The root's filter is the WHERE of every read
 * and update and is written on every create; a lookup's is the WHERE of every
 * search on its target. Either way the planner refuses every request it
 * scopes, so saying so at publish is cheaper than at every request. A root
 * filter column the account may not INSERT refuses every create in the same
 * way, so it is a problem while the form offers create.
 */
function unfilterableColumns(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string[] {
  const problems: string[] = []
  const unfilterable = (where: string, ref: ObjectRef, rules: Array<{ column: string }>) => {
    const object = findObject(snapshot, ref)
    // A table outside the snapshot is the bindings' problem, reported as such.
    if (object === undefined) return
    for (const { column } of rules) {
      const problem = rowFilterColumnProblem(object, column)
      if (problem !== null) problems.push(`policy: ${where} ${problem}`)
    }
  }
  unfilterable('rowFilters', bindings.root, rulesOf(policy.rowFilters))
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
    if (binding.kind === 'lookup') unfilterable(`lookups.${binding.field}`, binding.target.table, rulesOf(lookups[binding.field]))
  }
  return problems
}
