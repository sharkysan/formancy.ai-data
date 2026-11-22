import { describe, expect, test } from 'vitest'
import { DUPLICATE_RECORD } from '../actions/plan.js'
import { authorizeBulk, bulkOffered } from '../policy/evaluate.js'
import type { FormPolicy } from '../policy/types.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { chosenTwice, readBulkBody } from './bulk.js'
import { AUDITOR, CLERK, edited, INTAKE, MS_FACTS, MS_ORDER, ORDER_ID, ORDER_POLICY, ORDER_TOKEN, orderForm } from './test-support.js'

/*
 * What is decided once for a request that deletes the chosen records of a
 * page (0173), before any record is planned: the body's shape, held to a
 * page; no record named twice; and who may send one -- a role of the
 * policy's `bulk.delete` that may delete, scoped as a delete is. Each
 * record is then `planDelete`'s, which plan-delete.test.ts holds.
 */

const DELETABLE = orderForm(MS_FACTS).bindings
/** Clerks may delete orders; the auditor may read them, and nothing else. */
const DELETING: FormPolicy = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['clerk'] } }
/** And clerks delete chosen ones together. */
const BULK: FormPolicy = { ...DELETING, bulk: { delete: { roles: ['clerk'] } } }

const page = (count: number) => Array.from({ length: count }, (_, index) => ({ record: `k1:${String(index + 1)}`, version: '00000000000007d1' }))

describe('readBulkBody', () => {
  // A request is the chosen rows of the one page a list shows: one to a
  // page, never a number of its own, so a body past a page is refused
  // before any statement is sent. Watched failing with the bound taken
  // out: 51 records were read.
  test('reads one to a page of records, and refuses none or more', () => {
    expect(readBulkBody({ records: page(1) })).toEqual({ ok: true, body: { records: page(1) } })
    expect(readBulkBody({ records: page(LIST_PAGE_SIZE) })).toEqual({ ok: true, body: { records: page(LIST_PAGE_SIZE) } })
    const bound = { ok: false, code: 'invalid-request', message: 'A request names from 1 to 50 records: the chosen records of the page a list shows.' }
    expect(readBulkBody({ records: [] })).toEqual(bound)
    expect(readBulkBody({ records: page(LIST_PAGE_SIZE + 1) })).toEqual(bound)
  })

  // Each record is a token and the version its person read, as a single
  // delete's body is; anything else is no record to plan, and the whole
  // body is refused rather than the records that fit sent. What is read is
  // a copy of the two strings, nothing else of the entry.
  test('refuses a body that is not { records: [{ record, version }] }, and keeps only the two strings', () => {
    const shape = { ok: false, code: 'invalid-request', message: 'Expected { records: [{ record, version }] }.' }
    for (const body of [
      null,
      [],
      'records',
      {},
      { records: {} },
      { records: [{ record: 'k1:1' }] },
      { records: [{ record: 1, version: '1' }] },
      { records: [null] },
    ])
      expect(readBulkBody(body)).toEqual(shape)
    expect(readBulkBody({ records: [{ record: 'k1:1', version: '1', answers: { note: 'x' } }], answers: {} })).toEqual({
      ok: true,
      body: { records: [{ record: 'k1:1', version: '1' }] },
    })
  })
})

