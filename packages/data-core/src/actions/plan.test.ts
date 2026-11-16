import { describe, expect, test } from 'vitest'
import type { FormBindings } from '../generate/types.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import {
  actor,
  AUDITOR,
  BOOLEAN,
  CLERK,
  column,
  DATE,
  DEFINITION,
  described,
  edited,
  INT32,
  INT64,
  ORDER_ID,
  ORDER_TOKEN,
  sales,
  TENANT_ONE,
} from '../records/test-support.js'
import type { RoutineMeta } from '../routines.js'
import { ACTION_REFUSED, planAction } from './plan.js'
import { ACTION_POLICY, actionForm, CLOSE_ORDER, pgParameter, pgRoutine, routineSnapshot, SHIP, SHIP_ORDER } from './test-actions.js'
import type { ActionChoice, DescribedRoutine } from './types.js'

/*
 * A run, planned (0159): the policy, the tokens, the codecs and the
 * bindings meet, so both adapters receive one typed request for the same
 * answers, and every refusal comes before anything is sent.
 */

const SOURCE = routineSnapshot()
const BINDINGS = actionForm(SOURCE).bindings
const ROUTINE_DEFINITION = 'the routine as the request described it'

/** A routine as a request's `describe` reads it: what discovery records, but whether it may be executed, and the adapter's token. */
function describedRoutine(routine: RoutineMeta): DescribedRoutine {
  const { executable: _executable, ...rest } = routine
  return { ...rest, definition: ROUTINE_DEFINITION }
}

const ANSWERS = { reason: 'late', due: '2026-11-20', urgent: false }
const ONE = [{ record: ORDER_TOKEN, version: '3' }]

function run(
  name: string,
  body: unknown,
  options: { context?: PolicyContext; policy?: FormPolicy; bindings?: FormBindings; routine?: RoutineMeta; table?: ReturnType<typeof described> } = {},
) {
  const bindings = options.bindings ?? BINDINGS
  return planAction(SOURCE, bindings, options.policy ?? ACTION_POLICY, options.context ?? CLERK, name, body, {
    table: options.table ?? described(SOURCE, bindings),
    routine: describedRoutine(options.routine ?? (name === 'ship' ? SHIP_ORDER : CLOSE_ORDER)),
  })
}

