import { describe, expect, test } from 'vitest'
import type { ObjectMeta } from '../metadata.js'
import { edited, fieldOf, LINE_POLICY, lineForm, MS, ORDER_POLICY, orderForm, PG, snapshot, text } from '../records/test-support.js'
import { throughProblems } from './through.js'
import type { FormPolicy } from './types.js'
import { validatePolicy } from './validate.js'

/*
 * What only the snapshot can tell about a through (0043): whether its lookup
 * configures, and whether its key is one a through compares. The forms are
 * the planner's, generated from the fixture's schema as data-core restates it.
 */

/** The order form with its employee lookup named in `through`, generated from a snapshot whose `table.column` is text. */
function textKeyed(table: string, column: string) {
  const source = snapshot('postgres', (objects) => {
    const found = (objects.find((object) => object.ref.name === table) as ObjectMeta).columns.find((candidate) => candidate.name === column)
    if (found === undefined) throw new Error(`the fixture has no ${table}.${column}`)
    found.type = text(10)
  })
  const policy: FormPolicy = { ...ORDER_POLICY, through: ['employee'] }
  return { source, bindings: orderForm(source).bindings, policy }
}

describe('throughProblems', () => {
  // The line form's order is an integer key on both sides: what a through
  // is for, and on both engines' snapshots the policy fits as it stands, so
  // every refusal below is this function's and not the policy's.
  test("accepts a through over an integer key, on both engines' snapshots", () => {
    for (const source of [PG, MS]) {
      const bindings = lineForm(source).bindings
      expect(validatePolicy(LINE_POLICY, bindings)).toEqual({ ok: true })
      expect(throughProblems(source, bindings, LINE_POLICY)).toEqual([])
    }
  })

  // PostgreSQL lets a foreign key join text columns of two collations, and a
  // direct comparison of them then cannot resolve one; the snapshot records
  // none to name. A text column on EITHER side of the key is refused --
  // a check of one side only would let the other through -- naming the
  // field and the column.
  test('refuses a text key column on the target side and on the root side, naming the field and the column', () => {
    const target = textKeyed('employee', 'id')
    expect(validatePolicy(target.policy, target.bindings)).toEqual({ ok: true })
    expect(throughProblems(target.source, target.bindings, target.policy)).toEqual([
      'through: employee joins sales.employee.id, which a through cannot compare: only integer, decimal, uuid and date keys are compared without a collation, and the snapshot records none',
    ])
    const root = textKeyed('order', 'created_by')
    expect(throughProblems(root.source, root.bindings, root.policy)).toEqual([
      'through: employee joins sales.order.created_by, which a through cannot compare: only integer, decimal, uuid and date keys are compared without a collation, and the snapshot records none',
    ])
    // The same forms without the through are not this function's concern.
    expect(throughProblems(target.source, target.bindings, ORDER_POLICY)).toEqual([])
  })

  // A lookup that cannot be configured offers nothing and scopes nothing:
  // the planner could not build its EXISTS, so it is refused here, with
  // buildLookupConfig's own reason.
  test('refuses a through whose lookup does not configure, with the reason', () => {
    const bindings = edited(lineForm(PG).bindings, (draft) => {
      const order = fieldOf(draft, 'order')
      if (order.kind === 'lookup') order.display = ['shipped_on']
    })
    expect(throughProblems(PG, bindings, LINE_POLICY)).toEqual([
      'through: order cannot scope this form: fk_order_line_order (sales.order): the table has no column shipped_on',
    ])
  })

  // What validatePolicy refuses -- a through that is not a list, an entry on
  // a field that is not a lookup -- is its to say; said twice, a person
  // would fix one problem from two sentences.
  test('passes over what validatePolicy refuses', () => {
    const bindings = lineForm(PG).bindings
    expect(throughProblems(PG, bindings, { ...LINE_POLICY, through: ['quantity', 'nothing'] })).toEqual([])
    expect(throughProblems(PG, bindings, { ...LINE_POLICY, through: 'order' as unknown as string[] })).toEqual([])
  })
})
