import { diffSnapshots, driftRefusal, generateForm, planCreate } from '@formancy/data-core'
import type { DriftReport, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot, ObjectRef, PolicyContext } from '@formancy/data-core'
import { startPostgresFixture, STATES_SCOPE } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A published form over an enum and a domain's list, after the database
 * changed under it (0170), against REAL PostgreSQL: each change made with
 * the DDL a person runs, discovered again, and reviewed against the
 * snapshot the form was published from (0010) -- and decided again by the
 * runtime over the root's description (0041), and refused or taken by the
 * database itself.
 *
 * - Discovered under a search_path that makes the types visible: their
 *   columns respelled by their bare names, no type changed, and nothing
 *   stops.
 * - ALTER TYPE … ADD VALUE: a label a row may hold that the select does
 *   not offer. For review; nothing stops, and the published codec refuses
 *   the new label until the form is generated again.
 * - A domain's list replaced NOT VALID without a value the select offers:
 *   writes of the field stop in review, the runtime -- which compares no
 *   check -- sends them, and the database refuses the value; VALIDATE
 *   CONSTRAINT then holds every row to it; DROP CONSTRAINT leaves the
 *   column held to no list, for review.
 * - ALTER TYPE … RENAME VALUE: the select offers a label the type no longer
 *   has, which the database refuses with 22P02. Writes stop in review and
 *   at runtime alike, since the labels are the type, which the root's
 *   description reads.
 *
 * In order, each against the snapshot the form was published from: this
 * file's container is its own. Written on 2026-11-20 without a server to
 * run it on; its first run is in CI.
 */

let fixture: PostgresFixture
let owner: Sql
let base: MetadataSnapshot
let bindings: FormBindings
let policy: FormPolicy

const TICKET: ObjectRef = { schema: 'states', name: 'ticket' }
const REQUEST: GenerationRequest = { connection: 'test', root: TICKET, formId: 'ticket', title: 'Ticket', lookups: [], versionColumn: 'version' }
const CLERK: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: {} }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  base = await discoverPostgres(owner, STATES_SCOPE)
  bindings = generateForm(base, REQUEST).bindings
  policy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(
      bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }]),
    ),
    rowFilters: [],
    lookups: {},
  }
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

/** The published form reviewed against the database as it is now. */
async function reviewed(): Promise<DriftReport> {
  return diffSnapshots(base, await discoverPostgres(owner, STATES_SCOPE), bindings, policy)
}

/** Each change on `name`, by kind and severity. */
const on = (report: DriftReport, name: string) =>
  report.changes.filter((change) => 'name' in change.subject && change.subject.name === name).map((change) => [change.kind, change.severity])

/** What the runtime decides of a create over the root as one request describes it now. */
async function runtimeCreate() {
  const now = await createPostgresRecords(owner).describe(TICKET)
  if (!now.ok) throw new Error(`expected a description, got ${now.code}`)
  return { described: now.described, refusal: driftRefusal(base, bindings, policy, now.described, 'create') }
}

describe('a published form over an enum and a domain, under another search_path', () => {
  // format_type leaves a type's schema out exactly when the session's
  // search_path makes it visible: discovered with states on the path, an
  // enum's and a domain's column is spelled by its bare name, and
  // described by a session without it, qualified. No type changed, and
  // review and the runtime both say so; a respelling read as a type
  // changed refused every read of the form. Before any change below.
  test('stops nothing: discovered with the schema on the path, reviewed and described without it', async () => {
    const pathed = postgres(fixture.admin, { onnotice: () => {}, connection: { search_path: 'states, public' } })
    try {
      const visible = await discoverPostgres(pathed, STATES_SCOPE)
      const spelled = (snapshot: MetadataSnapshot, name: string) =>
        snapshot.objects.find((object) => object.ref.name === 'ticket')?.columns.find((column) => column.name === name)?.databaseType
      // The case is the one it means: the path respelled both.
      expect([spelled(visible, 'state'), spelled(visible, 'colour')]).toEqual(['order_state', 'colour'])
      expect([spelled(base, 'state'), spelled(base, 'colour')]).toEqual(['states.order_state', 'states.colour'])
      const published = generateForm(visible, REQUEST).bindings
      const report = diffSnapshots(visible, base, published, policy)
      // No bound column changed type. The path respells a default naming
      // the enum, and an array of one no field binds, each a note.
      for (const name of ['state', 'priority', 'colour', 'size', 'code', 'tone', 'stated']) {
        expect(
          on(report, name).filter(([kind]) => kind === 'column-type-changed'),
          name,
        ).toEqual([])
      }
      expect(report.changes.filter((change) => change.severity !== 'info')).toEqual([])
      expect(report).toMatchObject({ blocking: false, readable: true, writable: { create: true, update: true } })
      const now = await createPostgresRecords(owner).describe(TICKET)
      if (!now.ok) throw new Error(`expected a description, got ${now.code}`)
      for (const operation of ['read', 'create', 'update'] as const) {
        expect(driftRefusal(visible, published, policy, now.described, operation), operation).toBeUndefined()
      }
    } finally {
      await pathed.end()
    }
  })
})

