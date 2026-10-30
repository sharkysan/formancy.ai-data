import { describe, expect, test } from 'vitest'
import { planCreate, planUpdate } from './plan.js'
import type { FormRecord } from './plan-types.js'
import { planSupersede } from './supersede.js'
import { AMOUNT, AUDITOR, CLERK, column, DATE, DEFINITION, described, INT32, orderForm, ORDER_POLICY, ORDER_TOKEN, sales, snapshot, TENANT_ONE, text, value } from './test-support.js'
import { priced, priceForm, PRICE_POLICY } from './test-versions.js'
import { recordToken } from './token.js'

/*
 * A change from a date planned (0113): the open version ended where the
 * next one starts, under everything an update of it is guarded by, and the
 * next version decoded as a create of it is -- or why not. And the two
 * guards a form over versions adds to its create and its update.
 */

const PG = priced('postgres')
const PRICE = priceForm(PG).bindings
const encoded = recordToken(['tenant_id', 'product_no', 'valid_from'], { tenant_id: '1', product_no: '7', valid_from: '2026-01-01' })
if (!encoded.ok) throw new Error(encoded.message)
const TOKEN = encoded.token

/** The open version as the clerk read it, at version 1: the price from New Year, open. */
const asRead = (changes: FormRecord['answers'] = {}, version = '1'): FormRecord => ({
  record: TOKEN,
  version,
  answers: { tenant_id: 1, product_no: 7, valid_from: '2026-01-01', valid_to: null, amount: '9.5000', note: null, ...changes },
})
const NEXT = { valid_from: '2026-07-01', amount: '10.0000', note: 'summer' }
/** The change planned; `null` for a version that could not be read. */
const change = (answers: Record<string, unknown> = NEXT, read: FormRecord | null = asRead(), who = CLERK, version = '1', bindings = PRICE) =>
  planSupersede(PG, bindings, PRICE_POLICY, who, TOKEN, version, answers, read ?? undefined, described(PG, bindings))

