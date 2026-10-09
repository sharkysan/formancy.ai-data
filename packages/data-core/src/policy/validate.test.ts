import { describe, expect, test } from 'vitest'
import type { FieldBinding, FieldWrites, FormBindings } from '../generate/types.js'
import type { FormPolicy } from './types.js'
import { validatePolicy } from './validate.js'

/*
 * The same two forms evaluate.test.ts uses, restated rather than shared: a
 * test file that imported another would run its tests twice. On the order
 * form the tenant column travels inside the composite customer lookup; on the
 * customer form it is a plain column field.
 */
/** `true` writes on both operations, `false` on neither, and an object says which (0027). */
function column(field: string, writes: boolean | FieldWrites = true): FieldBinding {
  const both = typeof writes === 'boolean' ? { create: writes, update: writes } : writes
  return { kind: 'column', field, column: field, type: { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false }, nullable: true, writes: both }
}

function lookup(field: string, columns: string[], table: string, targetColumns: string[]): FieldBinding {
  return {
    kind: 'lookup',
    field,
    foreignKey: `fk_${field}`,
    columns,
    target: { table: { schema: 'sales', name: table }, columns: targetColumns },
    display: ['name'],
    source: `erp-sales-${field}`,
    nullable: false,
    writes: { create: true, update: true },
  }
}

function bindings(name: string, fields: FieldBinding[], identity: string[]): FormBindings {
  return {
    version: 2,
    root: { schema: 'sales', name },
    rootKind: 'table',
    identity,
    concurrency: { kind: 'rowversion', column: 'row_version', confirmed: true },
    operations: { create: true, update: true },
    fields,
    snapshotFingerprint: 'f',
  }
}

const ORDER = bindings(
  'order',
  [
    column('id', false),
    lookup('customer', ['tenant_id', 'customer_no'], 'customer', ['tenant_id', 'customer_no']),
    column('order_date'),
    column('amount'),
    column('notes'),
    lookup('created_by', ['created_by'], 'employee', ['id']),
  ],
  ['id'],
)

const CUSTOMER = bindings(
  'customer',
  [column('tenant_id'), column('customer_no'), column('name'), lookup('country', ['country_code'], 'country', ['iso_code'])],
  ['tenant_id', 'customer_no'],
)

const BOTH = ['clerk', 'manager']
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]

const ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: BOTH, create: ['clerk'], update: ['manager'] },
  fields: {
    id: { read: BOTH, write: [] },
    customer: { read: BOTH, write: BOTH },
    order_date: { read: BOTH, write: BOTH },
    amount: { read: ['manager'], write: ['manager'] },
    notes: { read: BOTH, write: ['clerk'] },
  },
  rowFilters: TENANT,
  lookups: { customer: TENANT, created_by: [] },
}

const CUSTOMER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: BOTH, create: BOTH, update: BOTH },
  fields: {
    tenant_id: { read: BOTH, write: [] },
    customer_no: { read: BOTH, write: BOTH },
    name: { read: BOTH, write: BOTH },
    country: { read: BOTH, write: BOTH },
  },
  rowFilters: TENANT,
  lookups: { country: [] },
}

/** A copy to change, so that one test's edit never reaches another test's fixture. */
function edited<T>(value: T, change: (draft: T) => void): T {
  const draft = JSON.parse(JSON.stringify(value)) as T
  change(draft)
  return draft
}

function problems(policy: unknown, form: FormBindings = ORDER): string[] {
  const result = validatePolicy(policy as FormPolicy, form)
  return result.ok ? [] : result.problems
}

