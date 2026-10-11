import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot, ObjectMeta } from '../metadata.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { formMenu, grantedOperations, menuForm } from './menu.js'
import type { MenuBundle } from './menu.js'
import { actor, AUDITOR, CLERK, CLERK_RW, fk, INTAKE, LINE_POLICY, lineForm, MS_FACTS, ORDER_POLICY, orderForm, PG, sales, snapshot, TENANT } from './test-support.js'

/*
 * The forms a person's menu names, and the children under each (0045): the
 * policy's decision, from the published bundles alone, asking no database.
 * Which lookups make a child at all is `childFields`' (children.test.ts);
 * what is under test here is who is told of a form or a child.
 */

const bundle = (id: string, title: string, source: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, connection = 'erp'): MenuBundle => ({ id, title, connection, snapshot: source, bindings, policy })
/** The menu as the route makes it: each bundle read alone for this person, then compared. */
const menuOf = (bundles: readonly MenuBundle[], context: PolicyContext) => formMenu(bundles.map((entry) => menuForm(entry, context)))

/** The fixture's employees, each managed by another, and a policy that keeps them to their tenant. */
const MANAGED = snapshot('postgres', (objects) => {
  ;(objects.find((object) => object.ref.name === 'employee') as ObjectMeta).foreignKeys.push(fk('fk_employee_manager', ['manager_id'], 'employee', ['id']))
})
const EMPLOYEE = generateForm(MANAGED, { connection: 'erp', root: sales('employee'), formId: 'sales-employee', title: 'Employee', lookups: [{ foreignKey: 'fk_employee_manager', display: ['name'] }] }).bindings
const EMPLOYEE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { id: CLERK_RW, tenant_id: { read: ['clerk'], write: [] }, name: CLERK_RW, employee: CLERK_RW },
  rowFilters: TENANT,
  lookups: { employee: TENANT },
}

const ORDER = bundle('order', 'Order', PG, orderForm(PG).bindings, ORDER_POLICY)
const LINES = bundle('order-line', 'Order line', PG, lineForm(PG).bindings, LINE_POLICY)
const EMPLOYEES = bundle('employee', 'Employee', MANAGED, EMPLOYEE, EMPLOYEE_POLICY)

describe('grantedOperations', () => {
  // What the policy grants this person and the form offers as published, in
  // one order: the part of `GET /v1/forms/:id`'s answer that asks no
  // database, which the menu says too, so the two cannot disagree on it.
  test('is what the policy grants of what the form offers, in read, create, update order', () => {
    expect(grantedOperations(ORDER.bindings, ORDER_POLICY, CLERK)).toEqual(['read', 'create', 'update'])
    expect(grantedOperations(ORDER.bindings, ORDER_POLICY, AUDITOR)).toEqual(['read'])
    expect(grantedOperations(ORDER.bindings, ORDER_POLICY, INTAKE)).toEqual(['create'])
    // Without a confirmed version column the form offers no update, whoever the policy grants it.
    expect(grantedOperations(orderForm(PG, false).bindings, ORDER_POLICY, CLERK)).toEqual(['read', 'create'])
    // A row filter whose attribute the context lacks scopes nothing, so it grants nothing (0011).
    expect(grantedOperations(ORDER.bindings, ORDER_POLICY, actor(['clerk'], {}))).toEqual([])
  })

  // Every form published before 0050 says nothing of delete in its
  // bindings, and offers none, by `offers()`: read as "anything but false",
  // as the form route read every flag before, a policy granting delete
  // would put delete on such a form's menu (watched failing that way). One
  // that offers it lists it last.
  test('lists delete only where the bindings say they offer it, after update', () => {
    const deleting: FormPolicy = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['clerk'] } }
    const { delete: _delete, ...unsaid } = ORDER.bindings.operations
    expect(grantedOperations({ ...ORDER.bindings, operations: unsaid }, deleting, CLERK)).toEqual(['read', 'create', 'update'])
    expect(grantedOperations(orderForm(MS_FACTS).bindings, deleting, CLERK)).toEqual(['read', 'create', 'update', 'delete'])
    expect(grantedOperations(orderForm(MS_FACTS).bindings, deleting, AUDITOR)).toEqual(['read'])
  })
})

