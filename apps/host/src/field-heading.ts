import type { FieldDef } from '@formancy/spec'

/**
 * What a field is called where the page names it: its label where that is a
 * string, otherwise its key, as the CSV export heads its own columns (0079).
 * A label may be a `{ $t }` reference into a message catalogue the page
 * cannot read, and `String` of that object is "[object Object]".
 */
export function fieldHeading(field: Pick<FieldDef, 'key' | 'label'>): string {
  return typeof field.label === 'string' ? field.label : field.key
}