describe('a published form over an enum and a domain, after the database changed', () => {
  test('a label added is for review, stops nothing, and is offered once the form is generated again', async () => {
    // A write decided over the description before: the labels are names
    // the definition digests, so the guard refuses it (0041).
    const before = await runtimeCreate()
    const decided = planCreate(base, bindings, policy, CLERK, { title: 'decided', priority: 'low' }, before.described)
    if (!decided.ok) throw new Error(`expected a create, got ${decided.code}: ${decided.message}`)
    await owner.unsafe("alter type states.priority add value 'critical'")
    expect(await createPostgresRecords(owner).insert(decided.request)).toMatchObject({ ok: false, code: 'schema-changed' })
    const report = await reviewed()
    expect(on(report, 'priority')).toEqual([['column-outgrew-field', 'review']])
    expect(report.writable).toMatchObject({ create: true, update: true })
    const { described, refusal } = await runtimeCreate()
    expect(refusal).toBeUndefined()
    // The published codec offers the labels it was published with.
    expect(planCreate(base, bindings, policy, CLERK, { title: 'critical', priority: 'critical' }, described)).toMatchObject({
      ok: false,
      code: 'invalid-values',
    })
    const again = generateForm(await discoverPostgres(owner, STATES_SCOPE), REQUEST)
    expect(again.form.model.fields.find((field) => field.key === 'priority')?.options?.map((option) => option.value)).toEqual([
      'low',
      'high',
      'urgent',
      'critical',
    ])
  })

  test("a domain's list replaced without an offered value stops writes in review, and the database refuses the value", async () => {
    await owner.unsafe(`
      alter domain states.colour drop constraint colour_check;
      alter domain states.colour add constraint colour_check check (value in ('red', 'green')) not valid;
    `)
    const report = await reviewed()
    // tone is a domain over colour: its select rests on the same list.
    for (const field of ['colour', 'tone']) expect(on(report, field), field).toContainEqual(['column-tightened', 'blocking'])
    expect(report.writable).toMatchObject({ create: false, update: false })
    const { described, refusal } = await runtimeCreate()
    expect(refusal).toBeUndefined()
    const plan = planCreate(base, bindings, policy, CLERK, { title: 'blue', colour: 'blue' }, described)
    if (!plan.ok) throw new Error(`expected the runtime to plan the create, got ${plan.code}: ${plan.message}`)
    expect(await createPostgresRecords(owner).insert(plan.request)).toMatchObject({ ok: false, code: 'check-violation' })
  })

  test('the list validated once no row holds the value: still tightened, and nothing a row holds outgrows the select', async () => {
    await owner.unsafe(`
      update states.ticket set colour = 'red' where colour = 'blue';
      update states.ticket set tone = 'red' where tone = 'blue';
      alter domain states.colour validate constraint colour_check;
    `)
    const report = await reviewed()
    expect(on(report, 'colour')).toEqual([['column-tightened', 'blocking']])
  })

  test("the domain's list dropped leaves the column held to no list, for review", async () => {
    await owner.unsafe('alter domain states.colour drop constraint colour_check')
    const report = await reviewed()
    expect(on(report, 'colour')).toEqual([['column-outgrew-field', 'review']])
    expect(report.changes.find((change) => 'name' in change.subject && change.subject.name === 'colour')?.message).toMatch(
      /^colour_check of states\.colour, whose values colour offers, is gone from colour\./,
    )
  })

  test('a label renamed stops writes in review and at runtime, and the database refuses the old one', async () => {
    await owner.unsafe("alter type states.order_state rename value 'shipped' to 'sent'")
    const report = await reviewed()
    // stated is a domain over the enum, which it is.
    for (const field of ['state', 'stated']) expect(on(report, field), field).toEqual([['column-tightened', 'blocking']])
    expect(report.writable).toMatchObject({ create: false, update: false })
    const { described, refusal } = await runtimeCreate()
    expect(refusal).toMatchObject({ ok: false, code: 'drift' })
    // Past the runtime, the old label is no input of the type.
    const now = await discoverPostgres(owner, STATES_SCOPE)
    const plan = planCreate(now, generateForm(now, REQUEST).bindings, policy, CLERK, { title: 'sent', state: 'sent' }, described)
    if (!plan.ok) throw new Error(`expected a create over the form generated again, got ${plan.code}: ${plan.message}`)
    const shipped = { ...plan.request, values: plan.request.values.map((value) => (value.name === 'state' ? { ...value, value: 'shipped' } : value)) }
    expect(await createPostgresRecords(owner).insert(shipped)).toMatchObject({ ok: false, code: 'out-of-range' })
  })

  // A value is cast to the enum by name: the type renamed under a write
  // planned before, the statement names a type that is gone, which the
  // server refuses before the guard is asked (42704) -- schema-changed, as
  // a column gone is, never the adapter's own error. Review calls it
  // another type, and the form is blocked.
  test('the type renamed under a planned write is a changed schema, and another type in review', async () => {
    const now = await discoverPostgres(owner, STATES_SCOPE)
    const { described } = await runtimeCreate()
    const plan = planCreate(now, generateForm(now, REQUEST).bindings, policy, CLERK, { title: 'renamed', priority: 'low' }, described)
    if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
    await owner.unsafe('alter type states.priority rename to priority_level')
    expect(await createPostgresRecords(owner).insert(plan.request)).toMatchObject({ ok: false, code: 'schema-changed' })
    expect(on(await reviewed(), 'priority')).toEqual([['column-type-changed', 'blocking']])
  })
})
