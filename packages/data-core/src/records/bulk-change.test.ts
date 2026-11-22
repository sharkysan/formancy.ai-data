import { describe, expect, test } from 'vitest'
import { authorizeBulk, bulkOffered } from '../policy/evaluate.js'
import type { FormPolicy } from '../policy/types.js'
import { bulkAnswers, readChangeBody } from './bulk.js'
import { planUpdate } from './plan.js'
import { audited, auditedForm, AUDITED_POLICY, signedIn } from './test-stamps.js'
import { actor, AUDITOR, CLERK, described, ORDER_POLICY, ORDER_TOKEN, PG, PG_ORDER } from './test-support.js'

/*
 * What is decided once for a request that changes the chosen records of a
 * page (0175), before any record is read: the body's shape, who may send
 * one -- a role of `bulk.update` that may update, scoped as an update is --
 * and the answers, the same for every record: held to the grant's fields
 * and to the over-posting check, and decoded once, as `planUpdate` decodes
 * them. What depends on the record -- its state's move among it -- stays
 * `planUpdate`'s, over each record's own read.
 */

/** Clerks change the chosen orders' status, amount, notes, customer and employee together; the order's moves are placed to shipped, the clerk's. */
const CHANGING: FormPolicy = {
  ...ORDER_POLICY,
  transitions: {
    field: 'status',
    moves: [
      { from: null, to: 'placed', roles: ['clerk'] },
      { from: 'placed', to: 'shipped', roles: ['clerk'] },
    ],
  },
  bulk: { update: { roles: ['clerk'], fields: ['amount', 'status', 'notes', 'customer', 'employee'] } },
}

const records = [{ record: ORDER_TOKEN, version: '1' }]

describe('readChangeBody', () => {
  // A change is the records a delete of them would name and the answers
  // each takes, an object of field keys; anything else is no change to
  // plan, refused before the write id is read. The records are held to a
  // page by the delete's own reader. Watched failing with `answers` left
  // unchecked: a body without them was read as a change of nothing.
  test('reads { records, answers }, and refuses a body without answers that are an object', () => {
    expect(readChangeBody({ records, answers: { notes: 'x' }, extra: 1 })).toEqual({ ok: true, body: { records, answers: { notes: 'x' } } })
    const shape = { ok: false, code: 'invalid-request', message: 'Expected { records: [{ record, version }], answers }.' }
    for (const body of [{ records }, { records, answers: null }, { records, answers: [] }, { records, answers: 'notes' }, { answers: {} }, null])
      expect(readChangeBody(body)).toEqual(shape)
    expect(readChangeBody({ records: [], answers: {} })).toMatchObject({ code: 'invalid-request', message: expect.stringMatching(/from 1 to 50 records/) })
  })
})

