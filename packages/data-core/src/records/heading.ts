import type { Text } from '@formancy/spec'

/**
 * What a field is called where a page or a file names it: its label where
 * that is a string, otherwise its key (0079). A label may be a `{ $t }`
 * reference into a message catalogue, which a form served as stored can
 * carry and which no file or grid here resolves, and `String` of that
 * object is "[object Object]". The export's headers, the host's grid, its
 * filter panel and its titles all name a field by this one rule.
 */
export function fieldHeading(field: { readonly key: string; readonly label?: Text }): string {
  return typeof field.label === 'string' ? field.label : field.key
}
