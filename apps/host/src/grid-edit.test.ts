import { describe, expect, test } from 'vitest'
import type { FormRecord, PublishedForm } from '@formancy/data-client'
import type { FieldDef, FormSchema } from '@formancy/spec'
import { drawnCopies } from './drawn-copies.js'
import { CANNOT_OPEN } from './grid-datasource.js'
import {
  cellEdit,
  drawnOf,
  editorOf,
  invalidSaid,
  leaving,
  markOf,
  NO_VERSION,
  READ_ONLY,
  ENDED,
  settled,
  stepFrom,
  STALE_KEPT,
  CHECK_IT,
  outcomeSaid,
} from './grid-edit.js'
import type { DrawnField } from './grid-edit.js'

/*
 * Which of a grid's cells a person edits there, which in the record's form
 * and which never, and why (0179) -- read from the
 * very copy a pane draws the record with (drawn-copies.ts), so a grid and
 * a form can never disagree about what a person may write; a row's states
 * and its mark; when leaving a row saves it; and where Tab goes in an
 * editor. Framework-neutral and asked of no server, so this file needs no
 * database: the behaviour on a real one is grid-editing.test.tsx's.
 */

const field = (def: Partial<FieldDef> & { key: string; type: FieldDef['type'] }): FieldDef => ({ label: def.key[0]?.toUpperCase() + def.key.slice(1), ...def })

/** A published order form as the server serves it to a clerk who may create and update: every kind of field a generated form holds. */
function definition(over: Partial<PublishedForm> = {}): PublishedForm {
  const fields: FieldDef[] = [
    field({ key: 'id', type: 'number' }),
    field({ key: 'number', type: 'text' }),
    field({ key: 'customer', type: 'select', optionsSource: 'customers' }),
    field({ key: 'status', type: 'text' }),
    field({ key: 'amount', type: 'text', pattern: '^[0-9]+(\\.[0-9]{1,4})?$' }),
    field({ key: 'count', type: 'number', step: 1 }),
    field({ key: 'due', type: 'date' }),
    field({ key: 'done', type: 'checkbox' }),
    field({
      key: 'size',
      type: 'select',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'large', label: 'Large' },
      ],
    }),
    field({ key: 'notes', type: 'textarea' }),
    field({ key: 'at', type: 'time' }),
    field({ key: 'stamp', type: 'datetime' }),
    field({ key: 'secret', type: 'text' }),
    field({ key: 'total', type: 'number' }),
    field({ key: 'until', type: 'date' }),
  ]
  const form = {
    specVersion: '5',
    id: 'orders',
    title: 'Order',
    model: { fields },
    // As the generator draws a field nothing writes: Id, which the database writes (generate.ts).
    logic: {
      rules: [
        { target: 'id', kind: 'disabled', cel: 'true' },
        { target: 'total', kind: 'computed', cel: 'count * 2' },
      ],
    },
    layouts: [{ name: 'default', nodes: fields.map((each) => ({ kind: 'field' as const, path: each.key })) }],
  } as FormSchema
  const written = ['customer', 'status', 'amount', 'count', 'due', 'done', 'size', 'notes', 'at', 'stamp', 'total', 'until']
  return {
    form,
    operations: ['read', 'create', 'update'],
    readable: fields.map((each) => each.key),
    list: null,
    deleting: null,
    copied: null,
    versions: null,
    writable: { create: ['number', ...written], update: written },
    moves: {
      field: 'status',
      moves: [
        { from: null, to: 'draft' },
        { from: 'draft', to: 'placed' },
        { from: 'placed', to: 'shipped' },
      ],
      labels: [{ state: 'shipped', label: 'Shipped' }],
    },
    opens: [],
    together: null,
    actions: [],
    bulk: { delete: false, update: null },
    ...over,
  }
}

const SAVED: FormRecord = { record: 'k1:9', version: '3', answers: { status: 'draft', amount: '12.5000' } }

/** How `key` of a saved record -- or of `record` -- is edited, read from the copy a form opened on it draws it with. */
function how(key: string | null, over: Partial<PublishedForm> = {}, record: FormRecord = SAVED, drawn?: DrawnField) {
  const published = definition(over)
  const copy = drawnCopies(published).of(record, false)
  return cellEdit({
    definition: published,
    row: { record: record.record, version: record.version, answers: record.answers },
    field: key,
    drawn: drawn ?? (key === null ? undefined : drawnOf(copy, key)),
  })
}

