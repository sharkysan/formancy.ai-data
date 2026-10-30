import type { PublishedForm } from '@formancy/data-client'
import { headingOf } from './heading.js'

/**
 * A child section's title: its form's, and where the form is a child twice
 * through different fields the field that tells them apart, by the heading
 * the field has everywhere else (a `{ $t }` label is its key).
 */
export function childTitle(title: string, twice: boolean, definition: PublishedForm, childField: string): string {
  if (!twice) return title
  return `${title}, ${headingOf(definition, childField)}`
}
