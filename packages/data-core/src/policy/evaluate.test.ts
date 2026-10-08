import { describe, expect, test } from 'vitest'
import type { FieldBinding, FormBindings } from '../generate/types.js'
import { authorizeOperation, checkSubmittedFields, forcedValues, lookupRowFilter, readableFields, rowFilter } from './evaluate.js'
import type { FormPolicy, PolicyContext } from './types.js'
import { validatePolicy } from './validate.js'

/*
 * Bindings shaped like what generateForm produces for the fixture's
 * sales.order and sales.customer. On the order form the tenant column is not a
 * field: it travels inside the composite customer lookup. On the customer form
 * it is a plain column field, part of the key.
 */
function column(field: string, writable = true): FieldBinding {
  return { kind: 'column', field, column: field, type: { kind: 'text', maxLength: 100, fixedLength: false }, nullable: true, writable }
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
    writable: true,
  }
}

function bindings(name: string, fields: FieldBinding[], identity: string[]): FormBindings {
  return {
    version: 1,
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

/** `created_by` has no entry in `fields`: nobody may read or write it. */
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

const CLERK: PolicyContext = { actor: { id: 'u-17', roles: ['clerk'] }, attributes: { tenant: '42' } }
const MANAGER: PolicyContext = { actor: { id: 'u-3', roles: ['manager'] }, attributes: { tenant: '42' } }
const NOBODY: PolicyContext = { actor: { id: 'u-0', roles: [] }, attributes: { tenant: '42' } }

/** A copy to change, so that one test's edit never reaches another test's fixture. */
function edited<T>(value: T, change: (draft: T) => void): T {
  const draft = JSON.parse(JSON.stringify(value)) as T
  change(draft)
  return draft
}

describe('authorizeOperation', () => {
  // The coarsest gate. A clerk who may create orders may not update them, and
  // nothing about the request can change that.
  test('grants an operation only to a role the policy lists for it', () => {
    expect(authorizeOperation(ORDER_POLICY, CLERK, 'create')).toEqual({ ok: true })
    expect(authorizeOperation(ORDER_POLICY, CLERK, 'update')).toEqual({
      ok: false,
      code: 'operation-denied',
      message: 'no role of this actor may update with this form',
    })
    expect(authorizeOperation(ORDER_POLICY, MANAGER, 'update')).toEqual({ ok: true })
  })

  // Role names are compared as exact strings. Folding case or trimming would
  // turn 'Manager' — a role some other system issued — into this policy's
  // manager.
  test('matches a role exactly, never by case, by prefix or by trimming', () => {
    for (const role of ['Manager', 'manager ', 'manage', 'managers']) {
      const actor: PolicyContext = { actor: { id: 'u-3', roles: [role] }, attributes: { tenant: '42' } }
      expect(authorizeOperation(ORDER_POLICY, actor, 'update')).toMatchObject({ ok: false, code: 'operation-denied' })
    }
  })

  // An operation that cannot be scoped to the actor's tenant is not authorised
  // at all. A caller that checked only this would otherwise go on to read
  // without the filter it could not have built.
  test('refuses an operation whose row filter the context cannot supply', () => {
    expect(authorizeOperation(ORDER_POLICY, { ...CLERK, attributes: {} }, 'read')).toMatchObject({ ok: false, code: 'missing-attribute' })
  })

  // `delete`, or a name every plain object inherits, is not an operation any
  // role holds. Looked up on the policy object, `constructor` would find
  // Object's constructor rather than "no such operation".
  test('refuses an operation this release does not have', () => {
    for (const operation of ['delete', 'constructor', '']) {
      expect(authorizeOperation(ORDER_POLICY, MANAGER, operation as 'read')).toMatchObject({ ok: false, code: 'operation-denied' })
    }
  })
})

describe('an actor with no roles', () => {
  // Authenticated is not authorised. An actor the host verified and gave no
  // role may do nothing, see nothing and search nothing.
  test('may do nothing, see nothing and search nothing', () => {
    for (const operation of ['read', 'create', 'update'] as const) {
      expect(authorizeOperation(ORDER_POLICY, NOBODY, operation)).toMatchObject({ ok: false, code: 'operation-denied' })
    }
    expect(readableFields(ORDER_POLICY, NOBODY, ORDER)).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(rowFilter(ORDER_POLICY, NOBODY, 'read')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(checkSubmittedFields(ORDER_POLICY, NOBODY, ORDER, 'create', [])).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(lookupRowFilter(ORDER_POLICY, NOBODY, ORDER, 'create', 'customer')).toMatchObject({ ok: false, code: 'operation-denied' })
  })
})

describe('a function that returns data', () => {
  /*
   * validatePolicy accepts a role that holds field grants and no operation
   * grant. authorizeOperation refuses such an actor, but it returns no data,
   * and the functions that do return everything a read endpoint needs: a WHERE
   * clause from rowFilter, a column list from readableFields. A caller that
   * skipped the gate would run the query with them. So each one authorises the
   * operation it serves itself, as checkSubmittedFields does for a write.
   */
  const AUDITED = edited(ORDER_POLICY, (draft) => {
    for (const entry of Object.values(draft.fields)) entry.read.push('auditor')
    draft.fields['customer']?.write.push('auditor')
  })
  const AUDITOR: PolicyContext = { actor: { id: 'u-8', roles: ['auditor'] }, attributes: { tenant: '42' } }

  test('refuses an actor whose roles hold field grants and no operation grant', () => {
    expect(validatePolicy(AUDITED, ORDER)).toEqual({ ok: true })
    for (const result of [
      readableFields(AUDITED, AUDITOR, ORDER),
      rowFilter(AUDITED, AUDITOR, 'read'),
      lookupRowFilter(AUDITED, AUDITOR, ORDER, 'read', 'customer'),
      lookupRowFilter(AUDITED, AUDITOR, ORDER, 'create', 'customer'),
      forcedValues(AUDITED, AUDITOR),
      checkSubmittedFields(AUDITED, AUDITOR, ORDER, 'create', ['customer']),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'operation-denied' })
    }
  })

  // A grant is per operation, so holding one is not holding another. A clerk
  // may create orders and not update them: the filter and the options an
  // update would run with are not theirs. A manager may not create, so gets
  // no values to create with. A role that may create and not read is shown no
  // field of a record, however many it may write.
  test('authorises the operation it serves, not any operation', () => {
    expect(rowFilter(ORDER_POLICY, CLERK, 'update')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(lookupRowFilter(ORDER_POLICY, CLERK, ORDER, 'update', 'customer')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(forcedValues(ORDER_POLICY, MANAGER)).toMatchObject({ ok: false, code: 'operation-denied' })
    const writeOnly = edited(ORDER_POLICY, (draft) => {
      draft.operations.read = ['manager']
    })
    expect(readableFields(writeOnly, CLERK, ORDER)).toMatchObject({ ok: false, code: 'operation-denied' })
  })
})

describe('readableFields', () => {
  // Deny by default. A field the policy does not mention — one a regeneration
  // added after the policy was written, say — must not reach anybody's
  // response until somebody grants it.
  test('a field with no entry is not readable, by anybody', () => {
    for (const actor of [CLERK, MANAGER]) {
      const result = readableFields(ORDER_POLICY, actor, ORDER)
      expect(result.ok).toBe(true)
      expect(result.ok && result.fields).not.toContain('created_by')
    }
  })

  // What a role may see, in the form's order, so a response projected through
  // it is the same shape every time.
  test("returns what the actor's roles may see, in form order", () => {
    expect(readableFields(ORDER_POLICY, CLERK, ORDER)).toEqual({ ok: true, fields: ['id', 'customer', 'order_date', 'notes'] })
    expect(readableFields(ORDER_POLICY, MANAGER, ORDER)).toEqual({ ok: true, fields: ['id', 'customer', 'order_date', 'amount', 'notes'] })
  })

  // A field key is whatever a column was called, and `constructor`, `toString`
  // and `__proto__` are all valid keys. Looked up on a plain object they would
  // find Object.prototype's members instead of "no entry".
  test('a field named like an Object.prototype member is not readable by inheritance', () => {
    const odd = { ...ORDER, fields: [...ORDER.fields, column('constructor'), column('toString'), column('__proto__')] }
    expect(readableFields(ORDER_POLICY, MANAGER, odd)).toEqual({ ok: true, fields: ['id', 'customer', 'order_date', 'amount', 'notes'] })
  })

  // A policy that names a field the form does not have was written for some
  // other form, or for this one before a regeneration. Nothing else in it can
  // be trusted to mean what it says, so none of it is applied.
  test('refuses a policy that does not fit the form', () => {
    const stale = edited(ORDER_POLICY, (draft) => {
      draft.fields['discount'] = { read: BOTH, write: [] }
    })
    expect(readableFields(stale, MANAGER, ORDER)).toEqual({
      ok: false,
      code: 'invalid-policy',
      message: 'fields.discount: the form has no field discount',
    })
  })
})

describe('checkSubmittedFields', () => {
  // The ordinary case, so that every refusal below is a refusal of something
  // specific rather than of everything.
  test('accepts what the actor may write', () => {
    expect(checkSubmittedFields(ORDER_POLICY, CLERK, ORDER, 'create', ['customer', 'order_date', 'notes'])).toEqual({ ok: true })
    expect(checkSubmittedFields(ORDER_POLICY, MANAGER, ORDER, 'update', ['amount', 'order_date'])).toEqual({ ok: true })
  })

  // Over-posting: a request carrying more than the form offers this actor. Each
  // key is refused for its own reason, and all of them are named, so the log
  // says what was tried.
  test('refuses a key not in the form, one the form never writes, and one this actor may not write', () => {
    expect(checkSubmittedFields(ORDER_POLICY, CLERK, ORDER, 'create', ['order_date', 'discount', 'id', 'amount', 'created_by'])).toEqual({
      ok: false,
      code: 'over-posting',
      message:
        'amount is not writable for this actor; created_by is not writable for this actor; discount is not a field of this form; id is never written by this form',
    })
  })

  // The tenant column is written from the context on create and is never the
  // request's to choose — not even when the value sent is the actor's own
  // tenant, because accepting an equal value teaches a client to send it, and
  // the comparison would be between a string and whatever a codec made of it.
  // On update, a new value would move the record into another tenant.
  test('refuses the tenant column on create and on update', () => {
    for (const operation of ['create', 'update'] as const) {
      expect(checkSubmittedFields(CUSTOMER_POLICY, MANAGER, CUSTOMER, operation, ['tenant_id', 'name'])).toEqual({
        ok: false,
        code: 'over-posting',
        message: 'tenant_id is pinned by a row filter: its value comes from the trusted context, never from the request',
      })
    }
  })

  // On the order form the tenant column has no field of its own. Posted by
  // its column name, it is refused like any key the form lacks, rather than
  // reaching an insert that names it.
  test('refuses the tenant column posted by name on a form that has no field for it', () => {
    expect(checkSubmittedFields(ORDER_POLICY, CLERK, ORDER, 'create', ['customer', 'tenant_id'])).toEqual({
      ok: false,
      code: 'over-posting',
      message: 'tenant_id is not a field of this form',
    })
  })

  // The customer lookup sets tenant_id too. That is safe only because the
  // policy pins the lookup's target to the same tenant, so the selection is
  // checked against this tenant's customers. Without that pin, a customer of
  // another tenant could be written into this tenant's order; the policy is
  // refused before any key is looked at.
  test('a lookup over the tenant column is accepted only when its target is pinned to the same tenant', () => {
    expect(checkSubmittedFields(ORDER_POLICY, CLERK, ORDER, 'create', ['customer'])).toEqual({ ok: true })
    const unpinned = edited(ORDER_POLICY, (draft) => {
      draft.lookups['customer'] = []
    })
    expect(checkSubmittedFields(unpinned, CLERK, ORDER, 'create', ['customer'])).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/lookups\.customer must pin sales\.customer\.tenant_id to tenant/),
    })
  })

  // A write path that calls only this function is still closed: the
  // operation is authorised, and scoped, before a single key is looked at.
  test('authorises and scopes the operation first', () => {
    expect(checkSubmittedFields(ORDER_POLICY, CLERK, ORDER, 'update', ['notes'])).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(checkSubmittedFields(ORDER_POLICY, { ...CLERK, attributes: {} }, ORDER, 'create', ['notes'])).toMatchObject({
      ok: false,
      code: 'missing-attribute',
    })
  })

  // Reading submits nothing. A host that routed a read through the write
  // check with the actor's read permission would otherwise accept a body.
  test('refuses an operation that submits nothing', () => {
    expect(checkSubmittedFields(ORDER_POLICY, MANAGER, ORDER, 'read' as 'update', [])).toEqual({
      ok: false,
      code: 'operation-denied',
      message: 'read submits no values',
    })
  })

  // The message is something a person compares across runs, so its order must
  // not depend on the host's locale: codepoint order puts 'Z' before 'a',
  // where a German or English collation would not.
  test('names refused keys once each, in codepoint order', () => {
    expect(checkSubmittedFields(ORDER_POLICY, CLERK, ORDER, 'create', ['b', 'Z', 'a', 'b'])).toEqual({
      ok: false,
      code: 'over-posting',
      message: 'Z is not a field of this form; a is not a field of this form; b is not a field of this form',
    })
  })
})

describe('rowFilter', () => {
  // The tenant column equals the context's tenant, and the value is the
  // context's, as a string the adapter binds as a parameter.
  test("pins the tenant column to the context's attribute", () => {
    expect(rowFilter(ORDER_POLICY, CLERK, 'read')).toEqual({ ok: true, filter: [{ column: 'tenant_id', value: '42' }] })
  })

  // The failure this module exists to prevent. A host that forgot to set the
  // tenant must not get an empty filter, because an empty filter is a query
  // over every tenant's rows.
  test('refuses, rather than returning an empty filter, when the attribute is missing or empty', () => {
    for (const attributes of [{}, { region: 'eu' }, { tenant: '' }]) {
      expect(rowFilter(ORDER_POLICY, { ...CLERK, attributes }, 'read')).toMatchObject({
        ok: false,
        code: 'missing-attribute',
        message: expect.stringMatching(/^rowFilters: tenant_id must equal the context's tenant/),
      })
    }
  })

  // A row filter on an attribute called `constructor` must find it missing
  // from a plain attributes object, not find Object's constructor there; and an
  // attribute that is only inherited was not put there by the host.
  test('an attribute named like an Object.prototype member, or only inherited, is missing', () => {
    const odd = edited(ORDER_POLICY, (draft) => {
      draft.rowFilters = [{ column: 'tenant_id', attribute: 'constructor' }]
    })
    expect(rowFilter(odd, CLERK, 'read')).toMatchObject({ ok: false, code: 'missing-attribute' })
    const inherited = Object.create({ tenant: '42' }) as Record<string, string>
    expect(rowFilter(ORDER_POLICY, { ...CLERK, attributes: inherited }, 'read')).toMatchObject({ ok: false, code: 'missing-attribute' })
  })

  // An empty filter is the policy's own statement — a table that is not per
  // tenant says `rowFilters: []` — and never the absence of one.
  test('is empty only when the policy says so in as many words', () => {
    expect(rowFilter({ ...ORDER_POLICY, rowFilters: [] }, CLERK, 'read')).toEqual({ ok: true, filter: [] })
    const silent = edited(ORDER_POLICY, (draft) => {
      delete (draft as Partial<FormPolicy>).rowFilters
    })
    expect(rowFilter(silent, CLERK, 'read')).toMatchObject({ ok: false, code: 'invalid-policy', message: 'rowFilters is not a list of row filters' })
  })
})

describe('lookupRowFilter', () => {
  // A lookup token is a reference, not a permission (plan section 9). The
  // options offered, and the selection rechecked on save, are this tenant's.
  test("pins the target's tenant column to the context's attribute", () => {
    expect(lookupRowFilter(ORDER_POLICY, CLERK, ORDER, 'create', 'customer')).toEqual({ ok: true, filter: [{ column: 'tenant_id', value: '42' }] })
  })

  // Saying nothing about a lookup is not saying "every row": it offers
  // nothing. `[]` is how a policy says a target is shared by every tenant.
  test('refuses a lookup the policy says nothing about; [] is the explicit "every row"', () => {
    for (const field of ['approved_by', 'constructor']) {
      expect(lookupRowFilter(ORDER_POLICY, MANAGER, ORDER, 'update', field)).toEqual({
        ok: false,
        code: 'unknown-lookup',
        message: `the policy says nothing about which rows ${field} may offer, so it offers none`,
      })
    }
    expect(lookupRowFilter(CUSTOMER_POLICY, CLERK, CUSTOMER, 'create', 'country')).toEqual({ ok: true, filter: [] })
  })

  // The same rule as the root's filter: a missing tenant is a refusal, not a
  // search across every tenant's customers. The root is scoped first, so on
  // the order form the refusal names the root's filter; where the root is
  // shared and only the lookup's target is per tenant, it names the lookup's.
  test("refuses when the attribute is missing, for the root's filter or the target's", () => {
    const tenantless = { ...CLERK, attributes: {} }
    expect(lookupRowFilter(ORDER_POLICY, tenantless, ORDER, 'create', 'customer')).toMatchObject({
      ok: false,
      code: 'missing-attribute',
      message: expect.stringMatching(/^rowFilters: tenant_id must equal the context's tenant/),
    })
    expect(lookupRowFilter({ ...ORDER_POLICY, rowFilters: [] }, tenantless, ORDER, 'create', 'customer')).toMatchObject({
      ok: false,
      code: 'missing-attribute',
      message: expect.stringMatching(/^lookups\.customer: tenant_id must equal the context's tenant/),
    })
  })

  // The write check refuses a policy whose customer lookup sets tenant_id
  // without pinning its target to the tenant. The options are searched before
  // anything is saved, so a check of the policy's shape alone would list every
  // tenant's customers first, and refusing the save afterwards would not take
  // that back.
  test('refuses a policy that does not fit the form, as the write check does', () => {
    const unpinned = edited(ORDER_POLICY, (draft) => {
      draft.lookups['customer'] = []
    })
    expect(lookupRowFilter(unpinned, CLERK, ORDER, 'create', 'customer')).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/lookups\.customer must pin sales\.customer\.tenant_id to tenant/),
    })
  })

  // Searching a lookup reads its target table — employee names, here. An
  // actor who may neither read nor write the field has no business seeing them,
  // and being granted the operation does not change that: a clerk who may
  // create orders but is granted nothing on the customer field would otherwise
  // search every customer of the tenant through it.
  test('refuses an actor who may neither read nor write the field', () => {
    expect(lookupRowFilter(ORDER_POLICY, MANAGER, ORDER, 'update', 'created_by')).toEqual({
      ok: false,
      code: 'field-denied',
      message: 'this actor may neither read nor write created_by, so its options are not theirs to search',
    })
    const managersOnly = edited(ORDER_POLICY, (draft) => {
      draft.fields['customer'] = { read: ['manager'], write: ['manager'] }
    })
    expect(lookupRowFilter(managersOnly, CLERK, ORDER, 'create', 'customer')).toMatchObject({ ok: false, code: 'field-denied' })
  })
})

describe('forcedValues', () => {
  // On create, the tenant column is written from the context. It is the same
  // decision as the read filter, made in one place, so the row a person
  // creates is a row they can then read.
  test('pins on create exactly what the row filter pins on read', () => {
    const forced = forcedValues(CUSTOMER_POLICY, CLERK)
    expect(forced).toEqual({ ok: true, values: [{ column: 'tenant_id', value: '42' }] })
    const filter = rowFilter(CUSTOMER_POLICY, CLERK, 'read')
    expect(filter.ok && filter.filter).toEqual(forced.ok && forced.values)
  })

  // A create with no tenant to write would insert a row that belongs to
  // nobody, or to whatever the column's default says.
  test('refuses when the attribute is missing', () => {
    expect(forcedValues(CUSTOMER_POLICY, { ...CLERK, attributes: {} })).toMatchObject({ ok: false, code: 'missing-attribute' })
  })
})

describe('a forged context', () => {
  /*
   * The type says what a host builds. At runtime a context is often assembled
   * from a decoded token, where the type is a hope. Each of these is a shape a
   * careless host could pass, and each would weaken a check if it were used
   * as it came — `'superclerk'.includes('clerk')` is true, so a role list that
   * is one string is a substring match.
   */
  const forged: Array<[string, unknown]> = [
    ['no context at all', null],
    ['a string', 'clerk'],
    ['no actor', { attributes: { tenant: '42' } }],
    ['an actor with no id', { actor: { roles: ['clerk'] }, attributes: { tenant: '42' } }],
    ['an actor with an empty id', { actor: { id: '', roles: ['clerk'] }, attributes: { tenant: '42' } }],
    ['roles as one string', { actor: { id: 'u-9', roles: 'superclerk' }, attributes: { tenant: '42' } }],
    ['a role that is not a string', { actor: { id: 'u-9', roles: ['clerk', 7] }, attributes: { tenant: '42' } }],
    ['an empty role', { actor: { id: 'u-9', roles: [''] }, attributes: { tenant: '42' } }],
    ['no attributes', { actor: { id: 'u-9', roles: ['clerk'] } }],
    ['attributes as a list', { actor: { id: 'u-9', roles: ['clerk'] }, attributes: ['42'] }],
    ['a tenant that is a number', { actor: { id: 'u-9', roles: ['clerk'] }, attributes: { tenant: 42 } }],
    ['a tenant that is a list', { actor: { id: 'u-9', roles: ['clerk'] }, attributes: { tenant: ['42', '43'] } }],
  ]

  test.each(forged)('%s is refused by every function', (_, shape) => {
    const context = shape as PolicyContext
    for (const result of [
      authorizeOperation(ORDER_POLICY, context, 'read'),
      readableFields(ORDER_POLICY, context, ORDER),
      checkSubmittedFields(ORDER_POLICY, context, ORDER, 'create', ['notes']),
      rowFilter(ORDER_POLICY, context, 'read'),
      lookupRowFilter(ORDER_POLICY, context, ORDER, 'create', 'customer'),
      forcedValues(ORDER_POLICY, context),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'invalid-context' })
    }
  })
})
