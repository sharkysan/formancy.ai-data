import { describe, expect, test } from 'vitest'
import type { PublishedForm } from '@formancy/data-client'
import { conditionOf, draftFor, draftHint, panelFields, panelShown, summaryOf, withTerm } from './filter-terms.js'
import type { Draft, PanelField } from './filter-terms.js'

/*
 * What a grid's filter panel offers and asks for (0104), as data: the fields
 * the server offers, by their labels, the condition a draft is, and the
 * sentences that name one. What the server does with a condition is the
 * suites' against the real server (filter.test.tsx); this holds what the
 * page makes of the person's choices before anything is sent.
 */

/** A delivery's form as the server publishes it, with every input kind among its offers: the fields' types are the generator's. */
const definition = {
  form: {
    specVersion: '3',
    id: 'pg-delivery',
    title: 'Delivery',
    model: {
      fields: [
        { key: 'id', type: 'text', label: 'Id', format: 'uuid' },
        { key: 'order', type: 'select', label: 'Order', optionsSource: 'pg-delivery.order' },
        { key: 'carrier', type: 'text', label: 'Carrier' },
        { key: 'shipped_at', type: 'datetime', label: 'Shipped at' },
        { key: 'dispatched_at', type: 'text', label: 'Dispatched at' },
        { key: 'parcels', type: 'number', label: 'Parcels' },
        { key: 'weight', type: 'text', label: 'Weight' },
        { key: 'due', type: 'date', label: 'Due' },
        { key: 'insured', type: 'checkbox', label: 'Insured' },
        { key: 'notes', type: 'textarea', label: 'Notes' },
      ],
    },
  },
  operations: ['read'],
  readable: ['id', 'order', 'carrier', 'shipped_at', 'dispatched_at', 'parcels', 'weight', 'due', 'insured', 'notes'],
  list: {
    searchable: ['carrier'],
    sortable: ['carrier'],
    filterable: [
      { field: 'id', offered: true, operators: ['equals'], input: 'uuid', days: null },
      { field: 'carrier', offered: true, operators: ['equals', 'contains'], input: 'text', days: null },
      { field: 'shipped_at', offered: true, operators: ['range', 'null', 'not-null'], input: 'date', days: 'utc' },
      { field: 'dispatched_at', offered: true, operators: ['range', 'null', 'not-null'], input: 'date', days: 'wall' },
      { field: 'parcels', offered: true, operators: ['equals', 'range'], input: 'integer', days: null },
      { field: 'weight', offered: true, operators: ['equals', 'range', 'null', 'not-null'], input: 'decimal', days: null },
      { field: 'due', offered: true, operators: ['equals', 'range'], input: 'date', days: null },
      { field: 'insured', offered: true, operators: ['equals'], input: 'boolean', days: null },
      { field: 'notes', offered: false, operators: ['equals', 'contains', 'null', 'not-null'], input: 'text', days: null },
    ],
  },
} as unknown as PublishedForm

const fields = panelFields(definition)
const field = (key: string): PanelField => fields.find((offered) => offered.field === key) as PanelField
const draft = (key: string, rest: Partial<Draft>): Draft => ({ ...draftFor(field(key)), ...rest })

