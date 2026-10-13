import { describe, expect, test } from 'vitest'
import type { FormPolicy } from '../policy/types.js'
import { planDelete } from './delete.js'
import { DELETE_REFUSED } from './drift.js'
import {
  AUDITOR,
  CLERK,
  DEFINITION,
  described,
  edited,
  factsSnapshot,
  INT32,
  INT64,
  LINE_POLICY,
  lineForm,
  MS,
  MS_FACTS,
  MS_ORDER,
  ORDER_ID,
  ORDER_POLICY,
  ORDER_TARGET,
  ORDER_TOKEN,
  orderForm,
  PG_FACTS,
  sales,
  TENANT_ONE,
  value,
} from './test-support.js'
import type { DescribedTable } from './types.js'

/*
 * What `planDelete` makes of one record to delete (0050): the request both
 * adapters receive, or the refusal that says why there is none. A delete
 * is scoped as an update is -- the root's filter and every through -- and
 * guarded by the version its person read; the policy is asked first, so a
 * person it refuses is told only that.
 */

/** Clerks may delete orders, and read them: a role that may delete must (validatePolicy). */
const DELETE_ORDERS: FormPolicy = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['clerk'] } }
const DELETE_LINES: FormPolicy = { ...LINE_POLICY, operations: { ...LINE_POLICY.operations, delete: ['clerk'] } }

const MS_DELETABLE = orderForm(MS_FACTS).bindings
const PG_DELETABLE = orderForm(PG_FACTS).bindings
const MS_LINES = lineForm(MS_FACTS).bindings

/** A rowversion as the SQL Server adapter spells one. */
const ROWVERSION = '00000000000007d1'
const REACH = { removed: [sales('order')], cleared: [], accepted: [] }

