// @vitest-environment node
//
// Node rather than jsdom: nothing here renders.
import { createSnapshot, describeRoutine, generateForm, sourceProblem } from '@formancy/data-core'
import type { ActionGround, ObjectMeta, RoutineMeta } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { actionNameFor, actionReasons, inputFor, routineFacts, routineKey, sourceOptions, startingAction, withSource } from './actions.js'
import type { ProposalRequest } from './api.js'
import { OWNER_ROUTINES, READER_ROUTINES, SQLSERVER_ROUTINES } from './test-server.js'

/*
 * What the Choose step starts an action with and keeps of it (0163),
 * without rendering: the routines are the suite's discovery's, as each
 * engine reports the fixture's.
 */

const shipping = (snapshot: typeof OWNER_ROUTINES): RoutineMeta => {
  const found = snapshot.routines?.find((routine) => routine.ref.name === 'ship_order')
  if (found === undefined) throw new Error('the snapshot records no ship_order')
  return found
}

describe('an action as it starts', () => {
  // A name is what a run's URL carries, so it starts as the routine's in
  // lower-case letters, digits and hyphens; and two routines of one name --
  // PostgreSQL's overloads -- start under two names, since the generator
  // throws the request for two actions of one. Watched failing with the
  // taken names unasked: the second overload started as ship-order too.
  test('is named after its routine, as a URL carries it, and apart from the names taken', () => {
    const routine = shipping(OWNER_ROUTINES)
    expect(actionNameFor(routine, [])).toBe('ship-order')
    expect(actionNameFor(routine, ['ship-order'])).toBe('ship-order-2')
    expect(actionNameFor(routine, ['ship-order', 'ship-order-2'])).toBe('ship-order-3')
    expect(actionNameFor({ ...routine, ref: { ...routine.ref, name: '__Close Order__' } }, [])).toBe('close-order')
    expect(startingAction(routine, [])).toEqual({ name: 'ship-order', routine: routine.ref, scope: 'record', parameters: [] })
  })

  // Each parameter's source is kept in the routine's order, whatever order
  // they were given in, and given nothing it is left out, as the generator
  // reads a parameter never mapped. Watched failing with a source appended
  // as chosen: tenant came before order_id.
  test('keeps its parameters in the routine’s order, and one given nothing out', () => {
    const routine = shipping(OWNER_ROUTINES)
    const both = withSource(withSource(startingAction(routine, []), routine, 'tenant', { attribute: 'tenant' }), routine, 'order_id', { key: 'id' })
    expect(both.parameters.map((entry) => entry.parameter)).toEqual(['order_id', 'tenant'])
    expect(withSource(both, routine, 'tenant', undefined).parameters).toEqual([{ parameter: 'order_id', from: { key: 'id' } }])
  })

  // What a routine is, as its box describes it: on SQL Server a procedure
  // that may act beyond the account's grants, by the engine's own rule.
  // Watched failing with the reach left out of the facts.
  test('is described by what the engine says of its routine', () => {
    expect(routineFacts(shipping(SQLSERVER_ROUTINES))).toBe(
      'procedure · returns nothing · may write · @order_id bigint, @tenant int · may act beyond this connection’s own grants',
    )
  })
})

/** The order as the Choose step asks of the generator: no lookup, its version column confirmed. */
const ORDER: ProposalRequest = {
  connection: 'fixture',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'row_version',
}
const order = OWNER_ROUTINES.objects.find((object) => object.ref.name === 'order') as ObjectMeta
const ground = (): ActionGround => {
  const { identity, concurrency, fields } = generateForm(OWNER_ROUTINES, ORDER).bindings
  return { identity, concurrency, fields }
}

