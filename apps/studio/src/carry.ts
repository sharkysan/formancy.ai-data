import { fieldAnchor, grantsOnKey, presentationOf, rebasePresentation } from '@formancy/data-core'
import type { FormBindings, FormPolicy, PresentationConflict, ReassignedKey } from '@formancy/data-core'
import { canonicalize } from '@formancy/spec'
import type { FormSchema } from '@formancy/spec'
import type { Proposal } from './api.js'

/**
 * What a draft brought with it from the one before (0030), for the
 * Presentation and Policy steps to show and the Publish step to wait on.
 */
export interface Carried {
  /** Where it came from, as the panel's heading says it: "version 2", "your earlier draft", or "version 2, then your earlier draft". */
  from: string
  /**
   * The version the draft was regenerated from, which is the base its
   * publish names, so a version published in between is a conflict; `null`
   * when the base is whatever is newest when the Publish step reads it.
   */
  version: number | null
  conflicts: PresentationConflict[]
  /** Fields whose column or lookup is new in this base: the ones a label left behind may be given to. */
  fresh: string[]
  /** Keys whose grants were written for another column or lookup, and not yet kept or removed. */
  undecided: ReassignedKey[]
  /** Those kept: sent with the publish as `keysConfirmed`, without which the server refuses grants on them (0039). */
  kept: ReassignedKey[]
  /**
   * Those removed, which leaves nothing to confirm. A removal is about the
   * grants the key had: one that has grants again is asked about again
   * (`asked`), and never confirmed by having been removed.
   */
  removed: ReassignedKey[]
}

/**
 * The keys a draft still asks about: those undecided, and those removed
 * whose field has been given a role since -- by hand, or by filling every
 * field from the operations -- by the test the server refuses with,
 * `grantsOnKey` (0039).
 */
export function asked(carried: Carried | null, policy: FormPolicy): ReassignedKey[] {
  if (carried === null) return []
  return [...carried.undecided, ...carried.removed.filter((entry) => grantsOnKey(policy, entry.field))]
}

/** `key` kept or removed: out of the list it was asked from -- undecided, or removed and granted again -- into the decision's. */
export function decide(carried: Carried, key: string, decision: 'keep' | 'remove'): Carried {
  const others = (list: readonly ReassignedKey[]) => list.filter((candidate) => candidate.field !== key)
  const entry = [...carried.undecided, ...carried.removed].filter((candidate) => candidate.field === key).slice(0, 1)
  return {
    ...carried,
    undecided: others(carried.undecided),
    kept: decision === 'keep' ? [...others(carried.kept), ...entry] : others(carried.kept),
    removed: decision === 'remove' ? [...others(carried.removed), ...entry] : others(carried.removed),
  }
}

/** The fields of `after` whose column or lookup `before` did not have, in `after`'s order. */
export function freshFields(before: FormBindings, after: FormBindings): string[] {
  const known = new Set(before.fields.map((binding) => canonicalize(fieldAnchor(binding))))
  return after.fields.filter((binding) => !known.has(canonicalize(fieldAnchor(binding)))).map((binding) => binding.field)
}

export type CarriedDraft = { ok: true; form: FormSchema; conflicts: PresentationConflict[]; fresh: string[] } | { ok: false; message: string }

/**
 * A draft's presentation carried to a new proposal of the same form: derived
 * from the old proposal's base exactly as a publish derives it, then rebased
 * by data-core onto the new base -- the rebase the server's regeneration
 * runs, so "Generate again" and a regeneration carry alike.
 *
 * A draft that is not only presentation is refused, saying why, rather than
 * carried without what does not fit.
 */
export function carryDraft(from: { proposal: Proposal; edited: FormSchema }, to: Proposal): CarriedDraft {
  const derived = presentationOf(from.proposal.form, from.edited, from.proposal.bindings)
  if (!derived.ok) return { ok: false, message: `the draft holds edits that are not presentation: ${derived.problems.join('; ')}` }
  // The rebase throws only for a base the generator did not write, which a
  // proposal never is and the derivation above has already read.
  const rebased = rebasePresentation(
    { base: from.proposal.form, presentation: derived.presentation, bindings: from.proposal.bindings },
    { base: to.form, bindings: to.bindings },
  )
  return { ok: true, form: rebased.form, conflicts: rebased.conflicts, fresh: freshFields(from.proposal.bindings, to.bindings) }
}

/**
 * What a draft carries after "Generate again" (0030). The new rebase reports
 * what this proposal could not carry from the draft; what the draft had
 * already lost -- a label or section override dropped by the regeneration
 * or an earlier "Generate again" -- is no longer in it to report, so those
 * conflicts are kept, earlier first. The fields a dropped label may be
 * given to are the earlier ones, followed to their keys in the new
 * proposal by what they stand for, and those new in it.
 */
export function carriedAgain(earlier: Carried | null, before: FormBindings, draft: { conflicts: PresentationConflict[]; fresh: string[] }, after: FormBindings): Carried {
  const lost = (earlier?.conflicts ?? []).filter((conflict) => conflict.kind === 'field-gone' || conflict.kind === 'section-gone')
  const anchorOf = new Map(before.fields.map((binding) => [binding.field, canonicalize(fieldAnchor(binding))]))
  const followed = new Set((earlier?.fresh ?? []).flatMap((key) => anchorOf.get(key) ?? []))
  const fresh = after.fields.filter((binding) => draft.fresh.includes(binding.field) || followed.has(canonicalize(fieldAnchor(binding)))).map((binding) => binding.field)
  const from = earlier === null || earlier.from.endsWith('your earlier draft') ? (earlier?.from ?? 'your earlier draft') : `${earlier.from}, then your earlier draft`
  return { from, version: earlier?.version ?? null, conflicts: [...lost, ...draft.conflicts], fresh, undecided: earlier?.undecided ?? [], kept: earlier?.kept ?? [], removed: earlier?.removed ?? [] }
}
