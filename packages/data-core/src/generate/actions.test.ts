import { createFormEngine } from '@formancy/core'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import type { ActionChoice } from '../actions/types.js'
import {
  actionForm,
  CLOSE,
  CLOSE_ORDER,
  msParameter,
  msRoutine,
  orderRequest,
  pgParameter,
  pgRoutine,
  routineSnapshot,
  SHIP,
  SHIP_ORDER,
  withRoutines,
} from '../actions/test-actions.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { INT32, orderForm, restrict, snapshot, text } from '../records/test-support.js'
import type { RoutineMeta } from '../routines.js'
import { ambiguousBeside, bindAction, fitProblem, inputProblem } from './actions.js'
import { generateForm } from './generate.js'
import { actionUnoffered, deleteUnoffered } from './offers.js'
import type { GenerationRequest } from './types.js'

/*
 * What the generator binds as an action (0159), and every rule it refuses
 * one by, with the note that says which. A refusal is a note, never a
 * throw: a regeneration against a database whose routine changed must
 * still produce the form, without the action. A request no generator
 * could honour is thrown, as an unknown root is.
 */

/** The blocked note the generator wrote about `action`, or `undefined`. */
function refusal(source: MetadataSnapshot, actions: ActionChoice[], edit: (request: GenerationRequest) => void = () => {}): string | undefined {
  const request = orderRequest(source, actions)
  edit(request)
  const generated = generateForm(source, request)
  const names = new Set(actions.map((action) => action.name))
  expect(generated.bindings.actions?.some((action) => names.has(action.name)) ?? false, 'a refused action was bound').toBe(false)
  return generated.notes.find((note) => names.has(note.subject) && note.kind === 'blocked')?.message
}

/** The fixture's order discovered with one routine more. */
const plus = (...routines: RoutineMeta[]) => routineSnapshot('postgres', [SHIP_ORDER, CLOSE_ORDER, ...routines])

describe('an action the generator binds', () => {
  // Every source kind lands where a run reads it: a key and a field as the
  // column the locked row is read by, never a value; an input as its dialog
  // field; an attribute and the actor by name. The version column moves.
  // Without the binding the planner and drift have nothing to hold a run
  // to. Watched failing with the actions left out of the bindings.
  test('carries the routine, each parameter in its order with its source, and the move', () => {
    const { bindings } = actionForm()
    const [ship, close] = bindings.actions ?? []
    expect(ship).toEqual({
      name: 'ship',
      routine: SHIP_ORDER.ref,
      kind: 'function',
      scope: 'record',
      parameters: [
        { parameter: 'order_id', typeId: '20', type: SHIP_ORDER.parameters[0]?.type, from: { kind: 'key', column: 'id' } },
        { parameter: 'tenant', typeId: '23', type: SHIP_ORDER.parameters[1]?.type, from: { kind: 'attribute', attribute: 'tenant' } },
      ],
      move: { kind: 'increment', column: 'row_version' },
      dialog: null,
    })
    expect(close?.parameters.map((parameter) => parameter.from)).toEqual([
      { kind: 'key', column: 'id' },
      { kind: 'input', input: 'reason' },
      { kind: 'input', input: 'due' },
      { kind: 'input', input: 'urgent' },
      { kind: 'actor' },
      { kind: 'field', field: 'amount', column: 'amount' },
    ])
  })

  // A form that binds none carries no `actions` at all, so every form
  // published before 0159 regenerates to bindings equal to the ones it was
  // published with -- `generatedProblems` compares them at every write.
  // Watched failing with `actions: []` written for every form.
  test('is absent from the bindings of a form that binds none', () => {
    const source = routineSnapshot()
    expect(Object.hasOwn(generateForm(source, orderRequest(source, [])).bindings, 'actions')).toBe(false)
    expect(Object.hasOwn(orderForm(snapshot('postgres')).bindings, 'actions')).toBe(false)
    expect(generateForm(source, orderRequest(source, [])).bindings).toEqual(orderForm(source).bindings)
  })

  // The administrator reads, before publication, what nothing here binds:
  // field grants, state moves and cascades, a routine writing other rows,
  // and a routine reaching past the account's grants. Watched failing with
  // the note left out.
  test('is said in a note that names what the policy does not bind', () => {
    const notes = actionForm().notes.filter((note) => note.subject === 'ship')
    expect(notes).toEqual([
      {
        subject: 'ship',
        kind: 'inferred',
        message: expect.stringMatching(
          /^Runs sales\.ship_order\(pg_catalog\.int8, pg_catalog\.int4\) over the open record after incrementing row_version.*field grants, state moves and the policy's cascades do not bind it/,
        ),
      },
    ])
    const definer = actionForm(routineSnapshot('postgres', [{ ...SHIP_ORDER, reach: 'owner' }]), [SHIP]).notes.find((note) => note.subject === 'ship')
    expect(definer?.message).toMatch(/beyond this connection's account's own grants/)
  })
})

