import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import { encodeKeyToken } from '../lookup/token.js'
import type { NormalizedType } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { toFormAnswers } from './answers.js'
import { planCreate } from './plan.js'
import { CLERK, CLERK_RW, CUSTOMER_POLICY, customerSource, sales, snapshot, text } from './test-support.js'
import { decodeRecordKey, intendedRecord, recordToken } from './token.js'
import type { InsertRequest, RecordColumn, RecordValue } from './types.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }

/** sales.order is named by a bigint identity; sales.customer by its tenant and its number. */
const ORDER: RecordColumn[] = [{ name: 'id', type: INT64 }]
const CUSTOMER: RecordColumn[] = [
  { name: 'tenant_id', type: INT32 },
  { name: 'customer_no', type: INT32 },
]

/** 2^53 + 1, the fixture's sales.order.id: the first integer a JavaScript number cannot hold. */
const BEYOND_SAFE = '9007199254740993'

describe('recordToken', () => {
  // A record is addressed with the encoding lookups use (0012), so a
  // composite key travels as one unambiguous string and an integer key reads
  // as itself in a log.
  test('is the key token of the identity values, in key order', () => {
    expect(recordToken(['id'], { id: BEYOND_SAFE, notes: 'x' })).toEqual({ ok: true, token: `k1:${BEYOND_SAFE}` })
    expect(recordToken(['tenant_id', 'customer_no'], { customer_no: '1001', tenant_id: '1' })).toEqual({ ok: true, token: 'k1:1,1001' })
  })

  // A nullable unique key can hold NULL, and `WHERE k = NULL` matches
  // nothing: such a record has no address. Spelling the NULL as "null" — what
  // String() does — would address a record whose key is the text "null". A
  // number is not a canonical key value either; its digits may already have
  // been rounded.
  test('refuses an identity value that is NULL, missing or not text, rather than spelling it', () => {
    expect(recordToken(['id'], { id: null })).toMatchObject({ ok: false, code: 'no-value' })
    expect(recordToken(['id'], {})).toMatchObject({ ok: false, code: 'no-value' })
    expect(recordToken(['id'], { id: 9007199254740992 })).toMatchObject({ ok: false, code: 'no-value' })
    expect(recordToken([], { id: '1' })).toMatchObject({ ok: false, code: 'no-value' })
  })

  // `constructor` is on every object's prototype. A key column with that name
  // must be read from the record, never inherited.
  test('reads only the record’s own values', () => {
    expect(recordToken(['constructor'], {})).toMatchObject({ ok: false, code: 'no-value' })
  })

  // Refused rather than truncated, as a lookup's key is: a shortened token
  // would name another record, or none.
  test('refuses a key no token can carry', () => {
    expect(recordToken(['code'], { code: 'é'.repeat(40) })).toMatchObject({ ok: false, code: 'too-long' })
  })
})

describe('decodeRecordKey', () => {
  // The key is bound from these strings. 2^53 + 1 bound as a JavaScript
  // number addresses a different row on both engines (0006, 0007), so the
  // value stays the decimal string it was.
  test('decodes a token into the identity’s columns with their types, values as strings', () => {
    expect(decodeRecordKey(ORDER, `k1:${BEYOND_SAFE}`)).toEqual({ ok: true, key: [{ name: 'id', type: INT64, value: BEYOND_SAFE }] })
    expect(decodeRecordKey(CUSTOMER, 'k1:1,1001')).toEqual({
      ok: true,
      key: [
        { name: 'tenant_id', type: INT32, value: '1' },
        { name: 'customer_no', type: INT32, value: '1001' },
      ],
    })
  })

  // A token is untrusted input. One with a value too few would leave a key
  // column unbound — an adapter that bound `undefined` as NULL would match
  // nothing on one engine and fail on the other; one too many would be
  // quietly cut.
  test('refuses a token that is not one value per key column', () => {
    expect(decodeRecordKey(CUSTOMER, 'k1:1')).toMatchObject({ ok: false, code: 'wrong-length' })
    expect(decodeRecordKey(CUSTOMER, 'k1:1,1001,9')).toMatchObject({ ok: false, code: 'wrong-length' })
    expect(decodeRecordKey(ORDER, 'k1:1,1001')).toMatchObject({ ok: false, code: 'wrong-length' })
  })

  // Only a value spelled as the column holds it can name a record. `1e3` is a
  // numeric to PostgreSQL and a conversion error to SQL Server; `007` is 7 to
  // both engines and a different token, so two tokens would name one record;
  // past the column's range is an error on both.
  test('refuses a value its key column cannot hold in that spelling', () => {
    for (const value of ['abc', '1e3', '007', '-0', '+7', ' 7', '1.0', '', '9223372036854775808']) {
      const token = encodeKeyToken([value])
      if (!token.ok) throw new Error(token.message)
      expect(decodeRecordKey(ORDER, token.token), value).toMatchObject({ ok: false, code: 'not-canonical' })
    }
  })

  // The token's own grammar, version and length are the lookup decoder's,
  // unchanged: one encoding, one set of refusals.
  test('refuses what the key-token decoder refuses', () => {
    expect(decodeRecordKey(ORDER, 'garbage')).toMatchObject({ ok: false, code: 'not-a-token' })
    expect(decodeRecordKey(ORDER, 'k2:7')).toMatchObject({ ok: false, code: 'unsupported-version' })
    expect(decodeRecordKey(ORDER, 'k1:~0037')).toMatchObject({ ok: false, code: 'malformed' })
    expect(decodeRecordKey(ORDER, 7 as unknown as string)).toMatchObject({ ok: false, code: 'not-text' })
  })

  // A key of a kind with no settled spelling — a timestamp, a float, a
  // boolean — has no token both engines would read alike, so a record keyed
  // by one cannot be addressed at all; and a form with no identity has
  // nothing to decode into.
  test('refuses to address a record whose key has no settled spelling, or that has no key', () => {
    expect(decodeRecordKey([{ name: 'at', type: { kind: 'timestamp', withTimeZone: true, precision: 6 } }], 'k1:2026')).toMatchObject({
      ok: false,
      code: 'not-addressable',
    })
    expect(decodeRecordKey([], 'k1:')).toMatchObject({ ok: false, code: 'not-addressable' })
  })

  // Whatever the token held, a message never repeats it: it is input from a
  // browser and lands in a log.
  test('never echoes the token in a message', () => {
    const outcome = decodeRecordKey(ORDER, 'k1:secret')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).not.toContain('secret')
  })
})

