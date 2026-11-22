import { parse, referencedPaths } from '@formancy/expressions'
import type { FormSchema } from '@formancy/spec'
import type { FormPolicy } from './types.js'

/*
 * The fields a form's rules read together, for what a change of chosen
 * records may set (0175).
 *
 * A change of chosen records sets each field it names to one value for
 * every record, and each record keeps its other answers. A rule of the form
 * -- `visible`, `disabled`, `required`, `computed`, `validate`, `check`,
 * `skip` (`logic.rules`) -- that reads a field together with another is run
 * by the page over one record's answers, and by nothing here: the server
 * runs no rule. The page that sets a value for fifty records cannot run it
 * over each record's other answers, so a field such a rule reads, or
 * decides, is no field a change of chosen records may set. A rule about one
 * field alone -- `amount` at least 0, the generator's `disabled` with `true`
 * -- the page runs over the value given, as for one record.
 *
 * What a rule reads:
 *
 * - its target, the field it decides about, by the first key of its data
 *   path -- `address` of `address.city`, `items` of `items[].qty` -- unless
 *   it is a page's (`skip`);
 * - every field its expression reads, as formancy's own parser answers it
 *   (`@formancy/expressions`' `referencedPaths` over `parse`), the reading
 *   its engine builds a form's dependencies from, by each path's first key:
 *   never a second reading of CEL here that the engine's could disagree
 *   with (0002);
 * - every field, for an expression that parser refuses, whose reads nobody
 *   can say, so nothing is granted on a guess; for a `check`, whose
 *   validator the deployment answers with the whole submission
 *   (formancy.ai 0086); and for a `skip` that reads a field, which hides a
 *   page of fields by what it reads.
 *
 * A form the generator made carries only `disabled` rules over `true`, and
 * a presentation adds none (0030), so this refuses something only in a
 * bundle whose form was written otherwise: format 1, which is published as
 * given.
 */

/** The field a data path is about: its first key. */
function fieldOf(path: string): string {
  return path.split(/[.[]/)[0] ?? path
}

/** The fields of the form an expression reads, by key, or `null` where formancy's parser refuses it. */
function fieldsRead(cel: string, keys: ReadonlySet<string>): string[] | null {
  const parsed = parse(cel)
  if (!parsed.ok) return null
  return [...new Set(referencedPaths(parsed.ast).map(fieldOf))].filter((name) => keys.has(name))
}

/**
 * Every field of the form a rule reads together with another, by key, each
 * with the first rule's target that reads it so: what a change of chosen
 * records may not set.
 */
export function readTogether(form: FormSchema): Map<string, string> {
  const keys = new Set(form.model.fields.map((field) => field.key))
  const together = new Map<string, string>()
  for (const rule of form.logic?.rules ?? []) {
    const named = rule.cel === undefined ? [] : fieldsRead(rule.cel, keys)
    const read = new Set<string>(rule.kind === 'skip' ? [] : [fieldOf(rule.target)])
    const reads = named === null || rule.kind === 'check' || (rule.kind === 'skip' && named.length > 0) ? keys : named
    for (const field of reads) read.add(field)
    if (read.size < 2) continue
    for (const field of read) if (!together.has(field)) together.set(field, rule.target)
  }
  return together
}

/**
 * Each field `bulk.update` lists that a rule of the form reads together
 * with another (0175), in the grant's order: refused at publish and on
 * every read of the bundle, since the page cannot run that rule over each
 * record's other answers and the server runs none.
 */
export function readTogetherProblems(form: FormSchema, policy: FormPolicy): string[] {
  const fields: unknown = policy.bulk?.update?.fields
  if (!Array.isArray(fields)) return []
  const together = readTogether(form)
  return fields
    .filter((field): field is string => typeof field === 'string' && together.has(field))
    .map((field) => `bulk.update.fields: ${field} ${readTogetherReason(String(together.get(field)))}`)
}

/**
 * Why a change of chosen records may not set a field the rule on `target`
 * reads together with another, as the bundle's check says it after the
 * field's key: the words the studio shows beside a field it does not offer
 * (0176), so the two cannot say it differently.
 */
export function readTogetherReason(target: string): string {
  return `is read by the rule on ${target} together with another field, which a change of chosen records cannot run over each record's other answers`
}
