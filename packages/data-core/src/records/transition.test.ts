import { describe, expect, test } from 'vitest'
import { checkTransition, stateField } from '../policy/evaluate.js'
import type { FormPolicy } from '../policy/types.js'
import { validatePolicy } from '../policy/validate.js'
import { planCreate, planUpdate } from './plan.js'
import { actor, CLERK, described, ORDER_POLICY, ORDER_TOKEN, PG, PG_ORDER } from './test-support.js'

/*
 * A state field's moves (0112): an order's status, which a clerk moves from
 * placed to shipped and a dispatcher from shipped to delivered, and nobody
 * back. Where a policy names them, every change of the field is a listed
 * move for one of the actor's roles, from the record as read.
 */

const DISPATCHER = actor(['clerk', 'dispatcher'])
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

/** The order as its person read it: placed, or another state. */
const asRead = (status: string) => ({ record: ORDER_TOKEN, version: '1', answers: { id: '9007199254740993', status, notes: null } })
const update = (policy: FormPolicy, who: typeof CLERK, status: string, from: string | undefined) =>
  planUpdate(PG, PG_ORDER, policy, who, ORDER_TOKEN, '1', { status }, from === undefined ? undefined : asRead(from), described(PG, PG_ORDER))
const ANSWERS = { customer: 'k1:1,1001', order_date: '2026-10-30', amount: '7.25' }

describe('a policy’s moves', () => {
  // Read and fitted as every other part of a policy: a field of this form,
  // text or a whole number, states spelled as the column holds them, each
  // move once, and every role one that may make it. Watched failing with a
  // move's operation left unchecked: the auditor's grant was accepted.
  test('are refused where they could not be a rule about this form', () => {
    expect(validatePolicy(MOVES, PG_ORDER)).toEqual({ ok: true })
    const refused = (transitions: unknown) => {
      const result = validatePolicy({ ...MOVES, transitions } as FormPolicy, PG_ORDER)
      return result.ok ? [] : result.problems
    }
    expect(refused({ field: 'nothing', moves: [{ from: null, to: 'a', roles: ['clerk'] }] })).toEqual([
      'transitions: nothing is not a column field of this form',
    ])
    expect(refused({ field: 'customer', moves: [{ from: null, to: 'a', roles: ['clerk'] }] })).toEqual([
      'transitions: customer is not a column field of this form',
    ])
    expect(refused({ field: 'paid', moves: [{ from: null, to: 'true', roles: ['clerk'] }] })).toEqual([
      'transitions: paid is boolean; a state field is text or a whole number',
    ])
    expect(refused({ field: 'status', moves: [{ from: 'placed', to: 'x'.repeat(21), roles: ['clerk'] }] })).toEqual([
      'transitions.moves[0].to is not spelled as status holds its values',
    ])
    expect(refused({ field: 'status', moves: [{ from: 'placed', to: 'shipped', roles: ['auditor'] }] })).toEqual([
      'transitions.moves[0] grants auditor, who may not update with this form',
    ])
    expect(refused({ field: 'status', moves: [{ from: null, to: 'placed', roles: ['intake'] }] })).toEqual([
      'transitions.moves[0] grants intake, who may not read and write status',
    ])
    expect(refused({ field: 'status', moves: [{ from: 'placed', to: 'placed', roles: ['clerk'] }] })).toEqual([
      'transitions.moves[0] moves the field to the value it already holds',
    ])
    expect(
      refused({
        field: 'status',
        moves: [
          { from: 'placed', to: 'shipped', roles: ['clerk'] },
          { from: 'placed', to: 'shipped', roles: ['clerk'] },
        ],
      }),
    ).toEqual(['transitions.moves[1] names a move a second time'])
    expect(refused({ field: 'status', moves: [] })).toEqual(['transitions.moves is not a list of at least one { from, to, roles }'])
    expect(refused({ field: 'status', moves: [{ from: 1, to: 'a', roles: ['clerk'], why: 'x' }] })).toEqual([
      'transitions.moves[0].why is not something this release reads, so nothing would enforce it',
      'transitions.moves[0].from is not a value of the field, or null for a create',
    ])
  })

  // The check itself: a listed move for one of the actor's roles, nothing
  // else -- never back, never past a step, never another role's move. A
  // policy without moves leaves every change to the field's write grant.
  // Its sentence names the field and no state. Watched failing with the
  // roles left out of it: the clerk delivered an order.
  test('allow a listed move for one of the actor’s roles, and nothing else', () => {
    expect(stateField(MOVES)).toBe('status')
    expect(checkTransition(MOVES, CLERK, PG_ORDER, 'placed', 'shipped')).toEqual({ ok: true })
    expect(checkTransition(MOVES, DISPATCHER, PG_ORDER, 'shipped', 'delivered')).toEqual({ ok: true })
    for (const [who, from, to] of [
      [CLERK, 'shipped', 'delivered'],
      [CLERK, 'shipped', 'placed'],
      [CLERK, 'placed', 'delivered'],
      [DISPATCHER, null, 'shipped'],
    ] as const) {
      expect(checkTransition(MOVES, who, PG_ORDER, from, to), `${String(from)} to ${to}`).toMatchObject({ ok: false, code: 'transition-denied' })
    }
    expect(JSON.stringify(checkTransition(MOVES, CLERK, PG_ORDER, 'shipped', 'delivered'))).not.toMatch(/shipped|delivered/)
    expect(stateField(ORDER_POLICY)).toBeNull()
    expect(checkTransition(ORDER_POLICY, CLERK, PG_ORDER, 'placed', 'delivered')).toEqual({ ok: true })
  })
})

