import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import { offeredFor, type OfferedOperation, type WriteScope } from '../generate/offers.js'
import { TOGETHER_MAX_ROWS } from '../generate/together.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { SAVE_MAX_ROWS } from './save-limits.js'
import type { FieldBinding, FormBindings, GenerationRequest } from '../generate/types.js'
import type { MetadataSnapshot, ObjectMeta } from '../metadata.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { planDelete } from './delete.js'
import { grantedOperations, menuForm, type MenuBundle } from './menu.js'
import { planCreate, planUpdate } from './plan.js'
import { prepare } from './prepare.js'
import { type MenuSaves, type MenuTogether, rowsRequired, saveParameters, SQLSERVER_MAX_PARAMETERS, togetherChildren } from './together.js'
import {
  actor,
  CLERK,
  col,
  companyForm,
  described,
  edited,
  factsSnapshot,
  fk,
  INT32,
  INT64,
  LINE_POLICY,
  lineForm,
  MS_FACTS,
  ORDER_ID,
  ORDER_POLICY,
  ORDER_TOKEN,
  orderForm,
  PG,
  PG_ORDER,
  restrict,
  sales,
  sectioned,
  snapshot,
  STAMPED,
  table,
  text,
  togetherOn,
} from './test-support.js'
import { customers, defaultedNumber, noted, notes, TOUCH_PINNED } from './test-together.js'

/*
 * What a form offers alone and in a save (0155), the bindings a save can
 * be planned from, which children require rows of a record, and what a
 * person may do with a together child's rows in a save, as the menu reads
 * each bundle alone.
 */

/** A rowversion as the SQL Server adapter spells one. */
const ROWVERSION = '00000000000007d1'
const DELETE_LINES: FormPolicy = { ...LINE_POLICY, operations: { ...LINE_POLICY.operations, delete: ['clerk'] } }
const MS_LINES = togetherOn(lineForm(MS_FACTS).bindings, 'order')
const MS_TOUCHED = edited(orderForm(MS_FACTS).bindings, (draft) => {
  if (draft.concurrency !== null) draft.concurrency.touch = 'notes'
})
const OPERATIONS: OfferedOperation[] = ['create', 'update', 'delete', 'supersede']
const offered = (bindings: FormBindings, scope: WriteScope) => OPERATIONS.map((operation) => offeredFor(bindings, operation, scope))

describe('offeredFor', () => {
  // A together child's rows are added and removed with their record, so
  // alone its form offers no create, delete or change from a date, and
  // keeps update: its together field is written on create only. In a save
  // through that field it offers what its bindings do, and through any
  // other nothing. A form without one offers alone what its bindings say,
  // and nothing in a save; one whose bindings carry two offers nothing a
  // save would make, alone or in one. The planners, and the menu's
  // operations, ask the same function. Watched failing with `offeredFor`
  // answering `offers()` alone: the line form created and deleted lines
  // one at a time.
  test("refuses a together child's create, delete and change from a date alone, and keeps its update", () => {
    expect(offered(MS_LINES, null)).toEqual([false, true, false, false])
    expect(offered(MS_LINES, { save: 'order' })).toEqual([true, true, true, false])
    expect(offered(MS_LINES, { save: 'line_no' })).toEqual([false, false, false, false])
    const plain = lineForm(MS_FACTS).bindings
    expect(offered(plain, null)).toEqual([true, true, true, false])
    expect(offered(plain, { save: 'order' })).toEqual([false, false, false, false])
    const twice = togetherOn(togetherOn(PG_ORDER, 'customer'), 'employee')
    expect(offered(twice, null)).toEqual([false, true, false, false])
    expect(offered(twice, { save: 'customer' })).toEqual([false, false, false, false])

    const line = { line_no: 1, quantity: 1, unit_price: '5.00' }
    const alone = "This form's rows are created and deleted with the record they belong to, in one save."
    const token = `k1:${ORDER_ID},1`
    expect(planCreate(MS_FACTS, MS_LINES, DELETE_LINES, CLERK, { ...line, order: ORDER_TOKEN }, described(MS_FACTS, MS_LINES))).toEqual({
      ok: false,
      code: 'operation-unavailable',
      message: alone,
    })
    expect(planDelete(MS_FACTS, MS_LINES, DELETE_LINES, CLERK, token, ROWVERSION, described(MS_FACTS, MS_LINES))).toEqual({
      ok: false,
      code: 'operation-unavailable',
      message: alone,
    })
    expect(planUpdate(MS_FACTS, MS_LINES, DELETE_LINES, CLERK, token, ROWVERSION, { quantity: 4 }, undefined, described(MS_FACTS, MS_LINES))).toMatchObject({
      ok: true,
    })
    expect(planCreate(MS_FACTS, MS_LINES, DELETE_LINES, CLERK, line, described(MS_FACTS, MS_LINES), { save: 'order' })).toMatchObject({ ok: true })
    expect(grantedOperations(MS_LINES, DELETE_LINES, CLERK)).toEqual(['read', 'update'])
  })
})

