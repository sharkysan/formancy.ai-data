import type { FormEngine } from '@formancy/core'

/**
 * Each top-level field's label, by its key, as the error summary names a
 * problem. Neither renderer's summary reads the document's labels: without
 * this map an entry says `customer: …` where the field says "Customer".
 *
 * A plain file of its own, imported by the Angular component and the React
 * pane alike, because the Angular compiler drops a function exported beside a
 * component.
 */
export function fieldLabels(engine: FormEngine): Record<string, string> {
  return Object.fromEntries(engine.schema().model.fields.map((field) => [field.key, engine.text(field.label) ?? field.key]))
}