describe('formMenu over menuForm', () => {
  // The menu opens grids, and a grid reads: a form is named when its policy
  // lets this person read, and otherwise not at all -- an intake clerk who
  // may only create orders, a clerk with no tenant, a stranger. In the
  // store's codepoint order whatever order the bundles came in, each with
  // its title and the operations `GET /v1/forms/:id` would start from.
  // Watched failing with every form named, whatever the policy.
  test('names only the forms the person may read, in codepoint order', () => {
    const forms = [LINES, ORDER, EMPLOYEES]
    expect(menuOf(forms, CLERK).forms.map(({ id, title, operations }) => ({ id, title, operations }))).toEqual([
      { id: 'employee', title: 'Employee', operations: ['read'] },
      { id: 'order', title: 'Order', operations: ['read', 'create', 'update'] },
      { id: 'order-line', title: 'Order line', operations: ['read', 'create', 'update'] },
    ])
    expect(menuOf(forms, INTAKE)).toEqual({ forms: [] })
    expect(menuOf(forms, actor(['clerk'], {}))).toEqual({ forms: [] })
    expect(menuOf(forms, actor([]))).toEqual({ forms: [] })
    expect(menuOf(forms, AUDITOR).forms.map((entry) => entry.id)).toEqual(['order', 'order-line'])
  })

  // An order's lines are its children for the clerk, who may list them and
  // read the field that names the order; the line form is in the menu by
  // itself too. The employee form is its own child through its manager, and
  // the order form a child of the employee through who created it.
  test('names a child under each parent whose token its listed field holds', () => {
    const menu = menuOf([ORDER, LINES, EMPLOYEES], CLERK)
    expect(Object.fromEntries(menu.forms.map((entry) => [entry.id, entry.children]))).toEqual({
      employee: [
        { form: 'employee', field: 'employee' },
        { form: 'order', field: 'employee' },
      ],
      order: [{ form: 'order-line', field: 'order' }],
      'order-line': [],
    })
  })

  // A child is a grid under its parent, so it is named only where that grid
  // would be served: the child form is in this person's menu, its list is
  // available to them (`listable`, which the list route asks), and they may
  // read the field the parent narrows it by (`planList`'s rule for a
  // parent). The auditor may read orders and lines, but not the lines' key,
  // so no line list is theirs. A line form published before `through` lists
  // nobody its lines. A clerk who may not read who created an order gets
  // the order form in the menu and not under the employee. Watched failing
  // with `listable` replaced by the readable fields: the unscoped line form
  // was named under the order; and with no check at all, the auditor's
  // lines were.
  test('names a child only when this person may list it and read its field', () => {
    expect(menuOf([ORDER, LINES], AUDITOR).forms.find((entry) => entry.id === 'order')?.children).toEqual([])

    const { through: _through, ...unscoped } = LINE_POLICY
    const before = bundle('order-line', 'Order line', PG, lineForm(PG).bindings, unscoped)
    const menu = menuOf([ORDER, before], CLERK)
    expect(menu.forms.map((entry) => entry.id)).toEqual(['order', 'order-line'])
    expect(menu.forms.find((entry) => entry.id === 'order')?.children).toEqual([])

    const hidden = bundle('order', 'Order', PG, orderForm(PG).bindings, { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, employee: { read: [], write: ['clerk'] } } })
    expect(menuOf([EMPLOYEES, hidden], CLERK).forms.find((entry) => entry.id === 'employee')?.children).toEqual([{ form: 'employee', field: 'employee' }])
  })

  // A child the person may not read is not named under anything: the menu
  // says nothing about a form the policy keeps from them.
  test('never names a child the person may not read', () => {
    const managersOnly = bundle('order-line', 'Order line', PG, lineForm(PG).bindings, { ...LINE_POLICY, operations: { read: ['manager'], create: [], update: [] } })
    const menu = menuOf([ORDER, managersOnly], CLERK)
    expect(menu).toEqual({ forms: [{ id: 'order', title: 'Order', operations: ['read', 'create', 'update'], children: [] }] })
  })

  // A table of the same name on another connection is another table, and
  // its rows are nobody's children here.
  test('names no child on another connection', () => {
    const elsewhere = bundle('order-line', 'Order line', PG, lineForm(PG).bindings, LINE_POLICY, 'archive')
    expect(menuOf([ORDER, elsewhere], CLERK).forms.find((entry) => entry.id === 'order')?.children).toEqual([])
  })
})
