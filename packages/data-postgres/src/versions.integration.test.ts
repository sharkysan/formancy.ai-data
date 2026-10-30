import { generateForm, planCreate, planRead, planSupersede, planUpdate, recordToken, toFormAnswers } from '@formancy/data-core'
import type { FormBindings, FormPolicy, FormRecord, MetadataSnapshot, PolicyContext, RecordAdapter, RecordOutcome } from '@formancy/data-core'
import { covers, PARITY_SCOPE, startPostgresFixture, VERSION_PARITY, versionCase } from '@formancy/data-fixtures'
import type { PostgresFixture, VersionCase } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A form over versions (0113) against REAL PostgreSQL loaded with the shared
 * fixture's parity schema: `parity.price`, a product's prices per tenant,
 * and `parity.price_declined`, whose BEFORE INSERT trigger keeps a version
 * noted 'next' out. Each case's answer is written once in
 * `@formancy/data-fixtures` (`VERSION_PARITY`); the SQL Server suite runs
 * the same cases, each declared with `covers()` (0035).
 *
 * The requests are the planner's, over bindings generated from what
 * discovery reports as the owner and the table as `describe` reads it, as
 * the server sends them. The owner inserts every version a case changes,
 * each case a product of its own, and reads what is there after.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let parity: MetadataSnapshot

const CLARA: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: '1' } }
const RW = { read: ['clerk'], write: ['clerk'] }
const READS = { read: ['clerk'], write: [] }
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { tenant_id: READS, product_no: RW, valid_from: RW, valid_to: READS, amount: RW, note: RW },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
}
type Table = 'price' | 'price_declined'
const forms = new Map<Table, FormBindings>()
const form = (table: Table) => forms.get(table) as FormBindings
const expected = (name: VersionCase): string => VERSION_PARITY[name]

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  parity = await discoverPostgres(owner, PARITY_SCOPE)
  for (const table of ['price', 'price_declined'] as const) {
    const request = {
      connection: 'test',
      root: { schema: 'parity', name: table },
      formId: table.replace('_', '-'),
      title: table,
      lookups: [],
      pinned: ['tenant_id'],
      versionColumn: 'version',
      validity: { from: 'valid_from', to: 'valid_to' },
    }
    forms.set(table, generateForm(parity, request).bindings)
  }
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

/** A version inserted as the owner, open unless `ends` says, and its token. */
async function inserted(table: Table, row: { tenant?: number; product: number; from: string; ends?: string; amount?: string; note?: string }): Promise<string> {
  await owner.unsafe(
    `insert into parity.${table} (tenant_id, product_no, valid_from, valid_to, amount, note) values ($1, $2, $3::date, $4::date, $5::numeric, $6)`,
    [row.tenant ?? 1, row.product, row.from, row.ends ?? null, row.amount ?? '9.5000', row.note ?? null],
  )
  const token = recordToken(['tenant_id', 'product_no', 'valid_from'], {
    tenant_id: String(row.tenant ?? 1),
    product_no: String(row.product),
    valid_from: row.from,
  })
  if (!token.ok) throw new Error(token.message)
  return token.token
}

/** One product's versions as the owner reads them, by start. */
async function versionsOf(
  table: Table,
  product: number,
  tenant = 1,
): Promise<Array<{ from: string; to: string | null; amount: string; note: string | null; version: string }>> {
  return owner.unsafe(
    `select valid_from::text as "from", valid_to::text as "to", amount::text as amount, note, version::text as version from parity.${table} where tenant_id = $1 and product_no = $2 order by valid_from`,
    [tenant, product],
  )
}

async function described(table: Table) {
  const found = await records.describe({ schema: 'parity', name: table })
  if (!found.ok) throw new Error(`expected a description, got ${found.code}`)
  return found.described
}

/** The version as Clara reads it through the adapter, as the server reads it before a change. */
async function asRead(table: Table, token: string): Promise<FormRecord> {
  const plan = planRead(parity, form(table), POLICY, CLARA, token)
  if (!plan.ok) throw new Error(`expected a read, got ${plan.code}`)
  const read = await records.read(plan.request)
  if (!read.ok || read.record === null) throw new Error('expected the version')
  return toFormAnswers(form(table), plan.fields, { ok: true, ...read.record })
}

/** A change from a date planned over `read` and sent; its answer, as VERSION_PARITY names one. */
async function changed(
  table: Table,
  token: string,
  version: string,
  answers: Record<string, unknown>,
  read: FormRecord,
): Promise<{ answer: string; outcome: RecordOutcome }> {
  const plan = planSupersede(parity, form(table), POLICY, CLARA, token, version, answers, read, await described(table))
  if (!plan.ok) throw new Error(`expected a change, got ${plan.code}: ${plan.message}`)
  const outcome = await records.supersede(plan.request)
  return { answer: outcome.ok ? 'changed' : outcome.code, outcome }
}