describe('which cells are edited in the grid, which in the form, and which never (0179)', () => {
  // A cell editor for what a cell can hold whole: one that took a textarea
  // would cut a note's lines, one that took a lookup would offer no
  // typeahead, and a number edited as a JavaScript number in a text field
  // would lose a numeric(18,4)'s digits -- which is why an exact decimal is
  // a text field, edited as text.
  test('a field the copy enables is edited in its cell where a cell holds it whole', () => {
    expect(['amount', 'count', 'due', 'done', 'size'].map((key) => [key, how(key)])).toEqual([
      ['amount', { kind: 'cell', editor: 'text' }],
      ['count', { kind: 'cell', editor: 'number' }],
      ['due', { kind: 'cell', editor: 'date' }],
      ['done', { kind: 'cell', editor: 'checkbox' }],
      ['size', { kind: 'cell', editor: 'select' }],
    ])
  })

  // A textarea, a time, a timestamp and a lookup are the form's: F2 there
  // takes the keyboard to the field, where the renderer's own control --
  // the typeahead among them -- edits the same draft.
  test('a textarea, a time, a timestamp and a lookup are edited in the record’s form', () => {
    expect(['notes', 'at', 'stamp', 'customer'].map((key) => how(key).kind)).toEqual(['form', 'form', 'form', 'form'])
    expect(editorOf(field({ key: 'customer', type: 'select', optionsSource: 'customers' }))).toBeNull()
  })

  // A row that cannot be opened cannot be edited: its edit would be a draft
  // no record holds. Without its own words F2 there would say nothing.
  test('a row with no token or no version is never edited, and says why', () => {
    expect(how('amount', {}, { ...SAVED, record: null })).toEqual({ kind: 'never', why: CANNOT_OPEN })
    expect(how('amount', {}, { ...SAVED, version: null })).toEqual({ kind: 'never', why: NO_VERSION })
  })

  // A row's box and its Delete take their own keys (0053, 0166): an editor there would hold no field.
  test('a column of the page’s own is never edited, and F2 there says nothing', () => {
    expect(how(null)).toEqual({ kind: 'never', why: null })
  })

  // Id is written by the database: drawn disabled by the published form itself, never by the person's policy.
  test('a field no write of the form takes is never edited, in the words of why', () => {
    expect(how('id')).toEqual({ kind: 'never', why: 'Id is not written from this form.' })
  })

  // 0122: an update refuses a field written on create only, so the update's
  // copy draws it disabled -- and a new record's copy, the create's, does not.
  test('a field written on create only is never edited on a saved record, and is on a new one', () => {
    expect(how('number')).toEqual({ kind: 'never', why: 'Number is given when the record is created.' })
    const created = drawnOf(drawnCopies(definition()).of(undefined, false), 'number')
    expect(created?.disabled).toBe(false)
  })

  // A field the policy lets this person read and not write.
  test('a field this person may only read is never edited, and says so', () => {
    expect(how('secret')).toEqual({ kind: 'never', why: 'You may read Secret, not change it.' })
  })

  // Read only, every field is disabled on the copy (UX-SPEC D19); the words are about the records, not one field.
  test('where this person may not update, no cell of a saved record is edited', () => {
    const readOnly = { operations: ['read', 'create'] as PublishedForm['operations'], writable: { create: ['amount'], update: null } }
    expect(how('amount', readOnly)).toEqual({ kind: 'never', why: READ_ONLY })
  })

  // A version that has ended is history (0113): its copy draws it read-only.
  test('an ended version is never edited', () => {
    const versions = { versions: { from: 'due', to: 'until', key: ['number'] } }
    expect(how('amount', versions, { ...SAVED, answers: { ...SAVED.answers, until: '2026-01-01' } })).toEqual({ kind: 'never', why: ENDED })
    expect(how('amount', versions).kind).toBe('cell')
  })

  // The state field is drawn as its moves (0127): a select of the state it
  // holds and each it may move to; with none, disabled -- in its own words.
  test('a state field is a select of its moves, and never edited where it has none', () => {
    const status = how('status')
    expect(status).toEqual({ kind: 'cell', editor: 'select' })
    const copy = drawnCopies(definition()).of(SAVED, false)
    expect(drawnOf(copy, 'status')?.def.options?.map((option) => option.value)).toEqual(['draft', 'placed'])
    expect(how('status', {}, { ...SAVED, answers: { status: 'shipped' } })).toEqual({ kind: 'never', why: 'Status cannot move from Shipped.' })
  })

  // A computed field's value is the form's rule's (formancy.ai 0181): a cell that took it would be overwritten.
  test('a computed field is never edited', () => {
    expect(how('total')).toEqual({ kind: 'never', why: "Total is worked out by the record's form." })
  })

  // On the open row the engine's snapshot decides, its conditions
  // evaluated: a field a condition disables now is not edited, though the
  // copy's own rules alone would allow it.
  test('the engine’s snapshot decides on the open row, a condition’s disabling among it', () => {
    const copy = drawnCopies(definition()).of(SAVED, false)
    const live = { ...(drawnOf(copy, 'amount') as DrawnField), disabled: true }
    expect(how('amount', {}, SAVED, live)).toEqual({ kind: 'never', why: "Amount cannot be changed now: the record's form holds it disabled." })
    const hidden = { ...(drawnOf(copy, 'amount') as DrawnField), visible: false }
    expect(how('amount', {}, SAVED, hidden)).toEqual({ kind: 'never', why: "Amount is hidden in the record's form now." })
  })
})

