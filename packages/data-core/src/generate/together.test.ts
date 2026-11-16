import { describe, expect, test } from 'vitest'
import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import { col, fk, INT64, lineForm, sales, snapshot, togetherOn } from '../records/test-support.js'
import { generateForm } from './generate.js'
import { TOGETHER_MAX_ROWS } from './together.js'
import type { FieldBinding, GenerationRequest, LookupChoice } from './types.js'

/*
 * What the generator writes for a lookup saved with its record and for a
 * rowversion's touch column (0155), and every request it refuses rather
 * than write bindings a save could not hold. The planner and the bundle
 * check hold the bindings to the same rule (`togetherProblem`), so a form
 * the generator writes is one they never refuse.
 */

const LINES = (kind: 'postgres' | 'sqlserver', choice: Partial<LookupChoice> = {}): GenerationRequest => ({
  connection: 'erp',
  root: sales('order_line'),
  formId: 'sales-order-line',
  title: 'Order line',
  lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'], together: { min: 1, max: 3 }, ...choice }],
  ...(kind === 'postgres' ? { versionColumn: 'row_version' } : {}),
})

const ORDERS = (touchColumn: string | undefined, extra: Partial<GenerationRequest> = {}): GenerationRequest => ({
  connection: 'erp',
  root: sales('order'),
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
  ...(touchColumn === undefined ? {} : { touchColumn }),
  ...extra,
})

const lookupOf = (bindings: { fields: FieldBinding[] }, field: string) =>
  bindings.fields.find((binding) => binding.field === field) as Extract<FieldBinding, { kind: 'lookup' }>

describe('a lookup saved with its record', () => {
  // The generator writes what the suites of PR 2 and 3 edited in by hand
  // (`togetherOn`, data-fixtures' `savedWith`): the bounds on the lookup,
  // and the field written on create only, so no row's record changes once
  // the module made it. A lookup not marked carries nothing, so every form
  // generated before 0155 generates byte for byte as it did. Watched
  // failing with the choice's `together` not carried into the binding:
  // the bindings lacked it.
  test('is the lookup with its bounds, written on create only', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const source = snapshot(kind)
      const generated = generateForm(source, LINES(kind))
      expect(generated.bindings, kind).toEqual(togetherOn(lineForm(source).bindings, 'order', { min: 1, max: 3 }))
      expect(Object.hasOwn(lookupOf(lineForm(source).bindings, 'order'), 'together')).toBe(false)
    }
  })

  // A save supplies the field from its record, and a row of the form is
  // created only in one: required in the form, it would be a field a page
  // drawing the row under its record could never submit without. The
  // administrator reads why in a note. Watched failing with `required`
  // decided as for any other lookup: the order field was required.
  test('is not required in the form, and its note says it is saved with its record', () => {
    const generated = generateForm(snapshot('sqlserver'), LINES('sqlserver'))
    const field = generated.form.model.fields.find((entry) => entry.key === 'order')
    expect(field?.required).toBeUndefined()
    expect(lineForm(snapshot('sqlserver')).form.model.fields.find((entry) => entry.key === 'order')?.required).toBe(true)
    expect(generated.notes).toContainEqual({
      subject: 'order',
      kind: 'read-only',
      message: 'Saved with its order, in one save, between 1 and 3 rows of one: written when a row is created with it, never on update.',
    })
  })

  // Each refusal is a lookup no save could hold: bounds that are not whole
  // and ordered, or past what a save is planned from; a foreign key that can
  // be NULL, so a row could belong to no record; a lookup onto the form's
  // own table, a tree, where each row would be another save's record; a
  // section; a form over versions; a second together lookup; and a table
  // whose rows the database hides from the account, which every count would
  // leave out. Watched failing with `togetherProblem` not asked of the
  // generated bindings: each of them was generated.
  test('is refused where a save could not hold it', () => {
    const source = snapshot('sqlserver')
    for (const together of [
      { min: 2, max: 1 },
      { min: 0, max: 0 },
      { min: 0.5, max: 2 },
      { min: 0, max: TOGETHER_MAX_ROWS + 1 },
    ]) {
      expect(() => generateForm(source, LINES('sqlserver', { together })), JSON.stringify(together)).toThrow('order is saved with its record, and its')
    }
    const nullable = snapshot('sqlserver', (objects) => {
      const line = objects.find((object) => object.ref.name === 'order_line') as ObjectMeta
      ;(line.columns.find((column) => column.name === 'order_id') as ColumnMeta).nullable = true
      line.primaryKey = { name: 'pk_order_line', columns: ['line_no'] }
    })
    expect(() => generateForm(nullable, LINES('sqlserver'))).toThrow('order_id can be NULL')
    const hidden = snapshot('sqlserver', (objects) => {
      ;(objects.find((object) => object.ref.name === 'order_line') as ObjectMeta).rowSecurity = 'applies'
    })
    expect(() => generateForm(hidden, LINES('sqlserver'))).toThrow('row security on the table would hide rows from every count')

    const tree = snapshot('sqlserver', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      order.columns.push(col('parent_id', 13, INT64))
      order.foreignKeys.push(fk('fk_order_parent', ['parent_id'], 'order', ['id']))
    })
    const own = ORDERS(undefined, { lookups: [{ foreignKey: 'fk_order_parent', display: ['notes'], together: { min: 0, max: 3 } }] })
    expect(() => generateForm(tree, own)).toThrow("references the form's own table")
    const twice = snapshot('sqlserver', (objects) => {
      const line = objects.find((object) => object.ref.name === 'order_line') as ObjectMeta
      line.columns.push(col('order_again', 7, INT64))
      line.foreignKeys.push(fk('fk_order_line_again', ['order_again'], 'order', ['id']))
    })
    const both = LINES('sqlserver')
    both.lookups.push({ foreignKey: 'fk_order_line_again', display: ['order_date'], together: { min: 0, max: 3 } })
    expect(() => generateForm(twice, both)).toThrow('are each saved with their record, and one lookup of a form at most is')
  })

  // A section is one row of its record, shown as a form, and a form over
  // versions keeps a chain whose ends no save of rows moves: neither is
  // saved with its record. Watched failing with the section and the
  // versions checks taken out of `togetherProblem`: both were generated.
  test('is neither a section nor a lookup of a form over versions', () => {
    const source = snapshot('postgres', (objects) => {
      const line = objects.find((object) => object.ref.name === 'order_line') as ObjectMeta
      line.primaryKey = { name: 'pk_order_line', columns: ['order_id'] }
      line.columns.push(col('valid_from', 7, { kind: 'date' }), col('valid_to', 8, { kind: 'date' }, { nullable: true }))
    })
    expect(() => generateForm(source, LINES('postgres', { section: { when: null } }))).toThrow('is a section')
    const over = { ...LINES('postgres'), validity: { from: 'valid_from', to: 'valid_to' } }
    expect(() => generateForm(source, over)).toThrow(/versions/)
  })
})