describe('a run planned', () => {
  // The one request an adapter runs: the record by its key and the version
  // read, under the clerk's tenant, the version column the run moves, and
  // each argument in the routine's order -- the key and the amount as
  // columns of the locked row, never a value from the browser; each answer
  // canonical; the actor's id from the verified context. Watched failing
  // with the field source planned as the browser's value: no answer named
  // it, so the plan had none.
  test('is the record, the move and every argument in the routine’s order', () => {
    expect(run('close', { records: ONE, answers: ANSWERS })).toEqual({
      ok: true,
      request: {
        action: 'close',
        target: { table: sales('order'), identity: [column('id', INT64)], concurrency: { kind: 'version-column', column: 'row_version' } },
        records: [{ key: [{ name: 'id', type: INT64, value: ORDER_ID }], expectedVersion: '3' }],
        filters: TENANT_ONE,
        through: [],
        move: { kind: 'increment', column: 'row_version' },
        routine: {
          ref: CLOSE_ORDER.ref,
          kind: 'function',
          arguments: [
            { parameter: 'order_id', typeId: '20', type: INT64, from: { kind: 'column', column: 'id' } },
            { parameter: 'reason', typeId: '25', type: CLOSE_ORDER.parameters[1]?.type, from: { kind: 'value', value: 'late' } },
            { parameter: 'due', typeId: '1082', type: DATE, from: { kind: 'value', value: '2026-11-20' } },
            { parameter: 'urgent', typeId: '16', type: BOOLEAN, from: { kind: 'value', value: false } },
            { parameter: 'closed_by', typeId: '25', type: CLOSE_ORDER.parameters[4]?.type, from: { kind: 'value', value: 'u-1' } },
            { parameter: 'amount', typeId: '1700', type: CLOSE_ORDER.parameters[5]?.type, from: { kind: 'column', column: 'amount' } },
          ],
        },
        definitions: { table: DEFINITION, routine: ROUTINE_DEFINITION },
      },
    })
  })

  // The tenant and the actor's id come from the verified context, each
  // through its parameter's codec: a UUID is passed as the codec spells it,
  // in lower case, whatever case the token carried, as a write's value is
  // (0008). Watched failing with the context's text passed as it was: the
  // UUID kept its capitals.
  test('gives the context’s values through their parameters’ codecs', () => {
    const planned = run('ship', { records: ONE, answers: {} })
    expect(planned.ok && planned.request.routine.arguments[1]).toEqual({ parameter: 'tenant', typeId: '23', type: INT32, from: { kind: 'value', value: '1' } })
    const markOrder = pgRoutine('mark_order', [pgParameter('order_id', 'int8'), pgParameter('by', 'uuid')])
    const source = routineSnapshot('postgres', [SHIP_ORDER, CLOSE_ORDER, markOrder])
    const mark: ActionChoice = {
      name: 'mark',
      routine: markOrder.ref,
      scope: 'record',
      parameters: [
        { parameter: 'order_id', from: { key: 'id' } },
        { parameter: 'by', from: { actor: 'id' } },
      ],
    }
    const { bindings } = actionForm(source, [mark])
    const context: PolicyContext = { actor: { id: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', roles: ['clerk'] }, attributes: { tenant: '1' } }
    const policy: FormPolicy = { ...ACTION_POLICY, actions: { mark: { roles: ['clerk'] } } }
    const marked = planAction(
      source,
      bindings,
      policy,
      context,
      'mark',
      { records: ONE, answers: {} },
      { table: described(source, bindings), routine: describedRoutine(markOrder) },
    )
    expect(marked.ok && marked.request.routine.arguments[1]?.from).toEqual({ kind: 'value', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  })
})

describe('what a run refuses before anything is sent', () => {
  // Two tokens of one key would lock one row and call the routine twice on
  // it. Watched failing with the check taken out: the plan's count check
  // answered `invalid-request` in its place.
  test('a key named twice', () => {
    expect(run('ship', { records: [...ONE, ...ONE], answers: {} })).toMatchObject({ ok: false, code: 'duplicate-record' })
  })

  // An action over the open record runs over exactly one, whatever the
  // body says. Watched failing with the count unchecked: two records were
  // planned.
  test('more or fewer than one record', () => {
    expect(run('ship', { records: [...ONE, { record: 'k1:7', version: '1' }], answers: {} })).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(run('ship', { records: [], answers: {} })).toMatchObject({ ok: false, code: 'invalid-request' })
  })

  // Every answer through its parameter's codec, every error collected by
  // input, so a person fixes them at once (0008); none echoes a value.
  // Watched failing with the first error returned alone.
  test('every answer its parameter refuses, by input', () => {
    const planned = run('close', { records: ONE, answers: { due: 'tomorrow', urgent: 'yes' } })
    expect(planned).toMatchObject({ ok: false, code: 'invalid-values' })
    expect(!planned.ok && 'fieldErrors' in planned && planned.fieldErrors.map((error) => [error.field, error.code])).toEqual([
      ['reason', 'required'],
      ['due', expect.any(String)],
      ['urgent', expect.any(String)],
    ])
    expect(JSON.stringify(planned)).not.toContain('tomorrow')
  })

  // An answer for no field of the dialog is over-posting, as a write's is.
  // Watched failing with unasked answers ignored: the amount was accepted.
  test('an answer for no field of the dialog', () => {
    expect(run('close', { records: ONE, answers: { ...ANSWERS, amount: '1' } })).toMatchObject({
      ok: false,
      code: 'over-posting',
      message: "amount is no field of close's dialog",
    })
  })

  // Deny by default, decided before the database or the token is looked
  // at: the auditor may not run `close`. And a context that cannot scope
  // the run -- no tenant -- is refused, never given an unscoped one or a
  // NULL tenant. Watched failing with the policy asked after the tokens:
  // a garbled token answered first.
  test('a person the policy does not let run it, or a missing attribute', () => {
    expect(run('close', { records: [{ record: 'garbled', version: '3' }], answers: ANSWERS }, { context: AUDITOR })).toMatchObject({
      ok: false,
      code: 'operation-denied',
    })
    expect(run('ship', { records: ONE, answers: {} }, { context: actor(['clerk'], {}) })).toMatchObject({ ok: false, code: 'missing-attribute' })
    expect(run('ship', { records: ONE, answers: {} }, { context: actor(['clerk'], { tenant: '' }) })).toMatchObject({ ok: false, code: 'missing-attribute' })
  })

  // A token that names no record, a version no token returns, an action the
  // form does not offer, a body of another shape. Watched failing with each
  // check taken out in turn.
  test('a token, a version, an action or a body that is not one', () => {
    expect(run('ship', { records: [{ record: 'garbled', version: '3' }], answers: {} })).toMatchObject({ ok: false, code: 'invalid-record-token' })
    expect(run('ship', { records: [{ record: ORDER_TOKEN, version: 'three' }], answers: {} })).toMatchObject({ ok: false, code: 'invalid-version' })
    expect(run('archive', { records: ONE, answers: {} })).toMatchObject({ ok: false, code: 'operation-unavailable' })
    expect(run('ship', { records: ONE })).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(run('ship', { records: [{ record: ORDER_TOKEN }], answers: {} })).toMatchObject({ ok: false, code: 'invalid-request' })
  })

  // The actor's id is text, and a parameter of a whole number cannot hold
  // `u-1`: refused, naming no value. Watched failing with the codec's
  // refusal ignored: the id was passed as it was.
  test('a context value its parameter cannot hold', () => {
    const source = routineSnapshot()
    const byActor = { ...SHIP, parameters: [SHIP.parameters[0] as (typeof SHIP.parameters)[number], { parameter: 'tenant', from: { actor: 'id' as const } }] }
    const bindings = actionForm(source, [byActor]).bindings
    const policy: FormPolicy = { ...ACTION_POLICY, actions: { ship: { roles: ['clerk'] } } }
    expect(run('ship', { records: ONE, answers: {} }, { bindings, policy })).toMatchObject({ ok: false, code: 'invalid-context' })
    expect(JSON.stringify(run('ship', { records: ONE, answers: {} }, { bindings, policy }))).not.toContain('u-1')
  })

  // A run moves the version column under the row filter; pinned by it, the
  // record would leave the rows the filter admits, as an update's would.
  // Watched failing with the check taken out.
  test('a row filter that pins the column a run moves', () => {
    const policy: FormPolicy = { ...ACTION_POLICY, rowFilters: [...ACTION_POLICY.rowFilters, { column: 'row_version', attribute: 'tenant' }] }
    expect(run('ship', { records: ONE, answers: {} }, { policy })).toMatchObject({ ok: false, code: 'invalid-policy' })
  })
})

describe('what a run is decided over', () => {
  // The database as this request described it (0041): a root whose key is
  // gone, or a routine whose parameters changed, refuses the run in words
  // that name neither. Watched failing with the routine's shape uncompared:
  // a routine taking text for the tenant was planned.
  test('a root or a routine that changed since the form was published', () => {
    const table = described(SOURCE, BINDINGS)
    const unkeyed = { ...table, primaryKey: null }
    expect(run('ship', { records: ONE, answers: {} }, { table: unkeyed })).toMatchObject({ ok: false, code: 'drift', message: ACTION_REFUSED })
    const retyped = {
      ...SHIP_ORDER,
      parameters: [
        SHIP_ORDER.parameters[0] as RoutineMeta['parameters'][number],
        { ...(CLOSE_ORDER.parameters[1] as RoutineMeta['parameters'][number]), name: 'tenant' },
      ],
    }
    const changed = run('ship', { records: ONE, answers: {} }, { routine: retyped })
    expect(changed).toMatchObject({
      ok: false,
      code: 'drift',
      message: ACTION_REFUSED,
      drift: [{ kind: 'routine-changed', subject: { kind: 'routine', routine: SHIP_ORDER.ref } }],
    })
    expect(run('ship', { records: ONE, answers: {} }, { routine: { ...SHIP_ORDER, reach: 'owner' } }).ok).toBe(true)
  })

  // A hand edit of the stored binding -- another type, another move, a
  // field key that is not the column's -- is refused, never run: the
  // generator's own rule asked again. Watched failing with
  // `bindingProblem` answering null.
  test('a binding the generator would not write', () => {
    const edit = (change: (action: NonNullable<FormBindings['actions']>[number]) => void) =>
      edited(BINDINGS, (draft) => change((draft.actions ?? [])[0] as NonNullable<FormBindings['actions']>[number]))
    const retyped = edit((action) => {
      ;(action.parameters[1] as { typeId: string }).typeId = '25'
    })
    expect(run('ship', { records: ONE, answers: {} }, { bindings: retyped })).toMatchObject({ ok: false, code: 'invalid-bindings' })
    const moved = edit((action) => {
      action.move = { kind: 'increment', column: 'amount' }
    })
    expect(run('ship', { records: ONE, answers: {} }, { bindings: moved })).toMatchObject({ ok: false, code: 'invalid-bindings' })
    const close = edited(BINDINGS, (draft) => {
      const amount = (draft.actions ?? [])[1]?.parameters[5] as { from: unknown }
      amount.from = { kind: 'field', field: 'notes', column: 'amount' }
    })
    expect(run('close', { records: ONE, answers: ANSWERS }, { bindings: close })).toMatchObject({ ok: false, code: 'invalid-bindings' })
  })
})
