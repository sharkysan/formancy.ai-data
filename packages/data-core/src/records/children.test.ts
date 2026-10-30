import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { childFields } from './children.js'
import type { PublishedTable } from './children.js'
import { col, customerForm, customerSource, edited, fk, INT32, lineForm, MS, orderForm, PG, sales, snapshot, table, text } from './test-support.js'

/*
 * Which lookups make one form's rows children of another's records (0045):
 * structure only, from the two bundles' snapshots and bindings, the same on
 * both engines. Who may see the child is the menu's business
 * (`menu.test.ts`). What a page does with a child is hand the parent's
 * token to the child's list as its `parent`, so every case here asks one
 * question: is the parent's record token a value the child's foreign key
 * takes, spelling the record it references? Which rows the list then holds
 * is the database's equality, the adapters' parity cases' business.
 */

const on = (source: MetadataSnapshot, bindings: FormBindings, connection = 'erp'): PublishedTable => ({ connection, snapshot: source, bindings })

/** The fixture's employee, managed by another employee: the self-reference `fk_employee_manager` the planner's fixture leaves out. */
const MANAGED = snapshot('postgres', (objects) => {
  const employee = objects.find((object) => object.ref.name === 'employee') as ObjectMeta
  employee.foreignKeys.push(fk('fk_employee_manager', ['manager_id'], 'employee', ['id']))
})
const employeeForm = (source: MetadataSnapshot) =>
  generateForm(source, {
    connection: 'erp',
    root: sales('employee'),
    formId: 'sales-employee',
    title: 'Employee',
    lookups: [{ foreignKey: 'fk_employee_manager', display: ['name'] }],
  }).bindings
/** An order form showing who created and who approved it: two lookups onto one employee. */
const staffForm = (source: MetadataSnapshot) =>
  generateForm(source, {
    connection: 'erp',
    root: sales('order'),
    formId: 'sales-order-staff',
    title: 'Order staff',
    lookups: [
      { foreignKey: 'fk_order_created_by', display: ['name'] },
      { foreignKey: 'fk_order_approved_by', display: ['name'] },
    ],
  }).bindings

/** A price list keyed by an amount, and a quote whose foreign key onto it is of `quoted`: the case where equal values are spelled apart. */
function priced(quoted: NormalizedType): MetadataSnapshot {
  return snapshot('postgres', (objects) => {
    objects.push(
      table('price', [col('code', 1, { kind: 'decimal', precision: 12, scale: 2 }), col('label', 2, text(50))], {
        primaryKey: { name: 'pk_price', columns: ['code'] },
      }),
      table('quote', [col('id', 1, INT32), col('price_code', 2, quoted)], {
        primaryKey: { name: 'pk_quote', columns: ['id'] },
        foreignKeys: [fk('fk_quote_price', ['price_code'], 'price', ['code'])],
      }),
    )
  })
}
const priceForm = (source: MetadataSnapshot) =>
  generateForm(source, { connection: 'erp', root: sales('price'), formId: 'price', title: 'Price', lookups: [] }).bindings
const quoteForm = (source: MetadataSnapshot) =>
  generateForm(source, {
    connection: 'erp',
    root: sales('quote'),
    formId: 'quote',
    title: 'Quote',
    lookups: [{ foreignKey: 'fk_quote_price', display: ['label'] }],
  }).bindings