describe('a change from a date on PostgreSQL (0113)', () => {
  // One statement ends the open version where the next starts and inserts
  // the next: the chain's key from the row ended, the end NULL, a version
  // of its own; the version ended moved by one. The answer is the next one.
  test('ends the open version and inserts the next', covers('postgres', versionCase('changed')), async () => {
    const token = await inserted('price', { product: 1, from: '2026-01-01' })
    const { answer, outcome } = await changed('price', token, '1', { valid_from: '2026-07-01', amount: '10.0000' }, await asRead('price', token))
    expect(answer).toBe(expected('changed'))
    expect(outcome).toMatchObject({
      ok: true,
      values: { tenant_id: '1', product_no: '1', valid_from: '2026-07-01', valid_to: null, amount: '10.0000' },
      version: '1',
    })
    expect(await versionsOf('price', 1)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', amount: '9.5000', note: null, version: '2' },
      { from: '2026-07-01', to: null, amount: '10.0000', note: null, version: '1' },
    ])
  })

  // The version moved after it was read: nothing ended, nothing inserted.
  test('is stale where the version moved since it was read', covers('postgres', versionCase('stale')), async () => {
    const token = await inserted('price', { product: 2, from: '2026-01-01' })
    const read = await asRead('price', token)
    await owner.unsafe("update parity.price set note = 'moved', version = version + 1 where product_no = 2")
    expect((await changed('price', token, '1', { valid_from: '2026-07-01', amount: '10.0000' }, read)).answer).toBe(expected('stale'))
    expect(await versionsOf('price', 2)).toEqual([{ from: '2026-01-01', to: null, amount: '9.5000', note: 'moved', version: '2' }])
  })

  // Ended at the version sent -- by another writer that left its version --
  // the version is history: version-ended, and nothing is written. Watched
  // failing with the NULL end left out of the statement: it was changed.
  test('refuses a version that has ended at the version sent', covers('postgres', versionCase('ended')), async () => {
    const token = await inserted('price', { product: 3, from: '2026-01-01' })
    const read = await asRead('price', token)
    await owner.unsafe("update parity.price set valid_to = '2026-06-01' where product_no = 3")
    expect((await changed('price', token, '1', { valid_from: '2026-07-01', amount: '10.0000' }, read)).answer).toBe(expected('ended'))
    expect(await versionsOf('price', 3)).toEqual([{ from: '2026-01-01', to: '2026-06-01', amount: '9.5000', note: null, version: '1' }])
  })

  // Another tenant's open version is outside Clara's rows, whatever she
  // sends: not found, and nothing written.
  test('finds no other tenant’s version', covers('postgres', versionCase('other-tenant')), async () => {
    const token = await inserted('price', { tenant: 2, product: 4, from: '2026-01-01' })
    const read: FormRecord = {
      record: token,
      version: '1',
      answers: { tenant_id: 2, product_no: 4, valid_from: '2026-01-01', valid_to: null, amount: '9.5000', note: null },
    }
    expect((await changed('price', token, '1', { valid_from: '2026-07-01', amount: '10.0000' }, read)).answer).toBe(expected('other-tenant'))
    expect(await versionsOf('price', 4, 2)).toEqual([{ from: '2026-01-01', to: null, amount: '9.5000', note: null, version: '1' }])
  })

  // An update holds only an open version: an ended one is history, and
  // the open one updates as any record does. Watched failing with `open`
  // left out of the update's WHERE: the ended version was updated.
  test('updates the open version, and refuses one that has ended', covers('postgres', versionCase('update-ended')), async () => {
    const ended = await inserted('price', { product: 5, from: '2026-01-01', ends: '2026-07-01' })
    const open = await inserted('price', { product: 5, from: '2026-07-01' })
    const update = async (token: string) => {
      const plan = planUpdate(parity, form('price'), POLICY, CLARA, token, '1', { amount: '11.0000' }, await asRead('price', token), await described('price'))
      if (!plan.ok) throw new Error(`expected an update, got ${plan.code}`)
      const outcome = await records.update(plan.request)
      return outcome.ok ? 'updated' : outcome.code
    }
    expect(await update(ended)).toBe(expected('update-ended'))
    expect(await update(open)).toBe('updated')
    expect((await versionsOf('price', 5)).map((row) => row.amount)).toEqual(['9.5000', '11.0000'])
  })

  // A create starts a chain only where the chain has none. Watched failing
  // with the insert's condition left out: a second chain was created.
  test('creates a chain’s first version only where it has none', covers('postgres', versionCase('chain-exists')), async () => {
    await inserted('price', { product: 6, from: '2026-01-01' })
    const create = async (product: number) => {
      const plan = planCreate(
        parity,
        form('price'),
        POLICY,
        CLARA,
        { product_no: product, valid_from: '2026-03-01', amount: '1.0000' },
        await described('price'),
      )
      if (!plan.ok) throw new Error(`expected a create, got ${plan.code}`)
      const outcome = await records.insert(plan.request)
      return outcome.ok ? 'created' : outcome.code
    }
    expect(await create(6)).toBe(expected('chain-exists'))
    expect(await create(7)).toBe('created')
    expect((await versionsOf('price', 6)).map((row) => row.from)).toEqual(['2026-01-01'])
    expect((await versionsOf('price', 7)).map((row) => row.from)).toEqual(['2026-03-01'])
  })

  // The trigger returns NULL for the next version after the open one was
  // ended in the same statement: the statement's own check fails it, 21000,
  // which undoes the end too. Watched failing with the check narrowed to
  // two versions ended: the end stood, answered as a change.
  test('is undone where the database declines the next version', covers('postgres', versionCase('next-declined')), async () => {
    const token = await inserted('price_declined', { product: 8, from: '2026-01-01', note: 'open' })
    expect(
      (await changed('price_declined', token, '1', { valid_from: '2026-07-01', amount: '10.0000', note: 'next' }, await asRead('price_declined', token)))
        .answer,
    ).toBe(expected('next-declined'))
    expect(await versionsOf('price_declined', 8)).toEqual([{ from: '2026-01-01', to: null, amount: '9.5000', note: 'open', version: '1' }])
  })
})
