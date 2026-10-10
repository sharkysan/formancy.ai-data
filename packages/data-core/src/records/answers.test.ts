import { createFormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import type { DatabaseKind } from '../adapter.js'
import type { ApiValue } from '../codecs/codec.js'
import { generateForm } from '../generate/generate.js'
import { toFormAnswers } from './answers.js'
import { planCreate, planRead, planUpdate } from './plan.js'
import {
  ANSWERS as CLERK_ANSWERS,
  CLERK,
  CLERK_FIELDS as ALL_FIELDS,
  col,
  described,
  edited,
  fk,
  ORDER_ID,
  ORDER_POLICY as POLICY,
  ORDER_TOKEN,
  orderForm,
  PG,
  sales,
  snapshot,
  table,
  text,
} from './test-support.js'
import type { InsertRequest, RecordRead } from './types.js'

/** A stored order as an adapter returns it: every value canonical text or JSON, exactly as a codec would return it (0015). */
const STORED: Record<string, ApiValue> = {
  id: ORDER_ID,
  tenant_id: '1',
  customer_no: '1001',
  order_date: '2026-10-08',
  status: 'placed',
  amount: '99999999999999.9999',
  notes: null,
  group: 'A',
  created_by: '1',
  approved_by: '2',
  paid: true,
}

const read = (values: Record<string, ApiValue>, version: string | null = '1'): RecordRead => ({ ok: true, values, version })

const PG_FORM = orderForm(PG)

describe('toFormAnswers', () => {
  // Each answer in the shape its generated control holds: a lookup as the
  // token of its columns, the radio's 'true', a whole number a number field
  // can hold, and a bigint key and a decimal as the exact text they are.
  test('answers each readable field in its control’s shape, with the record token and version', () => {
    expect(toFormAnswers(PG_FORM.bindings, ALL_FIELDS, read(STORED))).toEqual({
      record: ORDER_TOKEN,
      version: '1',
      answers: {
        id: ORDER_ID,
        customer: 'k1:1,1001',
        order_date: '2026-10-08',
        status: 'placed',
        amount: '99999999999999.9999',
        notes: null,
        group: 'A',
        employee: 'k1:1',
        approved_by: 2,
        paid: 'true',
      },
    })
  })

  // A reference with any NULL column references nothing — under MATCH
  // SIMPLE a composite foreign key with one NULL is not checked — so the
  // select is empty, never a token holding half a key.
  test('answers a lookup with null when any of its columns is NULL', () => {
    const { answers } = toFormAnswers(PG_FORM.bindings, ALL_FIELDS, read({ ...STORED, created_by: null, customer_no: null }))
    expect(answers.employee).toBeNull()
    expect(answers.customer).toBeNull()
  })

  // The column has three states and the radio three answers: no answer is
  // NULL, never false.
  test('answers the three-state flag as the radio’s strings, or null', () => {
    const answer = (paid: ApiValue): ApiValue | undefined => toFormAnswers(PG_FORM.bindings, ALL_FIELDS, read({ ...STORED, paid })).answers.paid
    expect([answer(true), answer(false), answer(null)]).toEqual(['true', 'false', null])
  })

  // Whatever the record holds, a field the policy keeps from this actor is
  // not in the answers. The read should not have fetched it; this is the
  // second line, for a record that came back with more.
  test('leaves out every field the actor may not read', () => {
    expect(toFormAnswers(PG_FORM.bindings, ['order_date', 'customer'], read(STORED)).answers).toEqual({ order_date: '2026-10-08', customer: 'k1:1,1001' })
  })

  // A key no token can carry cannot be offered as an option. Answered with
  // null, a form that submitted its answers back would clear a reference the
  // person never touched; left out, an update leaves it as it is.
  test('leaves out a reference no token can carry, rather than answering null', () => {
    const tagged = snapshot('postgres', (objects) => {
      objects.push(table('tag', [col('code', 1, text(100)), col('label', 2, text(100))], { primaryKey: { name: 'pk_tag', columns: ['code'] } }))
      const order = objects.find((object) => object.ref.name === 'order')
      order?.columns.push(col('tag_code', 13, text(100), { nullable: true }))
      order?.foreignKeys.push(fk('fk_order_tag', ['tag_code'], 'tag', ['code']))
    })
    const { bindings } = generateForm(tagged, {
      connection: 'erp',
      root: sales('order'),
      formId: 'sales-order',
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_tag', display: ['label'] }],
      versionColumn: 'row_version',
    })
    const record = read({ ...STORED, tag_code: 'é'.repeat(40) })
    const { answers } = toFormAnswers(bindings, ['tag', 'notes'], record)
    expect(answers).toEqual({ notes: null })
    expect(Object.hasOwn(answers, 'tag')).toBe(false)
    expect(toFormAnswers(bindings, ['tag'], read({ ...STORED, tag_code: 'CH' })).answers).toEqual({ tag: 'k1:CH' })
  })

  // A record whose key is NULL — a nullable unique key can hold one — or a
  // form with no key has no address. "k1:null" would address the record
  // whose key is the text "null".
  test('gives no record token to a record without an address', () => {
    expect(toFormAnswers(PG_FORM.bindings, [], read({ ...STORED, id: null })).record).toBeNull()
    const keyless = edited(PG_FORM.bindings, (draft) => {
      draft.identity = null
    })
    expect(toFormAnswers(keyless, [], read(STORED)).record).toBeNull()
    expect(toFormAnswers(PG_FORM.bindings, [], read(STORED, null)).version).toBeNull()
  })

  // A record is canonical out (0015). One missing a column the plan asked
  // for, a whole number as a JavaScript number, or a flag as text is an
  // adapter's programming error, and is thrown rather than shown as an
  // answer a person would save back.
  test('throws on a record that is not what the plan asked for, canonical', () => {
    const { id: _id, ...withoutId } = STORED
    expect(() => toFormAnswers(PG_FORM.bindings, ['id'], read(withoutId))).toThrow('the adapter did not return a column the plan asked for')
    expect(() => toFormAnswers(PG_FORM.bindings, ['approved_by'], read({ ...STORED, approved_by: 2 }))).toThrow('canonical whole number')
    expect(() => toFormAnswers(PG_FORM.bindings, ['approved_by'], read({ ...STORED, approved_by: '02' }))).toThrow('canonical whole number')
    expect(() => toFormAnswers(PG_FORM.bindings, ['paid'], read({ ...STORED, paid: 'true' }))).toThrow('boolean')
    expect(() => toFormAnswers(PG_FORM.bindings, ['employee'], read({ ...STORED, created_by: 1 }))).toThrow('not text')
  })

  // A field key is a column name made safe for CEL, and `__proto__` is one.
  // Assigned to a plain object it would set the prototype and vanish from
  // the answers.
  test('keeps a field called __proto__ as an answer', () => {
    const renamed = edited(PG_FORM.bindings, (draft) => {
      const group = draft.fields.find((binding) => binding.field === 'group')
      if (group !== undefined) group.field = '__proto__'
    })
    const { answers } = toFormAnswers(renamed, ['__proto__'], read(STORED))
    expect(Object.hasOwn(answers, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(answers)).toBe(Object.prototype)
  })
})

/** What a clerk enters for a new order, in canonical form; `paid` the radio's other answer from the planner tests'. */
const ANSWERS = { ...CLERK_ANSWERS, paid: 'false' }

/**
 * The row an adapter would return for this insert: what was written, what
 * the database generated, and NULL for a nullable column nobody wrote — read
 * back for exactly the columns the plan asked for.
 */
function stored(request: InsertRequest, generated: Record<string, ApiValue>, version: string): RecordRead {
  const written = new Map(request.values.map((entry) => [entry.name, entry.value]))
  const values = request.returning.map((column): [string, ApiValue] => [column.name, Object.hasOwn(generated, column.name) ? (generated[column.name] as ApiValue) : (written.get(column.name) ?? null)])
  return { ok: true, values: Object.fromEntries(values), version }
}

/** What the released engine says about one set of answers in server mode, the mode formancy's submission endpoint replays in. */
function engineErrors(form: FormSchema, answers: Record<string, unknown>): Record<string, string[]> {
  const capabilities = { now: () => 1_791_417_600_000, today: () => '2026-10-09', random: () => 0.5 }
  const engine = createFormEngine({ schema: form, mode: 'server', capabilities })
  for (const [key, answer] of Object.entries(answers)) engine.setValue([key], answer)
  return Object.fromEntries(Object.entries(engine.validate().errors).filter(([, codes]) => codes.length > 0))
}

describe('a round trip', () => {
  // The planner's two halves are one translation: what a person entered,
  // planned, stored and read back, is what they entered — on both engines,
  // and with the record token and version an update needs. A half that
  // canonicalised one way and read back another would show a person a change
  // they did not make.
  test.each<[DatabaseKind, string]>([
    ['postgres', '1'],
    ['sqlserver', '00000000000007d1'],
  ])('answers -> planCreate -> the stored row -> toFormAnswers returns what went in on %s', (kind, version) => {
    const source = snapshot(kind)
    const { bindings } = orderForm(source)
    const planned = planCreate(source, bindings, POLICY, CLERK, ANSWERS, described(source, bindings))
    if (!planned.ok) throw new Error(planned.message)
    const back = toFormAnswers(bindings, planned.fields, stored(planned.request, { id: ORDER_ID, status: 'draft' }, version))

    expect(back).toEqual({ record: ORDER_TOKEN, version, answers: { ...ANSWERS, id: ORDER_ID, status: 'draft' } })

    // The token it hands out addresses the same record, and the answers it
    // gives, less the key the form never writes, are a valid update of it.
    const again = planRead(source, bindings, POLICY, CLERK, back.record ?? '')
    expect(again).toMatchObject({ ok: true, request: { key: [{ name: 'id', value: ORDER_ID }] } })
    const { id: _id, ...writable } = back.answers
    expect(planUpdate(source, bindings, POLICY, CLERK, back.record ?? '', back.version ?? '', writable, undefined, described(source, bindings))).toMatchObject({ ok: true })
  })

  // A decimal is stored at its column's scale, so it comes back padded: the
  // database's truth (0008), and the one place the round trip does not
  // return the person's spelling.
  test('returns a decimal at its column’s scale', () => {
    const planned = planCreate(PG, PG_FORM.bindings, POLICY, CLERK, { ...ANSWERS, amount: '12.5' }, described(PG, PG_FORM.bindings))
    if (!planned.ok) throw new Error(planned.message)
    const back = toFormAnswers(PG_FORM.bindings, planned.fields, stored(planned.request, { id: ORDER_ID, status: 'draft' }, '1'))
    expect(back.answers.amount).toBe('12.5000')
  })

  // The released engine is the other half of the check: what toFormAnswers
  // gives a form must pass the form's own server-side validation, or a
  // person who opens a record and saves it unchanged is told it is wrong. A
  // whole number left as the codec's canonical text is reported by the
  // engine as below its minimum.
  test('gives answers the released engine accepts for the generated form, which canonical text would not be', () => {
    const answers = toFormAnswers(PG_FORM.bindings, ALL_FIELDS, read(STORED)).answers
    expect(engineErrors(PG_FORM.form, answers)).toEqual({})
    expect(engineErrors(PG_FORM.form, { ...answers, approved_by: '2' })).toEqual({ approved_by: ['min'] })
  })
})