describe('the bindings a save is planned from', () => {
  const refusal = (source: MetadataSnapshot, bindings: FormBindings) => {
    const ready = prepare(source, bindings)
    return ready.ok ? 'prepared' : `${ready.code}: ${ready.message}`
  }
  const lines = (change: (lookup: Extract<FieldBinding, { kind: 'lookup' }>, draft: FormBindings) => void) =>
    edited(togetherOn(lineForm(PG).bindings, 'order'), (draft) => change(draft.fields.find((binding) => binding.field === 'order') as never, draft))

  // A hand edit can carry a together lookup the generator will never
  // write, and the planner would then plan a save no bound or count holds:
  // two of them, bounds that are not whole or not ordered, or a `max` whose
  // list of rows is past a page, which every adapter refuses, a field written
  // on update, which would move a row to another record, a foreign key
  // that can be NULL, onto the form's own table, a section, a form over
  // versions, a table the database hides rows of. Each is refused before
  // anything is planned. Watched failing with `togetherProblem` unasked:
  // every one was prepared.
  // A together child declares no more rows than one save was measured to
  // hold, nor more than a list's page less one, whichever is fewer: a cap
  // above the measured one would let a bundle publish a bound the adapters'
  // save was never shown to hold within its deadline. Watched failing with
  // SAVE_MAX_ROWS measured at 10 and the cap the page's alone: "expected 49
  // to be less than or equal to 10".
  test('caps a together child at the fewer of a page less one and the rows a save was measured to hold', () => {
    expect(TOGETHER_MAX_ROWS).toBeLessThanOrEqual(SAVE_MAX_ROWS)
    expect(TOGETHER_MAX_ROWS).toBeLessThanOrEqual(LIST_PAGE_SIZE - 1)
    expect([SAVE_MAX_ROWS, LIST_PAGE_SIZE - 1]).toContain(TOGETHER_MAX_ROWS)
  })

  test('refuses a together lookup no save can hold', () => {
    expect(refusal(PG, togetherOn(lineForm(PG).bindings, 'order'))).toBe('prepared')
    expect(refusal(PG, togetherOn(togetherOn(PG_ORDER, 'customer'), 'employee'))).toContain('customer and employee are each saved with their record')
    // The largest `max` a list of the record's rows can be planned at, and one more.
    expect(refusal(PG, togetherOn(lineForm(PG).bindings, 'order', { min: 0, max: TOGETHER_MAX_ROWS }))).toBe('prepared')
    for (const [bounds, says] of [
      [{ min: 2, max: 1 }, 'not 0 <= min <= max'],
      [{ min: 0, max: 0 }, 'max is below 1'],
      [{ min: 0, max: TOGETHER_MAX_ROWS + 1 }, `max is above ${String(TOGETHER_MAX_ROWS)}`],
      [{ min: 0.5, max: 2 }, 'not whole numbers'],
      [{ min: 0, max: 2, step: 1 }, 'more than { min, max }'],
      [[1, 2], 'not { min, max }'],
    ] as const) {
      expect(
        refusal(
          PG,
          lines((lookup) => Object.assign(lookup, { together: bounds })),
        ),
      ).toContain(says)
    }
    expect(
      refusal(
        PG,
        lines((lookup) => (lookup.writes = { create: true, update: true })),
      ),
    ).toContain('written on update')
    expect(refusal(PG, togetherOn(PG_ORDER, 'employee'))).toContain('created_by can be NULL')
    const managed = snapshot('postgres', (objects) => {
      const employee = objects.find((object) => object.ref.name === 'employee') as ObjectMeta
      employee.foreignKeys.push(fk('fk_employee_manager', ['manager_id'], 'employee', ['id']))
      ;(employee.columns.find((column) => column.name === 'manager_id') as ObjectMeta['columns'][number]).nullable = false
    })
    const employees = generateForm(managed, {
      connection: 'erp',
      root: sales('employee'),
      formId: 'employee',
      title: 'Employee',
      lookups: [{ foreignKey: 'fk_employee_manager', display: ['name'] }],
    }).bindings
    expect(refusal(managed, togetherOn(employees, 'employee'))).toContain("references the form's own table")
    const SECTIONED = sectioned('postgres')
    expect(refusal(SECTIONED, togetherOn(companyForm(SECTIONED).bindings, 'customer'))).toContain('is a section')
    expect(
      refusal(
        PG,
        lines((_, draft) => (draft.validity = { from: 'line_no', to: 'quantity', key: ['order_id'] })),
      ),
    ).toContain('a form over versions')
    const hidden = snapshot('postgres', (objects) => {
      ;(objects.find((object) => object.ref.name === 'order_line') as ObjectMeta).rowSecurity = 'applies'
    })
    expect(refusal(hidden, togetherOn(lineForm(hidden).bindings, 'order'))).toContain('row security')
  })

  // A save of rows alone sets the touch column to itself, so a hand edit
  // that names one no such statement can set is refused: on a version
  // column, which the touch increments itself; a key, a foreign key or a
  // generated column; one the table lacks, or not a name; one the account
  // may not update. Watched failing with the touch column unchecked: each
  // was prepared.
  test('refuses a touch column a save of rows alone could not set', () => {
    const touched = (source: MetadataSnapshot, column: unknown) =>
      refusal(
        source,
        edited(orderForm(source).bindings, (draft) => Object.assign(draft.concurrency as object, { touch: column })),
      )
    expect(touched(MS_FACTS, 'notes')).toBe('prepared')
    expect(touched(PG, 'notes')).toContain("a touch column is a rowversion's")
    expect(touched(MS_FACTS, 'id')).toContain('in a key or a foreign key')
    expect(touched(MS_FACTS, 'customer_no')).toContain('in a key or a foreign key')
    expect(touched(MS_FACTS, 'row_version')).toContain('is generated')
    expect(touched(MS_FACTS, 'nope')).toContain('not a column of the table')
    expect(touched(MS_FACTS, 5)).toContain('not a column name')
    const readOnly = snapshot('sqlserver', (objects) => restrict(objects, 'order', 'notes', { update: false }))
    expect(touched(readOnly, 'notes')).toContain('may not both read and update the touch column notes')
  })
})

