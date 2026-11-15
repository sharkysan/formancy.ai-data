import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { FormBindings, StampBinding } from '../generate/types.js'
import type { ObjectMeta } from '../metadata.js'
import { writableFields } from '../policy/evaluate.js'
import { validatePolicy } from '../policy/validate.js'
import { copiedFields } from './copy.js'
import { planCreate, planRead, planUpdate } from './plan.js'
import { planSupersede } from './supersede.js'
import { audited, auditedForm, AUDITED_POLICY, DATE, INSTANT, signedIn, WALL_CLOCK } from './test-stamps.js'
import { col, described, edited, INT32, restrict, sales, TENANT_ONE, text, value } from './test-support.js'
import { priced, PRICE_POLICY } from './test-versions.js'
import { recordToken } from './token.js'

/*
 * What a write stamps, planned (0153): who from the verified context,
 * through the column's codec, and when as the database's clock, which the
 * adapter writes; never anything the request sent, and never a filter.
 */

const PG = audited('postgres')
const AUDITED = auditedForm(PG).bindings
const ALICE = signedIn('alice')
const BOB = signedIn('bob', { tenant: '1', site: 'Basel' })
const TOKEN = 'k1:5'

const create = (answers: Record<string, unknown>, who = ALICE, bindings = AUDITED) =>
  planCreate(PG, bindings, AUDITED_POLICY, who, answers, described(PG, bindings))
const update = (answers: Record<string, unknown>, who = BOB, bindings = AUDITED) =>
  planUpdate(PG, bindings, AUDITED_POLICY, who, TOKEN, '1', answers, undefined, described(PG, bindings))

describe('a create of a form that stamps', () => {
  // Who created the row is the signed-in person's id and their site, bound
  // as values in catalog order beside the pinned tenant and the answers;
  // when is the database's clock, for the columns stamped on create. A NOT
  // NULL created_by is not asked of the answers. Watched failing with the
  // stamped columns not passed as supplied: "created_by: A value is
  // required."; and with the stamps left out of the values: the insert
  // carried the note and the tenant alone.
  test('writes who from the context and when from the database', () => {
    const planned = create({ note: 'first' })
    expect(planned).toMatchObject({
      ok: true,
      request: {
        values: [
          value('tenant_id', INT32, '1'),
          value('note', text(50), 'first'),
          value('created_by', text(40), 'alice'),
          value('created_in', text(20), 'Bern'),
        ],
        clock: [
          { name: 'created_at', type: INSTANT },
          { name: 'changed_at', type: WALL_CLOCK },
        ],
      },
    })
  })

  // A value for a stamped field is somebody saying who they are: refused
  // as over-posting, whatever it holds, with the stamp named as the reason.
  // Watched failing with the stamp reason taken out: the refusal said the
  // field is never written, which is true and does not say why.
  test('refuses a submitted stamp', () => {
    expect(create({ note: 'x', created_by: 'mallory' })).toMatchObject({
      ok: false,
      code: 'over-posting',
      message: 'created_by is stamped by the server: who wrote the record, and when, never comes from the request',
    })
    expect(create({ note: 'x', changed_at: '2020-01-01T00:00:00' })).toMatchObject({ ok: false, code: 'over-posting' })
  })

  // A stamp the context cannot fill is refused before anything is written,
  // naming the column and never the value: an attribute the token does not
  // carry, as a row filter's missing one is; an id longer than the column,
  // which would otherwise be cut by nobody -- PostgreSQL refuses it, and so
  // does SQL Server with ANSI_WARNINGS on, but neither names the stamp.
  // Watched failing with the codec skipped: the 41-character id was planned.
  test('refuses what the context cannot fill', () => {
    expect(create({ note: 'x' }, signedIn('alice', { tenant: '1' }))).toMatchObject({
      ok: false,
      code: 'missing-attribute',
      message: 'created_in is stamped with the attribute site, which the context lacks.',
    })
    expect(create({ note: 'x' }, signedIn('a'.repeat(41)))).toEqual({
      ok: false,
      code: 'unstampable',
      message: "created_by cannot hold the signed-in person's id: At most 40 characters, counting an emoji as two.",
    })
    expect(create({ note: 'x' }, signedIn('alice', { tenant: '1', site: 's'.repeat(21) }))).toMatchObject({ ok: false, code: 'unstampable' })
  })

  // A form that stamps nothing plans what it planned before 0153: no `clock`.
  test('carries no clock where nothing is stamped', () => {
    const plain = auditedForm(PG, null).bindings
    const planned = create({ note: 'x', created_by: 'alice', created_at: '2026-11-15T10:00:00Z' }, ALICE, plain)
    expect(planned.ok && Object.hasOwn(planned.request, 'clock')).toBe(false)
  })
})

