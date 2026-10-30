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

function definition(operations: PublishedForm['operations']): PublishedForm {
  return {
    form: {
      specVersion: '3',
      id: 'pg-order-line',
      title: 'Order line',
      model: {
        fields: [
          { key: 'order', type: 'select', label: 'Order', optionsSource: 'pg-order-line.order' },
          { key: 'line_no', type: 'integer', label: 'Line' },
          { key: 'notes', type: 'text', label: 'Notes' },
        ],
      },
    },
    operations,
    readable: ['order', 'line_no', 'notes'],
    list: null,
    versions: null,
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
    const session = createSession({ client, formId: 'pg-order-line', definition: definition(['read', 'create', 'update']), renderer: 'react', fixed: ['order'] })
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
})
