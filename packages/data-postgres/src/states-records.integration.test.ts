import {
  buildLookupConfig,
  encodeKeyToken,
  exportColumns,
  exportHeader,
  exportRecord,
  generateForm,
  offers,
  planCreate,
  planList,
  planRead,
  planUpdate,
  recordPage,
  recordToken,
  toFormAnswers,
} from '@formancy/data-core'
import type {
  FormBindings,
  FormPolicy,
  GeneratedForm,
  GenerationRequest,
  LookupConfig,
  MetadataSnapshot,
  ObjectRef,
  PolicyContext,
  RecordAdapter,
  RecordList,
  RecordListQuery,
  RowFilters,
} from '@formancy/data-core'
import { startPostgresFixture, STATES, STATES_SCOPE } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresLookups, createPostgresRecords, discoverPostgres } from './index.js'

/*
 * Every operation over a column of an enum or of a domain (0170), against
 * REAL PostgreSQL: the shared fixture's states schema, through the
 * planners, as the server sends them, and this adapter. Each value of an
 * enum is bound cast to the type itself (`sql/types.ts`) -- left as text,
 * an insert would be refused with 42804 and a comparison with 42883, so
 * every case here that writes or compares one is also the proof that it is
 * not --, read as its label, sorted, paged after a row and compared in the
 * type's own order, searched as its label's text, and checked against the
 * labels before it is bound, so a value that is none fails no statement. A
 * domain over text or a whole number is bound as its base type, which the
 * server takes into the domain and holds to its checks.
 *
 * PostgreSQL's alone, so no case is a shared one. Written on 2026-11-20
 * without a server to run it on; its first run is in CI.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let states: MetadataSnapshot
let tickets: GeneratedForm

const TICKET: ObjectRef = { schema: 'states', name: 'ticket' }
const STAGE: ObjectRef = { schema: 'states', name: 'stage' }
const REQUEST: GenerationRequest = { connection: 'test', root: TICKET, formId: 'ticket', title: 'Ticket', lookups: [], versionColumn: 'version' }
const CLERK: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: {} }
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }
const NEVER = new AbortController().signal
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, filter: [], after: null, limit: 50 }

/**
 * Every field read by the clerk, and written where the form writes it. An
 * operation is granted only where the form offers it: the stage table has
 * no version, so its form offers no update, and a policy granting one is
 * refused as invalid before any statement is sent (0027).
 */
const policyOf = (bindings: FormBindings, extra: Partial<FormPolicy> = {}): FormPolicy => ({
  version: 1,
  operations: {
    read: ['clerk'],
    create: offers(bindings, 'create') ? ['clerk'] : [],
    update: offers(bindings, 'update') ? ['clerk'] : [],
  },
  fields: Object.fromEntries(
    bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }]),
  ),
  rowFilters: [],
  lookups: {},
  ...extra,
})

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  states = await discoverPostgres(owner, STATES_SCOPE)
  tickets = generateForm(states, REQUEST)
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

async function described() {
  const now = await records.describe(TICKET)
  if (!now.ok) throw new Error(`expected a description, got ${now.code}`)
  return now.described
}

/** One page of tickets as the server answers it, planned for the clerk. */
async function listed(change: Partial<RecordListQuery>, bindings = tickets.bindings): Promise<RecordList> {
  const plan = planList(states, bindings, policyOf(bindings), CLERK, { ...EVERY, ...change })
  if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
  const outcome = await records.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
  return recordPage(bindings, plan, outcome.rows)
}

/** The titles of a page, of the fixture's rows only: a create below adds its own. */
const titles = (page: RecordList): string[] =>
  page.rows.map((row) => String(row.answers['title'])).filter((title) => (STATES.rows as readonly string[]).includes(title))

/** A ticket read back by its id, as the person's form shows it. */
async function readBack(id: string) {
  const token = recordToken(['id'], { id })
  if (!token.ok) throw new Error(token.message)
  const plan = planRead(states, tickets.bindings, policyOf(tickets.bindings), CLERK, token.token)
  if (!plan.ok) throw new Error(`expected a read, got ${plan.code}: ${plan.message}`)
  const read = await records.read(plan.request)
  if (!read.ok || read.record === null) throw new Error(`expected ticket ${id}`)
  return { token: token.token, record: toFormAnswers(tickets.bindings, plan.fields, { ok: true, ...read.record }), version: String(read.record.version) }
}

