import type { FormSchema } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import type { StateMoves } from '../runtime.js'
import { startingDefaults } from './starting.js'

/*
 * The defaults one person's new record starts with (0149), decided once
 * for every page that draws the published form: a renderer submits every
 * field it draws, a disabled one too, so a default the person's create
 * does not accept would be sent untouched and the create refused (0117,
 * 0122), where the field left empty was left out and the create stored.
 */

/** A form whose three fields start at defaults, and one that has none. */
const FORM: FormSchema = {
  specVersion: '5',
  id: 'ticket',
  title: 'Ticket',
  model: {
    fields: [
      { key: 'note', type: 'text', label: 'Note', default: 'new' },
      { key: 'status', type: 'text', label: 'Status', default: 'open' },
      { key: 'priority', type: 'number', label: 'Priority', default: 2 },
      { key: 'owner', type: 'text', label: 'Owner' },
    ],
  },
}

const defaults = (form: FormSchema): Record<string, unknown> =>
  Object.fromEntries(form.model.fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])))

const moves = (field: string, from: Array<[string | null, string]>): StateMoves => ({ field, moves: from.map(([at, to]) => ({ from: at, to })), labels: [] })

describe('the defaults a person starts a new record with (0149)', () => {
  // A field their create does not accept keeps no default, and with no
  // create every field keeps none; the published form is left as it was,
  // and handed back itself where nothing is dropped. Watched failing with
  // the form served as published: note and priority kept theirs.
  test('keeps a default only on a field this person gives on create', () => {
    const before = JSON.stringify(FORM)
    expect(defaults(startingDefaults(FORM, ['status'], null))).toEqual({ status: 'open' })
    expect(defaults(startingDefaults(FORM, null, null))).toEqual({})
    expect(JSON.stringify(FORM)).toBe(before)
    expect(startingDefaults(FORM, ['note', 'status', 'priority', 'owner'], null)).toBe(FORM)
  })

  // The state field held to moves (0127) starts at its default only where
  // one of this person's moves starts a record there: any other would be
  // refused as a move they may not make, and so would a default where they
  // may start one nowhere. A whole number's state is compared as the
  // digits a state is spelled with. Watched failing with the moves left
  // unasked: the status kept open where the clerk's create starts at
  // draft, and with every move asked, not only a create's: it kept open
  // where only an update reaches it.
  test("keeps the state field's default only where a create move starts a record there", () => {
    const every = ['note', 'status', 'priority']
    expect(defaults(startingDefaults(FORM, every, moves('status', [[null, 'open']])))).toEqual({ note: 'new', status: 'open', priority: 2 })
    expect(defaults(startingDefaults(FORM, every, moves('status', [[null, 'draft']])))).toEqual({ note: 'new', priority: 2 })
    expect(defaults(startingDefaults(FORM, every, moves('status', [['draft', 'open']])))).toEqual({ note: 'new', priority: 2 })
    expect(defaults(startingDefaults(FORM, every, moves('priority', [[null, '2']])))).toEqual({ note: 'new', status: 'open', priority: 2 })
    expect(defaults(startingDefaults(FORM, every, moves('priority', [[null, '3']])))).toEqual({ note: 'new', status: 'open' })
  })
})
