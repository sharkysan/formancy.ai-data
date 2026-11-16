import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import { actionForm, CLOSE, CLOSE_ORDER, pgParameter, pgRoutine, routineSnapshot, SHIP, SHIP_ORDER } from '../actions/test-actions.js'
import type { ActionPresentation } from './actions.js'
import { actionShapeProblems, presentedActions } from './actions.js'
import { applyPresentation, presentationShapeProblems } from './apply.js'
import { rebasePresentation } from './rebase.js'
import type { PresentationOverrides } from './types.js'
import { PRESENTATION_VERSION } from './types.js'

/*
 * The words of a form's actions (0159): a patch over what the generator
 * wrote, applied and checked at publish as the form's presentation is
 * (0030), and carried to a regenerated base by the action's name and each
 * input's key. Words alone: nothing a presentation holds can retype a
 * dialog's field, add one or bind another routine.
 */

const GENERATED = actionForm()

function presented(actions: ActionPresentation[]): PresentationOverrides {
  return { version: PRESENTATION_VERSION, fields: [], sections: [], actions }
}

const WORDS: ActionPresentation[] = [
  { action: 'ship', label: 'Send it', done: 'On its way.' },
  {
    action: 'close',
    confirm: 'Close this order?',
    refresh: ['list', 'children'],
    inputs: [
      { input: 'reason', label: 'Why', description: 'Shown to the customer.' },
      { input: 'urgent', label: 'Urgent?' },
    ],
  },
]

describe('the words of an action', () => {
  // A patch that edits words alone publishes: the form itself is the base,
  // and the actions a page is offered carry the words, the dialog's title
  // the action's label, and the dialog still one formancy accepts. Watched
  // failing with the words not applied to the dialog: the label stayed
  // the generator's.
  test('publish, and reach the dialog a page is offered', () => {
    const applied = applyPresentation(GENERATED.form, presented(WORDS), GENERATED.bindings)
    expect(applied).toEqual({ ok: true, form: GENERATED.form })
    const [ship, close] = presentedActions(GENERATED.bindings, WORDS)
    expect(ship).toEqual({ name: 'ship', label: 'Send it', scope: 'record', confirm: null, done: 'On its way.', dialog: null, refresh: [] })
    expect(close?.confirm).toBe('Close this order?')
    expect(close?.refresh).toEqual(['list', 'children'])
    expect(close?.dialog?.title).toBe('Close')
    expect(close?.dialog?.model.fields.map((field) => [field.key, field.label, field.description ?? null, field.type, field.required ?? false])).toEqual([
      ['reason', 'Why', 'Shown to the customer.', 'textarea', true],
      ['due', 'Due', null, 'date', true],
      ['urgent', 'Urgent?', null, 'checkbox', false],
    ])
    expect(validateSchema(close?.dialog).valid).toBe(true)
    // Nothing presented: what the generator wrote, served as stored.
    expect(presentedActions(GENERATED.bindings, undefined)[1]?.dialog).toEqual(GENERATED.bindings.actions?.[1]?.dialog)
  })

  // Only words: a field's type, whether it is required, a new field, a
  // routine -- none is a property a presentation holds, so none reaches
  // the dialog. Watched failing with the input's unknown properties
  // ignored: `type` passed the shape.
  test('cannot retype a field, add one or bind a routine', () => {
    expect(actionShapeProblems([{ action: 'close', inputs: [{ input: 'reason', type: 'number' }] }])).toEqual([
      "/actions/0/inputs/0 holds a property an input's words do not",
    ])
    expect(actionShapeProblems([{ action: 'close', routine: SHIP_ORDER.ref }])).toEqual(["/actions/0 holds a property an action's words do not"])
    expect(presentationShapeProblems({ ...presented(WORDS), actions: [] })).toEqual([
      'actions must be a list of one or more actions’ words, left out where there are none',
    ])
  })

  // One spelling, as every presentation has: what the base says, an entry
  // that says nothing, an action or an input the bindings lack, a refresh
  // out of order -- each refused at publish. Watched failing with each
  // check taken out of `actionPresentationProblems` and
  // `actionShapeProblems` in turn.
  test('are refused where they say nothing new or name nothing bound', () => {
    const problems = (actions: ActionPresentation[]) => {
      const applied = applyPresentation(GENERATED.form, presented(actions), GENERATED.bindings)
      return applied.ok ? [] : applied.problems
    }
    expect(problems([{ action: 'archive', label: 'Archive' }])).toEqual(['/actions/0/action: the form binds no action archive'])
    expect(problems([{ action: 'ship', label: 'Ship' }])).toEqual(["/actions/0/label: equals the base's; leave it out"])
    expect(problems([{ action: 'ship' }])).toEqual(['/actions/0: says nothing; leave the action out'])
    expect(problems([{ action: 'close', inputs: [{ input: 'amount', label: 'Amount' }] }])).toEqual([
      "/actions/0/inputs/0/input: close's dialog has no field amount",
    ])
    expect(problems([{ action: 'close', inputs: [{ input: 'reason', label: 'Reason' }] }])).toEqual([
      "/actions/0/inputs/0/label: equals the base's; leave it out",
    ])
    expect(problems([{ action: 'close', inputs: [{ input: 'reason', description: null }] }])).toEqual([
      '/actions/0/inputs/0/description: the base has no help text to remove; leave it out',
    ])
    expect(
      problems([
        {
          action: 'close',
          inputs: [
            { input: 'urgent', label: 'U' },
            { input: 'reason', label: 'R' },
          ],
        },
      ]),
    ).toEqual(["/actions/0/inputs: not in the dialog's field order"])
    expect(problems([{ action: 'ship', inputs: [{ input: 'reason', label: 'R' }] }])).toEqual(['/actions/0/inputs: ship has no dialog'])
    expect(problems([...WORDS].reverse())).toEqual(["/actions: not in the bindings' action order"])
    expect(actionShapeProblems([{ action: 'ship', refresh: ['children', 'list'] }])).toEqual([
      '/actions/0/refresh must be one or both of list and children, each once, in that order',
    ])
    expect(
      actionShapeProblems([
        { action: 'ship', done: 'x' },
        { action: 'ship', done: 'y' },
      ]),
    ).toEqual(['/actions/1: ship appears twice'])
  })
})

