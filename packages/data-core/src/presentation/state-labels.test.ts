import { describe, expect, test } from 'vitest'
import { ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import { stateMoves } from '../policy/evaluate.js'
import type { FormPolicy } from '../policy/types.js'
import { actor, CLERK, ORDER_POLICY, PG_ORDER } from '../records/test-support.js'
import { presentationShapeProblems } from './apply.js'
import { rebasePresentation } from './rebase.js'
import { stateLabelProblems, statesOf } from './state-labels.js'
import { EMPTY_PRESENTATION } from './types.js'
import type { StateLabel } from './types.js'

/*
 * The labels of a state field's states (0129), as data: their shape on
 * every read, their fit to the policy's moves at a write, their carry
 * through a regeneration, and which a person is offered beside their moves.
 * Over the order's status, which a clerk places and ships and a dispatcher
 * delivers, as the moves' own cases have it.
 */

const MOVES: FormPolicy = {
  ...ORDER_POLICY,
  operations: { ...ORDER_POLICY.operations, update: ['clerk', 'dispatcher'] },
  fields: { ...ORDER_POLICY.fields, status: { read: ['clerk', 'auditor', 'dispatcher'], write: ['clerk', 'dispatcher'] } },
  transitions: {
    field: 'status',
    moves: [
      { from: null, to: 'placed', roles: ['clerk'] },
      { from: 'placed', to: 'shipped', roles: ['clerk'] },
      { from: 'shipped', to: 'delivered', roles: ['dispatcher'] },
    ],
  },
}
const LABELS: StateLabel[] = [
  { state: 'placed', label: 'Placed' },
  { state: 'shipped', label: 'On its way' },
  { state: 'delivered', label: 'Delivered' },
]

describe('state labels', () => {
  // What a stored presentation may hold: a state as its column holds it,
  // once, and words for it; none is the property left out. Watched failing
  // with states not a property of a presentation: every label was refused.
  test('are read by shape: a state once, and words a person can read', () => {
    expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, states: LABELS })).toEqual([])
    expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, states: [] })).toEqual(['states: labels none; leave it out'])
    expect(
      presentationShapeProblems({
        ...EMPTY_PRESENTATION,
        states: [
          { state: 'placed', label: 'Placed' },
          { state: 'placed', label: 'Again' },
          { state: 'shipped', label: ' ' },
          { state: '', label: 'x' },
          { state: 'x' },
        ],
      }),
    ).toEqual([
      '/states/1: placed is labelled twice',
      '/states/2/label needs words a person can read',
      '/states/3/state must be a state, as its column holds it',
      '/states/4/label must be text',
    ])
  })

  // A label for a state the policy's moves never name would be shown
  // nowhere, and one with no moves at all has nothing to label. Watched
  // failing with every label let through: lost was stored.
  test('fit the states the policy’s moves name, and nothing else', () => {
    expect(statesOf(MOVES)).toEqual(['placed', 'shipped', 'delivered'])
    expect(stateLabelProblems(LABELS, MOVES)).toEqual([])
    expect(stateLabelProblems([...LABELS, { state: 'lost', label: 'Lost' }], MOVES)).toEqual(["/states/3: lost is no state the policy's moves name."])
    expect(stateLabelProblems(LABELS, ORDER_POLICY)).toEqual(['/states: the policy holds no field to moves, so there is no state to label.'])
    expect(stateLabelProblems([], ORDER_POLICY)).toEqual([])
  })

  // A state is a value, not a field key: a regeneration carries its label
  // as it is. Watched failing with states left out of the carried
  // presentation: the labels were gone.
  test('are carried through a regeneration as they are', () => {
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const next = generateForm(snapshot(), ORDER)
    const rebased = rebasePresentation(
      { base: form, presentation: { ...EMPTY_PRESENTATION, states: LABELS }, bindings },
      { base: next.form, bindings: next.bindings },
    )
    expect(rebased.presentation.states).toEqual(LABELS)
  })

  // A person is offered the labels of the states their own moves name, and
  // not of one only another role moves to. Watched failing with every
  // label offered: the clerk was told what delivered is called.
  test('are offered beside a person’s moves, for the states those name', () => {
    expect(stateMoves(MOVES, CLERK, PG_ORDER, LABELS)?.labels).toEqual([
      { state: 'placed', label: 'Placed' },
      { state: 'shipped', label: 'On its way' },
    ])
    expect(stateMoves(MOVES, actor(['dispatcher']), PG_ORDER, LABELS)?.labels).toEqual([
      { state: 'shipped', label: 'On its way' },
      { state: 'delivered', label: 'Delivered' },
    ])
    expect(stateMoves(MOVES, CLERK, PG_ORDER)?.labels).toEqual([])
  })
})