describe('an update of a form that stamps', () => {
  // Who changed the row last is the person saving now, and when is the
  // database's; who created it and when are not in the update at all. An
  // update that changes nothing is still nothing: the stamps say who
  // changed a record, and are no change of their own. Watched failing with
  // the stamps planned on create's list: the update set created_by to bob.
  test('restamps who changed it and when, and leaves who created it', () => {
    const planned = update({ note: 'second' })
    expect(planned).toMatchObject({
      ok: true,
      request: {
        set: [value('note', text(50), 'second'), value('changed_by', text(40), 'bob')],
        clock: [
          { name: 'changed_at', type: WALL_CLOCK },
          { name: 'changed_on', type: DATE },
        ],
      },
    })
    expect(update({})).toMatchObject({ ok: false, code: 'nothing-to-update' })
    expect(update({ note: 'x', changed_by: 'mallory' })).toMatchObject({ ok: false, code: 'over-posting' })
  })

  // A stamp filters nothing: Bob reads and updates the record Alice
  // created, under the tenant's filter alone (0011).
  test('is no filter on a read or an update', () => {
    const read = planRead(PG, AUDITED, AUDITED_POLICY, BOB, TOKEN)
    expect(read.ok && read.request.filters).toEqual(TENANT_ONE)
    const planned = update({ note: 'third' })
    expect(planned.ok && planned.request.filters).toEqual(TENANT_ONE)
  })
})

describe('what a person may send to a form that stamps', () => {
  // The fields a page sends and a copy carries are the over-posting check's
  // (0117, 0107): a stamped field is in neither, so a duplicate starts with
  // no creator of its own and a page never sends one. Watched failing with
  // the stamped fields generated writable: both lists named created_by.
  test('never names a stamped field', () => {
    for (const operation of ['create', 'update'] as const) expect(writableFields(AUDITED_POLICY, ALICE, AUDITED, operation)).toEqual(['note'])
    expect(copiedFields(PG, AUDITED, AUDITED_POLICY, ALICE)).toEqual(['note'])
  })

  // A row filter on a stamped column would show each person only what they
  // created, and write the context into it where the stamp writes too:
  // refused on publish and on every read (0019). Watched failing with the
  // check taken out: the policy validated.
  test('is refused a row filter on a stamped column', () => {
    const policy = { ...AUDITED_POLICY, rowFilters: [...AUDITED_POLICY.rowFilters, { column: 'created_by', attribute: 'login' }] }
    expect(validatePolicy(policy, AUDITED)).toMatchObject({
      ok: false,
      problems: ['rowFilters: created_by is stamped by the server, and a stamp filters nothing: a person sees the records others wrote'],
    })
  })
})