describe("a row's states, its mark and when leaving it saves (0179)", () => {
  // The mark is text in the row's first cell, read with the row: without it
  // a refused row would look like every other.
  test('a row says Saving…, Not saved or May have been saved, and nothing otherwise', () => {
    expect(
      [{ kind: 'clean' }, { kind: 'edited' }, { kind: 'saving' }, { kind: 'refused', outcome: 'stale', message: 'm' }, { kind: 'unknown', message: 'm' }].map(
        (state) => markOf(state as Parameters<typeof markOf>[0]),
      ),
    ).toEqual(['', '', 'Saving…', 'Not saved', 'May have been saved'])
  })

  // A save's answer is the row's state: stored, clean; lost, unknown; any
  // other refusal kept with the session's words. A submit the engine
  // refused sent nothing, and is refused too.
  test('a save’s answer is the row’s state', () => {
    expect(settled({ kind: 'saved', message: 'Saved.' })).toEqual({ kind: 'clean' })
    expect(settled({ kind: 'created', message: 'Created.' })).toEqual({ kind: 'clean' })
    expect(settled({ kind: 'stale', message: 'Changed.' })).toEqual({ kind: 'refused', outcome: 'stale', message: 'Changed.' })
    expect(settled({ kind: 'invalid', message: 'Fix.', declined: true })).toEqual({ kind: 'refused', outcome: 'invalid', message: 'Fix.' })
    expect(settled(null)).toEqual({ kind: 'refused', outcome: 'engine', message: '' })
    const unknown = { operation: 'update', record: 'k1:9', version: '3', message: 'Lost.' }
    expect(settled({ kind: 'unknown', message: 'Lost.', unknown } as never)).toEqual({ kind: 'unknown', message: 'Lost.' })
  })

  // Leaving saves only what the grid edited and still differs; a save out
  // holds the move until its answer -- the form's Save of a row the grid
  // edited among them, which is the row's save, so a second sent beside it
  // would be refused as busy and the move lost; a refused row is left
  // through the guard, as today, never by saving it again unchanged, and a
  // row the grid did not edit goes to the guard whatever the form's Save is
  // doing.
  test('leaving a row saves what the grid edited, waits for a save out, and otherwise goes', () => {
    expect(leaving({ kind: 'edited' }, true)).toBe('save')
    expect(leaving({ kind: 'edited' }, false)).toBe('go')
    expect(leaving({ kind: 'clean' }, true)).toBe('go')
    expect(leaving({ kind: 'saving' }, true)).toBe('wait')
    expect(leaving({ kind: 'refused', outcome: 'stale', message: '' }, true)).toBe('go')
    expect(leaving({ kind: 'edited' }, true, true)).toBe('wait')
    expect(leaving({ kind: 'clean' }, true, true)).toBe('go')
  })

  // Tab and Shift+Tab move among the row's editable cells shown, in their
  // order, and past either end leave the row's cells: a Tab that wrapped
  // would never save the row.
  test('Tab and Shift+Tab step through the editable cells and past either end', () => {
    const cells = ['due', 'amount', 'done']
    expect(stepFrom(cells, 'due', false)).toEqual({ kind: 'cell', field: 'amount' })
    expect(stepFrom(cells, 'done', false)).toEqual({ kind: 'past' })
    expect(stepFrom(cells, 'amount', true)).toEqual({ kind: 'cell', field: 'due' })
    expect(stepFrom(cells, 'due', true)).toEqual({ kind: 'past' })
  })
})

describe('what the grid’s line says of a save (0179)', () => {
  // What each answer says on the line, in the server's words where it has
  // some, with what to do: a stale row's changes are kept, a lost answer
  // is checked in the record's notice.
  test('each outcome in its words', () => {
    const order = { noun: 'Order', token: 'k1:9', declinedBy: "These words are the database's own." }
    expect(outcomeSaid({ kind: 'saved', message: 'Saved.' }, order)).toEqual({ said: ['Saved Order ', { code: 'k1:9' }, '.'], kind: 'stored' })
    expect(outcomeSaid({ kind: 'stale', message: 'Changed since.' }, order)).toEqual({ said: ['Changed since. ', STALE_KEPT], kind: 'refused' })
    expect(outcomeSaid({ kind: 'declined', message: 'Closed.' }, order)).toEqual({ said: ["Closed. These words are the database's own."], kind: 'refused' })
    expect(outcomeSaid({ kind: 'refused', message: 'Down.' }, order)).toEqual({ said: ['Down.'], kind: 'refused' })
    expect(outcomeSaid({ kind: 'invalid', message: 'Fix.', declined: true }, order)).toEqual({
      said: ["Not saved. Fix. These words are the database's own."],
      kind: 'refused',
    })
    expect(outcomeSaid({ kind: 'unknown', message: 'Lost.', unknown: {} } as never, order)).toEqual({ said: [`Lost. ${CHECK_IT}`], kind: 'refused' })
  })

  // The first invalid cell shown takes the keyboard; the rest are named on the line as the form's.
  test('an invalid save names the fields to fix, in the cell and in the record’s form', () => {
    expect(invalidSaid('Amount', [])).toBe('Not saved: Amount is to fix.')
    expect(invalidSaid('Amount', ['Notes'])).toBe("Not saved: Amount is to fix, and Notes in the record's form.")
    expect(invalidSaid(null, ['Notes', 'Time'])).toBe("Not saved: Notes and Time are to fix in the record's form.")
  })
})
