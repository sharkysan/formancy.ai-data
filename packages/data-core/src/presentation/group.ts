import { labelFor } from '../generate/names.js'
import type { ObjectRef } from '../metadata.js'
import { nameProblem } from './views.js'

/*
 * The group a form is listed under (0143): a heading a host's list of
 * forms puts it under, which the menu (`GET /v1/forms`, 0045) names beside
 * its title. Kept in the presentation as `group`: left out, the form is
 * listed under its root schema's name in words, "sales" as "Sales"; text,
 * under that; `null`, under no group. Presentation only: a group grants
 * nothing and asks no database, and the menu reads it from the bundle.
 *
 * Pure and isomorphic, as the presentation is.
 */

/** The longest group, in UTF-16 code units: a choice, a heading in a list of forms and not a sentence, as a view's name is. */
export const GROUP_LIMIT = 80

/**
 * Why `group` is not a group a form may be listed under, or `null`: words
 * a person can read, with no space around them, no control character and
 * no lone surrogate (`nameProblem`), at most `GROUP_LIMIT` long.
 */
export function groupProblem(group: string): string | null {
  const named = nameProblem(group)
  if (named !== null) return group.trim() === '' ? `${named}; no group is null` : named
  return group.length > GROUP_LIMIT ? `is at most ${String(GROUP_LIMIT)} characters` : null
}

/**
 * Every reason `value` is not a presentation's `group` by shape: `null`, or
 * text `groupProblem` passes. An empty or blank group is refused rather
 * than read as `null`, so a presentation has one spelling of no group.
 */
export function groupShapeProblems(value: unknown): string[] {
  if (value === null) return []
  if (typeof value !== 'string') return ['group must be words, or null for no group']
  const problem = groupProblem(value)
  return problem === null ? [] : [`group ${problem}`]
}

/**
 * The group a form over `root` is listed under when its presentation says
 * nothing: the root schema's name in words, as generation words a label
 * (`labelFor`), or `null` where those words are no group an administrator
 * could type -- a schema of spaces or punctuation alone, or one past
 * `GROUP_LIMIT` in words -- so the menu never names a group the shape would
 * refuse.
 */
export function defaultGroup(root: ObjectRef): string | null {
  const words = labelFor(root.schema)
  return groupProblem(words) === null ? words : null
}

/** The group a form over `root` is listed under: the presentation's `group`, or the default where it says nothing. */
export function formGroup(group: string | null | undefined, root: ObjectRef): string | null {
  return group === undefined ? defaultGroup(root) : group
}

/**
 * Every reason a presentation's `group` does not fit a form over `root`,
 * prefixed by where it is: what a write refuses, as it refuses a label
 * equal to the base's (0030). The default spelled out is the property
 * left out. Asked at a write and never on read, so a later release that
 * words a schema otherwise leaves a stored version readable.
 */
export function groupProblems(group: string | null | undefined, root: ObjectRef): string[] {
  return group !== undefined && group === defaultGroup(root) ? [`/group: equals the default, from schema ${JSON.stringify(root.schema)}; leave it out`] : []
}
