import { createFormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import { buildLookupConfig } from '../lookup/config.js'
import type { FormPolicy } from '../policy/types.js'
import { validatePolicy } from '../policy/validate.js'
import { planCreate, planUpdate } from './plan.js'
import {
  actor,
  AMOUNT,
  ANSWERS,
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
  edited,
  fk,
  INT32,
  INT64,
  INTAKE,
  MS,
  MS_ORDER,
  ORDER_POLICY,
  ORDER_TARGET,
  ORDER_TOKEN,
  orderForm,
  PG,
  PG_ORDER,
  sales,
  snapshot,
  STAMPED,
  table,
  TENANT_ONE,
  text,
  value,
} from './test-support.js'

describe('planCreate', () => {
  // The whole translation in one request. Each value is what the codec made
  // of the answer; the tenant comes from the context; the customer token
  // becomes its two columns; `paid` is a boolean, not the radio's string; an
  // omitted `status` is absent, so the database's default applies; and every
  // lookup selection is handed back to be rechecked under the actor's filters.
  test('turns answers into exactly the insert, with the tenant from the context and every selection to recheck', () => {
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, ANSWERS)).toEqual({
      ok: true,
      request: {
        target: ORDER_TARGET.postgres,
        values: [
          value('tenant_id', INT32, '1'),
          value('customer_no', INT32, '1001'),
          value('order_date', DATE, '2026-10-08'),
          value('amount', AMOUNT, '99999999999999.9999'),
          value('notes', text(null), null),
          value('group', text(50), 'A'),
          value('created_by', INT32, '1'),
          value('approved_by', INT32, '2'),
          value('paid', BOOLEAN, true),
        ],
        returning: CLERK_COLUMNS,
      },
      fields: CLERK_FIELDS,
      memberships: [
        { field: 'customer', config: buildLookupConfig(PG_ORDER, 'customer', { snapshot: PG }), tokens: ['k1:1,1001'], filters: TENANT_ONE },
        { field: 'employee', config: buildLookupConfig(PG_ORDER, 'employee', { snapshot: PG }), tokens: ['k1:1'], filters: TENANT_ONE },
      ],
    })
  })

  // The same answers make the same request on the other engine, except for
  // what the engines genuinely differ in: the version is a rowversion.
  test('makes the same request for SQL Server, but for the concurrency the table has', () => {
    const pg = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, ANSWERS)
    const ms = planCreate(MS, MS_ORDER, ORDER_POLICY, CLERK, ANSWERS)
    expect(ms).toMatchObject({ ok: true, request: { target: ORDER_TARGET.sqlserver } })
    if (pg.ok && ms.ok) expect(ms.request.values).toEqual(pg.request.values)
  })

  // Over-posting. The tenant is the context's: on the order form it is not a
  // field at all, on the customer form it is a pinned one; an identity or a
  // version column is the database's. Each is refused before a value is read.
  test('refuses an over-posted tenant column, key or version, before looking at any value', () => {
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, tenant_id: '2', amount: 12.5 })).toMatchObject({
      ok: false,
      code: 'over-posting',
      message: 'tenant_id is not a field of this form',
    })
    const source = customerSource()
    expect(planCreate(source, customerForm(source).bindings, CUSTOMER_POLICY, CLERK, { tenant_id: '2', customer_no: 7, name: 'X' })).toMatchObject({
      ok: false,
      code: 'over-posting',
      message: expect.stringContaining('tenant_id is pinned by a row filter') as unknown as string,
    })
    for (const key of ['id', 'row_version']) {
      expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, [key]: '1' }), key).toMatchObject({ ok: false, code: 'over-posting' })
    }
  })

  // A JSON number for a decimal has been through a double (0008). Every
  // field that cannot be written is reported at once, in the form's order,
  // with the codec's own code, so a person fixes them in one pass.
  test('refuses a decimal sent as a number, and reports every bad field in the form’s order', () => {
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, amount: 12.5 })).toEqual({
      ok: false,
      code: 'invalid-values',
      message: 'amount cannot be written',
      fieldErrors: [{ field: 'amount', code: 'type', message: 'Send an exact decimal as a string, such as "1234.56".' }],
    })
    const outcome = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, paid: 'yes', group: 'x'.repeat(51), amount: '1.23456', order_date: '2026-02-30', customer: 'garbage' })
    expect(outcome).toMatchObject({ ok: false, code: 'invalid-values' })
    if (!outcome.ok && outcome.code === 'invalid-values') {
      expect(outcome.fieldErrors.map(({ field, code }) => `${field}:${code}`)).toEqual([
        'customer:not-an-option',
        'order_date:not-a-date',
        'amount:too-many-fraction-digits',
        'group:too-long',
        'paid:type',
      ])
    }
  })

  // A token is a browser's: anything the encoder would not have written for
  // a key of this lookup, spelled as its columns hold it, names no row. Every
  // such selection gets the same answer an invented one does, so a probe
  // cannot tell a malformed token from a missing row; and none is passed on
  // to be asked about.
  test('refuses a forged lookup token with the answer every non-member gets', () => {
    for (const token of ['garbage', 'k1:1', 'k1:1,1001,9', 'k1:1,01001', 'k1:1,abc', 'k1:1,1e3', 'k2:1,1001', '', 1001, true, ['k1:1,1001']]) {
      const outcome = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, customer: token })
      expect(outcome, JSON.stringify(token)).toEqual({
        ok: false,
        code: 'invalid-values',
        message: 'customer cannot be written',
        fieldErrors: [{ field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' }],
      })
    }
  })

  // A codec canonicalises: an upper-case UUID becomes lower case, 1.5 in a
  // numeric(5,2) becomes 1.50. A token is a key's one spelling (0012), so a
  // token the codec had to change is not one the lookup offered — though the
  // database would match it — and is refused, never quietly rewritten.
  test('refuses a token whose value the column’s codec would have to respell', () => {
    const projects = snapshot('postgres', (objects) => {
      objects.push(table('project', [col('id', 1, { kind: 'uuid' }), col('name', 2, text(100))], { primaryKey: { name: 'pk_project', columns: ['id'] } }))
      const order = objects.find((object) => object.ref.name === 'order')
      order?.columns.push(col('project_id', 13, { kind: 'uuid' }, { nullable: true }))
      order?.foreignKeys.push(fk('fk_order_project', ['project_id'], 'project', ['id']))
    })
    const { bindings } = generateForm(projects, {
      connection: 'erp',
      root: sales('order'),
      formId: 'sales-order',
      title: 'Order',
      lookups: [
        { foreignKey: 'fk_order_customer', display: ['name'] },
        { foreignKey: 'fk_order_created_by', display: ['name'] },
        { foreignKey: 'fk_order_project', display: ['name'] },
      ],
      versionColumn: 'row_version',
    })
    const policy: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, project: CLERK_RW }, lookups: { ...ORDER_POLICY.lookups, project: [] } }
    expect(validatePolicy(policy, bindings)).toEqual({ ok: true })
    const lower = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const planned = planCreate(projects, bindings, policy, CLERK, { ...ANSWERS, project: `k1:${lower}` })
    expect(planned.ok && planned.request.values.find((entry) => entry.name === 'project_id')).toEqual(value('project_id', { kind: 'uuid' }, lower))
    expect(planCreate(projects, bindings, policy, CLERK, { ...ANSWERS, project: `k1:${lower.toUpperCase()}` })).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'project', code: 'not-an-option' }],
    })
  })

  // The customer's key holds its tenant, which a row filter pins. A token for
  // tenant 2's customer 1001 contradicts the trusted tenant: written with the
  // context's tenant it would reference tenant 1's customer 1001, a row the
  // person never chose; written as given, another tenant's customer in this
  // tenant's order. Neither: it is refused as every non-member is.
  test('refuses another tenant’s customer, whose key carries the tenant, as a non-member', () => {
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, customer: 'k1:2,1001' })).toMatchObject({
      ok: false,
      code: 'invalid-values',
      fieldErrors: [{ field: 'customer', code: 'not-an-option' }],
    })
  })

  // An employee's key is a surrogate id, which says nothing about its tenant:
  // the planner cannot know that employee 7 is another tenant's. It decodes
  // the token, writes the id, and hands the selection back to be checked
  // under the actor's filters — `rejects` is what refuses it. A planner that
  // dropped this check because the token looked well formed would write a
  // cross-tenant reference the foreign key happily accepts.
  test('cannot tell another tenant’s employee by its token, and hands it to the membership check with the actor’s filters', () => {
    const planned = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, employee: 'k1:7' })
    expect(planned).toMatchObject({ ok: true })
    if (!planned.ok) return
    expect(planned.request.values).toContainEqual(value('created_by', INT32, '7'))
    expect(planned.memberships).toContainEqual({
      field: 'employee',
      config: buildLookupConfig(PG_ORDER, 'employee', { snapshot: PG }),
      tokens: ['k1:7'],
      filters: TENANT_ONE,
    })
  })

  // Clearing a lookup sets its columns NULL, except a column the context
  // pins, which is still the tenant. A selection that cannot be cleared —
  // the customer number is NOT NULL — is required, as the codec says.
  test('clears a lookup to NULL where its columns allow it, and never the pinned tenant', () => {
    const planned = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, employee: null })
    expect(planned).toMatchObject({ ok: true, memberships: [{ field: 'customer' }] })
    if (planned.ok) expect(planned.request.values).toContainEqual(value('created_by', INT32, null))
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, customer: null })).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'customer', code: 'required' }],
    })
  })

  // The nullable boolean is a radio of 'true' and 'false' (0009), because a
  // checkbox has two answers and the column three. Only those strings and
  // null are answers: the JSON boolean is not what the form holds, and
  // formancy's own server check would refuse it as an option anyway.
  test('reads the three-state radio as true, false or null, and nothing else', () => {
    for (const [answer, held] of [
      ['true', true],
      ['false', false],
      [null, null],
    ] as const) {
      const planned = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, paid: answer })
      expect(planned.ok && planned.request.values.find((entry) => entry.name === 'paid')?.value, String(answer)).toBe(held)
    }
    for (const answer of [true, 'True', 'yes', '', 1]) {
      expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...ANSWERS, paid: answer }), String(answer)).toMatchObject({
        ok: false,
        fieldErrors: [{ field: 'paid', code: 'type' }],
      })
    }
  })

  // formancy's server-side replay does not check a checkbox's type: it
  // accepts the string 'true', and anything else. The codec is the only gate,
  // so a client that sends 'true' passes the form and must still be refused
  // here rather than having a string bound to a bit.
  test('refuses a checkbox answered with text, which formancy’s own replay accepts', () => {
    const source = customerSource()
    const { form, bindings } = customerForm(source)
    for (const answer of ['true', 'abc', 1]) expect(engineErrors(form, { active: answer }), String(answer)).not.toHaveProperty('active')
    expect(planCreate(source, bindings, CUSTOMER_POLICY, CLERK, { customer_no: 7, name: 'X', active: 'true' })).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'active', code: 'type' }],
    })
  })

  // The generator does not know the policy (plan section 9 keeps them
  // apart), so a pinned NOT NULL column with no default is a required field
  // of the generated form. formancy's replay then demands an answer the
  // planner refuses as over-posting (0011): no submission passes both. The
  // host has to supply the tenant to formancy's check and leave it out of
  // what it plans, or a presentation override has to drop `required`. This
  // records the conflict; nothing here resolves it.
  test('cannot accept the pinned tenant the generated customer form requires', () => {
    const source = customerSource()
    const { form, bindings } = customerForm(source)
    expect(engineErrors(form, { customer_no: 7, name: 'X' })).toEqual({ tenant_id: ['required'] })
    expect(planCreate(source, bindings, CUSTOMER_POLICY, CLERK, { tenant_id: 1, customer_no: 7, name: 'X' })).toMatchObject({ ok: false, code: 'over-posting' })
    expect(planCreate(source, bindings, CUSTOMER_POLICY, CLERK, { customer_no: 7, name: 'X' })).toMatchObject({
      ok: true,
      request: { values: [value('tenant_id', INT32, '1'), value('customer_no', INT32, '7'), value('name', text(200), 'X')] },
    })
  })

  // A column that is NOT NULL, has no default and is not generated cannot be
  // left out: the database would refuse it after the person had moved on. One
  // with a default can, and that is how the default applies.
  test('reports an omitted field the database requires, and lets one with a default be omitted', () => {
    const { order_date: _date, amount: _amount, customer: _customer, ...rest } = ANSWERS
    const outcome = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, rest)
    expect(outcome).toMatchObject({ ok: false, code: 'invalid-values' })
    if (!outcome.ok && outcome.code === 'invalid-values') expect(outcome.fieldErrors.map(({ field, code }) => `${field}:${code}`)).toEqual(['customer:required', 'order_date:required', 'amount:required'])
    const planned = planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, ANSWERS)
    expect(planned.ok && planned.request.values.some((entry) => entry.name === 'status')).toBe(false)
  })

  // An intake role may create orders and read none. It still receives the
  // address of what it made — a reference number — and nothing else the
  // database filled in: no default, no computed value, no other column.
  test('returns only the key to an actor who may create and not read', () => {
    const planned = planCreate(PG, PG_ORDER, ORDER_POLICY, INTAKE, { customer: 'k1:1,1001', order_date: '2026-10-08', amount: '1.00' })
    expect(planned).toMatchObject({ ok: true, fields: [], request: { returning: [column('id', INT64)] } })
  })

  // The tenant written on create is the context's, through the column's
  // codec, so a record created is one the same actor can read back. '042'
  // would be written as 42 and the actor's filter compare '042'.
  test('refuses a trusted tenant not spelled as the column holds it', () => {
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, actor(['clerk'], { tenant: '042' }), ANSWERS)).toMatchObject({ ok: false, code: 'invalid-context' })
  })

  // Three ways a create cannot even start, each of which would otherwise
  // reach the policy or the codecs with something they were not built for.
  test('refuses a stale snapshot, a form that does not create, and answers that are not an object', () => {
    // Drift: the stored bindings were generated from a snapshot the database no longer matches.
    expect(planCreate(PG, MS_ORDER, ORDER_POLICY, CLERK, ANSWERS)).toMatchObject({ ok: false, code: 'drift' })
    // A view offers no create, whatever a policy grants.
    const view = generateForm(PG, { connection: 'erp', root: sales('customer_summary'), formId: 'summary', title: 'Summary', lookups: [] }).bindings
    expect(planCreate(PG, view, ORDER_POLICY, CLERK, {})).toMatchObject({ ok: false, code: 'operation-unavailable' })
    // A body that is not an object of answers has no keys to check for over-posting.
    for (const body of [null, [], 'customer', 7]) expect(planCreate(PG, PG_ORDER, ORDER_POLICY, CLERK, body), JSON.stringify(body)).toMatchObject({ ok: false, code: 'invalid-request' })
  })

  // A lookup that cannot be configured — here, labelled by a binary column —
  // offers no options, so no selection of it can be rechecked, and a request
  // that carries one is refused rather than written unchecked.
  test('refuses a selection whose lookup cannot be rechecked', () => {
    const binary = snapshot('postgres', (objects) => {
      const name = objects.find((object) => object.ref.name === 'employee')?.columns.find((candidate) => candidate.name === 'name')
      if (name !== undefined) name.type = { kind: 'binary', maxLength: null }
    })
    const bindings = orderForm(binary).bindings
    expect(planCreate(binary, bindings, ORDER_POLICY, CLERK, { ...ANSWERS, employee: 'k1:1' })).toMatchObject({ ok: false, code: 'invalid-bindings' })
  })

  // A lookup's filter is the actor's as much as the root's is: scoped by an
  // attribute the context lacks, it is refused rather than asked unfiltered;
  // on a column the target does not have, it is a policy that cannot be
  // applied — caught here, before an adapter is handed an identifier nobody
  // approved.
  test('refuses a selection whose lookup filter cannot be built for this actor', () => {
    const byBranch: FormPolicy = { ...ORDER_POLICY, lookups: { ...ORDER_POLICY.lookups, employee: [{ column: 'tenant_id', attribute: 'branch' }] } }
    expect(planCreate(PG, PG_ORDER, byBranch, CLERK, ANSWERS)).toMatchObject({ ok: false, code: 'missing-attribute' })
    expect(planUpdate(PG, PG_ORDER, byBranch, CLERK, ORDER_TOKEN, '1', { employee: 'k1:1' })).toMatchObject({ ok: false, code: 'missing-attribute' })
    // Without a selection there is nothing to recheck, and nothing to refuse.
    expect(planCreate(PG, PG_ORDER, byBranch, CLERK, { ...ANSWERS, employee: null })).toMatchObject({ ok: true })
    const byRegion: FormPolicy = { ...ORDER_POLICY, lookups: { ...ORDER_POLICY.lookups, employee: [{ column: 'region', attribute: 'tenant' }] } }
    expect(planCreate(PG, PG_ORDER, byRegion, CLERK, ANSWERS)).toMatchObject({ ok: false, code: 'invalid-policy', message: expect.stringContaining('employee has no column region') as unknown as string })
  })

  // The tenant can be a reference too: customer.tenant_id offered as a
  // lookup of tenants, pinned by the policy. The only selection it can hold
  // is the context's own tenant, written once; another tenant is a
  // non-member, and clearing it is not an answer.
  test('accepts a lookup over the pinned tenant alone only as the context’s tenant', () => {
    const source = snapshot('sqlserver', (objects) => {
      objects.push(table('tenant', [col('id', 1, INT32), col('name', 2, text(100))], { primaryKey: { name: 'pk_tenant', columns: ['id'] } }))
      objects.find((object) => object.ref.name === 'customer')?.foreignKeys.push(fk('fk_customer_tenant', ['tenant_id'], 'tenant', ['id']))
    })
    const { bindings } = generateForm(source, {
      connection: 'erp',
      root: sales('customer'),
      formId: 'sales-customer',
      title: 'Customer',
      lookups: [{ foreignKey: 'fk_customer_tenant', display: ['name'] }],
    })
    const { tenant_id: _pinned, country: _country, ...fields } = CUSTOMER_POLICY.fields
    const policy: FormPolicy = {
      ...CUSTOMER_POLICY,
      operations: { ...CUSTOMER_POLICY.operations, update: [] },
      fields: { ...fields, tenant: CLERK_RW },
      lookups: { tenant: [{ column: 'id', attribute: 'tenant' }] },
    }
    expect(validatePolicy(policy, bindings)).toEqual({ ok: true })

    const planned = planCreate(source, bindings, policy, CLERK, { tenant: 'k1:1', customer_no: 7, name: 'X' })
    expect(planned).toMatchObject({ ok: true, memberships: [{ field: 'tenant', tokens: ['k1:1'], filters: { kind: 'restricted', equal: [{ column: 'id', value: '1' }] } }] })
    if (planned.ok) expect(planned.request.values.filter((entry) => entry.name === 'tenant_id')).toEqual([value('tenant_id', INT32, '1')])
    expect(planCreate(source, bindings, policy, CLERK, { tenant: 'k1:2', customer_no: 7, name: 'X' })).toMatchObject({ ok: false, fieldErrors: [{ field: 'tenant', code: 'not-an-option' }] })
    expect(planCreate(source, bindings, policy, CLERK, { tenant: null, customer_no: 7, name: 'X' })).toMatchObject({ ok: false, fieldErrors: [{ field: 'tenant', code: 'required' }] })
  })

  // A pinned column is written from the context, through its codec like any
  // other value. One the database writes itself cannot be: the policy pins
  // something no insert may name.
  test('refuses a row filter that pins a column the database writes', () => {
    const onIdentity: FormPolicy = { ...ORDER_POLICY, rowFilters: [{ column: 'id', attribute: 'tenant' }] }
    expect(planCreate(PG, PG_ORDER, onIdentity, CLERK, ANSWERS)).toMatchObject({ ok: false, code: 'invalid-policy', message: expect.stringContaining('id cannot be written from the context') as unknown as string })
    expect(planCreate(PG, PG_ORDER, ORDER_POLICY, AUDITOR, ANSWERS)).toMatchObject({ ok: false, code: 'operation-denied' })
  })

  // A bindings file can bind a column the generator excluded. The codec is
  // the last gate: a type with no tested codec is never written.
  test('refuses a value for a column the generator excluded, if a bindings file binds it anyway', () => {
    const attached = snapshot('postgres', (objects) => {
      objects.find((object) => object.ref.name === 'order')?.columns.push(col('attachment', 13, { kind: 'binary', maxLength: null }, { nullable: true }))
    })
    const bindings = edited(orderForm(attached).bindings, (draft) => {
      draft.fields.push({ kind: 'column', field: 'attachment', column: 'attachment', type: { kind: 'binary', maxLength: null }, nullable: true, writable: true })
    })
    const policy: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, attachment: CLERK_RW } }
    expect(planCreate(attached, bindings, policy, CLERK, { ...ANSWERS, attachment: 'AAAA' })).toMatchObject({ ok: false, fieldErrors: [{ field: 'attachment', code: 'unsupported' }] })
  })

  // A record keyed by a timestamp can be created, and has no address
  // afterwards: what the insert reads back is what the actor may see, without
  // a key nobody could send back.
  test('creates a record whose key no token can carry, and reads back no key for it', () => {
    const planned = planCreate(STAMPED, orderForm(STAMPED).bindings, ORDER_POLICY, CLERK, ANSWERS)
    expect(planned).toMatchObject({ ok: true })
    if (planned.ok) expect(planned.request.returning.map((entry) => entry.name)).not.toContain('created_at')
  })
})

/** What the released engine says about one set of answers in server mode, the mode formancy's submission endpoint replays in. */
function engineErrors(form: FormSchema, answers: Record<string, unknown>): Record<string, string[]> {
  const capabilities = { now: () => 1_791_417_600_000, today: () => '2026-10-09', random: () => 0.5 }
  const engine = createFormEngine({ schema: form, mode: 'server', capabilities })
  for (const [key, answer] of Object.entries(answers)) engine.setValue([key], answer)
  return Object.fromEntries(Object.entries(engine.validate().errors).filter(([, codes]) => codes.length > 0))
}