describe('a ticket written and read back', () => {
  // A label of every select, a domain's whole number as its text: stored,
  // and read back as given. To be watched failing in CI with an enum bound
  // as text: the insert refused with 42804, which reads as schema-changed.
  test('a create stores a label of every select and reads it back as given', async () => {
    const plan = planCreate(states, tickets.bindings, policyOf(tickets.bindings), CLERK, { ...STATES.stored }, await described())
    if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
    const inserted = await records.insert(plan.request)
    if (!inserted.ok) throw new Error(`expected an insert, got ${inserted.code}: ${inserted.message}`)
    expect(toFormAnswers(tickets.bindings, plan.fields, inserted).answers).toMatchObject(STATES.stored)
    const back = await readBack(String(inserted.values['id']))
    expect(back.record.answers).toMatchObject(STATES.stored)
  })

  // The column's default, and a domain's: a create that leaves state and
  // tone out stores 'placed', the column's, and 'red', tone's domain's.
  test("a create that leaves them out stores the column's default and the domain's", async () => {
    const plan = planCreate(states, tickets.bindings, policyOf(tickets.bindings), CLERK, { title: 'defaulted' }, await described())
    if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
    const inserted = await records.insert(plan.request)
    if (!inserted.ok) throw new Error(`expected an insert, got ${inserted.code}: ${inserted.message}`)
    expect((await readBack(String(inserted.values['id']))).record.answers).toMatchObject({ ...STATES.form.defaults, title: 'defaulted' })
  })

  test('an update writes a label and a domain value and reads them back', async () => {
    const before = await readBack('3')
    const plan = planUpdate(
      states,
      tickets.bindings,
      policyOf(tickets.bindings),
      CLERK,
      before.token,
      before.version,
      { ...STATES.updated },
      before.record,
      await described(),
    )
    if (!plan.ok) throw new Error(`expected an update, got ${plan.code}: ${plan.message}`)
    const updated = await records.update(plan.request)
    if (!updated.ok) throw new Error(`expected an update, got ${updated.code}: ${updated.message}`)
    expect((await readBack('3')).record.answers).toMatchObject(STATES.updated)
    // Back as the fixture has it, for the cases below.
    const now = await readBack('3')
    const back = planUpdate(
      states,
      tickets.bindings,
      policyOf(tickets.bindings),
      CLERK,
      now.token,
      now.version,
      { priority: 'high', colour: 'green', stated: null },
      now.record,
      await described(),
    )
    if (!back.ok) throw new Error(`expected an update, got ${back.code}`)
    expect((await records.update(back.request)).ok).toBe(true)
  })

  // The codec refuses an answer no label is, before anything is sent; past
  // the planner, the engine refuses it with 22P02, an invalid input for the
  // type, which reads as a value out of range rather than the adapter's own
  // error. A domain's list is the database's to hold, as a check's is
  // (0152): a value it does not list reaches it, and is a check violation.
  test('a value no label is is refused by the codec, and by the database past it', async () => {
    const refused = planCreate(states, tickets.bindings, policyOf(tickets.bindings), CLERK, { title: 'lost', state: 'lost' }, await described())
    expect(refused).toMatchObject({ ok: false, code: 'invalid-values' })
    const plan = planCreate(states, tickets.bindings, policyOf(tickets.bindings), CLERK, { title: 'lost', state: 'draft' }, await described())
    if (!plan.ok) throw new Error(`expected a create, got ${plan.code}`)
    const lost = { ...plan.request, values: plan.request.values.map((value) => (value.name === 'state' ? { ...value, value: 'lost' } : value)) }
    expect(await records.insert(lost)).toMatchObject({ ok: false, code: 'out-of-range' })
    // The engine refuses an answer the select does not offer; the planner does not check the list, and the database does.
    const black = planCreate(states, tickets.bindings, policyOf(tickets.bindings), CLERK, { title: 'black', colour: 'black' }, await described())
    if (!black.ok) throw new Error(`expected the planner to leave the list to the database, got ${black.code}`)
    expect(await records.insert(black.request)).toMatchObject({ ok: false, code: 'check-violation' })
  })
})

