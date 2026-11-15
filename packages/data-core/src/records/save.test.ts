import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import type { SaveChange } from '../save.js'
import type { FormRecord } from './plan-types.js'
import { planSave, planSaveList, type SaveInput } from './save.js'
import type { SaveBundle, SaveChildInput } from './save-steps.js'
import {
  AUDITOR,
  CLERK,
  CLERK_RW,
  col,
  column,
  CUSTOMER_POLICY,
  customerForm,
  DEFINITION,
  described,
  edited,
  fk,
  INT32,
  INT64,
  LINE_POLICY,
  lineForm,
  MS_FACTS,
  ORDER_ID,
  ORDER_POLICY,
  ORDER_TARGET,
  ORDER_TOKEN,
  orderForm,
  PG,
  PG_ORDER,
  sales,
  snapshot,
  table,
  TENANT,
  TENANT_ONE,
  text,
  togetherOn,
  value,
} from './test-support.js'

/*
 * A save of a record with its rows (0155), as data-core plans it: every
 * part by today's planner under its own form's policy, every field error
 * at once, every row pinned to the record, the record's key bound or taken
 * from its step, the touch, `within`, the counts and the order of the
 * steps. Nothing runs a save yet; what is under test is the one request an
 * adapter will receive, and every refusal before it.
 */

const DEADLINE = 2000
/** A rowversion as the SQL Server adapter spells one. */
const ROWVERSION = '00000000000007d1'
const lineToken = (line: number) => `k1:${ORDER_ID},${String(line)}`

const PG_LINES = togetherOn(lineForm(PG).bindings, 'order')
const ORDERS: SaveBundle = { connection: 'erp', snapshot: PG, bindings: PG_ORDER, policy: ORDER_POLICY }
const LINES: SaveBundle = { connection: 'erp', snapshot: PG, bindings: PG_LINES, policy: LINE_POLICY }

/** SQL Server, whose order is a rowversion and whose lines offer delete: their rowversion never repeats. */
const DELETE_LINES: FormPolicy = { ...LINE_POLICY, operations: { ...LINE_POLICY.operations, delete: ['clerk'] } }
const MS_TOUCHED = edited(orderForm(MS_FACTS).bindings, (draft) => {
  if (draft.concurrency !== null) draft.concurrency.touch = 'notes'
})
const MS_ORDERS: SaveBundle = { connection: 'erp', snapshot: MS_FACTS, bindings: MS_TOUCHED, policy: ORDER_POLICY }
const MS_LINES: SaveBundle = { connection: 'erp', snapshot: MS_FACTS, bindings: togetherOn(lineForm(MS_FACTS).bindings, 'order'), policy: DELETE_LINES }

/** A line of the order as its list reads it for a clerk. */
const listed = (line: number, version = '1'): FormRecord => ({
  record: lineToken(line),
  version,
  answers: { order: ORDER_TOKEN, line_no: line, quantity: 2, unit_price: '9.50', line_total: '19.00' },
})
const newLine = (ref: string, line: number): SaveChange => ({ create: { ref, answers: { line_no: line, quantity: 1, unit_price: '5.00' } } })

/** One child of the save: the order's lines, by default, as listed over the saved order. */
function child(changes: SaveChange[], rows: FormRecord[] = [listed(1), listed(2)], bundle: SaveBundle = LINES, form = 'order-line'): SaveChildInput {
  return { form, field: 'order', bundle, changes, read: { rows, described: described(bundle.snapshot, bundle.bindings) } }
}
const updating = (bundle: SaveBundle, answers: Record<string, unknown> = {}, version = '7'): SaveInput['record'] => ({
  update: { record: ORDER_TOKEN, version, answers, asRead: undefined, described: described(bundle.snapshot, bundle.bindings) },
})
const creating = (bundle: SaveBundle, answers: Record<string, unknown>): SaveInput['record'] => ({
  create: { answers, described: described(bundle.snapshot, bundle.bindings) },
})
const save = (input: Omit<SaveInput, 'deadlineMs'>, context: PolicyContext = CLERK) => planSave({ ...input, deadlineMs: DEADLINE }, context)

/** A new order's answers, as a clerk enters them. */
const ORDER_ANSWERS = { customer: 'k1:1,1001', order_date: '2026-10-08', amount: '12.50', employee: 'k1:1' }
/** How a line reaches its order's tenant (0043): through the order, under the order lookup's filter. */
const LINE_THROUGH = { columns: [column('order_id', INT64)], target: sales('order'), targetColumns: [{ name: 'id', type: INT64 }], filters: TENANT_ONE }

