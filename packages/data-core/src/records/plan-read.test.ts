import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { FormBindings } from '../generate/types.js'
import type { FormPolicy } from '../policy/types.js'
import { validatePolicy } from '../policy/validate.js'
import { planRead, planUpdate } from './plan.js'
import {
  actor,
  AUDITOR,
  BOOLEAN,
  CLERK,
  CLERK_COLUMNS,
  CLERK_FIELDS,
  CLERK_RW,
  col,
  column,
  CUSTOMER_POLICY,
  customerForm,
  customerSource,
  DATE,
  described,
  edited,
  fieldOf,
  INT32,
  INT64,
  LINE_POLICY,
  lineForm,
  MS,
  MS_ORDER,
  ORDER_ID,
  ORDER_POLICY,
  ORDER_TARGET,
  ORDER_TOKEN,
  orderForm,
  PG,
  PG_ORDER,
  sales,
  snapshot,
  STAMPED,
  TENANT_ONE,
  text,
  value,
} from './test-support.js'

describe('the forms and policies these tests use', () => {
  // Every refusal below has to be the planner's. A policy that did not fit
  // its form would be refused by the policy functions first, and a test of a
  // planner guard would pass for the policy's reason.
  test('fit each other, and the generator offers what the tests rely on', () => {
    expect(validatePolicy(ORDER_POLICY, PG_ORDER)).toEqual({ ok: true })
    expect(validatePolicy(ORDER_POLICY, MS_ORDER)).toEqual({ ok: true })
    expect(validatePolicy(CUSTOMER_POLICY, customerForm(customerSource()).bindings)).toEqual({ ok: true })
    expect(PG_ORDER.fields.map((binding) => binding.field)).toEqual(CLERK_FIELDS)
    expect(PG_ORDER.operations).toEqual({ create: true, update: true })
  })
})

