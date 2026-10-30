import type { PublishedForm } from '@formancy/data-client'
import { headingOf } from './heading.js'

/**
 * What a tree of a form's records (0110) says of a level that holds no
 * records: the roots, with `under` null, or the records naming `under`.
 * Each names the field through which the records name their parent, by the
 * heading the field has everywhere else (a `{ $t }` label is its key).
 */
export function emptyLevelLine(definition: PublishedForm, field: string, under: string | null): string {
  const heading = headingOf(definition, field)
  return under === null ? `No records have no ${heading}.` : `No records name ${under} as their ${heading}.`
}
