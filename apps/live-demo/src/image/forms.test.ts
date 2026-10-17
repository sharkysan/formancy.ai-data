import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validatePolicy } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, GeneratedForm } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { DEMO_FORMS, ROLE_GRANTS } from '../personas.js'
import { CONNECTION, DEMO_FORM_SPECS, demoPolicy, demoPresentation, fieldsFromOperations, generationRequest } from './forms.js'
import type { DemoFormSpec } from './forms.js'

/**
 * What the image publishes, derived from the generator's bindings: the
 * request each form is generated from, its policy and its presentation.
 * Pure, over bindings shaped as the generator shapes them for the demo's
 * order form; publish.integration.test.ts publishes the real ones through
 * the real server and reads each persona's menu back.
 */

const order = DEMO_FORM_SPECS.find((spec) => spec.id === 'order') as DemoFormSpec

const columnBinding = (field: string, writes: { create: boolean; update: boolean }): FieldBinding => ({
  kind: 'column',
  field,
  column: field,
  type: { kind: 'text', maxLength: 20, lengthUnit: 'code-points', fixedLength: false },
  nullable: false,
  writes,
})

const lookupBinding = (field: string, foreignKey: string, columns: string[], table: string, writes = { create: true, update: true }): FieldBinding => ({
  kind: 'lookup',
  field,
  foreignKey,
  columns,
  target: { table: { schema: 'sales', name: table }, columns: columns.map((column) => (column === 'tenant_id' ? 'tenant_id' : column === 'customer_no' ? 'customer_no' : 'id')) },
  display: ['name'],
  source: `demo.sales.${table}.${field}`,
  nullable: true,
  writes,
})

/** The order form's bindings as the generator writes them for the demo's account, the customer set on create only; each lookup under the key given, as a regeneration may renumber them. */
function orderBindings(created = 'employee', approved = 'employee_2', customer = 'customer'): FormBindings {
  return {
    version: 2,
    root: { schema: 'sales', name: 'order' },
    rootKind: 'table',
    identity: ['id'],
    concurrency: { kind: 'version-column', column: 'row_version', confirmed: true },
    operations: { create: true, update: true, delete: true },
    fields: [
      columnBinding('id', { create: false, update: false }),
      lookupBinding(customer, 'fk_order_customer', ['tenant_id', 'customer_no'], 'customer', { create: true, update: false }),
      columnBinding('tenant_id', { create: true, update: false }),
      columnBinding('order_date', { create: true, update: true }),
      columnBinding('amount', { create: true, update: false }),
      lookupBinding(created, 'fk_order_created_by', ['created_by'], 'employee'),
      lookupBinding(approved, 'fk_order_approved_by', ['approved_by'], 'employee'),
    ],
    snapshotFingerprint: 'not-read-here',
  }
}

/** The base's fields, as many of them as the presentation reads: their keys, in order, and labels. */
function baseOf(bindings: FormBindings): GeneratedForm['form'] {
  return { model: { fields: bindings.fields.map((binding) => ({ key: binding.field, label: 'Employee' })) } } as unknown as GeneratedForm['form']
}