describe('a parameter’s sources', () => {
  // A source the choice gave a parameter that the generator now refuses --
  // a column of another type, or one the form no longer binds -- stays
  // offered, so the select still shows what was chosen and the note under
  // the action, which names it, can be answered there; a source nobody
  // chose is offered only where the generator binds it. Watched failing
  // with the chosen source unasked: "expected [ 'field:tenant_id', …(6) ]
  // to include 'field:amount'"; and with one no candidate left unlisted:
  // "expected 'actor' to be 'field:gone'".
  test('keep one chosen that the generator now refuses, and offer no other it refuses', () => {
    const tenant = shipping(OWNER_ROUTINES).parameters[1] as RoutineMeta['parameters'][number]
    const values = (current: Parameters<typeof sourceOptions>[3]) => sourceOptions(order, ground(), tenant, current).map((option) => option.value)
    expect(sourceProblem(order, ground(), tenant, { field: 'amount' })).not.toBeNull()
    expect(values(undefined)).not.toContain('field:amount')
    expect(values({ field: 'amount' })).toContain('field:amount')
    expect(values({ field: 'gone' }).at(-1)).toBe('field:gone')
    expect(values(undefined)).not.toContain('field:gone')
  })

  // An answer's dialog field is keyed by the generator's own rule for a
  // field key, which throws the request for an input it would change: so
  // a parameter named `in`, a word formancy reserves, is asked as `in_`
  // and bound, rather than offered as an answer the generator throws.
  // Watched failing with the name used as it is: "action ship-order:
  // input "in" is not a field key formancy accepts".
  test('ask a parameter in its dialog under a key the generator accepts, whatever its name', () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_ROUTINES)
    const routines = (contents.routines ?? []).map((routine) => ({
      ...routine,
      parameters: routine.parameters.map((parameter) => (parameter.name === 'tenant' ? { ...parameter, name: 'in' } : parameter)),
    }))
    const renamed = createSnapshot({ ...contents, routines })
    const routine = renamed.routines?.[0] as RoutineMeta
    const asked = routine.parameters[1] as RoutineMeta['parameters'][number]
    const { bindings } = generateForm(renamed, {
      ...ORDER,
      actions: [withSource(withSource(startingAction(routine, []), routine, 'order_id', { key: 'id' }), routine, 'in', { input: inputFor(asked) })],
    })
    expect(bindings.actions?.[0]?.dialog?.model.fields.map((field) => field.key)).toEqual(['in_'])
    expect(sourceOptions(order, ground(), asked, undefined).find((option) => option.label === 'Asked in its dialog')?.from).toEqual({ input: 'in_' })
  })
})

describe('what the step says of the actions', () => {
  // A routine no run could call is refused whatever else the choice holds,
  // so its box stays disabled with its words even while the request
  // without actions is one the generator throws -- a version column the
  // order does not have -- which Generate says. Watched failing with
  // nothing said where that request throws: the reader's ship_order, which
  // it may not execute, had no refusal, and its box could be ticked.
  test('refuse a routine no run could call while the rest of the choice is refused', () => {
    const routine = shipping(READER_ROUTINES)
    const reader = READER_ROUTINES.objects.find((object) => object.ref.name === 'order') as ObjectMeta
    const reasons = actionReasons(READER_ROUTINES, reader, { ...ORDER, connection: 'fixture-reader', versionColumn: 'nope' })
    expect(reasons.ground).toBeNull()
    expect(reasons.routines.get(routineKey(routine.ref))).toMatch(/may not execute/)
  })

  // A field's note has the field's key for its subject, which an action
  // may be named too: refused, the action has no note of its own, and the
  // field's would describe what the action runs over -- "What it runs
  // over" read as a sentence about a column. Only an action the generator
  // binds has its note, and that one is the generator's of the action
  // (watched failing with every inferred note of the action's name taken:
  // "expected 'A whole number held as text, because …' to be undefined").
  test('take an action’s note only where the generator binds it, never a field’s of the same name', () => {
    const plain = generateForm(OWNER_ROUTINES, ORDER)
    const keys = new Set(plain.bindings.fields.map((binding) => binding.field))
    const field = plain.notes.find((note) => note.kind === 'inferred' && keys.has(note.subject) && /^[a-z][a-z0-9-]*$/.test(note.subject))
    if (field === undefined) throw new Error('no field of the order has a note an action could be named after')
    const routine = shipping(OWNER_ROUTINES)
    const tenant = routine.parameters[1] as RoutineMeta['parameters'][number]
    const unmapped = { ...startingAction(routine, []), name: field.subject }
    const refused = actionReasons(OWNER_ROUTINES, order, { ...ORDER, actions: [unmapped] })
    expect(refused.chosen.get(field.subject)).toMatch(/is not offered/)
    expect(refused.bound.get(field.subject)).toBeUndefined()

    const mapped = withSource(withSource(unmapped, routine, 'order_id', { key: 'id' }), routine, tenant.name, { input: inputFor(tenant) })
    const bound = actionReasons(OWNER_ROUTINES, order, { ...ORDER, actions: [mapped] })
    expect(bound.chosen.get(field.subject)).toBeUndefined()
    expect(bound.bound.get(field.subject)).toContain(`Runs ${describeRoutine(routine.ref)} over the open record`)
  })
})