describe('authorizeBulk and bulkOffered for a change', () => {
  // Absent, the grant is nobody's: the clerk, who may update one record,
  // may not change a page of them, and a delete's grant grants no change.
  // A role the grant names, whose context scopes the update, is let
  // through; another, or a context with no tenant, is refused with its
  // own reason. Watched failing with `bulk.delete`'s roles asked for a
  // change: the clerk granted deletes was let through to change records.
  test('lets through a role of bulk.update that may update, and no other', () => {
    expect(authorizeBulk(ORDER_POLICY, CLERK, PG_ORDER, 'update')).toEqual({
      ok: false,
      code: 'operation-denied',
      message: 'no role of this actor may change chosen records together with this form',
    })
    const deleting = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['clerk'] }, bulk: { delete: { roles: ['clerk'] } } }
    const deletable = { ...PG_ORDER, operations: { ...PG_ORDER.operations, delete: true } }
    expect(authorizeBulk(deleting, CLERK, deletable, 'update')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(authorizeBulk(CHANGING, CLERK, PG_ORDER, 'update')).toEqual({ ok: true })
    expect(authorizeBulk(CHANGING, CLERK, PG_ORDER, 'delete')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(authorizeBulk(CHANGING, AUDITOR, PG_ORDER, 'update')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(authorizeBulk(CHANGING, actor(['clerk'], {}), PG_ORDER, 'update')).toMatchObject({ ok: false, code: 'missing-attribute' })
  })

  // What a page offers is the grant's fields this person may write on
  // update, in the form's order, by the over-posting check itself -- never
  // the grant's list as written -- and `null` where they may change none.
  // Watched failing with the grant's own order: amount came before status.
  test("offers the grant's fields in the form's order, and null to a person who may change none", () => {
    expect(bulkOffered(CHANGING, CLERK, PG_ORDER)).toEqual({ delete: false, update: ['customer', 'status', 'amount', 'notes', 'employee'] })
    expect(bulkOffered(CHANGING, AUDITOR, PG_ORDER)).toEqual({ delete: false, update: null })
    expect(bulkOffered(ORDER_POLICY, CLERK, PG_ORDER)).toEqual({ delete: false, update: null })
    const nothing = { ...CHANGING, bulk: { update: { roles: ['clerk'], fields: [] } } }
    expect(bulkOffered(nothing, CLERK, PG_ORDER)).toEqual({ delete: false, update: null })
  })
})

describe('bulkAnswers', () => {
  const answers = (sent: Record<string, unknown>, who = CLERK, policy = CHANGING) => bulkAnswers(PG, PG_ORDER, policy, who, sent)

  // A field the grant does not list is no field of a change of chosen
  // records, however freely the clerk updates it alone: over-posting, for
  // the request, before any record is read. A grant listing a field the
  // clerk may not write is no policy the over-posting check can fit, and
  // the request is refused as that policy is, nothing decoded; no answers
  // at all change nothing. Watched failing with the grant's fields not
  // asked: the order date of every chosen record was changed.
  test('refuses a field outside the grant as over-posting, and answers a grant the policy cannot hold refused', () => {
    expect(answers({ order_date: '2026-11-22', notes: 'x' })).toEqual({
      ok: false,
      code: 'over-posting',
      message: 'order_date is not changed in chosen records together with this form',
    })
    expect(answers({ group: 'A', order_date: '2026-11-22' })).toMatchObject({
      message: 'group, order_date are not changed in chosen records together with this form',
    })
    const unwritten = { ...CHANGING, fields: { ...CHANGING.fields, notes: { read: ['clerk'], write: [] } } }
    expect(bulkAnswers(PG, PG_ORDER, unwritten, CLERK, { notes: 'x' })).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/bulk\.update\.fields: notes is not one clerk may write/),
    })
    expect(answers({})).toEqual({
      ok: false,
      code: 'nothing-to-update',
      message: 'These answers change no field: a change of chosen records names at least one.',
    })
  })

  // Every answer goes through its column's codec once, for the request:
  // a value no codec takes is 422 with every field's error, never fifty
  // requests' worth of the same refusal after fifty reads. `null` clears a
  // column that may be NULL, and is `required` where it may not; a token
  // of another tenant's customer is no option, as the update alone says.
  // Watched failing with `invalid` returned for the first error alone:
  // the amount's error hid the customer's.
  test('decodes every answer once, and refuses the request with every error', () => {
    expect(answers({ amount: '12.5', notes: null, status: 'shipped' })).toEqual({ ok: true, memberships: [] })
    expect(answers({ amount: 'twelve', customer: 'k1:2,1001', notes: null })).toEqual({
      ok: false,
      code: 'invalid-values',
      message: 'customer, amount cannot be written',
      fieldErrors: [
        { field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' },
        expect.objectContaining({ field: 'amount' }),
      ],
    })
    expect(answers({ amount: null })).toMatchObject({ code: 'invalid-values', fieldErrors: [expect.objectContaining({ field: 'amount' })] })
  })

  // Each selection is a membership check the route runs once for the
  // request -- the customer under its tenant, as the update alone checks
  // it -- since neither the token nor the filter depends on the record.
  // Watched failing with the selections dropped: no check was returned.
  test('returns one membership check per selection, under the lookup filter of an update', () => {
    const decided = answers({ customer: 'k1:1,1001', employee: 'k1:7', notes: 'x' })
    expect(decided.ok).toBe(true)
    const checks = decided.ok ? decided.memberships : []
    expect(checks.map(({ field, tokens }) => ({ field, tokens }))).toEqual([
      { field: 'customer', tokens: ['k1:1,1001'] },
      { field: 'employee', tokens: ['k1:7'] },
    ])
    expect(checks[0]?.filters).toEqual({
      kind: 'restricted',
      equal: [{ column: 'tenant_id', type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, value: '1' }],
    })
  })

  // What a change stamps (0153) is the signed-in person's, the same for
  // every record, so a person whose id the stamped column cannot hold is
  // refused for the request, once, before any record is read -- not fifty
  // times over, each record's update `unstampable` in turn. Watched
  // failing with the stamps left to each record's plan: the request was
  // decided `{ ok: true }`.
  test('refuses the request for a stamp the signed-in person cannot fill', () => {
    const source = audited('postgres')
    const { bindings } = auditedForm(source)
    const stamping: FormPolicy = { ...AUDITED_POLICY, bulk: { update: { roles: ['clerk'], fields: ['note'] } } }
    expect(bulkAnswers(source, bindings, stamping, signedIn('bob'), { note: 'x' })).toEqual({ ok: true, memberships: [] })
    expect(bulkAnswers(source, bindings, stamping, signedIn('b'.repeat(41)), { note: 'x' })).toEqual({
      ok: false,
      code: 'unstampable',
      message: "changed_by cannot hold the signed-in person's id: At most 40 characters, counting an emoji as two.",
    })
  })

  // The state field may be changed together: what is decided once has no
  // record to move from, so it checks no move, and each record's is
  // `planUpdate`'s, from the state its own read holds (0127) -- the order
  // placed is shipped, the one delivered may not move back, the one
  // already shipped moves nothing. Watched failing with the request's
  // answers checked as a move from nothing, a create's: every change of
  // status was refused before any record was read.
  test('checks no move itself, and leaves each record its own, from its own state', () => {
    expect(answers({ status: 'shipped' })).toEqual({ ok: true, memberships: [] })
    const read = (status: string) => ({ record: ORDER_TOKEN, version: '1', answers: { id: '9007199254740993', status, notes: null } })
    const each = (status: string) => planUpdate(PG, PG_ORDER, CHANGING, CLERK, ORDER_TOKEN, '1', { status: 'shipped' }, read(status), described(PG, PG_ORDER))
    expect(each('placed')).toMatchObject({ ok: true, moved: true })
    expect(each('delivered')).toMatchObject({ ok: false, code: 'transition-denied' })
    expect(each('shipped')).toMatchObject({ ok: true, moved: false })
  })
})
