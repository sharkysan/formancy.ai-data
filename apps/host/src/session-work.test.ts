import { createDataClient } from '@formancy/data-client'
import type { PublishedForm } from '@formancy/data-client'
import { describe, expect, test } from 'vitest'
import { createSession } from './session.js'

/*
 * What a pane's session says it would lose, and the host's copy of the form
 * it draws (0047), without a server: nothing here sends. What a save does to
 * the same answers -- "saving", "unknown", and the stored spelling becoming
 * the new baseline -- is session.test.ts's, against the real server.
 */

/** A client whose every request fails the test: opening and typing must ask nothing. */
const client = createDataClient({
  token: () => 'unused',
  fetch: () => {
    throw new Error('the session sent a request')
  },
})

const FIELDS = ['order', 'line_no', 'notes']

/** The form as the server sends it; each write it offers accepts every field unless `writable` says otherwise. */
function definition(operations: PublishedForm['operations'], writable?: PublishedForm['writable'], moves: PublishedForm['moves'] = null): PublishedForm {
  return {
    form: {
      specVersion: '3',
      id: 'pg-order-line',
      title: 'Order line',
      model: {
        fields: [
          { key: 'order', type: 'select', label: 'Order', optionsSource: 'pg-order-line.order' },
          { key: 'line_no', type: 'number', label: 'Line' },
          { key: 'notes', type: 'text', label: 'Notes' },
        ],
      },
    },
    operations,
    readable: ['order', 'line_no', 'notes'],
    list: null,
    versions: null,
    writable: writable ?? { create: operations.includes('create') ? FIELDS : null, update: operations.includes('update') ? FIELDS : null },
    moves,
  } as unknown as PublishedForm
}

const RECORD = { record: 'k1:7,1', version: '3', answers: { order: 'k1:7', line_no: 1, notes: 'as stored' } }

const disabled = (session: ReturnType<typeof createSession>): string[] =>
  (session.opened().engine.schema().logic?.rules ?? []).filter((rule) => rule.kind === 'disabled').map((rule) => rule.target)

describe('what a pane would lose', () => {
  // Opened, it holds nothing; typed into, it holds a change; typed back to
  // what it was, it holds nothing again. A guard that counted keystrokes
  // would ask about a form whose answers are what was saved.
  test('is a change of answers, measured against what it was opened with', () => {
    const session = createSession({ client, formId: 'pg-order-line', definition: definition(['read', 'update']), renderer: 'react' })
    session.open(RECORD)
    expect(session.work()).toBeNull()
    session.opened().engine.setValue(['notes'], 'typed')
    expect(session.work()).toBe('changed')
    session.opened().engine.setValue(['notes'], 'as stored')
    expect(session.work()).toBeNull()
  })

  // Discarding opens the form again as it was opened: the record, its
  // version and its answers, and nothing typed since.
  test('is dropped by discard(), which opens the record as it was', () => {
    const session = createSession({ client, formId: 'pg-order-line', definition: definition(['read', 'update']), renderer: 'angular' })
    session.open(RECORD)
    const { generation } = session.opened()
    session.opened().engine.setValue(['notes'], 'typed')
    session.discard()
    expect(session.opened().generation).toBe(generation + 1)
    expect(session.work()).toBeNull()
    expect((session.opened().engine.value() as Record<string, unknown>)['notes']).toBe('as stored')
    expect(session.state()).toEqual({ record: 'k1:7,1', version: '3', operation: 'update' })
  })

  // A new record preset with its parent holds nothing until a person types:
  // the page's own answer is not the person's work.
  test('does not count a preset answer as a change', () => {
    const session = createSession({
      client,
      formId: 'pg-order-line',
      definition: definition(['read', 'create', 'update']),
      renderer: 'react',
      fixed: ['order'],
    })
    session.open({ record: null, version: null, answers: { order: 'k1:7' } })
    expect(session.work()).toBeNull()
    expect(session.state().operation).toBe('create')
  })
})