describe('planRead', () => {
  // The read asks for the record its token names, under the actor's tenant,
  // and for nothing the actor may not see: a column the policy keeps from the
  // auditor is never fetched, so it cannot leak through a serializer that
  // forgot to drop it. The key is read too, for the record token.
  test('asks for the named record, only the columns the actor may read and its key, under the tenant filter', () => {
    expect(planRead(PG, PG_ORDER, ORDER_POLICY, AUDITOR, ORDER_TOKEN)).toEqual({
      ok: true,
      request: {
        target: ORDER_TARGET.postgres,
        key: [value('id', INT64, ORDER_ID)],
        columns: [column('id', INT64), column('order_date', DATE), column('status', text(20))],
        filters: TENANT_ONE,
        through: [],
      },
      fields: ['id', 'order_date', 'status'],
    })
  })

  // A lookup field is answered with a token of its foreign-key columns, so a
  // reader of the customer field needs both of them; and the key is fetched
  // even for an actor who may not see the key field, because the record token
  // is the address they already hold.
  test('reads every foreign-key column of a readable lookup, and the key even when its field is not readable', () => {
    const policy: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, id: { read: ['clerk'], write: [] } } }
    const planned = planRead(MS, MS_ORDER, policy, AUDITOR, ORDER_TOKEN)
    expect(planned).toMatchObject({ ok: true, fields: ['order_date', 'status'] })
    if (planned.ok) expect(planned.request.columns.map((entry) => entry.name)).toEqual(['id', 'order_date', 'status'])
    const clerk = planRead(MS, MS_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN)
    expect(clerk).toMatchObject({ ok: true, fields: CLERK_FIELDS })
    if (clerk.ok) expect(clerk.request.columns).toEqual(CLERK_COLUMNS)
  })

  // A line has no tenant of its own (0043). Its read carries the order
  // lookup's filter on sales.order, typed from that table's column, and the
  // two sides of the foreign key paired in order, so the adapter can put the
  // parent in the statement that decides "not found". Left off, the read
  // reaches any tenant's line by a guessed key.
  test("carries a typed through for a line's order, under the order lookup's filter", () => {
    for (const source of [PG, MS]) {
      const bindings = lineForm(source).bindings
      expect(planRead(source, bindings, LINE_POLICY, CLERK, `k1:${ORDER_ID},1`), source.kind).toMatchObject({
        ok: true,
        request: {
          key: [value('order_id', INT64, ORDER_ID), value('line_no', INT32, '1')],
          filters: { kind: 'unrestricted' },
          through: [{ columns: [column('order_id', INT64)], target: sales('order'), targetColumns: [{ name: 'id', type: INT64 }], filters: TENANT_ONE }],
        },
        fields: ['order', 'line_no', 'quantity', 'unit_price', 'line_total'],
      })
    }
    // The order form names no through, and its read says so.
    expect(planRead(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN)).toMatchObject({ ok: true, request: { through: [] } })
  })

  // The through is the policy's, decided before the token: a missing tenant
  // refuses rather than reading lines unscoped, and an actor granted nothing
  // on the order field is scoped by it, not refused -- a through offers no
  // options. A through the snapshot cannot compare is refused here as it is
  // at publish, by the one function both ask.
  test('refuses a missing tenant, scopes an actor granted nothing on the field, and refuses a through the snapshot cannot compare', () => {
    const bindings = lineForm(PG).bindings
    expect(planRead(PG, bindings, LINE_POLICY, actor(['clerk'], {}), `k1:${ORDER_ID},1`)).toMatchObject({ ok: false, code: 'missing-attribute', message: expect.stringMatching(/^lookups\.order: /) as unknown as string })
    expect(planRead(PG, bindings, LINE_POLICY, AUDITOR, `k1:${ORDER_ID},1`)).toMatchObject({ ok: true, fields: ['line_total'], request: { through: [{ filters: TENANT_ONE }] } })
    const textual = snapshot('postgres', (objects) => {
      const id = objects.find((object) => object.ref.name === 'employee')?.columns.find((entry) => entry.name === 'id')
      if (id !== undefined) id.type = text(10)
    })
    expect(planRead(textual, orderForm(textual).bindings, { ...ORDER_POLICY, through: ['employee'] }, CLERK, ORDER_TOKEN)).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/^through: employee joins sales\.employee\.id, which a through cannot compare/) as unknown as string,
    })
  })

  // The token is a browser's. One that does not name a record of this form,
  // spelled as its key holds it, is refused before anything is bound.
  test('refuses a token that does not name a record of this form', () => {
    for (const token of ['garbage', 'k1:', 'k1:1,2', 'k1:1e3', 'k1:007', 'k1:9223372036854775808', 'k2:7', '']) {
      expect(planRead(PG, PG_ORDER, ORDER_POLICY, CLERK, token), token).toMatchObject({ ok: false, code: 'invalid-record-token' })
    }
  })

  // The policy decides before the token is looked at: an actor without the
  // read grant, or without the tenant the filter needs, gets the policy's
  // refusal, never a request without its filter.
  test('passes the policy’s refusal through', () => {
    expect(planRead(PG, PG_ORDER, ORDER_POLICY, actor(['intake']), ORDER_TOKEN)).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(planRead(PG, PG_ORDER, ORDER_POLICY, actor(['clerk'], {}), ORDER_TOKEN)).toMatchObject({ ok: false, code: 'missing-attribute' })
  })

  // A filter's term carries its column's type and the value as the column
  // holds it (0028): bound otherwise, each engine would convert it — '042' is
  // 42 to both, 'acme' is an error on both. The trusted value must be spelled
  // as the column holds it, or nothing is asked.
  test('refuses a trusted tenant not spelled as the column holds it, rather than letting each engine convert it', () => {
    for (const tenant of ['042', 'acme', ' 1', '1.0']) {
      expect(planRead(PG, PG_ORDER, ORDER_POLICY, actor(['clerk'], { tenant }), ORDER_TOKEN), tenant).toMatchObject({ ok: false, code: 'invalid-context' })
    }
  })

  // A policy written for another form, or for this one before a
  // regeneration renamed a field, grants things nobody meant (0011). The
  // root's filter is read without the form; the fields are not, and refuse it.
  test('refuses a policy that does not fit the form', () => {
    const misfit: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, total: CLERK_RW } }
    expect(planRead(PG, PG_ORDER, misfit, CLERK, ORDER_TOKEN)).toMatchObject({ ok: false, code: 'invalid-policy', message: expect.stringContaining('fields.total') as unknown as string })
  })

  // A filter compares a column's canonical value exactly. A boolean has many
  // spellings and a timestamp a precision per engine, so a filter on one is a
  // policy that cannot be applied the same way twice: refused, in lookups too.
  test('refuses a row filter on a column whose values have no settled spelling', () => {
    const onFlag: FormPolicy = { ...ORDER_POLICY, rowFilters: [{ column: 'paid', attribute: 'tenant' }] }
    expect(planRead(PG, PG_ORDER, onFlag, CLERK, ORDER_TOKEN)).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringContaining('paid is boolean, which a row filter cannot compare') as unknown as string,
    })
  })

  // The generator falls back to a unique key when a table has no primary
  // key, and that is still a key: one row per value.
  test('accepts an identity that is a unique key of a table without a primary key', () => {
    const unique = snapshot('postgres', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order')
      if (order === undefined) return
      order.primaryKey = null
      order.uniqueKeys = [{ name: 'uq_order_id', columns: ['id'] }]
    })
    expect(planRead(unique, orderForm(unique).bindings, ORDER_POLICY, CLERK, ORDER_TOKEN)).toMatchObject({ ok: true, request: { key: [{ name: 'id', value: ORDER_ID }] } })
  })

  // Drift: the database changed since the form was generated. Bindings from
  // another snapshot name columns that may not exist or mean something else.
  test('refuses bindings generated from another snapshot', () => {
    const changed = snapshot('postgres', (objects) => {
      objects.find((object) => object.ref.name === 'order')?.columns.push(col('rush', 13, BOOLEAN, { nullable: true }))
    })
    expect(planRead(changed, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN)).toMatchObject({ ok: false, code: 'drift' })
  })

  // A view has no key, and a key of a kind with no settled spelling has no
  // token: neither form can address a record, so neither reads or updates one.
  test('refuses a form that cannot address a record', () => {
    const view = generateForm(PG, { connection: 'erp', root: sales('customer_summary'), formId: 'summary', title: 'Summary', lookups: [] }).bindings
    expect(planRead(PG, view, ORDER_POLICY, CLERK, 'k1:1')).toMatchObject({ ok: false, code: 'operation-unavailable', message: expect.stringContaining('no primary or unique key') as unknown as string })
    const bindings = orderForm(STAMPED).bindings
    expect(bindings.operations.update).toBe(true)
    expect(planRead(STAMPED, bindings, ORDER_POLICY, CLERK, 'k1:2026')).toMatchObject({ ok: false, code: 'operation-unavailable', message: expect.stringContaining('no settled spelling') as unknown as string })
    expect(planUpdate(STAMPED, bindings, ORDER_POLICY, CLERK, 'k1:2026', '1', { notes: 'x' }, undefined, described(STAMPED, bindings))).toMatchObject({ ok: false, code: 'operation-unavailable' })
  })

  // The fingerprint covers the snapshot and not the bindings, so an edited
  // bindings file keeps it. Each edit below would make the adapter do
  // something nobody approved: bind a decimal as text, update every row whose
  // tenant matches, write one column twice, compare a bigint as a rowversion.
  test('refuses bindings that do not say what their own snapshot says', () => {
    // Each edit with the reason it must be refused for, so a neighbouring guard cannot pass it.
    const edits: Array<[string, (draft: FormBindings) => void]> = [
      [
        'amount describes amount as something other',
        (draft) => {
          const amount = fieldOf(draft, 'amount')
          if (amount.kind === 'column') amount.type = text(30)
        },
      ],
      [
        'notes describes notes as something other',
        (draft) => {
          const notes = fieldOf(draft, 'notes')
          if (notes.kind === 'column') notes.nullable = false
        },
      ],
      [
        'notes is bound to gone, which the table does not have',
        (draft) => {
          const notes = fieldOf(draft, 'notes')
          if (notes.kind === 'column') notes.column = 'gone'
        },
      ],
      [
        'the identity (tenant_id) is not a key',
        (draft) => {
          draft.identity = ['tenant_id']
        },
      ],
      [
        'the identity names missing',
        (draft) => {
          draft.identity = ['missing']
        },
      ],
      [
        'notes is bound by two fields',
        (draft) => {
          draft.fields.push({ ...fieldOf(draft, 'notes'), field: 'notes_again' })
        },
      ],
      [
        'row_version cannot be a rowversion',
        (draft) => {
          if (draft.concurrency !== null) draft.concurrency.kind = 'rowversion'
        },
      ],
      [
        'notes cannot be a version-column',
        (draft) => {
          if (draft.concurrency !== null) draft.concurrency.column = 'notes'
        },
      ],
      [
        'gone cannot be a version-column: the table does not have it',
        (draft) => {
          if (draft.concurrency !== null) draft.concurrency.column = 'gone'
        },
      ],
      [
        'id describes id as something other',
        (draft) => {
          draft.root = sales('employee')
        },
      ],
      [
        'sales.nowhere is not in the snapshot',
        (draft) => {
          draft.root = sales('nowhere')
        },
      ],
      [
        'call order a view, and it is a table',
        (draft) => {
          draft.rootKind = 'view'
        },
      ],
      [
        'customer names columns that are not those of a foreign key fk_order_customer',
        (draft) => {
          const customer = fieldOf(draft, 'customer')
          if (customer.kind === 'lookup') customer.columns = ['tenant_id', 'approved_by']
        },
      ],
      [
        'not those of a foreign key fk_nowhere',
        (draft) => {
          const customer = fieldOf(draft, 'customer')
          if (customer.kind === 'lookup') customer.foreignKey = 'fk_nowhere'
        },
      ],
      [
        'Bindings version 3',
        (draft) => {
          ;(draft as { version: number }).version = 3
        },
      ],
    ]
    for (const [reason, edit] of edits) {
      expect(planRead(PG, edited(PG_ORDER, edit), ORDER_POLICY, CLERK, ORDER_TOKEN), reason).toMatchObject({
        ok: false,
        code: 'invalid-bindings',
        message: expect.stringContaining(reason) as unknown as string,
      })
    }
    // A version column must be a non-nullable integer; on SQL Server the generated rowversion is the only proof.
    const nullableVersion = snapshot('postgres', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order')
      const version = order?.columns.find((candidate) => candidate.name === 'row_version')
      if (version !== undefined) version.nullable = true
    })
    const forged = edited(PG_ORDER, (draft) => {
      draft.snapshotFingerprint = nullableVersion.fingerprint
    })
    expect(planRead(nullableVersion, forged, ORDER_POLICY, CLERK, ORDER_TOKEN)).toMatchObject({
      ok: false,
      code: 'invalid-bindings',
      message: expect.stringContaining('row_version cannot be a version-column') as unknown as string,
    })
  })

  // The adapter increments a version column in the same UPDATE that checks it
  // (0015), so it moves whatever else the column is. As the record's key,
  // every save would change the address its token names — and with tenant_id
  // in the key, move the record into the next tenant. As a column a field is
  // bound to, the one statement could set it twice; as one the database
  // computes, no update could ever run. Each is refused before anything is
  // planned, read included, because the bindings say something untrue.
  test('refuses a version column that is the key, a field or generated', () => {
    const customers = customerSource()
    const asKey = edited(customerForm(customers).bindings, (draft) => {
      draft.concurrency = { kind: 'version-column', column: 'tenant_id', confirmed: true }
    })
    expect(planRead(customers, asKey, CUSTOMER_POLICY, CLERK, 'k1:1,1001')).toMatchObject({
      ok: false,
      code: 'invalid-bindings',
      message: expect.stringContaining("tenant_id cannot be a version-column: it is part of the record's key") as unknown as string,
    })
    // The order's tenant is no key, and the customer lookup writes it.
    const asField = edited(PG_ORDER, (draft) => {
      if (draft.concurrency !== null) draft.concurrency.column = 'tenant_id'
    })
    expect(planUpdate(PG, asField, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' }, undefined, described(PG, asField))).toMatchObject({
      ok: false,
      code: 'invalid-bindings',
      message: expect.stringContaining('tenant_id cannot be a version-column: a field is bound to it') as unknown as string,
    })
    const generated = edited(PG_ORDER, (draft) => {
      if (draft.concurrency !== null) draft.concurrency.column = 'id'
    })
    expect(planRead(PG, generated, ORDER_POLICY, CLERK, ORDER_TOKEN)).toMatchObject({
      ok: false,
      code: 'invalid-bindings',
      message: expect.stringContaining('id cannot be a version-column: the database generates it') as unknown as string,
    })
  })
})