describe('the fields a panel offers', () => {
  // The panel is drawn for a field it offers, or for a condition applied
  // -- a view's, on a field the administrator left out of the panel (0123)
  // -- which it says; with neither, a grid has no panel to draw. Watched
  // failing with the panel drawn for any field filtered by: a list whose
  // every field was left out drew an empty panel.
  test('is drawn for a field it offers, or for a condition applied on one it does not', () => {
    const notes = [field('notes')]
    expect(panelShown(fields, [])).toBe(true)
    expect(panelShown(notes, [])).toBe(false)
    expect(panelShown(notes, [{ field: 'notes', op: 'contains', text: 'x' }])).toBe(true)
    expect(panelShown([], [{ field: 'notes', op: 'contains', text: 'x' }])).toBe(false)
  })

  // The server's offers, in its order, each by the label the form gives it,
  // a timestamp's days on the clock the offer names -- UTC's for an instant,
  // the stored clock's for one in no zone -- whatever control the form draws
  // for it (watched failing with the clock guessed from the form's field
  // again: the instant drawn as text below was said to be on the stored
  // clock).
  test("are the server's, by their labels, a timestamp's days on its clock", () => {
    expect(fields.map((offered) => [offered.field, offered.label, offered.days])).toEqual([
      ['id', 'Id', null],
      ['carrier', 'Carrier', null],
      ['shipped_at', 'Shipped at', 'utc'],
      ['dispatched_at', 'Dispatched at', 'wall'],
      ['parcels', 'Parcels', null],
      ['weight', 'Weight', null],
      ['due', 'Due', null],
      ['insured', 'Insured', null],
      ['notes', 'Notes', null],
    ])
    const drawnAsText = { ...definition.form.model.fields.find((given) => given.key === 'shipped_at'), type: 'text' }
    const redrawn = { ...definition, form: { ...definition.form, model: { fields: [drawnAsText] } } } as unknown as PublishedForm
    expect(panelFields(redrawn).find((offered) => offered.field === 'shipped_at')?.days).toBe('utc')
    expect(panelFields({ ...definition, list: null })).toEqual([])
  })

  // A label may be `{ $t }`, which the page cannot resolve (0079): the panel
  // offers the field by its key, never as "[object Object]".
  test('offer a field whose label is a message reference by its key', () => {
    const referenced = {
      ...definition,
      form: { ...definition.form, model: { fields: [{ key: 'carrier', type: 'text', label: { $t: 'shipment.carrier' } }] } },
    } as unknown as PublishedForm
    expect(panelFields(referenced).find((offered) => offered.field === 'carrier')?.label).toBe('carrier')
  })
})

describe('the condition a draft asks for', () => {
  // Each operator becomes the request's own shape, with values as typed --
  // a text's spaces kept, since text is compared exactly, and a number's
  // too, which the server trims -- and a boolean as the select holds it:
  // whether a value fits its column is the server's to say (watched failing
  // with the value trimmed: " Post " sent as "Post").
  test('is the shape the route reads, the values as typed', () => {
    expect(conditionOf(draft('carrier', { value: ' Post ' }))).toEqual({ ok: true, term: { field: 'carrier', op: 'equals', value: ' Post ' } })
    expect(conditionOf(draft('carrier', { value: '', op: 'equals' }))).toEqual({ ok: true, term: { field: 'carrier', op: 'equals', value: '' } })
    expect(conditionOf(draft('notes', { op: 'contains', value: 'zug' }))).toEqual({ ok: true, term: { field: 'notes', op: 'contains', text: 'zug' } })
    expect(conditionOf(draft('parcels', { op: 'range', from: ' 2', to: '' }))).toEqual({
      ok: true,
      term: { field: 'parcels', op: 'range', from: ' 2', to: null },
    })
    expect(conditionOf(draft('shipped_at', { from: '', to: '2026-10-08' }))).toEqual({
      ok: true,
      term: { field: 'shipped_at', op: 'range', from: null, to: '2026-10-08' },
    })
    expect(conditionOf(draft('weight', { op: 'null' }))).toEqual({ ok: true, term: { field: 'weight', op: 'null' } })
    expect(conditionOf(draft('weight', { op: 'not-null', value: 'left over' }))).toEqual({ ok: true, term: { field: 'weight', op: 'not-null' } })
    expect(conditionOf(draftFor(field('insured')))).toEqual({ ok: true, term: { field: 'insured', op: 'equals', value: 'true' } })
    expect(conditionOf(draft('insured', { value: 'false' }))).toEqual({ ok: true, term: { field: 'insured', op: 'equals', value: 'false' } })
  })

  // A range with neither bound and contains with nothing to find are no
  // conditions: the route would refuse either as malformed, so the panel
  // says why and sends nothing (watched failing with the check gone: a
  // range of two nulls offered as a condition).
  test('is none for a range with no bound or contains with no text', () => {
    expect(conditionOf(draft('parcels', { op: 'range', from: ' ', to: '' }))).toEqual({ ok: false, problem: 'A range needs a From, a To or both.' })
    expect(conditionOf(draft('notes', { op: 'contains', value: '  ' }))).toEqual({ ok: false, problem: 'Contains needs text to find.' })
  })

  // Each field is named once (0104): applying a condition on a field that
  // has one puts it in that one's place, and anywhere else it comes last
  // (watched failing with every condition appended: notes named twice).
  test('takes the place of the condition its field had', () => {
    const notes = { field: 'notes', op: 'contains' as const, text: 'zug' }
    const weight = { field: 'weight', op: 'null' as const }
    const replaced = { field: 'notes', op: 'equals' as const, value: 'Zug' }
    expect(withTerm([notes, weight], replaced)).toEqual([replaced, weight])
    expect(withTerm([notes], weight)).toEqual([notes, weight])
  })
})

