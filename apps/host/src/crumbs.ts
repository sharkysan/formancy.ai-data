import type { FieldDef } from '@formancy/spec'
import type { Said } from './leave.js'

/*
 * What Drill down's trail calls each level (0090). Crumb 0 is the records;
 * a record's crumb is its form's title and its name, or its token when it
 * has none; a new record's is "New <title>". The name is read from what is
 * stored -- the record as it was opened or last saved -- never from typing.
 */

/** One crumb: the level it goes to, and what it says. */
export interface Crumb {
  level: number
  said: Said
}

/**
 * A record's name: the answer to the first field, in the form's order, that
 * is text with no pattern and no format, that the form requires, and that
 * is not the field naming the level above. A pattern or a format says a
 * number, an e-mail or an id, and a field the form does not require may
 * hold a default that names nothing. Null when that answer is not text with
 * something in it -- or the person may not read it, and there is none.
 */
export function recordName(fields: readonly FieldDef[], answers: Readonly<Record<string, unknown>>, parentField: string | null): string | null {
  for (const field of fields) {
    if (field.type !== 'text' || field.pattern !== undefined || field.format !== undefined || field.required !== true || field.key === parentField) continue
    if (!(field.key in answers)) continue
    const answer = answers[field.key]
    return typeof answer === 'string' && answer.trim() !== '' ? answer : null
  }
  return null
}

/** The crumb of a record at `level`: by its name when it has one, else by its token as code; `null` for a new record. */
export function crumbOf(level: number, title: string, open: { token: string; name: string | null } | null): Crumb {
  if (open === null) return { level, said: [`New ${title}`] }
  return { level, said: open.name === null ? [`${title} `, { code: open.token }] : [`${title} ${open.name}`] }
}

/** What the trail draws: every crumb, or on a phone past three the first, how many there are, and the last two. */
export function shownCrumbs(crumbs: readonly Crumb[], compact: boolean, expanded: boolean): Array<Crumb | { more: number }> {
  if (!compact || expanded || crumbs.length <= 3) return [...crumbs]
  return [crumbs[0] as Crumb, { more: crumbs.length }, ...crumbs.slice(-2)]
}
