import type { FormSchema } from '@formancy/spec'

/**
 * How this host draws a lookup: as a typeahead, whatever the published form
 * says.
 *
 * A lookup lists rows of a database table, which can be longer than a page,
 * and 0.3.0's option sources cannot tell a person that more rows exist; a
 * typeahead keeps narrowing as somebody types, a plain select lists the first
 * page and stops (0029). Which control a host draws is the host's choice, so
 * it is made here, on the host's copy of the form, and not in the published
 * version: the server publishes only the generated form with presentation
 * applied (0030), and a widget is not presentation there.
 *
 * Only a select whose answers come from a named source and that names no
 * widget of its own is changed; every other field is the published one.
 */
export function drawLookupsAsTypeaheads(form: FormSchema): FormSchema {
  const fields = form.model.fields.map((field) =>
    field.type === 'select' && field.optionsSource !== undefined && field.widget === undefined ? { ...field, widget: 'typeahead' as const } : field,
  )
  return { ...form, model: { ...form.model, fields } }
}