describe('the dialog', () => {
  // Stored as the base is and served as stored (0030): formancy accepts it,
  // and a regeneration writes it byte for byte. Watched failing with the
  // dialog's layout naming a field twice: formancy refused it.
  test('validates, and is what the generator writes again', () => {
    const dialog = actionForm().bindings.actions?.[1]?.dialog
    expect(dialog).not.toBeNull()
    expect(validateSchema(dialog).valid).toBe(true)
    expect(actionForm().bindings.actions?.[1]?.dialog).toEqual(dialog)
    expect(dialog?.id).toBe('sales-order.close')
    expect(dialog?.model.fields.map((field) => [field.key, field.type, field.required ?? false])).toEqual([
      ['reason', 'textarea', true],
      ['due', 'date', true],
      ['urgent', 'checkbox', false],
    ])
  })

  // formancy counts a required checkbox answered only when ticked, so a
  // required yes-or-no would make every person tick it. It starts unticked
  // instead, and false is an answer. Watched failing with every field
  // required: the engine reported `required` on an unticked checkbox.
  test('asks a yes or no without making the person tick it', () => {
    const dialog = actionForm().bindings.actions?.[1]?.dialog
    const capabilities = { now: () => 1_791_417_600_000, today: () => '2026-11-16', random: () => 0.5 }
    const engine = createFormEngine({ schema: dialog as NonNullable<typeof dialog>, mode: 'server', capabilities })
    engine.setValue(['reason'], 'late')
    engine.setValue(['due'], '2026-11-20')
    const report = engine.validate()
    expect(Object.values(report.errors).flat()).toEqual([])
    expect(engine.value()).toEqual({ reason: 'late', due: '2026-11-20', urgent: false })
  })
})

