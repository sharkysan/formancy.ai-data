import { fieldHeading } from '@formancy/data-client'
import type { PublishedForm } from '@formancy/data-client'

/**
 * What a form calls its field `key` where a line or a title names it: the
 * heading the field has everywhere else (`fieldHeading`, a `{ $t }` label
 * its key), and the key itself where the form has no such field.
 */
export function headingOf(definition: PublishedForm, key: string): string {
  return fieldHeading(definition.form.model.fields.find((field) => field.key === key) ?? { key })
}