describe('the words carried to a regenerated base', () => {
  const published = (actions: ActionPresentation[]) => ({ base: GENERATED.form, presentation: presented(actions), bindings: GENERATED.bindings })

  // By the action's name and each input's key: the words follow the action
  // whatever the generator now writes around them. An action the request
  // no longer names drops its words, said; so does an input its dialog no
  // longer asks. Watched failing with the actions' words left out of the
  // rebase: every word was lost, and none was said.
  test('follow the action by its name and each input by its key', () => {
    const reworded = pgRoutine('close_order', [
      pgParameter('order_id', 'int8'),
      pgParameter('reason', 'text'),
      pgParameter('closed_by', 'text'),
      pgParameter('amount', 'numeric'),
    ])
    const source = routineSnapshot('postgres', [SHIP_ORDER, reworded])
    const close = {
      ...CLOSE,
      routine: reworded.ref,
      parameters: CLOSE.parameters.filter((entry) => ['order_id', 'reason', 'closed_by', 'amount'].includes(entry.parameter)),
    }
    const regenerated = actionForm(source, [SHIP, close])
    const rebased = rebasePresentation(published(WORDS), { base: regenerated.form, bindings: regenerated.bindings })
    expect(rebased.presentation.actions).toEqual([
      { action: 'ship', label: 'Send it', done: 'On its way.' },
      {
        action: 'close',
        confirm: 'Close this order?',
        refresh: ['list', 'children'],
        inputs: [{ input: 'reason', label: 'Why', description: 'Shown to the customer.' }],
      },
    ])
    expect(rebased.conflicts).toEqual([
      {
        kind: 'action-input-dropped',
        action: 'close',
        input: 'urgent',
        resolution: 'dropped',
        message: "The words of urgent in action close's dialog were dropped: the regenerated dialog asks for no urgent.",
      },
    ])

    const without = actionForm(source, [SHIP])
    const dropped = rebasePresentation(published(WORDS), { base: without.form, bindings: without.bindings })
    expect(dropped.presentation.actions).toEqual([{ action: 'ship', label: 'Send it', done: 'On its way.' }])
    expect(dropped.conflicts.map((conflict) => conflict.kind)).toEqual(['action-dropped'])
  })

  // An action still bound whose every word is dropped leaves no entry,
  // which would say nothing, and a form left with none leaves `actions`
  // out, never `[]`, so the carried presentation is one a publish accepts.
  // Watched failing with an entry carried however little it says: the
  // rebase threw on its own presentation, an entry that says nothing.
  test('leave nothing behind where nothing is carried', () => {
    const none = actionForm(routineSnapshot('postgres', [SHIP_ORDER, CLOSE_ORDER]), [])
    const rebased = rebasePresentation(published(WORDS), { base: none.form, bindings: none.bindings })
    expect(Object.hasOwn(rebased.presentation, 'actions')).toBe(false)
    expect(rebased.conflicts.map((conflict) => conflict.kind)).toEqual(['action-dropped', 'action-dropped'])
    const unasked = { ...CLOSE_ORDER, parameters: CLOSE_ORDER.parameters.filter((parameter) => parameter.name !== 'urgent') }
    const routine = { ...unasked, ref: { ...unasked.ref, signature: 'pg_catalog.int8, pg_catalog.text, pg_catalog.date, pg_catalog.text, pg_catalog.numeric' } }
    const asked = actionForm(routineSnapshot('postgres', [SHIP_ORDER, routine]), [
      SHIP,
      { ...CLOSE, routine: routine.ref, parameters: CLOSE.parameters.filter((entry) => entry.parameter !== 'urgent') },
    ])
    expect(asked.bindings.actions?.map((action) => action.name)).toEqual(['ship', 'close'])
    const onlyUrgent = rebasePresentation(published([{ action: 'close', inputs: [{ input: 'urgent', label: 'Urgent?' }] }]), {
      base: asked.form,
      bindings: asked.bindings,
    })
    expect(Object.hasOwn(onlyUrgent.presentation, 'actions')).toBe(false)
    expect(onlyUrgent.conflicts.map((conflict) => conflict.kind)).toEqual(['action-input-dropped'])
  })
})