describe('childFields', () => {
  // An order's lines reference the order's key, its only identity column,
  // and of its type: a line list narrowed by the order's own token holds
  // exactly that order's lines. Watched failing with only the target table
  // compared: the cases below, that reach the parent's table by other
  // columns or other types, were children too.
  test("a lookup onto the parent's identity, in order and of equal types, makes a child", () => {
    expect(childFields(on(PG, orderForm(PG).bindings), on(PG, lineForm(PG).bindings))).toEqual(['order'])
    // A composite key: an order references its customer by both columns of the customer's key, in the key's order.
    const source = customerSource()
    expect(childFields(on(source, customerForm(source).bindings), on(source, orderForm(source).bindings))).toEqual(['customer'])
  })

  // The bindings a token is decoded through are each form's own, from its
  // own snapshot: the line form's snapshot need not be the order form's,
  // as long as the two say the same of the columns a token carries. Which
  // side's snapshot each type is read from is the two disagreement cases'
  // below.
  test('is a child across two snapshots that agree on the key and its foreign key', () => {
    const order = orderForm(PG).bindings
    const line = lineForm(MANAGED).bindings
    expect(childFields(on(PG, order), on(MANAGED, line))).toEqual(['order'])
  })

  // A table of the same name on another connection is another database's
  // table: its rows reference nothing the parent form's tokens name.
  test('is nothing on another connection', () => {
    expect(childFields(on(PG, orderForm(PG).bindings), on(PG, lineForm(PG).bindings, 'archive'))).toEqual([])
  })

  // A customer references its country by `iso_code`, a unique key that is
  // not the country form's identity: the country's token spells its `id`,
  // and narrowing customers by it would compare `iso_code` with an id.
  test('is nothing through a foreign key onto a unique key that is not the identity', () => {
    const country = generateForm(MS, { connection: 'erp', root: sales('country'), formId: 'sales-country', title: 'Country', lookups: [] }).bindings
    expect(country.identity).toEqual(['id'])
    const source = customerSource()
    expect(childFields(on(MS, country), on(source, customerForm(source).bindings))).toEqual([])
  })

  // The same two columns, referenced in the other order: each row still
  // references one customer, but the parent's token spells tenant then
  // number and the child's lookup holds number then tenant, so a token
  // handed across would name another row, or none.
  test("is nothing when the foreign key names the identity's columns in another order", () => {
    const source = snapshot('sqlserver', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      order.foreignKeys = [fk('fk_order_customer', ['customer_no', 'tenant_id'], 'customer', ['customer_no', 'tenant_id'])]
      ;(objects.find((object) => object.ref.name === 'customer') as ObjectMeta).uniqueKeys.push({
        name: 'uq_customer_reversed',
        columns: ['customer_no', 'tenant_id'],
      })
    })
    const order = generateForm(source, {
      connection: 'erp',
      root: sales('order'),
      formId: 'o',
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
    }).bindings
    expect(childFields(on(source, customerForm(source).bindings), on(source, order))).toEqual([])
  })

  // A parent whose records have no token has nothing to hand a child.
  test('is nothing under a parent with no identity', () => {
    const order = edited(orderForm(PG).bindings, (draft) => {
      draft.identity = null
    })
    expect(childFields(on(PG, order), on(PG, lineForm(PG).bindings))).toEqual([])
  })

  // `numeric(12,4)` onto `numeric(12,2)`: the parent's token spells `1.50`,
  // the child's column holds `1.5000`, and its codec refuses the shorter
  // spelling, so a list narrowed by the parent's token would be refused.
  // Equal types are a child, which shows the type is what decides. Watched
  // failing with the types left uncompared: the wider key was a child.
  test('is nothing when a foreign-key column is of another type than the key it references', () => {
    const wider = priced({ kind: 'decimal', precision: 12, scale: 4 })
    expect(childFields(on(wider, priceForm(wider)), on(wider, quoteForm(wider)))).toEqual([])
    const same = priced({ kind: 'decimal', precision: 12, scale: 2 })
    expect(childFields(on(same, priceForm(same)), on(same, quoteForm(same)))).toEqual(['price'])
  })

  // A foreign key whose type the child's snapshot says one thing of and
  // the parent's key another -- one was taken before a column was retyped
  // -- is not trusted to match.
  test("is nothing when the two snapshots disagree about the foreign key's type", () => {
    const retyped = snapshot('postgres', (objects) => {
      const line = objects.find((object) => object.ref.name === 'order_line') as ObjectMeta
      Object.assign(line.columns.find((column) => column.name === 'order_id') as object, { type: INT32 })
    })
    expect(childFields(on(PG, orderForm(PG).bindings), on(retyped, lineForm(retyped).bindings))).toEqual([])
  })

  // The parent's key retyped in the parent's snapshot alone: the parent's
  // token is made through the parent's codecs, from its own snapshot, and
  // here spells an `int4` the child's snapshot still calls `int8`. Read
  // from the child's snapshot alone, the key would still agree with the
  // child's column, and the child would be named. Watched failing with the
  // key's types read from the child's snapshot: the order was named.
  test("is nothing when the parent's snapshot alone retypes its key", () => {
    const retyped = snapshot('postgres', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      Object.assign(order.columns.find((column) => column.name === 'id') as object, { type: INT32 })
    })
    expect(childFields(on(retyped, orderForm(retyped).bindings), on(PG, lineForm(PG).bindings))).toEqual([])
  })

  // A text key makes a child as a key of any other type does, though the
  // child's rows need not spell it as the parent's token does: the list
  // narrows by the database's own equality (0044's `text-parent`), the one
  // the foreign key was checked by, so under SQL Server's case-insensitive
  // collation a depot holding `ch` references region `CH`, is listed under
  // it, and its field spells `k1:ch`. Refusing text keys here, as `through`
  // does (0043), would name no depot under a region at all. Watched failing
  // with text keys refused: the depot was not named.
  test('a text key makes a child', () => {
    const regions = snapshot('sqlserver', (objects) => {
      objects.push(
        table('region', [col('code', 1, text(3)), col('name', 2, text(50))], { primaryKey: { name: 'pk_region', columns: ['code'] } }),
        table('depot', [col('id', 1, INT32), col('region_code', 2, text(3))], {
          primaryKey: { name: 'pk_depot', columns: ['id'] },
          foreignKeys: [fk('fk_depot_region', ['region_code'], 'region', ['code'])],
        }),
      )
    })
    const region = generateForm(regions, { connection: 'erp', root: sales('region'), formId: 'region', title: 'Region', lookups: [] }).bindings
    const depot = generateForm(regions, {
      connection: 'erp',
      root: sales('depot'),
      formId: 'depot',
      title: 'Depot',
      lookups: [{ foreignKey: 'fk_depot_region', display: ['name'] }],
    }).bindings
    expect(childFields(on(regions, region), on(regions, depot))).toEqual(['region'])
  })

  // An employee's manager is an employee: the employee form is its own
  // child, so a page can list the employees one employee manages.
  test('a self-reference makes a form its own child', () => {
    const employee = employeeForm(MANAGED)
    expect(childFields(on(MANAGED, employee), on(MANAGED, employee))).toEqual(['employee'])
  })

  // An order names two employees, who created it and who approved it: one
  // form, a child of the employee twice, once through each field, in the
  // bindings' order.
  test('two lookups onto one parent make two children', () => {
    expect(childFields(on(MANAGED, employeeForm(MANAGED)), on(MANAGED, staffForm(MANAGED)))).toEqual(['employee', 'employee_2'])
  })

  // Nothing but a lookup is a child: the order form's `approved_by` is a
  // column field when it is not offered as a lookup, and the customer form
  // references no order.
  test('is nothing through a column field, or onto another table', () => {
    expect(childFields(on(MANAGED, employeeForm(MANAGED)), on(PG, orderForm(PG).bindings))).toEqual(['employee'])
    const source = customerSource()
    expect(childFields(on(PG, orderForm(PG).bindings), on(source, customerForm(source).bindings))).toEqual([])
  })
})
