// @vitest-environment node
//
// Node rather than jsdom: nothing here renders.
import type { RoutineMeta } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { actionNameFor, routineFacts, startingAction, withSource } from './actions.js'
import { OWNER_ROUTINES, SQLSERVER_ROUTINES } from './test-server.js'

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
