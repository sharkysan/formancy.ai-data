import { describe, expect, test } from 'vitest'
import type { NormalizedType, ObjectMeta } from '../metadata.js'
import { driftRefusal, NOTHING_LEFT, READ_REFUSED, runtimeOperations, WRITE_REFUSED } from './drift.js'
import { planCreate, planUpdate } from './plan.js'
import type { DescribedTable } from './types.js'
import { ANSWERS, AUDITOR, CLERK, DEFINITION, described, MS, MS_ORDER, ORDER_POLICY, ORDER_TOKEN, PG, PG_ORDER, snapshot, text } from './test-support.js'

/*
 * What the planners decide about the database as a request described it
 * (0041). The description is the order table as a snapshot changed by hand
 * would describe it: the planner never sees how it was read, only what it
 * says, and decides with drift review's own root families.
 */

/** The order table described after `edit`, carrying `definition`. */
function after(kind: 'postgres' | 'sqlserver', edit: (order: ObjectMeta) => void, definition = DEFINITION): DescribedTable {
  const changed = snapshot(kind, (objects) => edit(objects.find((object) => object.ref.name === 'order') as ObjectMeta))
  return { ...described(changed, kind === 'postgres' ? PG_ORDER : MS_ORDER), definition }
}

function retyped(name: string, type: NormalizedType, databaseType: string): (order: ObjectMeta) => void {
  return (order) => Object.assign(order.columns.find((column) => column.name === name) as object, { type, databaseType })
}

const AMOUNT_AS_TEXT = retyped('amount', text(20), 'varchar(20)')
const GROUP_NARROWED = retyped('group', text(20), 'varchar(20)')
const GROUP_WIDENED = retyped('group', text(100), 'varchar(100)')
const KEY_DROPPED = (order: ObjectMeta): void => {
  order.primaryKey = null
}

describe('driftRefusal and runtimeOperations', () => {
  // The three outcomes per operation, from one report. A read refused for a
  // narrowing would close every form whose writes a narrowing stopped; a
  // write let through a narrowing is the reproduction's 1234.57.
  test('refuse a read only when what the form shows breaks, and a write when a change stops it', () => {
    expect(driftRefusal(PG, PG_ORDER, ORDER_POLICY, after('postgres', AMOUNT_AS_TEXT), 'read')).toMatchObject({ ok: false, code: 'drift', message: READ_REFUSED })
    expect(driftRefusal(PG, PG_ORDER, ORDER_POLICY, after('postgres', GROUP_NARROWED), 'read')).toBeUndefined()
    expect(driftRefusal(PG, PG_ORDER, ORDER_POLICY, after('postgres', GROUP_NARROWED), 'create')).toMatchObject({ ok: false, code: 'drift', message: WRITE_REFUSED })
    expect(driftRefusal(PG, PG_ORDER, ORDER_POLICY, after('postgres', KEY_DROPPED), 'update')).toMatchObject({ ok: false, code: 'drift' })
    expect(driftRefusal(PG, PG_ORDER, ORDER_POLICY, after('postgres', KEY_DROPPED), 'create')).toBeUndefined()
    expect(driftRefusal(PG, PG_ORDER, ORDER_POLICY, described(PG, PG_ORDER), 'update')).toBeUndefined()
  })

  // The person is told an administrator must review the form; the log is
  // told which changes, by kind -- and only the log, because a change's
  // message names columns and types.
  test('a refusal names the blocking changes for the log, and its sentence names no column', () => {
    const refusal = driftRefusal(PG, PG_ORDER, ORDER_POLICY, after('postgres', GROUP_NARROWED), 'update')
    expect(refusal?.drift?.map((change) => [change.kind, change.affects])).toEqual([['column-tightened', ['group']]])
    for (const sentence of [READ_REFUSED, WRITE_REFUSED, NOTHING_LEFT]) expect(sentence).not.toMatch(/group|varchar|amount/)
  })

  // What GET offers is the runtime's verdict, from the same report.
  test('runtimeOperations is the report’s runtime verdict', () => {
    expect(runtimeOperations(MS, MS_ORDER, ORDER_POLICY, after('sqlserver', KEY_DROPPED))).toMatchObject({ ok: true, verdict: { readable: true, writable: { create: true, update: false } } })
    expect(runtimeOperations(MS, MS_ORDER, ORDER_POLICY, described(MS, MS_ORDER))).toEqual({ ok: true, verdict: { readable: true, writable: { create: true, update: true } }, drift: [] })
  })

  // Bindings that do not fit their own snapshot cannot be compared, and
  // the planner and the bundle's check refuse them first; asked anyway, the
  // comparison refuses rather than throw out of a request.
  test('bindings that cannot be compared are invalid-bindings, never a throw', () => {
    const ghost = { ...PG_ORDER, identity: ['order_date'] }
    expect(driftRefusal(PG, ghost, ORDER_POLICY, described(PG, PG_ORDER), 'read')).toMatchObject({ ok: false, code: 'invalid-bindings' })
    expect(runtimeOperations(PG, ghost, ORDER_POLICY, described(PG, PG_ORDER))).toMatchObject({ ok: false, code: 'invalid-bindings' })
  })
})

describe('planCreate over a description', () => {
  // Without the check the reproduction's create was planned and sent.
  test('refuses drift when the description stops create, after the policy and before the codecs', () => {
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, ANSWERS, after('postgres', GROUP_NARROWED))).toMatchObject({ ok: false, code: 'drift', drift: [{ kind: 'column-tightened' }] })
    // Who may act first: the auditor may not create, whatever the database says.
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, AUDITOR, ANSWERS, after('postgres', GROUP_NARROWED))).toMatchObject({ ok: false, code: 'operation-denied' })
    // And before what was sent: an answer the codec refuses is still drift on a form that cannot save.
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, amount: 'many' }, after('postgres', GROUP_NARROWED))).toMatchObject({ ok: false, code: 'drift' })
  })

  // A widening is information (0010); refusing it would stop every form
  // whose table grew, the e2e's step 4 among them.
  test('plans after a widening, and the insert carries the description’s definition', () => {
    const planned = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, ANSWERS, after('postgres', GROUP_WIDENED, 'widened@read committed'))
    expect(planned).toMatchObject({ ok: true, request: { definition: 'widened@read committed' } })
  })
})

describe('planUpdate over a description', () => {
  test('refuses drift when the description stops update, after the policy and before the token, the version and the codecs', () => {
    const narrowed = after('postgres', GROUP_NARROWED)
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' }, undefined, narrowed)).toMatchObject({ ok: false, code: 'drift' })
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' }, undefined, after('postgres', KEY_DROPPED))).toMatchObject({
      ok: false,
      code: 'drift',
      drift: [{ kind: 'identity-key-changed' }],
    })
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, AUDITOR, ORDER_TOKEN, '1', { notes: 'x' }, undefined, narrowed)).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, 'k1:x', 'not a version', { amount: 'many' }, undefined, narrowed)).toMatchObject({ ok: false, code: 'drift' })
  })

  test('plans after a widening, and the update carries the description’s definition', () => {
    const planned = planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' }, undefined, after('postgres', GROUP_WIDENED, 'widened@repeatable read'))
    expect(planned).toMatchObject({ ok: true, request: { definition: 'widened@repeatable read' } })
  })
})