describe('planDelete', () => {
  // The forms the cases below rest on offer what they say: the order on
  // both engines, a line on SQL Server, whose rowversion never repeats.
  test('the forms these tests use offer delete', () => {
    for (const bindings of [MS_DELETABLE, PG_DELETABLE, MS_LINES]) expect(bindings.operations.delete).toBe(true)
  })

  // Exactly the request an adapter receives: the key the token names, the
  // version the person read, the tenant's filter, no through, the root as
  // the reach, and the definition it was decided over -- nothing else, so
  // nothing a browser sent reaches SQL but the key and the version
  // (watched failing with the filters dropped, then with the throughs).
  test('asks for the named record at the version read, under the tenant filter, reaching the root alone', () => {
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, CLERK, ORDER_TOKEN, ROWVERSION, described(MS_FACTS, MS_DELETABLE))).toEqual({
      ok: true,
      request: {
        target: ORDER_TARGET.sqlserver,
        key: [value('id', INT64, ORDER_ID)],
        expectedVersion: ROWVERSION,
        filters: TENANT_ONE,
        through: [],
        reach: REACH,
        definition: DEFINITION,
      },
    })
    expect(planDelete(PG_FACTS, PG_DELETABLE, DELETE_ORDERS, CLERK, ORDER_TOKEN, '1', described(PG_FACTS, PG_DELETABLE))).toMatchObject({
      ok: true,
      request: { target: ORDER_TARGET.postgres, expectedVersion: '1', filters: TENANT_ONE },
    })
  })

  // A line has no tenant of its own: it exists for a delete only through an
  // order the tenant may reference (0043), as for an update.
  test("carries a line's through, beside its key and the version", () => {
    expect(planDelete(MS_FACTS, MS_LINES, DELETE_LINES, CLERK, `k1:${ORDER_ID},1`, ROWVERSION, described(MS_FACTS, MS_LINES))).toMatchObject({
      ok: true,
      request: {
        key: [value('order_id', INT64, ORDER_ID), value('line_no', INT32, '1')],
        filters: { kind: 'unrestricted' },
        through: [{ columns: [{ name: 'order_id', type: INT64 }], target: sales('order'), targetColumns: [{ name: 'id', type: INT64 }], filters: TENANT_ONE }],
        reach: { removed: [sales('order_line')], cleared: [], accepted: [] },
      },
    })
  })

  // Who may act is decided before anything about the form or the record:
  // the auditor, granted no delete, is refused as such whatever the form
  // offers, and so is a clerk on a form whose policy grants delete to nobody.
  test('the policy refuses before the form says it offers no delete', () => {
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, AUDITOR, ORDER_TOKEN, ROWVERSION, described(MS_FACTS, MS_DELETABLE))).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(planDelete(MS, MS_ORDER, ORDER_POLICY, CLERK, ORDER_TOKEN, ROWVERSION, described(MS, MS_ORDER))).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, { ...CLERK, attributes: {} }, ORDER_TOKEN, ROWVERSION, described(MS_FACTS, MS_DELETABLE))).toMatchObject({
      ok: false,
      code: 'missing-attribute',
    })
  })

  // A hand edit can say delete where the generator never would: with no
  // token the version proves nothing, and over a snapshot that does not
  // record whether its account may delete, the generator's own rule says no.
  test('refuses bindings that offer a delete their token or their snapshot cannot back', () => {
    const tokenless = edited(MS_DELETABLE, (draft) => {
      draft.concurrency = null
    })
    expect(planDelete(MS_FACTS, tokenless, DELETE_ORDERS, CLERK, ORDER_TOKEN, ROWVERSION, described(MS_FACTS, tokenless))).toMatchObject({ ok: false, code: 'operation-unavailable' })
    const claimed = edited(MS_ORDER, (draft) => {
      draft.operations.delete = true
    })
    expect(planDelete(MS, claimed, DELETE_ORDERS, CLERK, ORDER_TOKEN, ROWVERSION, described(MS, claimed))).toMatchObject({
      ok: false,
      code: 'invalid-bindings',
      message: expect.stringMatching(/taken before it recorded whether its account may delete/),
    })
  })

  // The generator's rule over a key a default fills, asked again of the
  // bindings' own snapshot (0057): an order keyed by a uuid that
  // gen_random_uuid() fills is planned on PostgreSQL, over its version
  // column, by the snapshot's own engine; the same claim over a key whose
  // default is a constant, or over one a foreign key includes, which a
  // lookup writes, is a hand edit the planner refuses (watched failing with
  // the planner asking SQL Server's rule of the PostgreSQL snapshot: the
  // first was refused; and with the foreign keys not asked: the last was
  // planned).
  test("plans a delete over a key of one column the engine's never-repeating default fills, and refuses one over a constant or a foreign key", () => {
    const keyed = (expression: string, referring = false) =>
      factsSnapshot('postgres', (objects) => {
        const order = objects.find((object) => object.ref.name === 'order')
        const id = order?.columns.find((candidate) => candidate.name === 'id')
        if (id !== undefined) Object.assign(id, { databaseType: 'uuid', type: { kind: 'uuid' }, generated: 'none', hasDefault: true, defaultExpression: expression })
        if (referring) {
          order?.foreignKeys.push({ name: 'fk_order_parent', columns: ['id'], references: { table: { schema: 'sales', name: 'order' }, columns: ['id'] }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true })
        }
      })
    const token = 'k1:1d3e5a70-9c2b-4f61-8e44-3c0a7d9b2e51'
    const drawn = keyed('gen_random_uuid()')
    const bindings = orderForm(drawn).bindings
    expect(bindings.operations.delete).toBe(true)
    expect(planDelete(drawn, bindings, DELETE_ORDERS, CLERK, token, '1', described(drawn, bindings))).toMatchObject({ ok: true, request: { key: [{ name: 'id', value: '1d3e5a70-9c2b-4f61-8e44-3c0a7d9b2e51' }], expectedVersion: '1' } })
    const constant = keyed("'2b7e1516-28ae-4d2a-a6f7-15880945cf4f'::uuid")
    const claimed = edited(orderForm(constant).bindings, (draft) => {
      draft.operations.delete = true
    })
    expect(planDelete(constant, claimed, DELETE_ORDERS, CLERK, token, '1', described(constant, claimed))).toMatchObject({
      ok: false,
      code: 'invalid-bindings',
      message: expect.stringMatching(/a key of one column that gen_random_uuid\(\) fills and no foreign key includes/),
    })
    const referred = keyed('gen_random_uuid()', true)
    const over = edited(orderForm(referred).bindings, (draft) => {
      draft.operations.delete = true
    })
    expect(planDelete(referred, over, DELETE_ORDERS, CLERK, token, '1', described(referred, over))).toMatchObject({ ok: false, code: 'invalid-bindings' })
  })

  // A key no token can carry addresses nothing to delete.
  test('refuses a form whose key no token can carry', () => {
    const stamped = factsSnapshot('sqlserver', (objects) => {
      const order = objects.find((object) => object.ref.name === 'order')
      if (order === undefined) return
      order.columns.push({ ...order.columns[3], name: 'created_at', ordinal: 13, type: { kind: 'timestamp', withTimeZone: true, precision: 6 }, databaseType: 'datetimeoffset' } as never)
      order.primaryKey = { name: 'pk_order', columns: ['created_at'] }
    })
    const bindings = orderForm(stamped).bindings
    expect(bindings.operations.delete).toBe(true)
    expect(planDelete(stamped, bindings, DELETE_ORDERS, CLERK, ORDER_TOKEN, ROWVERSION, described(stamped, bindings))).toMatchObject({ ok: false, code: 'operation-unavailable' })
  })

  // A line form published before 0043 scoped nothing of its own rows:
  // validatePolicy refuses a delete on it, so the planner, which fits the
  // policy before anything, refuses it as an invalid policy.
  test('refuses a delete whose rows nothing scopes while a lookup is filtered', () => {
    const unscoped: FormPolicy = { ...DELETE_LINES, through: [] }
    expect(planDelete(MS_FACTS, MS_LINES, unscoped, CLERK, `k1:${ORDER_ID},1`, ROWVERSION, described(MS_FACTS, MS_LINES))).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/nothing scopes the records of this form/),
    })
  })

  // What a delete also does is the policy's, by the publish check's own
  // function: a key that cascades from the root refuses the grant here too,
  // reached only by a bundle the read check would refuse.
  test('refuses a policy that grants delete while another table cascades from the root', () => {
    const cascading = factsSnapshot('sqlserver', (objects) => {
      const key = objects.find((object) => object.ref.name === 'order_line')?.foreignKeys.find((candidate) => candidate.name === 'fk_order_line_order')
      if (key !== undefined) key.onDelete = 'cascade'
    })
    const bindings = orderForm(cascading).bindings
    expect(planDelete(cascading, bindings, DELETE_ORDERS, CLERK, ORDER_TOKEN, ROWVERSION, described(cascading, bindings))).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/deleting a record of sales\.order also deletes rows of sales\.order_line \(fk_order_line_order, ON DELETE CASCADE\)/),
    })
  })

  // The database as this request described it: a key gone stops delete as
  // it stops update, with the delete's own sentence.
  test('refuses drift when the description stops delete, after the policy and before the token and the version', () => {
    const description = described(MS_FACTS, MS_DELETABLE)
    const keyless: DescribedTable = { ...description, primaryKey: null }
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, CLERK, 'not a token', 'not a version', keyless)).toMatchObject({
      ok: false,
      code: 'drift',
      message: DELETE_REFUSED,
      drift: [{ kind: 'identity-key-changed' }],
    })
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, AUDITOR, ORDER_TOKEN, ROWVERSION, keyless)).toMatchObject({ ok: false, code: 'operation-denied' })
  })

  // A token that is not this form's names no record; a version this
  // target's token could never be is not one a person read (watched failing
  // with versionFits removed: the stray version was planned).
  test('refuses a token that names no record of this form, and a version this token could never be', () => {
    const description = described(MS_FACTS, MS_DELETABLE)
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, CLERK, 'k1:x', ROWVERSION, description)).toMatchObject({ ok: false, code: 'invalid-record-token' })
    expect(planDelete(MS_FACTS, MS_DELETABLE, DELETE_ORDERS, CLERK, ORDER_TOKEN, '1', description)).toMatchObject({ ok: false, code: 'invalid-version' })
    expect(planDelete(PG_FACTS, PG_DELETABLE, DELETE_ORDERS, CLERK, ORDER_TOKEN, ROWVERSION, described(PG_FACTS, PG_DELETABLE))).toMatchObject({ ok: false, code: 'invalid-version' })
    expect(planDelete(PG_FACTS, PG_DELETABLE, DELETE_ORDERS, CLERK, ORDER_TOKEN, 7 as unknown as string, described(PG_FACTS, PG_DELETABLE))).toMatchObject({ ok: false, code: 'invalid-version' })
  })
})
