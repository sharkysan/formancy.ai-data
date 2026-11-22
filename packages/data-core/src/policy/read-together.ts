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
 * - every field key its expression names as a variable: CEL names a field
 *   by its key, a member after a dot names none, and text inside a string
 *   literal is no name. Read by `namedIn`, a scan of the expression's
 *   tokens, never its evaluation, which errs towards a field read: a
 *   function named like a field counts as the field;
 * - every field, for a `check`, whose validator the deployment answers
 *   with the whole submission (formancy.ai 0086), and for a `skip`, which
 *   hides a page of fields by what it reads.
 *
 * A form the generator made carries only `disabled` rules over `true`, and
 * a presentation adds none (0030), so this refuses something only in a
 * bundle whose form was written otherwise: format 1, which is published as
 * given.
 */

/** Every field key a CEL expression names as a variable: each identifier outside a string literal and not after a dot. */
export function namedIn(cel: string): Set<string> {
  const named = new Set<string>()
  let at = 0
  let afterDot = false
  while (at < cel.length) {
    const char = cel[at] as string
    const quoted = stringAt(cel, at)
    if (quoted !== null) {
      at = quoted
      afterDot = false
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = at + 1
      while (end < cel.length && /[A-Za-z0-9_]/.test(cel[end] as string)) end += 1
      if (!afterDot) named.add(cel.slice(at, end))
      at = end
      afterDot = false
      continue
    }
    if (char === '.') afterDot = true
    else if (!/\s/.test(char)) afterDot = false
    at += 1
  }
  return named
}

/**
 * Where a string literal that starts at `at` ends, or `null` where none
 * starts there: CEL's quotes, single or triple, `'` or `"`, after an
 * optional `r` (raw: no escapes) or `b` prefix, in either case and order.
 */
function stringAt(cel: string, at: number): number | null {
  const prefix = /^(?:[rR][bB]?|[bB][rR]?)?/.exec(cel.slice(at))?.[0] ?? ''
  // A prefix is one only before a quote, and only as a token's start: `br` of `abr'` is the end of an identifier.
  if (prefix !== '' && at > 0 && /[A-Za-z0-9_]/.test(cel[at - 1] as string)) return null
  const open = at + prefix.length
  const quote = cel[open]
  if (quote !== "'" && quote !== '"') return null
  const raw = /[rR]/.test(prefix)
  const fence = cel.startsWith(quote.repeat(3), open) ? quote.repeat(3) : quote
  let index = open + fence.length
  while (index < cel.length) {
    if (!raw && cel[index] === '\\') {
      index += 2
      continue
    }
    if (cel.startsWith(fence, index)) return index + fence.length
    index += 1
  }
  // Unterminated: the rest is the literal, so nothing in it is a name -- the validator refuses such an expression first.
  return cel.length
}

/** The field a data path is about: its first key. */
function fieldOf(path: string): string {
  return path.split(/[.[]/)[0] ?? path
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
    const named = [...namedIn(rule.cel ?? '')].filter((name) => keys.has(name))
    const read = new Set<string>(rule.kind === 'skip' ? [] : [fieldOf(rule.target)])
    const everything = rule.kind === 'check' || (rule.kind === 'skip' && named.length > 0)
    for (const field of everything ? keys : named) read.add(field)
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
    .map(
      (field) =>
        `bulk.update.fields: ${field} is read by the rule on ${String(together.get(field))} together with another field, which a change of chosen records cannot run over each record's other answers`,
    )
}