describe('a move in the planner', () => {
  // An update moves the field from the record as read to the value sent;
  // the version it names guards that read, and the plan says whether it
  // moves, for the audit. The value it already holds is
  // no move; a change not listed is refused before any statement; and an
  // update whose record could not be read cannot say where it moves from.
  // Watched failing with the record as read left out of the check: the
  // clerk's placed-to-shipped was refused as a start; and with a record
  // that could not be read let through: the update planned.
  test('checks an update from the record as read', () => {
    expect(update(MOVES, CLERK, 'shipped', 'placed')).toMatchObject({ ok: true, moved: true })
    expect(update(MOVES, DISPATCHER, 'delivered', 'shipped')).toMatchObject({ ok: true, moved: true })
    expect(update(MOVES, CLERK, 'shipped', 'shipped')).toMatchObject({ ok: true, moved: false })
    expect(update(MOVES, CLERK, 'delivered', 'shipped')).toMatchObject({ ok: false, code: 'transition-denied' })
    expect(update(MOVES, CLERK, 'placed', 'shipped')).toMatchObject({ ok: false, code: 'transition-denied' })
    expect(update(MOVES, CLERK, 'shipped', undefined)).toMatchObject({
      ok: false,
      code: 'transition-denied',
      message: 'status moves only from where the record is, and this record could not be read to say.',
    })
    // Emptied: no move ends at nothing, so a nullable state field cannot be
    // cleared past the rule. Watched failing with a NULL taken for no
    // change: the update planned.
    const notes: FormPolicy = { ...MOVES, transitions: { field: 'notes', moves: [{ from: 'open', to: 'closed', roles: ['clerk'] }] } }
    const open = { ...asRead('placed'), answers: { ...asRead('placed').answers, notes: 'open' } }
    expect(planUpdate(PG, PG_ORDER, notes, CLERK, ORDER_TOKEN, '1', { notes: 'closed' }, open, described(PG, PG_ORDER))).toMatchObject({ ok: true })
    expect(planUpdate(PG, PG_ORDER, notes, CLERK, ORDER_TOKEN, '1', { notes: null }, open, described(PG, PG_ORDER))).toMatchObject({
      ok: false,
      code: 'transition-denied',
    })
    // Read at a newer version than the update names: the move would start
    // from a state the person never read, and the version guard refuses
    // the write as stale. Watched failing with the move checked against the
    // newer read: the clerk was refused a move instead of told stale.
    expect(
      planUpdate(PG, PG_ORDER, MOVES, CLERK, ORDER_TOKEN, '1', { status: 'shipped' }, { ...asRead('delivered'), version: '2' }, described(PG, PG_ORDER)),
    ).toMatchObject({ ok: true, moved: true })
    // Another field changed, the state left alone: nothing moves.
    expect(planUpdate(PG, PG_ORDER, MOVES, CLERK, ORDER_TOKEN, '1', { notes: 'x' }, asRead('placed'), described(PG, PG_ORDER))).toMatchObject({
      ok: true,
      moved: false,
    })
    // A policy without moves: the audit has no move to name.
    expect(update(ORDER_POLICY, CLERK, 'delivered', 'placed')).toMatchObject({ ok: true, moved: null })
  })

  // A create starts the field where a move from nothing puts it, or leaves
  // it to the column's default, the schema's own start. Watched failing
  // with the create's move left unchecked: an order was created shipped.
  test('checks where a create starts the field, and lets the default start it', () => {
    expect(planCreate(PG, PG_ORDER, MOVES, CLERK, { ...ANSWERS, status: 'placed' }, described(PG, PG_ORDER))).toMatchObject({ ok: true, moved: true })
    expect(planCreate(PG, PG_ORDER, MOVES, CLERK, { ...ANSWERS, status: 'shipped' }, described(PG, PG_ORDER))).toMatchObject({
      ok: false,
      code: 'transition-denied',
    })
    expect(planCreate(PG, PG_ORDER, MOVES, CLERK, ANSWERS, described(PG, PG_ORDER))).toMatchObject({ ok: true, moved: false })
  })
})