describe('a page of tickets', () => {
  // The type's order, not the alphabet's -- low, high, urgent -- NULLs last
  // both ways. To be watched failing in CI with the order by the label's
  // text: high came first.
  test('sorts by an enum in the order its type gives its labels', async () => {
    expect(titles(await listed({ sort: [{ field: 'priority', direction: 'asc' }] }))).toEqual(STATES.sorted.asc)
    expect(titles(await listed({ sort: [{ field: 'priority', direction: 'desc' }] }))).toEqual(STATES.sorted.desc)
  })

  // A page continues after the row the one before ended with, compared
  // column against column in the type's own operator (0108): walked one at
  // a time, the pages are the one page of every row.
  test('pages after a row by an enum, one row at a time, as the one page of every row', async () => {
    for (const direction of ['asc', 'desc'] as const) {
      const sort = [{ field: 'priority', direction }]
      expect(await walked(sort), direction).toEqual(titles(await listed({ sort })))
    }
  })

  // An enum has no LIKE of its own: matched as its label's text.
  test('a search finds a row by its label', async () => {
    expect(titles(await listed({ search: STATES.search.text }))).toEqual(STATES.search.titles)
  })

  // Equality with a label, bound cast to the type: to be watched failing in
  // CI with the label bound as text, 42883.
  test('a filter narrows to a label', async () => {
    expect(titles(await listed({ filter: [{ field: 'priority', op: 'equals', value: STATES.filter.priority }] }))).toEqual(STATES.filter.titles)
  })

  // A label is its cell, as the type holds it; NULL an empty one.
  test("an export writes each label as the row's cell", async () => {
    expect(await exported(['id', 'state', 'priority', 'title'])).toEqual(STATES.exported)
  })
})