describe('a change from a date', () => {
  // The open version, located by its key, the clerk's tenant and the version
  // read, is ended where the next one starts; the next one carries the
  // person's answers and its start, and its chain's key is the row's, never
  // an answer -- the tenant among it, so it is no pinned value either.
  // Watched failing with the pinned tenant kept among the next version's
  // values: the request wrote it beside the chain it copies.
  test('ends the open version where the next one starts, and carries the next one', () => {
    expect(change()).toEqual({
      ok: true,
      request: {
        target: { table: sales('price'), identity: [column('tenant_id', INT32), column('product_no', INT32), column('valid_from', DATE)], concurrency: { kind: 'version-column', column: 'row_version' } },
        key: [value('tenant_id', INT32, '1'), value('product_no', INT32, '7'), value('valid_from', DATE, '2026-01-01')],
        expectedVersion: '1',
        filters: TENANT_ONE,
        through: [],
        ends: 'valid_to',
        start: value('valid_from', DATE, '2026-07-01'),
        chain: [column('tenant_id', INT32), column('product_no', INT32)],
        values: [value('amount', AMOUNT, '10.0000'), value('note', text(100), 'summer')],
        returning: [column('tenant_id', INT32), column('product_no', INT32), column('valid_from', DATE), column('valid_to', DATE), column('amount', AMOUNT), column('note', text(100))],
        definition: DEFINITION,
      },
      fields: ['tenant_id', 'product_no', 'valid_from', 'valid_to', 'amount', 'note'],
      memberships: [],
      moved: null,
    })
  })

  // Read at the version named, the open version decides: one that has
  // ended is refused, and a start not after the open one's is the person's
  // to correct. Read at another version, neither is decided from a row the
  // person never saw: the guarded write answers it stale. Watched failing
  // with the version left out of the condition: the later read refused the
  // change as ended.
  test('refuses an ended version and a start not after the open one, as read at the version named', () => {
    expect(change(NEXT, asRead({ valid_to: '2026-06-01' }))).toMatchObject({ ok: false, code: 'version-ended' })
    for (const start of ['2026-01-01', '2025-12-31']) {
      expect(change({ ...NEXT, valid_from: start }), start).toMatchObject({ ok: false, code: 'invalid-values', fieldErrors: [{ field: 'valid_from', code: 'not-after' }] })
    }
    expect(change(NEXT, asRead({ valid_to: '2026-06-01' }, '2'))).toMatchObject({ ok: true })
    expect(change({ amount: '10.0000' })).toMatchObject({ ok: false, code: 'invalid-values', fieldErrors: [{ field: 'valid_from', code: 'required' }] })
  })

  // The chain and the end are the server's. A renderer submits every field,
  // so a copy of the version echoes both: equal to it, and the end empty,
  // they are dropped; another product, or an end, is over-posting -- no
  // change starts another product's chain or a version already ended.
  // Watched failing with the chain's key left out of the check: the change
  // was planned, product 8 among the next version's values.
  test('drops an echo of the chain’s key and of the empty end, and refuses another', () => {
    const echoed = change({ ...NEXT, tenant_id: 1, product_no: 7, valid_to: '' })
    expect(echoed).toMatchObject({ ok: true })
    expect(echoed.ok && echoed.request.values.map((entry) => entry.name)).toEqual(['amount', 'note'])
    expect(change({ ...NEXT, product_no: 8 })).toMatchObject({ ok: false, code: 'over-posting' })
    expect(change({ ...NEXT, valid_to: '2026-12-31' })).toMatchObject({ ok: false, code: 'over-posting' })
  })

  // Without the version as read, or without its start and end in it, the
  // change cannot be decided; one role is asked for both update and create;
  // a form over records of their own offers none.
  test('is refused without the version as read, without both operations, and on a form with no chain', () => {
    expect(change(NEXT, null)).toMatchObject({ ok: false, code: 'record-not-read' })
    expect(change(NEXT, { ...asRead(), answers: { amount: '9.5000' } })).toMatchObject({ ok: false, code: 'field-denied' })
    expect(change(NEXT, asRead(), AUDITOR)).toMatchObject({ ok: false, code: 'operation-denied' })
    const updater = { ...PRICE_POLICY, operations: { ...PRICE_POLICY.operations, create: [] } }
    expect(planSupersede(PG, PRICE, updater, CLERK, TOKEN, '1', NEXT, asRead(), described(PG, PRICE))).toMatchObject({ ok: false, code: 'operation-denied' })
    const order = orderForm(snapshot('postgres')).bindings
    expect(planSupersede(snapshot('postgres'), order, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', {}, undefined, described(snapshot('postgres'), order))).toMatchObject({ ok: false, code: 'operation-unavailable' })
  })
})

describe('a form over versions', () => {
  // A create starts a chain, so it holds only where its key has no version;
  // an update holds only while its version is open. Both are the
  // statement's to enforce: the request says what. A form over records of
  // their own carries neither. Watched failing with `fresh` left off, and
  // with `open`: the create's request said nothing of the chain, the
  // update's nothing of the end.
  test('guards its create to a new chain and its update to the open version', () => {
    const created = planCreate(PG, PRICE, PRICE_POLICY, CLERK, { product_no: 7, valid_from: '2026-01-01', amount: '9.5000' }, described(PG, PRICE))
    expect(created).toMatchObject({ ok: true, request: { fresh: ['tenant_id', 'product_no'] } })
    const updated = planUpdate(PG, PRICE, PRICE_POLICY, CLERK, TOKEN, '1', { amount: '9.9000' }, asRead(), described(PG, PRICE))
    expect(updated).toMatchObject({ ok: true, request: { open: 'valid_to' } })
    const order = orderForm(snapshot('postgres')).bindings
    const plain = planUpdate(snapshot('postgres'), order, ORDER_POLICY, CLERK, ORDER_TOKEN, '1', { notes: 'x' }, undefined, described(snapshot('postgres'), order))
    expect(plain.ok && Object.hasOwn(plain.request, 'open')).toBe(false)
  })
})