describe("the host's copy of the form", () => {
  // The parent field is filled in by the page and drawn disabled, as the
  // generator draws a field nothing may write; a record the person may only
  // read has every field disabled, while a new one they may create has not.
  test('disables the fixed fields, and every field of a record that may not be updated', () => {
    const child = createSession({ client, formId: 'pg-order-line', definition: definition(['read', 'create', 'update']), renderer: 'react', fixed: ['order'] })
    child.open(RECORD)
    expect(disabled(child)).toEqual(['order'])
    const reader = createSession({ client, formId: 'pg-order-line', definition: definition(['read', 'create']), renderer: 'react' })
    reader.open(RECORD)
    expect(disabled(reader)).toEqual(['order', 'line_no', 'notes'])
    reader.open()
    expect(disabled(reader)).toEqual([])
  })

  // A field no write accepts from this person -- the notes, read and not
  // written -- is drawn disabled on a new record and on a saved one, as the
  // generator draws a field nothing may write; one a create alone accepts
  // is not (0117). Watched failing with the unwritten fields left out of
  // the drawn form: nothing was disabled.
  test('disables a field no write accepts from this person, and not one a create alone accepts', () => {
    const session = createSession({
      client,
      formId: 'pg-order-line',
      definition: definition(['read', 'create', 'update'], { create: ['order', 'line_no'], update: ['line_no'] }),
      renderer: 'react',
    })
    session.open()
    expect(disabled(session)).toEqual(['notes'])
    session.open(RECORD)
    expect(disabled(session)).toContain('notes')
  })

  // Each write as it accepts (0122): a field written on create only -- the
  // order, here -- is drawn writable on a new record and disabled on a
  // saved one, which an update would refuse it on; a field neither write
  // accepts is disabled on both. Watched failing with one drawing for both
  // writes, as 0117 drew them: the saved record's order was writable.
  test('draws a field written on create only writable on a new record and disabled on a saved one', () => {
    const session = createSession({
      client,
      formId: 'pg-order-line',
      definition: definition(['read', 'create', 'update'], { create: ['order', 'line_no'], update: ['line_no'] }),
      renderer: 'react',
    })
    session.open()
    expect(disabled(session)).toEqual(['notes'])
    session.open(RECORD)
    expect(disabled(session).sort()).toEqual(['notes', 'order'])
  })
})

describe('a state field drawn as its moves (0127)', () => {
  /** The notes held to moves, as a ticket's state is: a clerk opens one and closes it, nobody reopens it. */
  const MOVES: PublishedForm['moves'] = {
    field: 'notes',
    moves: [
      { from: null, to: 'open' },
      { from: 'open', to: 'closed' },
    ],
    labels: [],
  }
  const session = (moves: PublishedForm['moves']) =>
    createSession({ client, formId: 'pg-order-line', definition: definition(['read', 'create', 'update'], undefined, moves), renderer: 'react' })
  const notes = (drawn: ReturnType<typeof createSession>) =>
    drawn
      .opened()
      .engine.schema()
      .model.fields.find((field) => field.key === 'notes')
  const at = (state: string | null) => ({ ...RECORD, answers: { ...RECORD.answers, notes: state } })

  // A saved record's state is a choice of where it is and where this
  // person may move it, its label kept; one it may move nowhere from is
  // drawn disabled; a new record a choice of where a create may start it.
  // Watched failing with the session drawing the form as published: the
  // notes stayed a text box on every record.
  test('draws the state as the moves from where the record is, and disabled where there are none', () => {
    const drawn = session(MOVES)
    drawn.open(at('open'))
    expect(notes(drawn)).toEqual({
      key: 'notes',
      type: 'select',
      label: 'Notes',
      options: [
        { value: 'open', label: 'open' },
        { value: 'closed', label: 'closed' },
      ],
    })
    expect(disabled(drawn)).toEqual([])
    drawn.open(at('closed'))
    expect(notes(drawn)?.type).toBe('text')
    expect(disabled(drawn)).toEqual(['notes'])
    drawn.open()
    expect(notes(drawn)?.options).toEqual([{ value: 'open', label: 'open' }])
  })

  // A state the administrator labelled (0129) is offered by its label, its
  // value the state as the column holds it; one without a label by its
  // spelling. Watched failing with the labels left unread: Open was "open".
  test('offers each state by its label where it has one', () => {
    const drawn = session({ ...MOVES, labels: [{ state: 'open', label: 'Open' }] })
    drawn.open(at('open'))
    expect(notes(drawn)?.options).toEqual([
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'closed' },
    ])
  })

  // No moves, the published field; a whole number held to moves keeps its
  // box, which a choice's text would not fit, and is disabled where it may
  // go nowhere.
  test('leaves a field no moves hold, and keeps a whole number’s box', () => {
    const plain = session(null)
    plain.open(at('open'))
    expect(notes(plain)?.type).toBe('text')
    const numbered = session({ field: 'line_no', moves: [{ from: '1', to: '2' }], labels: [] })
    numbered.open(RECORD)
    expect(
      numbered
        .opened()
        .engine.schema()
        .model.fields.find((field) => field.key === 'line_no')?.type,
    ).toBe('number')
    expect(disabled(numbered)).toEqual([])
    numbered.open({ ...RECORD, answers: { ...RECORD.answers, line_no: 2 } })
    expect(disabled(numbered)).toEqual(['line_no'])
  })
})