describe("a rowversion's touch column", () => {
  // Confirmed by the request alone and kept on the concurrency, so a save
  // of rows alone moves the rowversion by setting it to itself; never
  // inferred, so a form whose request names none has none. Watched failing
  // with `touchColumn` not read: the bindings had no touch.
  test('is the request’s, on a rowversion root, and never inferred', () => {
    const source = snapshot('sqlserver')
    expect(generateForm(source, ORDERS('notes')).bindings.concurrency).toEqual({ kind: 'rowversion', column: 'row_version', confirmed: true, touch: 'notes' })
    expect(Object.hasOwn(generateForm(source, ORDERS(undefined)).bindings.concurrency ?? {}, 'touch')).toBe(false)
  })

  // A touch writes the column, so it is no column a trigger guarding the
  // record's address or tenant would refuse every such save over -- a key,
  // a foreign key -- none the policy pins, none the database generates, and
  // one the account may both read and update. A version column is moved by
  // a save itself and takes none. Watched failing with the request's touch
  // column carried unchecked: each was generated.
  test('is refused where a touch could not set it', () => {
    const source = snapshot('sqlserver', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      ;(order.columns.find((column) => column.name === 'group') as ColumnMeta).access = { select: true, insert: true, update: false }
    })
    expect(() => generateForm(source, ORDERS('id'))).toThrow('the touch column id is in a key or a foreign key')
    expect(() => generateForm(source, ORDERS('tenant_id'))).toThrow('the touch column tenant_id is in a key or a foreign key')
    expect(() => generateForm(source, ORDERS('row_version'))).toThrow('the touch column row_version is generated')
    expect(() => generateForm(source, ORDERS('group'))).toThrow('may not both read and update the touch column group')
    expect(() => generateForm(source, ORDERS('nope'))).toThrow('the touch column nope is not a column of the table')
    expect(() => generateForm(source, ORDERS('status', { pinned: ['status'] }))).toThrow('the touch column status is pinned by the policy')
    expect(() => generateForm(snapshot('postgres'), ORDERS('notes', { versionColumn: 'row_version' }))).toThrow("a touch column is a rowversion's")
  })
})