describe('what the generator refuses, each with the rule', () => {
  // A run moves the record's version under the version its person read,
  // and acts as opaquely as a delete: so it needs the delete's ground. Each
  // was watched failing with its check taken out of `actionUnoffered`.
  test('a form a run cannot be held to the version its person read', () => {
    const view = routineSnapshot('postgres', [SHIP_ORDER], (objects) => {
      ;(objects.find((object) => object.ref.name === 'order') as ObjectMeta).kind = 'view'
    })
    expect(refusal(view, [SHIP])).toMatch(/is a view/)
    expect(
      refusal(routineSnapshot(), [SHIP], (request) => {
        delete request.versionColumn
      }),
    ).toMatch(/no confirmed version column/)
    const unkeyed = routineSnapshot('postgres', [SHIP_ORDER], (objects) => {
      ;(objects.find((object) => object.ref.name === 'order') as ObjectMeta).primaryKey = null
    })
    expect(refusal(unkeyed, [SHIP])).toMatch(/no key of sales\.order/)
    // The generator refuses such a version column outright; a stored binding
    // can still name one, which the planner asks this of again.
    const unmoved = routineSnapshot('postgres', [SHIP_ORDER], (objects) => restrict(objects, 'order', 'row_version', { update: false }))
    const order = unmoved.objects.find((object) => object.ref.name === 'order') as ObjectMeta
    expect(actionUnoffered('postgres', order, ['id'], { kind: 'version-column', column: 'row_version', confirmed: true })).toMatch(
      /may not both read and UPDATE row_version, which every run moves/,
    )
  })

  // A key people type, with a version column, lets a record deleted and
  // created again start its version where the first did, so an old read
  // would act on the new record: the delete's rule, `versionProvesRecord`,
  // asked through the same function (0050). Watched failing with that
  // check taken out of `actionUnoffered`.
  test('a version that does not prove the record, as delete refuses it', () => {
    const typed = routineSnapshot('postgres', [SHIP_ORDER], (objects) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      ;(order.columns[0] as ColumnMeta).generated = 'none'
    })
    expect(refusal(typed, [SHIP])).toMatch(/a version cannot tell the two apart -- the rule delete keeps/)
    const order = { ...(typed.objects.find((object) => object.ref.name === 'order') as ObjectMeta), access: { delete: true } }
    const token = { kind: 'version-column', column: 'row_version', confirmed: true } as const
    expect(deleteUnoffered('postgres', order, ['id'], token)).toMatch(/a version cannot tell the two apart/)
    expect(
      actionUnoffered(
        'postgres',
        { ...order, columns: snapshot('postgres').objects.find((object) => object.ref.name === 'order')?.columns ?? [] },
        ['id'],
        token,
      ),
    ).toBeNull()
  })

  // On SQL Server a run moves the rowversion by setting the touch column a
  // save of rows moves it by (0155); never inferred, so without one no
  // action is offered. Watched failing with the touch column not required.
  test('a rowversion form that confirms no touch column', () => {
    const ship = msRoutine('ship_order', [
      msParameter('@order_id', '127:8:19:0', { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }, 'bigint'),
    ])
    const source = routineSnapshot('sqlserver', [ship])
    expect(refusal(source, [{ ...SHIP, routine: ship.ref, parameters: [{ parameter: '@order_id', from: { key: 'id' } }] }])).toMatch(
      /a run moves row_version by setting a confirmed touch column to itself.*confirms none/,
    )
  })

  // Discovered without routines, the snapshot says nothing of one, and a
  // routine behind a gap or gone cannot be bound: each says why, and the
  // rest of the form is generated. Watched failing with `missing` asked
  // only whether the routine is found: one message for all three.
  test('a routine the snapshot does not record', () => {
    expect(refusal(snapshot('postgres'), [SHIP])).toMatch(/discovered without routines; discover again with them/)
    expect(refusal(routineSnapshot('postgres', [CLOSE_ORDER]), [SHIP])).toMatch(
      /sales\.ship_order\(pg_catalog\.int8, pg_catalog\.int4\) is not in the snapshot/,
    )
    const hidden = withRoutines(snapshot('postgres'), [], [{ subject: { kind: 'schema', schema: 'sales' }, aspect: 'routines', detail: 'not listed' }])
    expect(refusal(hidden, [SHIP])).toMatch(/is not visible to this connection: "not listed"/)
  })

  // Each shape a run could not call, by the engine's rule (0158's facts).
  // Watched failing with each check in `routineProblem` taken out in turn.
  test('a routine of a shape no run calls', () => {
    const shaped = (extra: Partial<RoutineMeta>) => refusal(routineSnapshot('postgres', [{ ...SHIP_ORDER, ...extra }]), [SHIP])
    expect(shaped({ executable: false })).toMatch(/may not execute/)
    expect(shaped({ kind: 'procedure' })).toMatch(/is a procedure, which may COMMIT inside itself/)
    expect(
      shaped({
        returns: 'scalar',
        result: { databaseType: 'text', typeId: '25', type: { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false } },
      }),
    ).toMatch(/returns a value, which a run would throw away/)
    expect(shaped({ returns: 'set' })).toMatch(/returns rows/)
    for (const mode of ['out', 'inout', 'variadic'] as const) {
      expect(shaped({ parameters: [SHIP_ORDER.parameters[0] as RoutineMeta['parameters'][number], pgParameter('tenant', 'int4', { mode })] }), mode).toMatch(
        new RegExp(`has ${mode} parameter tenant`),
      )
    }
    expect(shaped({ parameters: [SHIP_ORDER.parameters[0] as RoutineMeta['parameters'][number], pgParameter('', 'int4')] })).toMatch(
      /a parameter without a name/,
    )
  })

  // A domain, an enum or a type outside the adapter's table is recorded
  // unsupported (0158): no cast could be spelled for it. Watched failing
  // with the unsupported check taken out: the domain was bound.
  test('a parameter of a domain type', () => {
    const domain = { ...pgParameter('tenant', 'int4'), typeId: '90001', databaseType: 'sales.tenant_id', type: { kind: 'unsupported' } as const }
    expect(
      refusal(routineSnapshot('postgres', [{ ...SHIP_ORDER, parameters: [SHIP_ORDER.parameters[0] as RoutineMeta['parameters'][number], domain] }]), [SHIP]),
    ).toMatch(/parameter tenant is sales\.tenant_id, which no codec this release has speaks/)
  })

  // SQL Server's EXEC passes `@p = @v` with the name as written, which no
  // quoting can make safe: a name that is not a regular identifier is
  // refused, and a function, which SQL Server forbids to write. Watched
  // failing with the identifier check and the function check taken out.
  test('a SQL Server routine whose parameter is irregularly named, or a function', () => {
    const bigint = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const
    const source = withRoutines(snapshot('sqlserver'), [])
    const ground = {
      identity: ['id'],
      concurrency: { kind: 'rowversion' as const, column: 'row_version', confirmed: true, touch: 'notes' },
      fields: orderForm(source).bindings.fields,
    }
    const root = source.objects.find((object) => object.ref.name === 'order') as ObjectMeta
    const bind = (routine: RoutineMeta) =>
      bindAction(withRoutines(snapshot('sqlserver'), [routine]), root, ground, {
        ...SHIP,
        routine: routine.ref,
        parameters: [{ parameter: routine.parameters[0]?.name as string, from: { key: 'id' } }],
      })
    expect(bind(msRoutine('ship_order', [msParameter('@order id', '127:8:19:0', bigint, 'bigint')]))).toMatch(/@order id is not a regular identifier/)
    expect(bind(msRoutine('ship_order', [msParameter('@order_id', '127:8:19:0', bigint, 'bigint')]))).toMatchObject({
      move: { kind: 'touch', column: 'notes' },
    })
    expect(bind(msRoutine('ship_order', [msParameter('@order_id', '127:8:19:0', bigint, 'bigint')], { kind: 'function' }))).toMatch(
      /is a function, which SQL Server forbids to write/,
    )
  })

  // Beside `f(int8, int4 default 0)`, every call of `f(int8)` is 42725,
  // cast or named (0158, R7): a run of it would fail every time. Watched
  // failing with `ambiguousBeside` answering undefined.
  test('a PostgreSQL routine every call of which is ambiguous beside an overload', () => {
    const shorter = pgRoutine('ship_order', [pgParameter('order_id', 'int8')])
    const longer = pgRoutine('ship_order', [pgParameter('order_id', 'int8'), pgParameter('tenant', 'int4', { hasDefault: true })])
    const choice: ActionChoice = { ...SHIP, routine: shorter.ref, parameters: [{ parameter: 'order_id', from: { key: 'id' } }] }
    expect(refusal(routineSnapshot('postgres', [shorter, longer]), [choice])).toMatch(
      /beside sales\.ship_order\(pg_catalog\.int8, pg_catalog\.int4\).*every call of sales\.ship_order\(pg_catalog\.int8\) is ambiguous/,
    )
    expect(ambiguousBeside([shorter, { ...longer, parameters: [pgParameter('order_id', 'int8'), pgParameter('tenant', 'int4')] }], shorter)).toBeUndefined()
    expect(ambiguousBeside([longer, shorter], longer)).toBeUndefined()
  })

  // Every parameter mapped exactly once, and none left to a default: SQL
  // Server's catalog keeps no T-SQL default (0158). Watched failing with
  // each check in `parametersFor` taken out in turn.
  test('a mapping that leaves a parameter out, names one twice, or names one the routine lacks', () => {
    expect(refusal(plus(), [{ ...SHIP, parameters: [{ parameter: 'order_id', from: { key: 'id' } }] }])).toMatch(/parameter tenant is given nothing/)
    expect(refusal(plus(), [{ ...SHIP, parameters: [...SHIP.parameters, { parameter: 'tenant', from: { actor: 'id' } }] }])).toMatch(
      /parameter tenant is given twice/,
    )
    expect(refusal(plus(), [{ ...SHIP, parameters: [...SHIP.parameters, { parameter: 'region', from: { actor: 'id' } }] }])).toMatch(/has no parameter region/)
    const twice: ActionChoice = {
      ...CLOSE,
      parameters: CLOSE.parameters.map((entry) => (entry.parameter === 'closed_by' ? { ...entry, from: { input: 'reason' } } : entry)),
    }
    expect(refusal(plus(), [twice])).toMatch(/input reason is given to two parameters/)
  })

  // Each source is typed by its parameter. Watched failing with each check
  // in `boundSource` taken out in turn: the field that is no column field,
  // the field of another kind, the key that is not one, the input no
  // dialog field can ask, and the attribute given to a yes-or-no.
  test('a source its parameter cannot take', () => {
    const withSource = (parameter: string, from: ActionChoice['parameters'][number]['from']): ActionChoice => ({
      ...CLOSE,
      parameters: CLOSE.parameters.map((entry) => (entry.parameter === parameter ? { parameter, from } : entry)),
    })
    expect(refusal(plus(), [withSource('amount', { field: 'customer_no' })])).toMatch(/given customer_no, which no column field of this form is bound to/)
    expect(refusal(plus(), [withSource('amount', { field: 'order_date' })])).toMatch(/given order_date, and it holds date, and the parameter takes decimal/)
    expect(refusal(plus(), [withSource('order_id', { key: 'tenant_id' })])).toMatch(/given tenant_id, which is no column of the record's key/)
    const stamped = pgRoutine('stamp_order', [pgParameter('order_id', 'int8'), pgParameter('at', 'timestamp')])
    const stamp: ActionChoice = {
      name: 'stamp',
      routine: stamped.ref,
      scope: 'record',
      parameters: [
        { parameter: 'order_id', from: { key: 'id' } },
        { parameter: 'at', from: { input: 'at' } },
      ],
    }
    expect(refusal(plus(stamped), [stamp])).toMatch(
      /parameter at is asked of the person, and timestamp without time zone: a timestamp without a time zone has no formancy field/,
    )
    expect(refusal(plus(), [withSource('urgent', { attribute: 'tenant' })])).toMatch(
      /parameter urgent takes boolean, and the verified context's attribute tenant is text/,
    )
  })

  // A request no generator could honour is thrown, naming it, before
  // anything is bound. Watched failing with each check in `assertChoices`
  // taken out in turn.
  test('a request that is not one is thrown', () => {
    const source = plus()
    const thrown = (actions: unknown[]) => () => generateForm(source, orderRequest(source, actions as ActionChoice[]))
    expect(thrown([{ ...SHIP, name: 'Ship it' }])).toThrow(/action name "Ship it" is not lower-case letters/)
    expect(thrown([SHIP, SHIP])).toThrow('two actions are named ship')
    expect(thrown([{ ...SHIP, scope: 'selection' }])).toThrow(/scope "selection"; this release runs an action over the open record alone/)
    expect(thrown([{ ...SHIP, routine: { schema: 'sales', name: 'ship_order' } }])).toThrow(/names no routine as \{ schema, name, signature \}/)
    expect(thrown([{ ...SHIP, parameters: [{ parameter: 'order_id', from: { column: 'id' } }] }])).toThrow(/each parameter is \{ parameter, from/)
    expect(thrown([{ ...SHIP, parameters: [{ parameter: 'order_id', from: { input: 'in' } }] }])).toThrow(/input "in" is not a field key formancy accepts/)
  })
})

describe('the typing of each source', () => {
  const INT8: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
  // A column passes to a parameter only where every value it holds is one
  // the parameter holds -- on SQL Server, whose catalog keeps lengths, a
  // varchar(200) column never reaches a varchar(20) parameter, which would
  // cut it. On PostgreSQL the parameter keeps no length (0158), so only the
  // kind and the range are compared. Watched failing with each case of
  // `fitProblem` answering null.
  test('a column fits a parameter only where the parameter holds all it holds', () => {
    expect(fitProblem(text(200), text(20))).toMatch(/holds values the parameter cannot/)
    expect(fitProblem(text(20), text(200))).toBeNull()
    expect(fitProblem(text(20), text(null))).toBeNull()
    expect(fitProblem(text(null), text(20))).toMatch(/cannot/)
    expect(fitProblem(text(20, false, 'utf8-bytes'), text(20))).toMatch(/cannot/)
    expect(fitProblem(INT8, INT32)).toMatch(/cannot/)
    expect(fitProblem(INT32, INT8)).toBeNull()
    expect(fitProblem({ kind: 'decimal', precision: 14, scale: 2 }, { kind: 'decimal', precision: 18, scale: 4 })).toBeNull()
    expect(fitProblem({ kind: 'decimal', precision: 14, scale: 2 }, { kind: 'decimal', precision: 10, scale: 2 })).toMatch(/cannot/)
    expect(fitProblem({ kind: 'decimal', precision: 14, scale: 4 }, { kind: 'decimal', precision: 18, scale: 2 })).toMatch(/cannot/)
    expect(fitProblem({ kind: 'decimal', precision: null, scale: null }, { kind: 'decimal', precision: 18, scale: 4 })).toMatch(/cannot/)
    expect(fitProblem({ kind: 'decimal', precision: 14, scale: 2 }, { kind: 'decimal', precision: null, scale: null })).toBeNull()
    expect(fitProblem({ kind: 'float', bits: 64 }, { kind: 'float', bits: 32 })).toMatch(/cannot/)
    expect(fitProblem({ kind: 'timestamp', withTimeZone: true, precision: 6 }, { kind: 'timestamp', withTimeZone: false, precision: 6 })).toMatch(/time zone/)
    expect(fitProblem({ kind: 'date' }, { kind: 'date' })).toBeNull()
    expect(fitProblem({ kind: 'date' }, INT32)).toBe('it holds date, and the parameter takes integer')
  })

  // An input is asked by the field `controlFor` makes of its type, written
  // through a codec, or not at all. Watched failing with the read-only
  // check taken out: a wall-clock timestamp was asked.
  test('an input is a type a dialog field can write', () => {
    expect(inputProblem(pgParameter('due', 'date'))).toBeNull()
    expect(inputProblem(pgParameter('at', 'timestamp'))).toMatch(/has no formancy field/)
    expect(inputProblem({ ...pgParameter('blob', 'text'), databaseType: 'bytea', type: { kind: 'binary', maxLength: null, fixedLength: false } })).toMatch(
      /bytea: binary data has no form control/,
    )
  })

  // A key or a field: the same rule, the parameter's. Watched failing with
  // the key's fit left unasked: an int8 key was bound to an int4.
  test('a key is held to its parameter as a field is', () => {
    const narrow = pgRoutine('ship_order', [pgParameter('order_id', 'int4'), pgParameter('tenant', 'int4')])
    expect(refusal(routineSnapshot('postgres', [narrow]), [{ ...SHIP, routine: narrow.ref }])).toMatch(/given id, and it holds values the parameter cannot/)
  })
})