describe('intendedRecord', () => {
  const insert = (identity: readonly RecordColumn[], values: readonly RecordValue[]): InsertRequest => ({
    target: { table: { schema: 'sales', name: 'customer' }, identity, concurrency: null },
    values,
    returning: [],
  })
  const tenant = { name: 'tenant_id', type: INT32, value: '1' }
  const number = { name: 'customer_no', type: INT32, value: '8' }

  // A customer is named by its tenant, pinned from the context, and a number
  // the person types: the insert names the whole key, so the host is told
  // which record a lost answer was about and can read it. Returning null here
  // would report a create the host could check as one nobody can.
  test('is the token of the key the insert names: a typed number and a pinned tenant', () => {
    expect(intendedRecord(insert(CUSTOMER, [tenant, number, { name: 'name', type: text(200), value: 'Neu GmbH' }]))).toBe('k1:1,8')
  })

  // Each of these would promise a token the stored row may not have. The
  // database numbers the order (the key is not in the insert); a NULL key
  // value addresses nothing (recordToken refuses it); a timestamp key has no
  // spelling both engines read alike; a number may already have been
  // rounded; and a key too long for a token is not shortened into another.
  test('is null when the database supplies the key, a value is NULL or not text, or the key has no settled spelling', () => {
    expect(intendedRecord(insert(ORDER, [tenant, { name: 'notes', type: text(null), value: 'x' }]))).toBeNull()
    expect(intendedRecord(insert(CUSTOMER, [tenant, { ...number, value: null }]))).toBeNull()
    expect(intendedRecord(insert(CUSTOMER, [tenant, { ...number, value: 8 as unknown as string }]))).toBeNull()
    const at: NormalizedType = { kind: 'timestamp', withTimeZone: true, precision: 6 }
    expect(intendedRecord(insert([{ name: 'at', type: at }], [{ name: 'at', type: at, value: '2026-10-09T12:00:00Z' }]))).toBeNull()
    const code = text(null)
    expect(intendedRecord(insert([{ name: 'code', type: code }], [{ name: 'code', type: code, value: 'é'.repeat(40) }]))).toBeNull()
    expect(intendedRecord(insert([], [tenant]))).toBeNull()
  })

  // The reconciling read looks the record up by this token, and the read
  // names the stored row by toFormAnswers' token: if the two spelled one key
  // differently -- a char(n) padded on one side (0028), a composite key in
  // another order -- the read would miss a row that is there, and the host
  // would offer to enter it again.
  test('equals the token toFormAnswers gives the stored row, for a composite key and a char(n) key', () => {
    const customers = customerSource()
    const customer = generateForm(customers, { connection: 'erp', root: sales('customer'), formId: 'c', title: 'Customer', lookups: [], pinned: ['tenant_id'] })
    const { country: _country, ...fields } = CUSTOMER_POLICY.fields
    const customerPolicy: FormPolicy = { ...CUSTOMER_POLICY, fields: { ...fields, country_code: CLERK_RW }, lookups: {} }
    expectSameToken(planCreate(customers, customer.bindings, customerPolicy, CLERK, { customer_no: 8, name: 'Neu GmbH' }), customer.bindings, 'k1:1,8')

    const coded = snapshot('postgres', (objects) => {
      const country = objects.find((object) => object.ref.name === 'country')
      if (country === undefined) throw new Error('the test snapshot has no country')
      country.primaryKey = { name: 'pk_country', columns: ['iso_code'] }
      country.uniqueKeys = []
    })
    const country = generateForm(coded, { connection: 'erp', root: sales('country'), formId: 'k', title: 'Country', lookups: [] })
    const countryPolicy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: [] },
      fields: { id: { read: ['clerk'], write: [] }, iso_code: { read: ['clerk'], write: ['clerk'] }, name: { read: ['clerk'], write: ['clerk'] } },
      rowFilters: [],
      lookups: {},
    }
    // One letter in a char(2): stored padded, read back without the pad on both engines.
    expectSameToken(planCreate(coded, country.bindings, countryPolicy, CLERK, { iso_code: 'C', name: 'Cee' }), country.bindings, 'k1:C')
  })
})

/** The planned insert's intended token, and the token of the row it would store, read back as an adapter reads it. */
function expectSameToken(plan: ReturnType<typeof planCreate>, bindings: Parameters<typeof toFormAnswers>[0], token: string): void {
  if (!plan.ok) throw new Error(`the create was not planned: ${plan.message}`)
  // What was written comes back as written; a column the insert left to the database comes back NULL here, which no key is.
  const written = new Map(plan.request.values.map((entry) => [entry.name, entry.value]))
  const stored = Object.fromEntries(plan.request.returning.map((column) => [column.name, written.get(column.name) ?? null]))
  const read = toFormAnswers(bindings, plan.fields, { ok: true, values: stored, version: null })
  expect({ intended: intendedRecord(plan.request), read: read.record }).toEqual({ intended: token, read: token })
}