describe("a new record starts with its column's default (0149)", () => {
  /** The form as `definition` gives it, in spec 5, the line number and the notes starting at their columns' defaults: as the server serves it to a person whose create takes both (0149). */
  function defaulted(...given: Parameters<typeof definition>): PublishedForm {
    const published = definition(...given)
    const fields = published.form.model.fields.map((field) =>
      field.key === 'line_no' ? { ...field, default: 1 } : field.key === 'notes' ? { ...field, default: 'open' } : field,
    )
    return { ...published, form: { ...published.form, specVersion: '5', model: { ...published.form.model, fields } } }
  }
  const session = (published: PublishedForm, fixed: string[] = []) =>
    createSession({ client, formId: 'pg-order-line', definition: published, renderer: 'react', fixed })
  const value = (drawn: ReturnType<typeof createSession>) => drawn.opened().engine.value()
  const RECORD_AT = (notes: string) => ({ ...RECORD.answers, notes })
  const defaultOf = (drawn: ReturnType<typeof createSession>, key: string) =>
    drawn
      .opened()
      .engine.schema()
      .model.fields.find((field) => field.key === key)?.default

  // New record is a fresh form: each field at its default, which is what
  // a save of it untouched sends, and nothing the person has to lose. A
  // record read, a copy and a draft start as handed in (formancy.ai 0197):
  // the stored line number kept, a field the reader may not see -- absent
  // from the record's answers -- left out, never filled with a default the
  // record may not hold, and a copy's left-out fields empty. Watched
  // failing with the record's answers merged over the defaults: the opened
  // record started its notes at open.
  test('starts a new record at each default, and a record read or copied as handed in', () => {
    const drawn = session(defaulted(['read', 'create', 'update']))
    drawn.open()
    expect(value(drawn)).toEqual({ line_no: 1, notes: 'open' })
    expect(drawn.work()).toBeNull()
    drawn.open({ record: 'k1:7,4', version: '3', answers: { order: 'k1:7', line_no: 4 } })
    expect(value(drawn)).toEqual({ order: 'k1:7', line_no: 4 })
    drawn.open({ record: null, version: null, answers: { order: 'k1:7' } })
    expect(value(drawn)).toEqual({ order: 'k1:7' })
  })

  // A child's new row is a new record too: its parent is the page's, and
  // every other field starts at its default, with nothing to lose until a
  // person types. Watched failing with the parent opened as a record's
  // answers, as before: the row started with its parent alone.
  test('starts a new record under its parent at each default and the parent', () => {
    const drawn = session(defaulted(['read', 'create', 'update']), ['order'])
    drawn.start({ order: 'k1:7' })
    expect(value(drawn)).toEqual({ order: 'k1:7', line_no: 1, notes: 'open' })
    expect(drawn.work()).toBeNull()
    expect(drawn.state()).toEqual({ record: undefined, version: undefined, operation: 'create' })
  })

  // The served form carries a default only where this person's create
  // takes it (0149, data-core's `startingDefaults`), so the host draws what
  // it is served. A state field's choice on a new record starts at it --
  // a state a create of theirs starts the record in -- and on a saved
  // record carries none: the record opens at the state it holds, and a
  // default the choice does not offer would stop the engine opening it. A
  // whole number's box, which offers no states, keeps it. Watched failing
  // with the choice carrying the default on every record (the engine
  // refused to open the closed ticket: open is not one of its options),
  // and with the choice carrying none, as it was built before (the new
  // ticket started empty).
  test("starts a new record's state at the served default, and a saved record's choice at the state it holds", () => {
    const moves: PublishedForm['moves'] = {
      field: 'notes',
      moves: [
        { from: null, to: 'open' },
        { from: 'open', to: 'closed' },
        { from: 'closed', to: 'archived' },
      ],
      labels: [],
    }
    const tickets = session(defaulted(['read', 'create', 'update'], undefined, moves))
    tickets.open()
    expect(value(tickets)).toEqual({ line_no: 1, notes: 'open' })
    tickets.open({ ...RECORD, answers: { ...RECORD.answers, notes: 'closed' } })
    expect({ value: value(tickets), default: defaultOf(tickets, 'notes') }).toEqual({ value: RECORD_AT('closed'), default: undefined })
    const numbered = session(defaulted(['read', 'create', 'update'], undefined, { field: 'line_no', moves: [{ from: null, to: '1' }], labels: [] }))
    numbered.open()
    expect(value(numbered)).toEqual({ line_no: 1, notes: 'open' })
  })
})
