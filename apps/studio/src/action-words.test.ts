// @vitest-environment node
//
// Node rather than jsdom: nothing here renders.
import { actionPresentationProblems, actionShapeProblems, generateForm, presentedActions } from '@formancy/data-core'
import type { ActionPresentation, FormBindings } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { actionWordsProblems, withActionWords, withInputWords } from './action-words.js'
import { OWNER_ROUTINES } from './test-server.js'

/*
 * The words of an action (0163) as the Presentation step keeps them: in
 * the one spelling the server reads, so what a person types publishes and
 * a word typed back to the generator's leaves nothing behind.
 */

/** The order with `ship_order` bound as `ship`, its tenant asked in its dialog: a form whose action has words to edit, and a dialog. */
const BINDINGS: FormBindings = generateForm(OWNER_ROUTINES, {
  connection: 'fixture',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'row_version',
  actions: [
    {
      name: 'ship',
      routine: { schema: 'sales', name: 'ship_order', signature: 'pg_catalog.int8, pg_catalog.int4' },
      scope: 'record',
      parameters: [
        { parameter: 'order_id', from: { key: 'id' } },
        { parameter: 'tenant', from: { input: 'tenant' } },
      ],
    },
  ],
}).bindings

/** Every step of `edits` from no words, each result one the server's own checks accept: its shape, and its fit to the bindings. */
function typed(...edits: Array<(actions: ActionPresentation[]) => ActionPresentation[]>): ActionPresentation[] {
  return edits.reduce<ActionPresentation[]>((actions, edit) => {
    const next = edit(actions)
    expect(next.length === 0 ? [] : [...actionShapeProblems(next), ...actionPresentationProblems(next, BINDINGS)]).toEqual([])
    return next
  }, [])
}

describe('an action’s words', () => {
  // The server refuses a label equal to the base's and an entry that says
  // nothing (0159), so a label typed back to the generator's, or emptied,
  // must leave no entry at all; any other is kept as typed. Watched
  // failing with the base's label kept: the server's check refused the
  // label typed back to "Ship".
  test('keeps a label only where it is not the generator’s', () => {
    expect(BINDINGS.actions?.map((action) => action.name)).toEqual(['ship'])
    expect(typed((actions) => withActionWords(actions, BINDINGS, 'ship', { label: 'Ship it' }))).toEqual([{ action: 'ship', label: 'Ship it' }])
    expect(
      typed(
        (actions) => withActionWords(actions, BINDINGS, 'ship', { label: 'Ship it' }),
        (actions) => withActionWords(actions, BINDINGS, 'ship', { label: 'Ship' }),
      ),
    ).toEqual([])
    expect(typed((actions) => withActionWords(actions, BINDINGS, 'ship', { label: '' }))).toEqual([])
  })

  // A sentence left blank is none, which a page words itself; the views
  // to read again are in the one order the server reads, and none is the
  // property left out. Watched failing with the views kept in the order
  // ticked: the server's shape check refused children before list.
  test('keeps sentences that say something, and the views in their order', () => {
    const words = typed(
      (actions) => withActionWords(actions, BINDINGS, 'ship', { confirm: 'Ship this order now?' }),
      (actions) => withActionWords(actions, BINDINGS, 'ship', { done: '   ' }),
      (actions) => withActionWords(actions, BINDINGS, 'ship', { refresh: ['children', 'list'] }),
    )
    expect(words).toEqual([{ action: 'ship', confirm: 'Ship this order now?', refresh: ['list', 'children'] }])
    expect(
      typed(
        () => words,
        (actions) => withActionWords(actions, BINDINGS, 'ship', { confirm: '' }),
        (actions) => withActionWords(actions, BINDINGS, 'ship', { refresh: [] }),
      ),
    ).toEqual([])
  })

  // A question's label is kept only where it differs from the field's, and
  // emptied help text over a field that has none is nothing, never a
  // removal the server refuses -- and the words land on the dialog a page
  // is served. Watched failing with emptied help text written as null:
  // the server's check refused the removal of help text the field never
  // had.
  test('keeps a question’s words only where they differ from its field’s, and they reach the dialog served', () => {
    const words = typed(
      (actions) => withInputWords(actions, BINDINGS, 'ship', 'tenant', { label: 'Which tenant ships it' }),
      (actions) => withInputWords(actions, BINDINGS, 'ship', 'tenant', { description: 'Only yours.' }),
      (actions) => withInputWords(actions, BINDINGS, 'ship', 'tenant', { description: '' }),
    )
    expect(words).toEqual([{ action: 'ship', inputs: [{ input: 'tenant', label: 'Which tenant ships it' }] }])
    const field = presentedActions(BINDINGS, words)[0]?.dialog?.model.fields.find((candidate) => candidate.key === 'tenant')
    expect(field?.label).toBe('Which tenant ships it')
    expect(typed((actions) => withInputWords(actions, BINDINGS, 'ship', 'tenant', { label: 'Tenant' }))).toEqual([])
  })

  // What the server refuses of the words is said in its words, and so is
  // what formancy's validator refuses of the dialog they make, which no
  // renderer would draw: help text past the 300 characters formancy holds.
  // Watched failing with the dialog left unvalidated: the help text was
  // said nothing of.
  test('says what the server and formancy’s validator refuse of them', () => {
    expect(actionWordsProblems([{ action: 'close', label: 'Close' }], BINDINGS)).toEqual(['/actions/0/action: the form binds no action close'])
    const long = withInputWords([], BINDINGS, 'ship', 'tenant', { description: 'x'.repeat(301) })
    expect(actionPresentationProblems(long, BINDINGS)).toEqual([])
    expect(actionWordsProblems(long, BINDINGS)).toEqual([expect.stringMatching(/^the dialog of ship, at \/model\/fields\/0\/description: /)])
    expect(actionWordsProblems([], BINDINGS)).toEqual([])
  })
})