describe('validatePolicy', () => {
  // The two policies every other test edits. If these were refused, every
  // refusal below would be proving nothing.
  test('accepts a policy that fits its form', () => {
    expect(validatePolicy(ORDER_POLICY, ORDER)).toEqual({ ok: true })
    expect(validatePolicy(CUSTOMER_POLICY, CUSTOMER)).toEqual({ ok: true })
  })

  // A policy naming a field the form does not have was written for another
  // form, or for this one before a regeneration renamed something. Applied
  // anyway, its grants would mean whatever the form now happens to hold.
  test('refuses a policy that lists a field the bindings do not have', () => {
    const stale = edited(ORDER_POLICY, (draft) => {
      draft.fields['discount'] = { read: BOTH, write: [] }
    })
    expect(validatePolicy(stale, ORDER)).toEqual({
      ok: false,
      code: 'invalid-policy',
      message: 'fields.discount: the form has no field discount',
      problems: ['fields.discount: the form has no field discount'],
    })
  })

  // A grant nothing can honour is a policy that says something untrue, and a
  // review screen would show it as true.
  test('refuses write on a field the form never writes, and an operation the form does not offer', () => {
    const writesId = edited(ORDER_POLICY, (draft) => {
      draft.fields['id'] = { read: BOTH, write: ['manager'] }
    })
    expect(problems(writesId)).toEqual(['fields.id grants write, and the form never writes id'])
    // Written on one operation is written (0027): a grant on a field the
    // account may INSERT and not UPDATE means something on create.
    const createOnlyAmount = { ...ORDER, fields: ORDER.fields.map((binding) => (binding.field === 'amount' ? column('amount', { create: true, update: false }) : binding)) }
    expect(problems(ORDER_POLICY, createOnlyAmount)).toEqual([])
    const neither = { ...ORDER, fields: ORDER.fields.map((binding) => (binding.field === 'amount' ? column('amount', false) : binding)) }
    expect(problems(ORDER_POLICY, neither)).toEqual(['fields.amount grants write, and the form never writes amount'])

    const createOnly = { ...ORDER, operations: { create: true, update: false } }
    expect(problems(ORDER_POLICY, createOnly)).toEqual(['operations.update grants roles, and this form does not offer update'])
    expect(problems({ ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, update: [] } }, createOnly)).toEqual([])
  })

  // The tenant column's value comes from the context, on create and on
  // update. A grant to write it is a grant nobody can use, and says otherwise.
  test('refuses write on a column a row filter pins', () => {
    const writesTenant = edited(CUSTOMER_POLICY, (draft) => {
      draft.fields['tenant_id'] = { read: BOTH, write: ['manager'] }
    })
    expect(problems(writesTenant, CUSTOMER)).toEqual([
      'fields.tenant_id grants write, and tenant_id is pinned by a row filter: its value comes from the context',
    ])
  })

  // A filter on a column the form is not bound to names an identifier nobody
  // approved for this form. A column filtered twice pins it to two
  // attributes, and a create would have to write two values into one column.
  test('refuses a row filter on a column the form is not bound to, and a column filtered twice', () => {
    expect(problems({ ...ORDER_POLICY, rowFilters: [...TENANT, { column: 'region', attribute: 'region' }] })).toEqual([
      'rowFilters: region is not a column this form is bound to',
    ])
    expect(problems({ ...ORDER_POLICY, rowFilters: [...TENANT, { column: 'tenant_id', attribute: 'org' }] })).toEqual([
      'rowFilters[1] filters tenant_id a second time',
    ])
    // The concurrency and identity columns are columns the form is bound to.
    expect(problems({ ...ORDER_POLICY, rowFilters: [...TENANT, { column: 'id', attribute: 'order' }] })).toEqual([])
    expect(problems({ ...ORDER_POLICY, rowFilters: [...TENANT, { column: 'row_version', attribute: 'version' }] })).toEqual([])
  })

  // A form with no key and no concurrency token — create-only, like a log
  // table — is bound to its fields' columns and nothing else. A filter on a
  // version column it does not have would name an identifier nobody approved.
  test('a form with no key and no token is bound to its fields alone', () => {
    const keyless: FormBindings = { ...CUSTOMER, identity: null, concurrency: null, operations: { create: true, update: false } }
    const createOnly = { ...CUSTOMER_POLICY, operations: { ...CUSTOMER_POLICY.operations, update: [] } }
    expect(problems(createOnly, keyless)).toEqual([])
    expect(problems({ ...createOnly, rowFilters: [...TENANT, { column: 'row_version', attribute: 'version' }] }, keyless)).toEqual([
      'rowFilters: row_version is not a column this form is bound to',
    ])
  })

  // The customer lookup sets tenant_id. Unless its target is pinned to the
  // same attribute — tenant_id paired with tenant_id, by the foreign key's
  // order — a customer of another tenant would pass the membership check and
  // be written into this tenant's order.
  test('refuses a lookup over a pinned column whose target is not pinned to the same attribute', () => {
    const cases = [[], [{ column: 'tenant_id', attribute: 'region' }], [{ column: 'customer_no', attribute: 'tenant' }]]
    for (const filters of cases) {
      const unpinned = edited(ORDER_POLICY, (draft) => {
        draft.lookups['customer'] = filters
      })
      expect(problems(unpinned)).toEqual([
        'lookups.customer must pin sales.customer.tenant_id to tenant, because customer sets tenant_id, which a row filter pins to tenant',
      ])
    }
  })

  // Saying nothing about a lookup's target is not saying "every row", and a
  // filter for a field that is not a lookup is a filter nothing applies.
  test('refuses a lookup field with no lookups entry, and an entry for a field that is not a lookup', () => {
    const silent = edited(ORDER_POLICY, (draft) => {
      delete draft.lookups['created_by']
      draft.lookups['notes'] = []
    })
    expect(problems(silent)).toEqual([
      'lookups.notes: notes is not a lookup field of this form',
      'lookups has no entry for created_by: say which rows of sales.employee it may offer, or [] for every row',
    ])
  })

  // A role list that is a string makes `includes` a substring match. A
  // property this release does not read is a rule nobody enforces, which the
  // person who wrote it believes is enforced. Each is named, all at once,
  // because a person fixes a policy from this list.
  test('refuses a malformed policy, naming every problem', () => {
    const malformed = {
      version: 2,
      operations: { read: BOTH, create: 'clerk', update: ['manager', ''], delete: ['manager'] },
      fields: { amount: { read: BOTH, write: BOTH, update: ['manager'] }, notes: 'everyone' },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant', operator: '=' }, { column: '', attribute: 7 }, 'tenant_id'],
      lookups: { customer: { column: 'tenant_id', attribute: 'tenant' } },
      columns: ['amount'],
    }
    expect(problems(malformed)).toEqual([
      'columns is not something this release reads, so nothing would enforce it',
      'version is not 1, the only policy version this release reads',
      'operations.delete is not something this release reads, so nothing would enforce it',
      'operations.create is not a list of roles',
      'operations.update[1] is not a role name',
      'fields.amount.update is not something this release reads, so nothing would enforce it',
      'fields.notes is not a field policy',
      'rowFilters[0].operator is not something this release reads, so nothing would enforce it',
      'rowFilters[1] names no column',
      'rowFilters[1] names no attribute',
      'rowFilters[2] is not a row filter',
      'lookups.customer is not a list of row filters',
    ])
  })

  // Each container missing or of the wrong kind is its own problem, rather
  // than an exception from reading a property of undefined.
  test('refuses a policy that is not an object, or whose parts are not', () => {
    for (const policy of [null, [], 'policy']) expect(problems(policy)).toEqual(['the policy is not an object'])
    expect(problems({ version: 1, operations: [], fields: null, rowFilters: {}, lookups: 'none' })).toEqual([
      'operations is not an object',
      'fields is not an object',
      'rowFilters is not a list of row filters',
      'lookups is not an object',
    ])
  })

  // The same policy written with its keys in another order is the same
  // policy, and must produce the same list in the same order — codepoint
  // order, so 'Z' comes before 'a' on every host.
  test('lists problems in an order that does not depend on how the policy was written', () => {
    const forwards = edited(ORDER_POLICY, (draft) => {
      draft.fields['a'] = { read: [], write: [] }
      draft.fields['b'] = { read: [], write: [] }
      draft.fields['Z'] = { read: [], write: [] }
    })
    const backwards = edited(ORDER_POLICY, (draft) => {
      draft.fields['Z'] = { read: [], write: [] }
      draft.fields['b'] = { read: [], write: [] }
      draft.fields['a'] = { read: [], write: [] }
    })
    const expected = ['fields.Z: the form has no field Z', 'fields.a: the form has no field a', 'fields.b: the form has no field b']
    expect(problems(forwards)).toEqual(expected)
    expect(problems(backwards)).toEqual(expected)
  })
})
