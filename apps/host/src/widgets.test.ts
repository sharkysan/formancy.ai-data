import type { FormSchema } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { drawLookupsAsTypeaheads } from './widgets.js'

/** A form with one of each kind of select this host meets, and one text field. */
function form(): FormSchema {
  return {
    $schema: 'https://formancy.ai/schema/0.3.0',
    id: 'order',
    title: 'Order',
    model: {
      fields: [
        { key: 'customer', type: 'select', label: 'Customer', optionsSource: 'erp-sales-order-fk-order-customer' },
        { key: 'status', type: 'select', label: 'Status', options: [{ value: 'placed', label: 'placed' }] },
        { key: 'region', type: 'select', label: 'Region', optionsSource: 'regions', widget: 'radio' },
        { key: 'notes', type: 'text', label: 'Notes' },
      ],
    },
    layouts: [],
  } as unknown as FormSchema
}

describe("the host's choice of control for a lookup", () => {
  // The journey suites prove a lookup is searched as a typeahead in both
  // renderers. What they do not reach: a select listing fixed answers is not a
  // lookup, and a select that already names its control was decided by
  // somebody else -- turning either into a typeahead would draw a control the
  // published form never asked for.
  test('draws only a lookup with no control of its own as a typeahead', () => {
    const drawn = drawLookupsAsTypeaheads(form())
    const widgets = Object.fromEntries(drawn.model.fields.map((field) => [field.key, (field as { widget?: string }).widget]))
    expect(widgets).toEqual({ customer: 'typeahead', status: undefined, region: 'radio', notes: undefined })
  })

  // The published definition is shared by both panes and by every later
  // open; drawing on it in place would change what the other pane renders.
  test('leaves the published form as it was', () => {
    const published = form()
    const before = JSON.stringify(published)
    drawLookupsAsTypeaheads(published)
    expect(JSON.stringify(published)).toBe(before)
  })
})