describe('planSave', () => {
  // The order's step is planned under the order's policy -- its tenant
  // filter, no through -- and each line's under the line's -- no filter of
  // its own, and the through the order (0043). A person whom one form's
  // policy refuses is refused at that part, in that policy's words, though
  // the other would let them. Watched failing with every part planned
  // under the order's policy: the lines' tenant filter named a column
  // order_line does not have, and the save was refused invalid-policy.
  test("plans each part under its own form's policy", () => {
    const planned = save({
      parent: ORDERS,
      record: updating(ORDERS, { notes: 'x' }),
      children: [child([{ update: { record: lineToken(1), version: '1', answers: { quantity: 4 } } }, newLine('a', 3)])],
    })
    expect(planned).toMatchObject({
      ok: true,
      request: {
        record: { kind: 'update', request: { filters: TENANT_ONE, through: [] } },
        children: [
          {
            updates: [{ filters: { kind: 'unrestricted' }, through: [LINE_THROUGH] }],
            count: { filters: { kind: 'unrestricted' }, through: [LINE_THROUGH], min: 1, max: 3 },
          },
        ],
      },
    })
    const managersUpdateLines: SaveBundle = { ...LINES, policy: { ...LINE_POLICY, operations: { ...LINE_POLICY.operations, update: ['manager'] } } }
    expect(
      save({
        parent: ORDERS,
        record: updating(ORDERS),
        children: [child([{ update: { record: lineToken(1), version: '1', answers: { quantity: 4 } } }], undefined, managersUpdateLines)],
      }),
    ).toMatchObject({ ok: false, code: 'operation-denied', at: { form: 'order-line', field: 'order', record: lineToken(1) } })
    expect(save({ parent: ORDERS, record: updating(ORDERS, { notes: 'x' }), children: [child([newLine('a', 3)])] }, AUDITOR)).toMatchObject({
      ok: false,
      code: 'operation-denied',
      at: { record: true },
    })
  })

  // A person fixes every field at once: the order's date, the first new
  // line's quantity and the second's missing price are three parts' errors
  // in one answer, each in its own form's field keys. Watched failing with
  // the record's errors answered as soon as they were found: one part.
  test('collects the field errors of the record and of every row at once', () => {
    const planned = save({
      parent: ORDERS,
      record: creating(ORDERS, { ...ORDER_ANSWERS, order_date: 'soon' }),
      children: [
        child(
          [
            { create: { ref: 'a', answers: { line_no: 1, quantity: 'many', unit_price: '5.00' } } },
            { create: { ref: 'b', answers: { line_no: 2, quantity: 1 } } },
          ],
          [],
        ),
      ],
    })
    expect(planned).toMatchObject({
      ok: false,
      code: 'invalid-values',
      parts: [
        { at: { record: true }, fieldErrors: [{ field: 'order_date' }] },
        { at: { form: 'order-line', field: 'order', ref: 'a' }, fieldErrors: [{ field: 'quantity' }] },
        { at: { form: 'order-line', field: 'order', ref: 'b' }, fieldErrors: [{ field: 'unit_price', code: 'required' }] },
      ],
    })
  })

  // Every line step carries the order's key as the value of the line's
  // foreign key, so the statement that locates a line, and the read that
  // explains one that changed nothing, find another order's line nowhere.
  // A line the order's list does not hold is not-found at its part before
  // anything is sent. Watched failing with the pin left empty.
  test('pins every row step to the record, and finds no row of another record', () => {
    const planned = save({
      parent: MS_ORDERS,
      record: updating(MS_ORDERS, { notes: 'x' }, ROWVERSION),
      children: [
        child(
          [{ update: { record: lineToken(1), version: ROWVERSION, answers: { quantity: 4 } } }, { delete: { record: lineToken(2), version: ROWVERSION } }],
          [listed(1, ROWVERSION), listed(2, ROWVERSION)],
          MS_LINES,
        ),
      ],
    })
    expect(planned).toMatchObject({
      ok: true,
      request: {
        children: [
          {
            parent: [{ column: column('order_id', INT64), value: value('id', INT64, ORDER_ID) }],
            updates: [{ key: [value('order_id', INT64, ORDER_ID), value('line_no', INT32, '1')] }],
            deletes: [{ key: [value('order_id', INT64, ORDER_ID), value('line_no', INT32, '2')] }],
          },
        ],
      },
    })
    const elsewhere = 'k1:9007199254740994,1'
    expect(
      save({
        parent: MS_ORDERS,
        record: updating(MS_ORDERS, {}, ROWVERSION),
        children: [child([{ delete: { record: elsewhere, version: ROWVERSION } }], [listed(1, ROWVERSION)], MS_LINES)],
      }),
    ).toMatchObject({ ok: false, code: 'not-found', at: { form: 'order-line', field: 'order', record: elsewhere } })
  })

  // The field that names the order is the save's: a new line needs none,
  // nor any column of it, and carries none into its insert; one sent is
  // over-posting. On an update the page may send it back as read, the
  // order's own token, and it is dropped; another order's is over-posting,
  // since it would move the line. Watched failing with the field's columns
  // not supplied: "order: A value is required." on every new line.
  test('supplies the field that names the record on create, and refuses it sent otherwise on update', () => {
    const planned = save({ parent: ORDERS, record: creating(ORDERS, ORDER_ANSWERS), children: [child([newLine('a', 1)], [])] })
    expect(planned.ok).toBe(true)
    if (planned.ok) expect(planned.request.children[0]?.creates[0]?.values.map((entry) => entry.name)).toEqual(['line_no', 'quantity', 'unit_price'])
    expect(
      save({
        parent: ORDERS,
        record: creating(ORDERS, ORDER_ANSWERS),
        children: [child([{ create: { ref: 'a', answers: { order: ORDER_TOKEN, line_no: 1, quantity: 1, unit_price: '5.00' } } }], [])],
      }),
    ).toMatchObject({ ok: false, code: 'over-posting', at: { ref: 'a' } })
    expect(
      save({
        parent: ORDERS,
        record: updating(ORDERS),
        children: [child([{ update: { record: lineToken(1), version: '1', answers: { order: ORDER_TOKEN, quantity: 4 } } }])],
      }),
    ).toMatchObject({ ok: true, request: { children: [{ updates: [{ set: [value('quantity', INT32, '4')] }] }] } })
    expect(
      save({
        parent: ORDERS,
        record: updating(ORDERS),
        children: [child([{ update: { record: lineToken(1), version: '1', answers: { order: 'k1:2', quantity: 4 } } }])],
      }),
    ).toMatchObject({ ok: false, code: 'over-posting', at: { record: lineToken(1) } })
  })

  // A child that creates rows checks the order once, before its first
  // create, under the line lookup's filter for a create -- the tenant, on
  // the order's table -- and a child that only changes rows does not.
  // Watched failing with `within` planned for every child.
  test("checks the record under the child's lookup filter, once per child that creates rows", () => {
    const planned = save({
      parent: ORDERS,
      record: updating(ORDERS),
      children: [
        child([newLine('a', 3), newLine('b', 4)]),
        child([{ update: { record: lineToken(1), version: '1', answers: { quantity: 4 } } }], undefined, LINES, 'order-line-copy'),
      ],
    })
    expect(planned).toMatchObject({
      ok: true,
      request: { children: [{ within: { target: sales('order'), filters: TENANT_ONE } }, { within: null }] },
    })
    if (planned.ok) expect(planned.steps.filter((step) => typeof step.step === 'object' && 'within' in step.step)).toHaveLength(1)
  })

  // An order's key is an identity: its new lines take it from the order's
  // step. A saved order's lines bind it from the token. A customer's key is
  // its tenant, from the context, and a number the person types: bound,
  // both. A key column a default fills that may repeat cannot be known
  // before the insert, and the save is refused rather than guess. Watched
  // failing with every key taken from the record's step.
  test("binds the record's key where it is known, and takes it from the record's step only where the database numbers it", () => {
    const fresh = save({ parent: ORDERS, record: creating(ORDERS, ORDER_ANSWERS), children: [child([newLine('a', 1)], [])] })
    expect(fresh).toMatchObject({ ok: true, request: { children: [{ parent: [{ column: column('order_id', INT64), returned: 'id' }] }] } })
    const saved = save({ parent: ORDERS, record: updating(ORDERS), children: [child([newLine('a', 3)])] })
    expect(saved).toMatchObject({ ok: true, request: { children: [{ parent: [{ column: column('order_id', INT64), value: value('id', INT64, ORDER_ID) }] }] } })

    const noted = (edit: (objects: ObjectMeta[]) => void = () => {}) =>
      snapshot('postgres', (objects) => {
        objects.push(
          table('customer_note', [col('tenant_id', 1, INT32), col('customer_no', 2, INT32), col('note_no', 3, INT32), col('body', 4, text(200))], {
            primaryKey: { name: 'pk_customer_note', columns: ['tenant_id', 'customer_no', 'note_no'] },
            foreignKeys: [fk('fk_customer_note_customer', ['tenant_id', 'customer_no'], 'customer', ['tenant_id', 'customer_no'])],
          }),
        )
        edit(objects)
      })
    const notes = (source: ReturnType<typeof noted>): SaveBundle => ({
      connection: 'erp',
      snapshot: source,
      bindings: togetherOn(
        generateForm(source, {
          connection: 'erp',
          root: sales('customer_note'),
          formId: 'notes',
          title: 'Note',
          lookups: [{ foreignKey: 'fk_customer_note_customer', display: ['name'] }],
        }).bindings,
        'customer',
      ),
      policy: {
        version: 1,
        operations: { read: ['clerk'], create: ['clerk'], update: [] },
        fields: { customer: CLERK_RW, note_no: CLERK_RW, body: CLERK_RW },
        rowFilters: TENANT,
        lookups: { customer: TENANT },
      },
    })
    // The customer form over PostgreSQL has no version column, so it creates and offers no update.
    const customers = (source: ReturnType<typeof noted>): SaveBundle => ({
      connection: 'erp',
      snapshot: source,
      bindings: customerForm(source).bindings,
      policy: { ...CUSTOMER_POLICY, operations: { read: ['clerk'], create: ['clerk'], update: [] } },
    })
    const typed = noted()
    const note = { create: { ref: 'n', answers: { note_no: 1, body: 'Prefers mornings' } } }
    const keyed = save({
      parent: customers(typed),
      record: creating(customers(typed), { customer_no: 7, name: 'Acme' }),
      children: [
        { form: 'notes', field: 'customer', bundle: notes(typed), changes: [note], read: { rows: [], described: described(typed, notes(typed).bindings) } },
      ],
    })
    expect(keyed).toMatchObject({
      ok: true,
      request: {
        children: [
          {
            parent: [
              { column: column('tenant_id', INT32), value: value('tenant_id', INT32, '1') },
              { column: column('customer_no', INT32), value: value('customer_no', INT32, '7') },
            ],
          },
        ],
      },
    })
    // The pinned tenant is the record's, so the note's insert carries none of its foreign key's columns.
    if (keyed.ok) expect(keyed.request.children[0]?.creates[0]?.values.map((entry) => entry.name)).toEqual(['note_no', 'body'])

    const defaulted = noted((objects) => {
      const number = (objects.find((object) => object.ref.name === 'customer') as ObjectMeta).columns[1] as ObjectMeta['columns'][number]
      Object.assign(number, { hasDefault: true, defaultExpression: "nextval('customer_no')" })
    })
    expect(
      save({
        parent: customers(defaulted),
        record: creating(customers(defaulted), { name: 'Acme' }),
        children: [
          {
            form: 'notes',
            field: 'customer',
            bundle: notes(defaulted),
            changes: [note],
            read: { rows: [], described: described(defaulted, notes(defaulted).bindings) },
          },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'operation-unavailable', at: { record: true }, message: expect.stringContaining('customer_no') })
  })

  // An order whose own answers change nothing while its lines change is
  // touched: on SQL Server its confirmed touch column set to itself, which
  // moves the rowversion; on PostgreSQL its version column incremented,
  // `touch: null`. Without a confirmed touch column the save of rows alone
  // cannot move the rowversion, and is unavailable; with no row changed
  // either, nothing changes, as for an update today. Watched failing with
  // the record's update planned as it is alone: nothing-to-update.
  test('touches the record when its patch changes nothing, and is unavailable without a confirmed touch column', () => {
    const lineUpdate: SaveChange = { update: { record: lineToken(1), version: ROWVERSION, answers: { quantity: 4 } } }
    const rows = [listed(1, ROWVERSION)]
    expect(save({ parent: MS_ORDERS, record: updating(MS_ORDERS, {}, ROWVERSION), children: [child([lineUpdate], rows, MS_LINES)] })).toMatchObject({
      ok: true,
      request: {
        record: {
          kind: 'touch',
          request: {
            target: ORDER_TARGET.sqlserver,
            key: [value('id', INT64, ORDER_ID)],
            expectedVersion: ROWVERSION,
            filters: TENANT_ONE,
            through: [],
            definition: DEFINITION,
            touch: 'notes',
          },
        },
      },
    })
    const untouched: SaveBundle = { ...MS_ORDERS, bindings: orderForm(MS_FACTS).bindings }
    expect(save({ parent: untouched, record: updating(untouched, {}, ROWVERSION), children: [child([lineUpdate], rows, MS_LINES)] })).toMatchObject({
      ok: false,
      code: 'operation-unavailable',
      at: { record: true },
    })
    expect(
      save({ parent: ORDERS, record: updating(ORDERS), children: [child([{ update: { record: lineToken(1), version: '1', answers: { quantity: 4 } } }])] }),
    ).toMatchObject({ ok: true, request: { record: { kind: 'touch', request: { touch: null, expectedVersion: '7' } } } })
    expect(save({ parent: ORDERS, record: updating(ORDERS), children: [] })).toMatchObject({ ok: false, code: 'nothing-to-update', at: { record: true } })
  })

  // Only a child the save changes is counted, or refused for its bound: an
  // order whose other line form holds more than it allows can still have
  // its lines saved. A record already listed above its bound refuses a
  // change of that child. A new order holds only the lines the save
  // creates, so its bound is checked before any statement: none of a child
  // that requires rows, or more than its max, is refused. Watched failing
  // with children that change nothing kept, and with a new record's bound
  // not checked.
  test('counts only the children the save changes, and holds a new record to its bound before any statement', () => {
    const lineUpdate: SaveChange = { update: { record: lineToken(1), version: '1', answers: { quantity: 4 } } }
    const four = [listed(1), listed(2), listed(3), listed(4)]
    const planned = save({ parent: ORDERS, record: updating(ORDERS), children: [child([lineUpdate]), child([], four, LINES, 'order-line-copy')] })
    expect(planned).toMatchObject({ ok: true })
    if (planned.ok) expect(planned.request.children).toHaveLength(1)
    expect(save({ parent: ORDERS, record: updating(ORDERS), children: [child([lineUpdate], four)] })).toMatchObject({
      ok: false,
      code: 'too-many-rows',
      at: { form: 'order-line', field: 'order' },
      rows: { form: 'order-line', field: 'order', min: 1, max: 3, held: 4 },
    })

    const required = [{ form: 'order-line', field: 'order', min: 1, max: 3 }]
    expect(save({ parent: ORDERS, record: creating(ORDERS, ORDER_ANSWERS), children: [], required })).toMatchObject({
      ok: false,
      code: 'too-few-rows',
      rows: { min: 1, held: 0 },
    })
    const lines = (count: number) => Array.from({ length: count }, (_, index) => newLine(`r${String(index)}`, index + 1))
    expect(save({ parent: ORDERS, record: creating(ORDERS, ORDER_ANSWERS), children: [child(lines(4), [])], required })).toMatchObject({
      ok: false,
      code: 'too-many-rows',
      rows: { max: 3, held: 4 },
    })
    expect(save({ parent: ORDERS, record: creating(ORDERS, ORDER_ANSWERS), children: [child(lines(3), [])], required })).toMatchObject({ ok: true })
  })

  // The record first; then each child in codepoint order of form and
  // field, whatever order the body sent them in -- its `within`, then its
  // deletes, its updates and its creates, whatever order the body sent
  // those in; then every count. Watched failing with the children left in
  // the body's order.
  test('runs the steps in one order', () => {
    const lineUpdate = (line: number): SaveChange => ({ update: { record: lineToken(line), version: ROWVERSION, answers: { quantity: 4 } } })
    const rows = [listed(1, ROWVERSION), listed(2, ROWVERSION)]
    const planned = save({
      parent: MS_ORDERS,
      record: updating(MS_ORDERS, { notes: 'x' }, ROWVERSION),
      children: [
        child([newLine('a', 3), lineUpdate(1), { delete: { record: lineToken(2), version: ROWVERSION } }], rows, MS_LINES, 'order-line'),
        child([lineUpdate(2)], rows, MS_LINES, 'b-lines'),
      ],
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.steps.map(({ step, at }) => ({ step, at }))).toEqual([
      { step: 'record', at: { record: true } },
      { step: { child: 0, update: 0 }, at: { form: 'b-lines', field: 'order', record: lineToken(2) } },
      { step: { child: 1, within: true }, at: { form: 'order-line', field: 'order' } },
      { step: { child: 1, delete: 0 }, at: { form: 'order-line', field: 'order', record: lineToken(2) } },
      { step: { child: 1, update: 0 }, at: { form: 'order-line', field: 'order', record: lineToken(1) } },
      { step: { child: 1, create: 0 }, at: { form: 'order-line', field: 'order', ref: 'a' } },
      { step: { child: 0, count: true }, at: { form: 'b-lines', field: 'order' } },
      { step: { child: 1, count: true }, at: { form: 'order-line', field: 'order' } },
    ])
  })

  // A save holds a record and the rows of its together children through
  // the field each is saved by, and nothing else: a child form whose
  // lookup is not together, or is together through another field, is not
  // one; and a record whose own rows are saved with another record carries
  // no save of its own, a save being one level deep. Watched failing with
  // the child's together field not compared, and with the record's own
  // together lookup not asked.
  test('saves only together children of the record, one level deep', () => {
    const plain: SaveBundle = { ...LINES, bindings: lineForm(PG).bindings }
    expect(save({ parent: ORDERS, record: updating(ORDERS), children: [child([newLine('a', 3)], undefined, plain)] })).toMatchObject({
      ok: false,
      code: 'invalid-request',
    })
    // A line that references the order twice, saved with it through one of the two.
    const twice = snapshot('postgres', (objects) => {
      const line = objects.find((object) => object.ref.name === 'order_line') as ObjectMeta
      line.columns.push(col('origin_id', 7, INT64))
      line.foreignKeys.push(fk('fk_order_line_origin', ['origin_id'], 'order', ['id']))
    })
    const both = generateForm(twice, {
      connection: 'erp',
      root: sales('order_line'),
      formId: 'lines',
      title: 'Line',
      lookups: [
        { foreignKey: 'fk_order_line_order', display: ['order_date'] },
        { foreignKey: 'fk_order_line_origin', display: ['order_date'] },
      ],
      versionColumn: 'row_version',
    }).bindings
    const origin = (both.fields.find((binding) => binding.kind === 'lookup' && binding.foreignKey === 'fk_order_line_origin') as { field: string }).field
    const viaOrigin: SaveBundle = { ...LINES, snapshot: twice, bindings: togetherOn(both, 'order') }
    expect(save({ parent: ORDERS, record: updating(ORDERS), children: [{ ...child([newLine('a', 3)], undefined, viaOrigin), field: origin }] })).toMatchObject({
      ok: false,
      code: 'invalid-request',
    })
    const nested: SaveBundle = { ...ORDERS, bindings: togetherOn(PG_ORDER, 'customer') }
    expect(save({ parent: nested, record: updating(nested), children: [child([newLine('a', 3)])] })).toMatchObject({
      ok: false,
      code: 'operation-unavailable',
      at: { record: true },
    })
  })

  // The deadline reaches a SET that takes no bind parameter, so a value
  // that is not a whole number of milliseconds is a programming error,
  // thrown before anything is planned. Watched failing with it unchecked.
  test('throws on a deadline that is not a whole number of milliseconds', () => {
    for (const deadlineMs of [0, -1, 1.5, Number.NaN]) {
      expect(() => planSave({ parent: ORDERS, record: updating(ORDERS), children: [], deadlineMs }, CLERK)).toThrow(TypeError)
    }
  })
})

describe('planSaveList', () => {
  // The rows a save is planned over are the line form's own list under the
  // order: narrowed to it through the together field, in key order, with
  // one row more than the order may hold, so a record another writer left
  // above its bound is seen. Watched failing with the limit at `max`.
  test("lists a record's rows as its person reads them, one more than its max", () => {
    expect(planSaveList(LINES, 'order', ORDER_TOKEN, 3, CLERK)).toMatchObject({
      ok: true,
      request: { equal: [value('order_id', INT64, ORDER_ID)], filter: [], related: [], search: null, after: null, limit: 4, through: [LINE_THROUGH] },
    })
  })
})