describe('bindings that stamp', () => {
  // A bindings file is a stored file (0019): a stamp a hand edit changed is
  // refused before anything is planned from it, by the generator's own
  // rules. Watched failing with `stampsProblem` unasked: each edit planned.
  test('are refused where a stamp does not fit the snapshot', () => {
    const refusedFor = (change: (stamps: StampBinding[], draft: FormBindings) => void, source = PG) =>
      planCreate(
        source,
        edited(AUDITED, (draft) => change(draft.stamps as StampBinding[], draft)),
        AUDITED_POLICY,
        ALICE,
        { note: 'x' },
        described(source, AUDITED),
      )
    const stamp = (stamps: StampBinding[], column: string) => stamps.find((entry) => entry.column === column) as StampBinding
    expect(refusedFor((stamps) => (stamp(stamps, 'created_by').column = 'made_by'))).toMatchObject({
      code: 'invalid-bindings',
      message: 'The bindings do not fit their snapshot: the server stamps made_by, which the table does not have.',
    })
    expect(refusedFor((stamps) => (stamp(stamps, 'created_by').type = text(80)))).toMatchObject({
      message: expect.stringContaining('the stamp of created_by describes it'),
    })
    expect(refusedFor((stamps) => (stamp(stamps, 'created_at').value = { kind: 'actor' }))).toMatchObject({
      message: expect.stringContaining('created_at cannot be stamped: it is timestamp'),
    })
    expect(refusedFor((stamps) => stamps.push({ ...stamp(stamps, 'created_by') }))).toMatchObject({
      message: expect.stringContaining('created_by is stamped twice'),
    })
    expect(refusedFor((stamps) => stamps.push({ column: 'note', value: { kind: 'actor' }, on: 'create', type: text(50) }))).toMatchObject({
      message: expect.stringContaining('note is stamped by the server, and a field writes it'),
    })
    expect(refusedFor((stamps) => stamps.push({ column: 'id', value: { kind: 'time' }, on: 'update', type: INT32 }))).toMatchObject({
      message: expect.stringContaining('id cannot be stamped'),
    })
    expect(refusedFor((stamps) => ((stamps[0] as unknown as Record<string, unknown>)['on'] = 'always'))).toMatchObject({
      message: expect.stringContaining('a stamp is not { column, value, on, type }'),
    })
    const unwritable = audited('postgres', (objects) => restrict(objects, 'audited', 'created_by', { insert: false }))
    expect(
      planCreate(unwritable, { ...AUDITED, snapshotFingerprint: unwritable.fingerprint }, AUDITED_POLICY, ALICE, { note: 'x' }, described(unwritable, AUDITED)),
    ).toMatchObject({ message: expect.stringContaining("created_by is stamped on create, and this connection's account may not INSERT it") })
  })
})

describe('a change from a date of a form that stamps', () => {
  // The next version is a create, and is stamped as one: who started it
  // and when, beside the answers; the version it ends is not stamped -- its
  // end is the next one's start, whose stamps say who wrote it and when.
  // Watched failing with the stamps left out of the next version: its
  // values were the answers alone, with no creator.
  test('stamps the next version as a create', () => {
    const source = priced('postgres', (objects) => {
      const price = objects.find((object) => object.ref.name === 'price') as ObjectMeta
      price.columns.push(col('created_by', 8, text(40)), col('created_at', 9, INSTANT))
    })
    const bindings = generateForm(source, {
      connection: 'erp',
      root: sales('price'),
      formId: 'sales-price',
      title: 'Price',
      lookups: [],
      pinned: ['tenant_id'],
      versionColumn: 'row_version',
      validity: { from: 'valid_from', to: 'valid_to' },
      stamps: [
        { column: 'created_by', value: { kind: 'actor' }, on: 'create' },
        { column: 'created_at', value: { kind: 'time' }, on: 'both' },
      ],
    }).bindings
    const encoded = recordToken(['tenant_id', 'product_no', 'valid_from'], { tenant_id: '1', product_no: '7', valid_from: '2026-01-01' })
    if (!encoded.ok) throw new Error(encoded.message)
    const asRead = {
      record: encoded.token,
      version: '1',
      answers: { tenant_id: 1, product_no: 7, valid_from: '2026-01-01', valid_to: null, amount: '9.5000', note: null, created_by: 'alice', created_at: null },
    }
    const policy = {
      ...PRICE_POLICY,
      fields: { ...PRICE_POLICY.fields, created_by: { read: ['clerk'], write: [] }, created_at: { read: ['clerk'], write: [] } },
    }
    const planned = planSupersede(
      source,
      bindings,
      policy,
      { actor: { id: 'bob', roles: ['clerk'] }, attributes: { tenant: '1' } },
      encoded.token,
      '1',
      { valid_from: '2026-07-01', amount: '10.0000', note: 'summer' },
      asRead,
      described(source, bindings),
    )
    expect(planned).toMatchObject({
      ok: true,
      request: {
        values: [
          value('amount', { kind: 'decimal', precision: 18, scale: 4 }, '10.0000'),
          value('note', text(100), 'summer'),
          value('created_by', text(40), 'bob'),
        ],
        clock: [{ name: 'created_at', type: INSTANT }],
      },
    })
  })
})