/** The fixture's rows of the file an export of `readable` writes, each record without its line end. */
async function exported(readable: readonly string[]): Promise<string[]> {
  const policy = policyOf(tickets.bindings, {
    fields: Object.fromEntries(readable.map((field) => [field, { read: ['clerk'], write: [] }])),
    operations: { read: ['clerk'], create: [], update: [] },
  })
  const plan = planList(states, tickets.bindings, policy, CLERK, EVERY)
  if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
  const outcome = await records.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}`)
  const page = recordPage(tickets.bindings, plan, outcome.rows)
  const columns = exportColumns(tickets.form, tickets.bindings, plan.fields)
  const lines = [exportHeader(columns), ...page.rows.map((row) => exportRecord(columns, row, new Map()))].map((line) => (line.ok ? line.text : line.message))
  return lines
    .slice(1)
    .map((line) => line.replace(/\r\n$/, ''))
    .filter((line) => STATES.rows.some((title) => line.endsWith(`,${title}`)))
}

/** Every row of a list in `sort`, walked one page of one row at a time from the start. */
async function walked(sort: RecordListQuery['sort']): Promise<string[]> {
  const rows: string[] = []
  let after: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const next: RecordList = await listed({ sort, after, limit: 1 })
    rows.push(...titles(next))
    if (next.next === null) break
    after = next.next
  }
  return rows
}

describe('a page of tickets by a column of a domain', () => {
  // A domain over varchar and one over an integer, each listed, and one
  // over text that is not: each sorted as its base type is, NULLs last
  // both ways. To be watched failing in CI with an order the engine could
  // not resolve over the domain.
  test.each(Object.entries(STATES.domains.sorted))('sorts by %s as its base type', async (field, sorted) => {
    expect(titles(await listed({ sort: [{ field, direction: 'asc' }] }))).toEqual(sorted.asc)
    expect(titles(await listed({ sort: [{ field, direction: 'desc' }] }))).toEqual(sorted.desc)
  })

  // A page continues after a row compared column against column in the
  // base type's operator, spelled with its schema (0108): walked one row at
  // a time, the pages are the one page of every row.
  test.each(Object.keys(STATES.domains.sorted))('pages after a row by %s, one row at a time, as the one page of every row', async (field) => {
    for (const direction of ['asc', 'desc'] as const) {
      const sort = [{ field, direction }]
      expect(await walked(sort), direction).toEqual(titles(await listed({ sort })))
    }
  })

  // Equality with a value bound as the base type, which the engine
  // compares with the domain's.
  test.each(STATES.domains.filter)('a filter narrows $field to one value', async ({ field, value, titles: expected }) => {
    expect(titles(await listed({ filter: [{ field, op: 'equals', value }] }))).toEqual(expected)
  })

  // A domain's value is its cell, as its base type spells it.
  test("an export writes each domain's value as the row's cell", async () => {
    expect(await exported(['id', 'colour', 'size', 'code', 'title'])).toEqual(STATES.domains.exported)
  })
})

describe('a table keyed by an enum', () => {
  const tokenOf = (...key: string[]) => {
    const encoded = encodeKeyToken(key)
    if (!encoded.ok) throw new Error(encoded.message)
    return encoded.token
  }
  const stages = (display: string[]): LookupConfig => {
    const generated = generateForm(states, { ...REQUEST, lookups: [{ foreignKey: 'fk_ticket_stage', display }] })
    const field = generated.bindings.fields.find((binding) => binding.kind === 'lookup' && binding.foreignKey === 'fk_ticket_stage')
    if (field === undefined) throw new Error('no stage lookup')
    return buildLookupConfig(generated.bindings, field.field, { snapshot: states })
  }

  // A record addressed by its label: the key predicate binds it cast to
  // the type, and finds the row.
  test('reads a record by a token that spells its label', async () => {
    const stage = generateForm(states, { connection: 'test', root: STAGE, formId: 'stage', title: 'Stage', lookups: [] })
    const plan = planRead(states, stage.bindings, policyOf(stage.bindings), CLERK, tokenOf('placed'))
    if (!plan.ok) throw new Error(`expected a read, got ${plan.code}: ${plan.message}`)
    const read = await records.read(plan.request)
    if (!read.ok || read.record === null) throw new Error('expected stage placed')
    expect(toFormAnswers(stage.bindings, plan.fields, { ok: true, ...read.record }).answers).toMatchObject({ state: 'placed', title: 'Placed' })
  })

  // A lookup onto it offers each stage by its token, and a token that is no
  // label is rejected among the others rather than failing the whole
  // statement with 22P02 (0028).
  test('a lookup onto it offers each stage, resolves one, and rejects a token that is no label', async () => {
    const lookups = createPostgresLookups(owner)
    const config = stages(['title'])
    const page = await lookups.search(config, { search: '', offset: 0, limit: 50 }, EVERY_ROW, NEVER)
    expect(page.rows.map((row) => row.token).sort()).toEqual([tokenOf('draft'), tokenOf('placed'), tokenOf('shipped')].sort())
    expect(await lookups.resolve(config, [tokenOf('shipped')], EVERY_ROW, NEVER)).toEqual([{ token: tokenOf('shipped'), label: 'Shipped' }])
    expect(await lookups.rejects(config, [tokenOf('draft'), tokenOf('lost')], EVERY_ROW, NEVER)).toEqual([tokenOf('lost')])
  })

  // A label shown, and searched as its text.
  test('a lookup that shows the enum searches it as its label', async () => {
    const page = await createPostgresLookups(owner).search(stages(['state']), { search: 'ship', offset: 0, limit: 50 }, EVERY_ROW, NEVER)
    expect(page.rows).toEqual([{ token: tokenOf('shipped'), label: 'shipped' }])
  })
})

describe('a state field over an enum', () => {
  // Its moves are between labels (0127): the clerk may move a draft to
  // placed and nowhere else, and the move is written cast to the type.
  test('keeps its moves', async () => {
    const policy = policyOf(tickets.bindings, {
      transitions: { field: 'state', moves: [{ from: 'draft', to: 'placed', roles: ['clerk'] }] },
    })
    const before = await readBack('4')
    const refused = planUpdate(states, tickets.bindings, policy, CLERK, before.token, before.version, { state: 'shipped' }, before.record, await described())
    expect(refused.ok).toBe(false)
    const plan = planUpdate(states, tickets.bindings, policy, CLERK, before.token, before.version, { state: 'placed' }, before.record, await described())
    if (!plan.ok) throw new Error(`expected the move, got ${plan.code}: ${plan.message}`)
    expect((await records.update(plan.request)).ok).toBe(true)
    expect((await readBack('4')).record.answers['state']).toBe('placed')
    await owner.unsafe("update states.ticket set state = 'draft' where id = 4")
  })
})
