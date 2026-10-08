import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import { buildLookupConfig } from '../lookup/config.js'
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
  CUSTOMER_POLICY,
  customerForm,
  customerSource,
  edited,
  INT32,
  INT64,
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
  TENANT,
  TENANT_ONE,
  text,
  value,
} from './test-support.js'

describe('planUpdate', () => {
  // A patch: what was submitted is set, an explicit null clears, and what
  // was omitted is not mentioned — so a field hidden by form logic cannot
  // erase a column. The customer selection sets only the customer number:
  // the tenant it carries is pinned, and equals the context's.
  test('sets exactly what was submitted, never the tenant, guarded by the key, the filter and the version', () => {
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { customer: 'k1:1,1002', notes: null, paid: 'false' })).toEqual({
      ok: true,
      request: {
        target: ORDER_TARGET.postgres,
        key: [value('id', INT64, ORDER_ID)],
        set: [value('customer_no', INT32, '1002'), value('notes', text(null), null), value('paid', BOOLEAN, false)],
        expectedVersion: '1',
        filters: TENANT_ONE,
        returning: CLERK_COLUMNS,
      },
      fields: CLERK_FIELDS,
      memberships: [{ field: 'customer', config: buildLookupConfig(PG_ORDER, 'customer', { snapshot: PG }), tokens: ['k1:1,1002'], filters: TENANT_ONE }],
    })
  })

  // Clearing is subject to nullability: amount is NOT NULL.
  test('refuses to clear a column that cannot be NULL', () => {
    expect(planUpdate(MS, MS_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '00000000000007d1', { amount: null })).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'amount', code: 'required', message: 'A value is required.' }],
    })
  })

  // Moving an order to another tenant's customer would move it into that
  // tenant's books through the customer key; refused as a non-member.
  test('refuses another tenant’s customer as a non-member', () => {
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { customer: 'k1:2,1001' })).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'customer', code: 'not-an-option' }],
    })
  })

  // Without proof against lost updates (0009, plan section 12) a form stays
  // read-only. The generator offers no update for an unconfirmed version
  // column; a bindings file edited to claim one is still refused, because the
  // planner reads the concurrency itself.
  test('refuses an update the form does not offer, or whose concurrency nobody confirmed', () => {
    const unconfirmed = orderForm(PG, false).bindings
    expect(unconfirmed.concurrency).toEqual({ kind: 'version-column', column: 'row_version', confirmed: false })
    expect(planUpdate(PG, unconfirmed, { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, update: [] } }, CLERK, ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({
      ok: false,
      code: 'operation-unavailable',
    })
    const claimed = edited(unconfirmed, (draft) => {
      draft.operations.update = true
    })
    expect(planUpdate(PG, claimed, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({
      ok: false,
      code: 'operation-unavailable',
      message: expect.stringContaining('concurrency') as unknown as string,
    })
    const none = edited(PG_ORDER, (draft) => {
      draft.concurrency = null
    })
    expect(planUpdate(PG, none, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({ ok: false, code: 'operation-unavailable' })
    // And the other way: bindings that withhold update are obeyed, though a key and a confirmed version are there.
    const withheld = edited(PG_ORDER, (draft) => {
      draft.operations.update = false
    })
    expect(planUpdate(PG, withheld, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({
      ok: false,
      code: 'operation-unavailable',
      message: 'This form does not offer update.',
    })
  })

  // A version is a token the read returned, and one the target could never
  // have returned is not "stale" — it is a malformed request. A rowversion is
  // sixteen lower-case hex characters (0008); a version column's value is a
  // canonical integer in its column's range.
  test('refuses a version this target could never have returned', () => {
    for (const version of ['1.0', '01', '-0', 'abc', '', '9223372036854775808', 1]) {
      expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, version as string, { notes: 'x' }), String(version)).toMatchObject({
        ok: false,
        code: 'invalid-version',
      })
    }
    for (const version of ['00000000000007D1', '7d1', '00000000000007d1 ', 'zz000000000007d1', '1']) {
      expect(planUpdate(MS, MS_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, version, { notes: 'x' }), version).toMatchObject({ ok: false, code: 'invalid-version' })
    }
    expect(planUpdate(MS, MS_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '00000000000007d1', { notes: 'x' })).toMatchObject({
      ok: true,
      request: { target: ORDER_TARGET.sqlserver, expectedVersion: '00000000000007d1' },
    })
  })

  // A record's key is how the token addresses it; an update changes the
  // record, not its address. A form submits every field, so the key field
  // arrives with each save: equal to the token's key it is accepted and not
  // set, different it is refused rather than silently ignored.
  test('never sets the key: an unchanged key field is accepted, a changed one refused', () => {
    const source = customerSource()
    const { bindings } = customerForm(source)
    const planned = planUpdate(source, bindings, CUSTOMER_POLICY, CLERK, 'k1:1,1001', '00000000000007d1', { customer_no: 1001, name: 'Muster AG', credit_limit: '12.5' })
    expect(planned).toMatchObject({
      ok: true,
      request: {
        key: [value('tenant_id', INT32, '1'), value('customer_no', INT32, '1001')],
        set: [value('name', text(200), 'Muster AG'), value('credit_limit', { kind: 'decimal', precision: 14, scale: 2 }, '12.50')],
        filters: TENANT_ONE,
        // The shared country table: the policy says so with [].
      },
    })
    expect(planUpdate(source, bindings, CUSTOMER_POLICY, CLERK, 'k1:1,1001', '00000000000007d1', { customer_no: 1002 })).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'customer_no', code: 'read-only' }],
    })
    expect(planUpdate(source, bindings, CUSTOMER_POLICY, CLERK, 'k1:1,1001', '00000000000007d1', { tenant_id: '1' })).toMatchObject({ ok: false, code: 'over-posting' })
    const country = planUpdate(source, bindings, CUSTOMER_POLICY, CLERK, 'k1:1,1001', '00000000000007d1', { country: 'k1:CH' })
    expect(country).toMatchObject({ ok: true, memberships: [{ field: 'country', tokens: ['k1:CH'], filters: { kind: 'unrestricted' } }] })
  })

  // The update increments its version column in the statement the row filter
  // guards (0015). An employee table versioned by its tenant column, as an
  // administrator may confirm — a non-nullable integer that is neither key
  // nor field — under a policy that pins that column to the actor's tenant:
  // the save would run `SET tenant_id = tenant_id + 1 WHERE tenant_id = 1`
  // and move the employee into tenant 2. The policy fits the form, and a read
  // moves nothing, so the read is planned and the update refused.
  test('refuses an update whose row filter pins the version column', () => {
    const { bindings } = generateForm(PG, { connection: 'erp', root: sales('employee'), formId: 'sales-employee', title: 'Employee', lookups: [], versionColumn: 'tenant_id' })
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: [], update: ['clerk'] },
      fields: { id: { read: ['clerk'], write: [] }, name: CLERK_RW, manager_id: CLERK_RW },
      rowFilters: TENANT,
      lookups: {},
    }
    expect(validatePolicy(policy, bindings)).toEqual({ ok: true })
    expect(planRead(PG, bindings, policy, CLERK, 'k1:5')).toMatchObject({ ok: true, request: { filters: TENANT_ONE } })
    expect(planUpdate(PG, bindings, policy, CLERK, 'k1:5', '1', { name: 'Muster' })).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringContaining('tenant_id is the version column') as unknown as string,
    })
    // The same form unfiltered: the version column alone is no reason to refuse.
    expect(planUpdate(PG, bindings, { ...policy, rowFilters: [] }, CLERK, 'k1:5', '1', { name: 'Muster' })).toMatchObject({
      ok: true,
      request: { target: { concurrency: { kind: 'version-column', column: 'tenant_id' } }, filters: { kind: 'unrestricted' } },
    })
  })

  // An update that would set nothing has no statement both engines write
  // alike — SQL Server needs a SET, PostgreSQL would only move the version —
  // so it is refused here, once, rather than in each adapter.
  test('refuses an update that changes nothing', () => {
    const source = customerSource()
    const { bindings } = customerForm(source)
    for (const answers of [{}, { customer_no: 1001 }]) {
      expect(planUpdate(source, bindings, CUSTOMER_POLICY, CLERK, 'k1:1,1001', '00000000000007d1', answers), JSON.stringify(answers)).toMatchObject({
        ok: false,
        code: 'nothing-to-update',
      })
    }
  })

  // The update runs every gate the read and the create do: an update that
  // skipped one would write where a read of the same record is refused.
  test('refuses a bad record token, a stale snapshot, a forbidden actor and answers that are not an object', () => {
    // A token whose value an integer key cannot hold names no record.
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, 'k1:x', '1', { notes: 'x' })).toMatchObject({ ok: false, code: 'invalid-record-token' })
    // Bindings generated from the SQL Server snapshot, applied to the PostgreSQL one.
    expect(planUpdate(MS, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({ ok: false, code: 'drift' })
    // An auditor may read orders and not change them.
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, AUDITOR, ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({ ok: false, code: 'operation-denied' })
    // A tenant no integer column can hold would be a conversion error on both engines.
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, actor(['clerk'], { tenant: 'acme' }), ORDER_TOKEN, '1', { notes: 'x' })).toMatchObject({ ok: false, code: 'invalid-context' })
    // No body, no keys to check for over-posting.
    expect(planUpdate(PG, PG_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', null)).toMatchObject({ ok: false, code: 'invalid-request' })
  })
})