/** A published form as the menu reads it. */
const bundle = (id: string, source: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, connection = 'erp'): MenuBundle => ({
  id,
  title: id,
  connection,
  snapshot: source,
  bindings,
  policy,
})

describe('rowsRequired', () => {
  // A plain create of a record a together child requires rows of is
  // refused whoever asks, so the lookups that require them are found from
  // the bundles alone, with no person: a child no one may read is still
  // found, and one whose min is 0, one on another connection, or one that
  // is not together is not. Watched failing with a min of 0 counted as
  // requiring.
  test('finds every child that requires rows of a record, whoever the person is', () => {
    const order = bundle('order', PG, PG_ORDER, ORDER_POLICY)
    const required = bundle('order-line', PG, togetherOn(lineForm(PG).bindings, 'order'), {
      ...LINE_POLICY,
      operations: { read: [], create: [], update: [] },
    })
    const optional = bundle('optional-lines', PG, togetherOn(lineForm(PG).bindings, 'order', { min: 0, max: 3 }), LINE_POLICY)
    const elsewhere = bundle('archived-lines', PG, togetherOn(lineForm(PG).bindings, 'order'), LINE_POLICY, 'archive')
    const plain = bundle('plain-lines', PG, lineForm(PG).bindings, LINE_POLICY)
    expect(rowsRequired(order, [order, required, optional, elsewhere, plain])).toEqual([{ form: required, field: 'order', min: 1, max: 3 }])
    expect(rowsRequired(bundle('line', PG, lineForm(PG).bindings, LINE_POLICY), [required])).toEqual([])
  })
})

