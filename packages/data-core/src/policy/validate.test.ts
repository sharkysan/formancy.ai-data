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
  return {
    kind: 'column',
    field,
    column: field,
    type: { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false },
    nullable: true,
    writes: both,
  }
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

/** An order's lines: no tenant column, and the order a lookup whose target, sales.order, has one (0043). */
const LINE = bindings('order_line', [lookup('order', ['order_id'], 'order', ['id']), column('line_no'), column('quantity')], ['order_id', 'line_no'])

/** The same forms as the generator writes them where it offers delete (0050). */
const DELETABLE_ORDER: FormBindings = { ...ORDER, operations: { create: true, update: true, delete: true } }
const DELETABLE_LINE: FormBindings = { ...LINE, operations: { create: true, update: true, delete: true } }

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
    const createOnlyAmount = {
      ...ORDER,
      fields: ORDER.fields.map((binding) => (binding.field === 'amount' ? column('amount', { create: true, update: false }) : binding)),
    }
    expect(problems(ORDER_POLICY, createOnlyAmount)).toEqual([])
    const neither = { ...ORDER, fields: ORDER.fields.map((binding) => (binding.field === 'amount' ? column('amount', false) : binding)) }
    expect(problems(ORDER_POLICY, neither)).toEqual(['fields.amount grants write, and the form never writes amount'])

    const createOnly = { ...ORDER, operations: { create: true, update: false } }
    expect(problems(ORDER_POLICY, createOnly)).toEqual(['operations.update grants roles, and this form does not offer update'])
    expect(problems({ ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, update: [] } }, createOnly)).toEqual([])
  })

  // A delete is offered by the generator only where one can be made
  // against the table, by its account, with a version that proves the
  // record (0050). A grant on a form whose bindings do not offer it -- and
  // every form published before 0050 says nothing about delete -- is a
  // rule nothing could honour, so it is refused as an update's is; an
  // absent list, or an empty one, grants nobody and fits any form.
  test('refuses delete granted on a form that does not offer it, and reads an absent flag as not offered', () => {
    const deleting = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['manager'] } }
    const refused = ['operations.delete grants roles, and this form does not offer delete']
    expect(problems(deleting)).toEqual(refused)
    expect(problems(deleting, { ...ORDER, operations: { create: true, update: true, delete: false } })).toEqual(refused)
    expect(problems(deleting, DELETABLE_ORDER)).toEqual([])
    expect(problems({ ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: [] } })).toEqual([])
    expect(problems(ORDER_POLICY, DELETABLE_ORDER)).toEqual([])
  })

  // A delete names the version its person read (0050): a role that may
  // not read has no version but a guess, and a version column's versions
  // are small integers that can be tried one after another. Every role
  // that may delete must be granted read, named one by one in codepoint
  // order (watched failing: every delete grant was accepted).
  test('refuses delete granted to a role that may not read with the form', () => {
    const deleting = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['manager', 'purger', 'Archivist'] } }
    const sentence = (role: string) =>
      `operations.delete grants ${role}, who may not read with this form: a delete names the version its person read, so grant read to every role that may delete`
    expect(problems(deleting, DELETABLE_ORDER)).toEqual([sentence('Archivist'), sentence('purger')])
  })

  // A child form published before 0043 scoped nothing of its own rows while
  // its lookup's options were filtered. A read reaches another tenant's
  // line there only by a guessed token; a delete granted on it would
  // destroy one by a guessed token and version. Refused, as a list of such
  // a form is (0044), and accepted once a through scopes the rows.
  test('refuses delete on a form whose rows nothing scopes while a lookup is filtered', () => {
    const unscoped: FormPolicy = {
      version: 1,
      operations: { read: BOTH, create: [], update: [], delete: BOTH },
      fields: { order: { read: BOTH, write: [] }, line_no: { read: BOTH, write: [] }, quantity: { read: BOTH, write: [] } },
      rowFilters: [],
      lookups: { order: TENANT },
    }
    expect(problems(unscoped, DELETABLE_LINE)).toEqual([
      'operations.delete grants roles, and nothing scopes the records of this form though the options of order are filtered, so a delete could reach a record of any tenant by its token: scope them with a row filter or a through',
    ])
    expect(problems({ ...unscoped, through: ['order'] }, DELETABLE_LINE)).toEqual([])
    expect(problems({ ...unscoped, operations: { ...unscoped.operations, delete: [] } }, DELETABLE_LINE)).toEqual([])
  })

  // `cascades` names each foreign key a delete may act through, with its
  // action (0051): a name is two parts, never a dotted string, since an
  // identifier may hold a dot; an action that does nothing on delete
  // accepts nothing, and a key named twice says the same thing twice or
  // two contradicting things. Each is a policy that says something nothing
  // enforces, refused as an unread property is (watched failing with the
  // property unread).
  test('refuses a cascade that is not a key named by its table, with an action that acts on delete, or one named twice', () => {
    const deleting = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['manager'] } }
    const line = { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' }
    expect(problems({ ...deleting, cascades: [line] }, DELETABLE_ORDER)).toEqual([])
    expect(problems({ ...deleting, cascades: 'fk_order_line_order' }, DELETABLE_ORDER)).toEqual([
      'cascades is not a list of the foreign keys a delete may act through',
    ])
    expect(
      problems(
        {
          ...deleting,
          cascades: [
            'sales.order_line.fk_order_line_order',
            { ...line, table: 'sales.order_line' },
            { ...line, table: { schema: 'sales', name: '' } },
            { ...line, foreignKey: '' },
            { ...line, onDelete: 'no-action' },
            { ...line, columns: ['order_id'] },
            { ...line, table: { ...line.table, database: 'erp' } },
            line,
            { ...line, onDelete: 'set-null' },
          ],
        },
        DELETABLE_ORDER,
      ),
    ).toEqual([
      'cascades[0] is not a foreign key named by its table and its name',
      'cascades[1].table is not a table named by its schema and its name',
      'cascades[2].table is not a table named by its schema and its name',
      'cascades[3] names no foreign key',
      'cascades[4].onDelete is not cascade, set-null or set-default, the actions a delete acts through',
      'cascades[5].columns is not something this release reads, so nothing would enforce it',
      'cascades[6].table.database is not something this release reads, so nothing would enforce it',
      'cascades[8] names fk_order_line_order of sales.order_line a second time',
    ])
  })

  // An acceptance of what a delete does says something only where somebody
  // may delete; with nobody granted delete it is a rule about nothing
  // (0051), refused as a through over every row is.
  test('refuses cascades on a form nobody may delete with', () => {
    const cascades = [{ table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' as const }]
    expect(problems({ ...ORDER_POLICY, cascades }, DELETABLE_ORDER)).toEqual(['cascades accepts what a delete does, and nobody may delete with this form'])
    expect(problems({ ...ORDER_POLICY, cascades: [] }, DELETABLE_ORDER)).toEqual([])
  })

  // Deleting chosen records together is a delete of each (0173): a role
  // the bulk grant names that `operations.delete` does not would be
  // offered a request every record of which is refused, and a grant on a
  // form that offers no delete says something nothing could honour, as
  // `operations.delete`'s does. Named one by one in codepoint order.
  // Watched failing with `bulkFitProblems` left out of `fitProblems`:
  // every grant below was accepted.
  test('refuses a bulk delete granted to a role that may not delete, or on a form that offers no delete', () => {
    const deleting = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['manager'] } }
    expect(problems({ ...deleting, bulk: { delete: { roles: ['manager'] } } }, DELETABLE_ORDER)).toEqual([])
    const sentence = (role: string) => `bulk.delete grants ${role}, who may not delete with this form: each chosen record is a delete of its own`
    expect(problems({ ...deleting, bulk: { delete: { roles: ['manager', 'clerk', 'Archivist'] } } }, DELETABLE_ORDER)).toEqual([
      sentence('Archivist'),
      sentence('clerk'),
    ])
    const offersNone = ['bulk names who may delete chosen records together, and this form does not offer delete']
    expect(problems({ ...ORDER_POLICY, bulk: { delete: { roles: [] } } })).toEqual(offersNone)
    // Absent, or naming nobody on a form that offers delete, it grants nobody and fits.
    expect(problems({ ...deleting, bulk: {} }, DELETABLE_ORDER)).toEqual([])
    expect(problems(deleting, DELETABLE_ORDER)).toEqual([])
  })

  // A `bulk` that names no operation grants nobody (0175): since a change
  // of chosen records is read too, it fits a form that offers an update or
  // a delete alone, and is refused on one that offers neither, where it
  // says something nothing could honour. Watched failing with 0173's rule,
  // which asked of `{}` a delete alone: the order form, which updates and
  // never deletes, was refused a bulk that grants nothing.
  test('refuses a bulk naming no operation only on a form that offers neither an update nor a delete alone', () => {
    expect(problems({ ...ORDER_POLICY, bulk: {} })).toEqual([])
    const creating: FormBindings = { ...ORDER, operations: { create: true, update: false } }
    expect(problems({ ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, update: [] }, bulk: {} }, creating)).toEqual([
      'bulk names who may change or delete chosen records together, and this form offers neither an update nor a delete of a record alone',
    ])
  })

  // A together child's rows are deleted only inside a save of the record
  // they belong to (0155): its policy may grant the delete a save uses,
  // and every delete alone is refused `operation-unavailable`. A bulk
  // grant there names a request no record of which could ever be deleted,
  // and GET /v1/forms/:id would say `bulk.delete: false` to everybody it
  // names. Watched failing with `offers()` asked in place of
  // `offeredFor(…, null)`: the grant on the together line was accepted.
  test('refuses a bulk delete on a form whose rows are deleted only in a save of their record', () => {
    const lines: FormPolicy = {
      version: 1,
      operations: { read: BOTH, create: [], update: [], delete: BOTH },
      fields: { order: { read: BOTH, write: [] }, line_no: { read: BOTH, write: [] }, quantity: { read: BOTH, write: [] } },
      rowFilters: [],
      lookups: { order: TENANT },
      through: ['order'],
      bulk: { delete: { roles: ['manager'] } },
    }
    const together: FormBindings = {
      ...DELETABLE_LINE,
      fields: DELETABLE_LINE.fields.map((binding) => (binding.field === 'order' ? { ...binding, together: { min: 0, max: 10 } } : binding)),
    }
    expect(problems(lines, DELETABLE_LINE)).toEqual([])
    expect(problems(lines, together)).toEqual([
      "bulk names who may delete chosen records together, and this form's rows are deleted only with the record they belong to, in one save",
    ])
    // The delete the save uses is still the policy's to grant.
    const { bulk: _bulk, ...granting } = lines
    expect(problems(granting, together)).toEqual([])
  })

  // Delete and update are the operations `bulk` names (0173, 0175): any
  // other, and any property of either beyond its own, is refused as every
  // unread property is -- a grant nothing enforces -- which is also why a
  // server older than 0175 refuses a policy naming `bulk.update`. The
  // shape is held too. Watched failing with `bulk.update`'s properties
  // not checked: `values` was accepted.
  test('refuses a bulk grant this release does not read, and one of the wrong shape', () => {
    const deleting = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['manager'] } }
    const bulk = (value: unknown) => problems({ ...deleting, bulk: value }, DELETABLE_ORDER)
    expect(bulk({ delete: { roles: ['manager'] }, archive: { roles: ['manager'] } })).toEqual([
      'bulk.archive is not something this release reads, so nothing would enforce it',
    ])
    expect(bulk({ delete: { roles: ['manager'], purge: true } })).toEqual([
      'bulk.delete.purge is not something this release reads, so nothing would enforce it',
    ])
    expect(bulk({ update: { roles: ['manager'], fields: ['amount'], values: { amount: '1' } } })).toEqual([
      'bulk.update.values is not something this release reads, so nothing would enforce it',
    ])
    expect(bulk([])).toEqual(['bulk is not { update: { roles, fields }, delete: { roles } }'])
    expect(bulk({ delete: ['manager'] })).toEqual(['bulk.delete is not { roles }'])
    expect(bulk({ delete: { roles: 'manager' } })).toEqual(['bulk.delete.roles is not a list of roles'])
    expect(bulk({ delete: { roles: [''] } })).toEqual(['bulk.delete.roles[0] is not a role name'])
    expect(bulk({ update: ['manager'] })).toEqual(['bulk.update is not { roles, fields }'])
    expect(bulk({ update: { roles: ['manager'] } })).toEqual(['bulk.update.fields is not a list of field keys'])
    expect(bulk({ update: { roles: ['manager'], fields: ['amount', 7, 'amount'] } })).toEqual([
      'bulk.update.fields[1] is not a field key',
      'bulk.update.fields names amount twice',
    ])
  })

  // Changing chosen records together is an update of each (0175): a role
  // the grant names that `operations.update` does not, or one that may not
  // write a field it lists, would be offered a request every record of
  // which is refused; and a grant on a form that offers no update alone
  // says something nothing could honour. Named in the grant's order, each
  // role in codepoint order. Watched failing with `updateFit` left out of
  // `bulkFitProblems`: every grant below was accepted.
  test('refuses a bulk update granted to a role that may not update, a field it may not write, or a form that offers no update', () => {
    const changing = (roles: string[], fields: string[]) => ({ ...ORDER_POLICY, bulk: { update: { roles, fields } } })
    expect(problems(changing(['manager'], ['amount', 'customer', 'order_date']))).toEqual([])
    expect(problems(changing(['manager', 'clerk', 'Archivist'], ['amount']))).toEqual([
      'bulk.update grants Archivist, who may not update with this form: each chosen record is an update of its own',
      'bulk.update grants clerk, who may not update with this form: each chosen record is an update of its own',
    ])
    const both = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, update: BOTH } }
    expect(problems({ ...both, bulk: { update: { roles: BOTH, fields: ['notes', 'amount'] } } })).toEqual([
      'bulk.update.fields: notes is not one manager may write, and bulk.update grants manager its change',
      'bulk.update.fields: amount is not one clerk may write, and bulk.update grants clerk its change',
    ])
    const creating: FormBindings = { ...ORDER, operations: { create: true, update: false } }
    expect(problems({ ...changing([], []), operations: { ...ORDER_POLICY.operations, update: [] } }, creating)).toEqual([
      'bulk.update names who may change chosen records together, and this form does not offer update',
    ])
  })

  // No change of chosen records sets what an update alone never sets from
  // the request, or sets only for one record: each kind refused by name,
  // whoever may write it -- the key; a field written on create only; one
  // the database writes; one the server stamps (0153); a pinned one; a
  // version chain's (0113); the field a together child's rows are saved
  // with their record through (0155); and one this form does not have.
  // Watched failing with `unsettable` answering null: every field below
  // was granted, the key among them.
  test('refuses the key, a create-only field, one the database or the server writes, a pinned one, a version chain’s and the together field', () => {
    const fielded = (fields: FieldBinding[], extra: Partial<FormBindings> = {}): FormBindings => ({ ...bindings('thing', fields, ['code']), ...extra })
    const form = fielded(
      [
        column('code'),
        column('created', { create: true, update: false }),
        column('total', false),
        column('changed_by', false),
        column('tenant_id'),
        column('valid_from'),
        lookup('order', ['order_id'], 'order', ['id']),
        column('note'),
      ],
      {
        stamps: [
          {
            column: 'changed_by',
            value: { kind: 'actor' },
            on: 'update',
            type: { kind: 'text', maxLength: 40, lengthUnit: 'utf16-code-units', fixedLength: false },
          },
        ],
      },
    )
    const writing = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, { read: ['clerk'], write: ['clerk'] }]))
    const policy = (fields: string[], form: FormBindings) =>
      problems(
        {
          version: 1,
          operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
          fields: writing(form.fields.filter((binding) => binding.writes.create || binding.writes.update).map((binding) => binding.field)),
          rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
          lookups: { order: [] },
          bulk: { update: { roles: ['clerk'], fields } },
        },
        form,
      ).filter((problem) => problem.startsWith('bulk.'))
    expect(policy(['note'], form)).toEqual([])
    expect(policy(['code', 'created', 'total', 'changed_by', 'tenant_id', 'missing'], form)).toEqual([
      "bulk.update.fields: code is the record's key, which an update never sets",
      'bulk.update.fields: created is written on create only (0027)',
      'bulk.update.fields: total is written by the database, never by this form',
      'bulk.update.fields: changed_by is stamped by the server (0153)',
      'bulk.update.fields: tenant_id is pinned by a row filter: its value comes from the context',
      'bulk.update.fields: missing is not a field of this form',
    ])
    const versions = fielded(form.fields, { validity: { from: 'valid_from', to: 'valid_to', key: ['code'] } })
    expect(policy(['valid_from'], versions)).toEqual([
      "bulk.update.fields: valid_from is a version's start, end or chain, which a change from a date writes (0113)",
    ])
    const together = fielded(
      form.fields.map((binding) =>
        binding.field === 'order' ? { ...binding, writes: { create: true, update: true }, together: { min: 0, max: 5 } } : binding,
      ),
    )
    expect(policy(['order'], together)).toEqual([
      "bulk.update.fields: order names the record this form's rows are saved with, which a row keeps from its create (0155)",
    ])
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

  // A through scopes this form's rows by a lookup's own filter on its target
  // (0043). Named on a field the form lacks, or on one that is not a lookup,
  // it names a filter nothing could apply; over a lookup whose entry is []
  // it scopes nothing at all. Each is a rule its author believes is
  // enforced, so each is refused, naming the entry, and a through that fits
  // is accepted as it is.
  test('refuses a through over a field the form lacks, one that is not a lookup, and one whose lookup offers every row', () => {
    expect(problems({ ...ORDER_POLICY, through: ['customer'] })).toEqual([])
    expect(problems({ ...ORDER_POLICY, through: ['discount', 'notes', 'customer', 'created_by'] })).toEqual([
      'through: discount is not a field of this form',
      'through: notes is not a lookup field of this form',
      'through: created_by scopes nothing, because lookups.created_by is [], every row of sales.employee',
    ])
  })

  // The shape is read before anything is fitted: a through that is not a
  // list, an entry that is not a key, and a key named twice -- a list
  // somebody misread -- are each named, with every other problem.
  test('refuses a through that is not a list of lookup keys, or names one twice', () => {
    expect(problems({ ...ORDER_POLICY, through: 'customer' })).toEqual(['through is not a list of lookup field keys'])
    expect(problems({ ...ORDER_POLICY, through: ['customer', '', 7, 'customer'] })).toEqual([
      'through[1] is not a field key',
      'through[2] is not a field key',
      'through[3] names customer a second time',
    ])
  })

  // A role list that is a string makes `includes` a substring match. A
  // property this release does not read is a rule nobody enforces, which the
  // person who wrote it believes is enforced. Each is named, all at once,
  // because a person fixes a policy from this list.
  test('refuses a malformed policy, naming every problem', () => {
    const malformed = {
      version: 2,
      operations: { read: BOTH, create: 'clerk', update: ['manager', ''], archive: ['manager'] },
      fields: { amount: { read: BOTH, write: BOTH, update: ['manager'] }, notes: 'everyone' },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant', operator: '=' }, { column: '', attribute: 7 }, 'tenant_id'],
      lookups: { customer: { column: 'tenant_id', attribute: 'tenant' } },
      columns: ['amount'],
    }
    expect(problems(malformed)).toEqual([
      'columns is not something this release reads, so nothing would enforce it',
      'version is not 1, the only policy version this release reads',
      'operations.archive is not something this release reads, so nothing would enforce it',
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