describe('chosenTwice', () => {
  // Two tokens of one key would send a second delete of one row, answered
  // `not-found` about a record its person chose, as if it had never
  // existed: refused before anything is sent, naming both positions, in a
  // selection's words (0165) -- whatever versions the two carry. Compared
  // by the decoded key, as a run's records are; a token has one spelling
  // of its key (`not-canonical` refuses any other), so `k1:07` is no
  // second spelling of `k1:7` but no token at all. Watched failing with
  // the check returning null: the page of three and a repeat passed.
  test('names the first two positions whose tokens are one key', () => {
    expect(chosenTwice(MS_FACTS, DELETABLE, [...page(3), { record: 'k1:2', version: '1' }])).toEqual({
      ok: false,
      code: 'duplicate-record',
      message: DUPLICATE_RECORD,
      records: [1, 3],
    })
    expect(
      chosenTwice(MS_FACTS, DELETABLE, [
        { record: ORDER_TOKEN, version: '1' },
        { record: ORDER_TOKEN, version: '2' },
      ]),
    ).toMatchObject({
      records: [0, 1],
    })
    expect(
      chosenTwice(MS_FACTS, DELETABLE, [
        { record: ORDER_TOKEN, version: '1' },
        { record: `k1:0${ORDER_ID}`, version: '1' },
      ]),
    ).toBeNull()
    expect(chosenTwice(MS_FACTS, DELETABLE, page(LIST_PAGE_SIZE))).toBeNull()
  })

  // A token that names no key of this form is that record's own refusal
  // when it is planned, `invalid-record-token`; bindings that cannot be
  // planned from refuse every record there. Neither is a duplicate.
  test('passes over a token that names no key, and bindings that cannot be planned', () => {
    expect(
      chosenTwice(MS_FACTS, DELETABLE, [
        { record: 'k1:x', version: '1' },
        { record: 'k1:x', version: '1' },
      ]),
    ).toBeNull()
    const drifted = edited(DELETABLE, (draft) => {
      draft.snapshotFingerprint = 'another'
    })
    expect(chosenTwice(MS_FACTS, drifted, [...page(1), ...page(1)])).toBeNull()
  })
})

describe('authorizeBulk and bulkOffered', () => {
  // Absent, the grant is nobody's, and a policy written before 0173 keeps
  // its meaning: the clerk, who may delete one record, may not send a page
  // of them. Watched failing with an absent grant read as every deleter's.
  test('is nobody, by default', () => {
    expect(authorizeBulk(DELETING, CLERK, DELETABLE)).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(bulkOffered(DELETING, CLERK, DELETABLE)).toEqual({ delete: false })
  })

  // A role the grant names, that may delete, whose context scopes the
  // delete: the clerk. The auditor and intake are refused, the grant being
  // the clerk's. Watched failing with the grant's roles not asked: the
  // auditor was let through to a request every record of which is refused.
  test('lets through a role the grant names, and no other', () => {
    expect(authorizeBulk(BULK, CLERK, DELETABLE)).toEqual({ ok: true })
    expect(bulkOffered(BULK, CLERK, DELETABLE)).toEqual({ delete: true })
    for (const actor of [AUDITOR, INTAKE]) {
      expect(authorizeBulk(BULK, actor, DELETABLE)).toEqual({
        ok: false,
        code: 'operation-denied',
        message: 'no role of this actor may delete chosen records together with this form',
      })
      expect(bulkOffered(BULK, actor, DELETABLE)).toEqual({ delete: false })
    }
  })

  // The grant narrows a delete, and widens nothing: a context that cannot
  // scope a delete cannot scope a page of them either, and is refused with
  // the delete's own reason rather than let through to a filter of nothing.
  // Watched failing with the row filter not resolved: the clerk with no
  // tenant was let through.
  test("refuses a context that cannot scope the delete, with the delete's reason", () => {
    expect(authorizeBulk(BULK, { ...CLERK, attributes: {} }, DELETABLE)).toMatchObject({ ok: false, code: 'missing-attribute' })
    expect(bulkOffered(BULK, { ...CLERK, attributes: {} }, DELETABLE)).toEqual({ delete: false })
  })

  // The policy is fitted to the form first: a grant on a form that offers
  // no delete, or to a role that may not delete, is no grant anybody
  // holds -- refused as the policy that says it, never let through.
  test('refuses a grant the policy cannot fit to the form', () => {
    expect(MS_ORDER.operations.delete).not.toBe(true)
    expect(authorizeBulk(BULK, CLERK, MS_ORDER)).toMatchObject({ ok: false, code: 'invalid-policy' })
    expect(authorizeBulk({ ...BULK, operations: { ...BULK.operations, delete: [] } }, CLERK, DELETABLE)).toMatchObject({
      ok: false,
      code: 'invalid-policy',
      message: expect.stringMatching(/bulk\.delete grants clerk, who may not delete with this form/),
    })
  })
})
