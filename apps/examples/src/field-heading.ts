import type { FieldDef } from '@formancy/spec'

/**
 * What a field is called on the page: its label where that is a string,
 * otherwise its key. A generated form's labels are strings; a label may be
 * a `{ $t }` reference into a catalogue the page cannot read (0079), and
 * `String` of that object is "[object Object]".
 */
export function fieldHeading(field: Pick<FieldDef, 'key' | 'label'>): string {
  return typeof field.label === 'string' ? field.label : field.key
}