describe('what a panel says', () => {
  // A condition as the list under Filter shows it, by its field's label,
  // its value as it was typed, quoted where it is text, a boolean as yes or
  // no, a one-sided range by what bounds it (watched failing with the
  // field's key for its label: "shipped_at is on or before …").
  test('names each condition by its field and its value', () => {
    expect(summaryOf({ field: 'carrier', op: 'equals', value: 'Post' }, field('carrier'))).toBe('Carrier is “Post”')
    expect(summaryOf({ field: 'insured', op: 'equals', value: 'false' }, field('insured'))).toBe('Insured is no')
    expect(summaryOf({ field: 'parcels', op: 'equals', value: '7' }, field('parcels'))).toBe('Parcels is 7')
    expect(summaryOf({ field: 'parcels', op: 'range', from: '2', to: '3' }, field('parcels'))).toBe('Parcels is between 2 and 3')
    expect(summaryOf({ field: 'weight', op: 'range', from: '2.5', to: null }, field('weight'))).toBe('Weight is at least 2.5')
    expect(summaryOf({ field: 'shipped_at', op: 'range', from: null, to: '2026-10-08' }, field('shipped_at'))).toBe('Shipped at is on or before 2026-10-08')
    expect(summaryOf({ field: 'due', op: 'range', from: '2026-10-01', to: null }, field('due'))).toBe('Due is on or after 2026-10-01')
    expect(summaryOf({ field: 'notes', op: 'contains', text: 'zug' }, field('notes'))).toBe('Notes contains “zug”')
    expect(summaryOf({ field: 'notes', op: 'null' }, field('notes'))).toBe('Notes has no value')
    expect(summaryOf({ field: 'weight', op: 'not-null' }, field('weight'))).toBe('Weight has a value')
  })

  // Under a draft, what its condition means where it is not obvious: a
  // timestamp's range is whole days, on the clock the grid shows it in; a
  // date's or a number's bounds are included; contains matches as Search
  // does, which on SQL Server is the column's collation, so it promises no
  // case; and
  // text of no characters is a value, so "has no value" does not find it
  // (watched failing with one hint for every range: an instant's days not
  // said to be UTC's).
  test('says what a range, contains and no value mean', () => {
    expect(draftHint(draft('shipped_at', {}), field('shipped_at'))).toBe(
      'Whole days in UTC, as the grid shows times: from the start of From to the end of To. Either may be left empty.',
    )
    expect(draftHint(draft('dispatched_at', {}), field('dispatched_at'))).toBe(
      'Whole days, as the time is stored: from the start of From to the end of To. Either may be left empty.',
    )
    expect(draftHint(draft('due', { op: 'range' }), field('due'))).toBe('From and To are included. Either may be left empty.')
    expect(draftHint(draft('notes', { op: 'contains' }), field('notes'))).toBe('Found anywhere in the field, as Search finds text.')
    expect(draftHint(draft('notes', { op: 'null' }), field('notes'))).toBe('Text of no characters is a value.')
    expect(draftHint(draft('weight', { op: 'null' }), field('weight'))).toBeNull()
    expect(draftHint(draft('parcels', {}), field('parcels'))).toBeNull()
  })
})