describe('TogetherChild', () => {
  const lines = (policy: FormPolicy = DELETE_LINES, bindings = MS_LINES) => bundle('order-line', MS_FACTS, bindings, policy)
  const orders = (policy: FormPolicy = ORDER_POLICY, bindings = MS_TOUCHED) => bundle('order', MS_FACTS, bindings, policy)
  const flags = (parent: MenuBundle, child: MenuBundle, context: PolicyContext = CLERK) =>
    togetherChildren(menuForm(parent, context), [menuForm(child, context)]).map((entry) => entry.together)
  const only =
    (operation: 'create' | 'update' | 'delete', roles: string[]) =>
    (policy: FormPolicy): FormPolicy => ({
      ...policy,
      operations: { ...policy.operations, [operation]: roles },
    })
  const ALL = { min: 1, max: 3, created: { create: true }, saved: { create: true, update: true, delete: true } }

  // Each flag is the child's own write in a save, under its policy, with
  // the parent's: a save that creates the record needs the parent's
  // create; one over a saved record its update, its confirmed concurrency
  // and, on a rowversion, a confirmed touch column. A parent that cannot
  // carry a save -- one whose own rows are saved with another record, one
  // over versions, one no token addresses -- turns every flag off. A touch
  // column the parent's row filters pin leaves no save over a saved record,
  // as the planner refuses one; a key the database fills by a default that
  // can repeat leaves no save that creates the record, as the planner
  // cannot pin its rows to it. Watched failing with the parent's update,
  // and then its touch column, left out of `saved`; with the row filters
  // unasked: every saved flag on; with the key unasked: the defaulted
  // customer's create offered; and with an unaddressable parent and one
  // over versions carrying saves.
  test('follows each operation of the child and of the parent', () => {
    expect(flags(orders(), lines())).toEqual([ALL])
    expect(flags(orders(), lines(only('create', ['manager'])(DELETE_LINES)))).toEqual([
      { ...ALL, created: { create: false }, saved: { ...ALL.saved, create: false } },
    ])
    expect(flags(orders(), lines(only('update', ['manager'])(DELETE_LINES)))).toEqual([{ ...ALL, saved: { ...ALL.saved, update: false } }])
    expect(flags(orders(), lines(only('delete', ['manager'])(DELETE_LINES)))).toEqual([{ ...ALL, saved: { ...ALL.saved, delete: false } }])
    const none = { create: false, update: false, delete: false }
    expect(flags(orders(only('update', ['manager'])(ORDER_POLICY)), lines())).toEqual([{ ...ALL, saved: none }])
    expect(flags(orders(only('create', ['manager'])(ORDER_POLICY)), lines())).toEqual([{ ...ALL, created: { create: false } }])
    expect(flags(orders(ORDER_POLICY, orderForm(MS_FACTS).bindings), lines())).toEqual([{ ...ALL, saved: none }])
    expect(flags(orders(ORDER_POLICY, togetherOn(MS_TOUCHED, 'customer')), lines())).toEqual([{ ...ALL, created: { create: false }, saved: none }])
    expect(flags(orders(TOUCH_PINNED), lines(), actor(['clerk'], { tenant: '1', note: 'n' }))).toEqual([{ ...ALL, saved: none }])

    // A customer over PostgreSQL has no version column, so nothing is saved over a saved one.
    const customerFlags = (source: MetadataSnapshot) => {
      const parent = customers(source)
      const child = notes(source)
      return flags(bundle('customer', source, parent.bindings, parent.policy), bundle('notes', source, child.bindings, child.policy))
    }
    const NOTES = { min: 1, max: 3, saved: none }
    expect(customerFlags(noted())).toEqual([{ ...NOTES, created: { create: true } }])
    expect(customerFlags(noted(defaultedNumber))).toEqual([{ ...NOTES, created: { create: false } }])

    const versioned = edited(PG_ORDER, (draft) => (draft.validity = { from: 'order_date', to: 'paid', key: ['tenant_id', 'customer_no'] }))
    expect(menuForm(bundle('order', PG, versioned, ORDER_POLICY), CLERK).saves).toBeNull()
    expect(menuForm(bundle('order', STAMPED, orderForm(STAMPED).bindings, ORDER_POLICY), CLERK).saves).toBeNull()
  })

  // On SQL Server a save is one batch, held to 2,100 parameters: the
  // order's step, 17 here, and each line change's 10 -- three columns set,
  // two key parts, the version, the through's tenant, the order's key, and
  // the table's name and definition -- with 9 for each child's count and
  // `within`, summed over every together child of the order. No child
  // holds more than TOGETHER_MAX_ROWS lines, so the order is given as many
  // line forms at that bound as fit, and one more whose bound is found
  // from those numbers: at it every flag of every child is on, and at one
  // line more every one is off. PostgreSQL sends a save's statements one at
  // a time and has no such limit. Watched failing with the batch's sum left
  // unasked, and with each child's count and `within` left out of it.
  test('holds a SQL Server save to one batch, and a PostgreSQL one to nothing of the kind', () => {
    expect(saveParameters(MS_FACTS, MS_LINES, DELETE_LINES)).toBe(10)
    const parent = menuForm(orders(), CLERK)
    expect(parent.saves).toEqual({ kind: 'sqlserver', touch: true, knownKey: true, parameters: 17 })
    const once = (menuForm(lines(), CLERK).together as MenuTogether).parameters
    expect(once).toEqual({ row: 10, child: 9 })

    const full = TOGETHER_MAX_ROWS * once.row + once.child
    const room = SQLSERVER_MAX_PARAMETERS - (parent.saves as MenuSaves).parameters
    const filled = Math.floor(room / full)
    const last = Math.floor((room - filled * full - once.child) / once.row)
    const children = (source: MetadataSnapshot, policy: FormPolicy, bounds: number[]) =>
      bounds.map((max, index) =>
        menuForm(bundle(`lines-${String(index)}`, source, togetherOn(lineForm(source).bindings, 'order', { min: 1, max }), policy), CLERK),
      )
    const at = (max: number) => togetherChildren(parent, children(MS_FACTS, DELETE_LINES, [...Array<number>(filled).fill(TOGETHER_MAX_ROWS), max]))
    const on = { created: { create: true }, saved: { create: true, update: true, delete: true } }
    const off = { created: { create: false }, saved: { create: false, update: false, delete: false } }
    expect(at(last).map((entry) => entry.together)).toMatchObject(Array<typeof on>(filled + 1).fill(on))
    expect(at(last + 1).map((entry) => entry.together)).toMatchObject(Array<typeof off>(filled + 1).fill(off))

    const pgParent = menuForm(bundle('order', PG, PG_ORDER, ORDER_POLICY), CLERK)
    const pgChildren = children(PG, LINE_POLICY, Array<number>(filled + 2).fill(TOGETHER_MAX_ROWS))
    expect(togetherChildren(pgParent, pgChildren).map((entry) => entry.together)).toEqual(
      Array<unknown>(filled + 2).fill({ min: 1, max: TOGETHER_MAX_ROWS, created: { create: true }, saved: { create: true, update: true, delete: false } }),
    )
  })

  // What one change of a row binds is the most of what its create, update
  // and delete bind: a delete binds every table its reach removes rows of
  // and every key it accepts, so a line whose delete also deletes its
  // notes binds more than its update; and an update binds each stamp of who
  // changed the row, never one of when, which the database's clock writes.
  // Watched failing with the reach left out of a delete, and with who's
  // stamps left out of an update.
  test("binds a row's delete reach and its stamps of who", () => {
    const reached = factsSnapshot('sqlserver', (objects) => {
      objects.push(
        table('line_note', [col('order_id', 1, INT64), col('line_no', 2, INT32), col('note_no', 3, INT32)], {
          primaryKey: { name: 'pk_line_note', columns: ['order_id', 'line_no', 'note_no'] },
          foreignKeys: [{ ...fk('fk_line_note_line', ['order_id', 'line_no'], 'order_line', ['order_id', 'line_no']), onDelete: 'cascade' }],
        }),
      )
    })
    const cascading: FormPolicy = { ...DELETE_LINES, cascades: [{ table: sales('line_note'), foreignKey: 'fk_line_note_line', onDelete: 'cascade' }] }
    // Located: two key parts, the version, the through's tenant and the order's key, 5; reached: two tables removed, twice each, and one key accepted, four times.
    expect(saveParameters(reached, togetherOn(lineForm(reached).bindings, 'order'), cascading)).toBe(2 + 5 + 2 * 2 + 4)

    const stamped = factsSnapshot('sqlserver', (objects) => {
      const line = objects.find((object) => object.ref.name === 'order_line') as ObjectMeta
      line.columns.push(
        col('changed_by', 7, text(40), { nullable: true }),
        col('changed_at', 8, { kind: 'timestamp', withTimeZone: true, precision: 6 }, { nullable: true }),
      )
    })
    const request: GenerationRequest = {
      connection: 'erp',
      root: sales('order_line'),
      formId: 'sales-order-line',
      title: 'Order line',
      lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
      stamps: [
        { column: 'changed_by', value: { kind: 'actor' }, on: 'update' },
        { column: 'changed_at', value: { kind: 'time' }, on: 'update' },
      ],
    }
    // The update's three columns set and who changed it, beside the 5 located and the 2 of every statement.
    expect(saveParameters(stamped, togetherOn(generateForm(stamped, request).bindings, 'order'), DELETE_LINES)).toBe(2 + 3 + 1 + 5)
  })
})