describe('the demo forms', () => {
  // DEMO_FORMS is what the personas' sentences name; a form published
  // under another id, or one left out, would be a sentence about a form
  // nobody can open.
  test('are the forms the personas name, each generated on the demo connection from sales', () => {
    expect(DEMO_FORM_SPECS.map((spec) => spec.id)).toEqual(DEMO_FORMS.map((form) => form.id))
    for (const spec of DEMO_FORM_SPECS) {
      expect(generationRequest(spec)).toMatchObject({ connection: CONNECTION, root: { schema: 'sales', name: spec.table }, formId: spec.id, title: spec.title })
    }
    expect(generationRequest(order)).toEqual({
      connection: 'demo',
      root: { schema: 'sales', name: 'order' },
      formId: 'order',
      title: 'Order',
      lookups: [
        { foreignKey: 'fk_order_customer', display: ['name'] },
        { foreignKey: 'fk_order_created_by', display: ['name'] },
        { foreignKey: 'fk_order_approved_by', display: ['name'] },
      ],
      pinned: ['tenant_id'],
      versionColumn: 'row_version',
    })
  })

  // A role granted an operation the table does not give it -- or a role
  // the table names left out -- is a persona whose sentence lies.
  test("grant each operation to exactly the roles ROLE_GRANTS gives it on that form", () => {
    for (const spec of DEMO_FORM_SPECS) {
      const policy = demoPolicy({ ...spec, lookups: [] }, { ...orderBindings(), fields: [] })
      for (const operation of ['read', 'create', 'update', 'delete'] as const) {
        const roles = Object.entries(ROLE_GRANTS)
          .filter(([, { may }]) => may[spec.id].includes(operation))
          .map(([role]) => role)
        expect(policy.operations[operation] ?? []).toEqual(roles)
      }
    }
    expect(demoPolicy(order, orderBindings()).operations).toEqual({ read: ['clerk', 'auditor'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] })
  })

  // Filters are chosen by foreign key, and the generator's keys renumber:
  // keyed by field, the customer's tenant filter could land on an
  // employee lookup and the customer offer every tenant's rows.
  test('filter each lookup by its foreign key, under whatever key the generator gave it', () => {
    expect(demoPolicy(order, orderBindings()).lookups).toEqual({ customer: [{ column: 'tenant_id', attribute: 'tenant' }], employee: [], employee_2: [] })
    expect(demoPolicy(order, orderBindings('employee_2', 'employee', 'buyer')).lookups).toEqual({ buyer: [{ column: 'tenant_id', attribute: 'tenant' }], employee_2: [], employee: [] })
    const lines = DEMO_FORM_SPECS.find((spec) => spec.id === 'order-line') as DemoFormSpec
    const bindings: FormBindings = { ...orderBindings(), root: { schema: 'sales', name: 'order_line' }, fields: [lookupBinding('parent_order', 'fk_order_line_order', ['order_id'], 'order')] }
    expect(demoPolicy(lines, bindings)).toMatchObject({ rowFilters: [], lookups: { parent_order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['parent_order'] })
  })

  // Fail closed: a lookup nobody chose a filter for would otherwise offer
  // every row, and a chosen one the generator did not make would leave a
  // filter or a label applied to nothing, silently.
  test('refuse a lookup the demo does not name, and a named one the generator did not make', () => {
    const extra = orderBindings()
    extra.fields.push(lookupBinding('shipment', 'fk_order_shipment', ['shipment_id'], 'shipment'))
    expect(() => demoPolicy(order, extra)).toThrow('order: the generated form has a lookup over fk_order_shipment, and the demo says nothing of which of its rows it may offer')
    const missing = orderBindings()
    missing.fields = missing.fields.filter((binding) => binding.kind !== 'lookup' || binding.foreignKey !== 'fk_order_approved_by')
    expect(() => demoPolicy(order, missing)).toThrow('order: the demo names a lookup over fk_order_approved_by, and the generated form has none')
  })

  // The studio's "Fill every field from the operations" is the rule an
  // administrator would apply, and getting-started's journey copies it
  // too; a third reading that drifted from the studio's would publish
  // fields the studio would not.
  test("give every field the roles the studio's own fill rule gives it", async () => {
    const studio = (await import(pathToFileURL(join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'studio', 'src', 'policy-model.ts')).href)) as {
      fillFromOperations(policy: FormPolicy, bindings: FormBindings): FormPolicy
    }
    for (const bindings of [orderBindings(), orderBindings('employee_2', 'employee', 'buyer')]) {
      const policy = demoPolicy(order, bindings)
      expect(policy.fields).toEqual(studio.fillFromOperations(policy, bindings).fields)
      expect(fieldsFromOperations(policy, bindings)).toEqual(policy.fields)
    }
    // Pinned and never written are read-only; a create-only field is still written.
    expect(demoPolicy(order, orderBindings()).fields).toMatchObject({
      tenant_id: { read: ['clerk', 'auditor'], write: [] },
      id: { read: ['clerk', 'auditor'], write: [] },
      amount: { read: ['clerk', 'auditor'], write: ['clerk'] },
      customer: { read: ['clerk', 'auditor'], write: ['clerk'] },
    })
  })

  // What the server checks on publish (0019), asked before a build is spent on it.
  test('fit the bindings they were derived from', () => {
    expect(validatePolicy(demoPolicy(order, orderBindings()), orderBindings())).toEqual({ ok: true })
  })

  // Two lookups of one table are both "Employee" as generated; the
  // labels are chosen by foreign key, so they follow the column when the
  // generator renumbers the keys (0030).
  test('relabel the employee lookups by their foreign keys, in the base order', () => {
    for (const [created, approved] of [
      ['employee', 'employee_2'],
      ['employee_2', 'employee'],
    ] as const) {
      const bindings = orderBindings(created, approved)
      expect(demoPresentation(order, baseOf(bindings), bindings)).toEqual({
        version: 1,
        fields: [
          { field: created, anchor: { kind: 'lookup', foreignKey: 'fk_order_created_by' }, label: 'Created by' },
          { field: approved, anchor: { kind: 'lookup', foreignKey: 'fk_order_approved_by' }, label: 'Approved by' },
        ],
        sections: [],
      })
    }
    // A form whose lookups the demo does not relabel says nothing: an entry that changes nothing is refused (0030).
    const lines = DEMO_FORM_SPECS.find((spec) => spec.id === 'order-line') as DemoFormSpec
    const bindings: FormBindings = { ...orderBindings(), fields: [lookupBinding('order', 'fk_order_line_order', ['order_id'], 'order')] }
    expect(demoPresentation(lines, baseOf(bindings), bindings)).toEqual({ version: 1, fields: [], sections: [] })
  })
})
