import { mkdtemp, rm } from 'node:fs/promises'
import type { Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, EXPORT_MAX_BYTES, generateForm, LIST_PAGE_SIZE } from '@formancy/data-core'
import type {
  ColumnMeta,
  DatabaseAdapter,
  FieldBinding,
  DescribedTable,
  FormPolicy,
  ListOutcome,
  ListRequest,
  LookupAdapter,
  LookupConfig,
  NormalizedType,
  ObjectRef,
  RecordAdapter,
  RowFilters,
} from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import { EXPORT_DEADLINE_MS } from '../export-limits.js'

/*
 * `POST /v1/forms/:id/records/export` over fake ports (0079). What the
 * database does with each page is the adapter suites' business, against
 * real servers (0003), and what a file's text is, data-core's; under test
 * here is what the route decides around them: who may export, which pages
 * reach the port, how the labels are asked for, that a file is answered
 * whole or refused with nothing of it, the three bounds, and what the trail
 * says.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const NAME: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const CODE: NormalizedType = { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }
const NOTES: NormalizedType = { kind: 'text', maxLength: null, lengthUnit: 'utf16-code-units', fixedLength: false }
const PHOTO: NormalizedType = { kind: 'binary', maxLength: null, fixedLength: false }
/** Text long enough that a key of it needs more than `KEY_TOKEN_MAX_LENGTH` characters as a token: such a record is listed with no token. */
const LONG: NormalizedType = { kind: 'text', maxLength: 400, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  ordinal,
  databaseType: type.kind,
  type,
  nullable: false,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
  ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })
const fk = (name: string, columns: string[], target: string, targetColumns: string[]) =>
  ({
    name,
    columns,
    references: { table: ref(target), columns: targetColumns },
    onUpdate: 'no-action',
    onDelete: 'no-action',
    enforced: true,
    validated: true,
  }) as const

const SNAPSHOT = createSnapshot({
  kind: 'sqlserver',
  serverVersion: '16.0',
  account: { user: 'dbo', login: 'sa' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [
    {
      ref: ref('country'),
      kind: 'table',
      comment: null,
      columns: [col('id', 1, INT32, { generated: 'identity-always' }), col('iso_code', 2, CODE), col('name', 3, NAME), col('region', 4, CODE)],
      primaryKey: { name: 'pk_country', columns: ['id'] },
      uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }],
      foreignKeys: [],
      checks: [],
      rowSecurity: 'none',
    },
    {
      ref: ref('customer'),
      kind: 'table',
      comment: null,
      columns: [
        col('tenant_id', 1, INT32),
        col('customer_no', 2, INT32),
        col('name', 3, NAME),
        col('country_code', 4, CODE, { nullable: true }),
        col('notes', 5, NOTES, { nullable: true }),
        col('row_version', 6, { kind: 'rowversion' }, { generated: 'rowversion' }),
        col('photo', 7, PHOTO, { nullable: true }),
      ],
      primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] },
      uniqueKeys: [],
      foreignKeys: [fk('fk_customer_country', ['country_code'], 'country', ['iso_code'])],
      checks: [],
      rowSecurity: 'none',
    },
    {
      ref: ref('order'),
      kind: 'table',
      comment: null,
      columns: [col('id', 1, INT32), col('tenant_id', 2, INT32), col('placed', 3, { kind: 'date' })],
      primaryKey: { name: 'pk_order', columns: ['id'] },
      uniqueKeys: [],
      foreignKeys: [],
      checks: [],
      rowSecurity: 'none',
    },
    {
      ref: ref('line'),
      kind: 'table',
      comment: null,
      columns: [
        col('order_id', 1, INT32),
        col('line_no', 2, INT32),
        col('quantity', 3, INT32),
        col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' }),
      ],
      primaryKey: { name: 'pk_line', columns: ['order_id', 'line_no'] },
      uniqueKeys: [],
      foreignKeys: [fk('fk_line_order', ['order_id'], 'order', ['id'])],
      checks: [],
      rowSecurity: 'none',
    },
    {
      ref: ref('tag'),
      kind: 'table',
      comment: null,
      columns: [col('code', 1, LONG), col('name', 2, NAME)],
      primaryKey: { name: 'pk_tag', columns: ['code'] },
      uniqueKeys: [],
      foreignKeys: [],
      checks: [],
      rowSecurity: 'none',
    },
  ],
})

const RW = { read: ['clerk', 'reader'], write: ['clerk'] }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]

/** A clerk's customers, and a country's label only where the country is in the clerk's region: the lookup's filter for read. */
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'reader'], create: ['clerk'], update: ['clerk'] },
  fields: { tenant_id: { read: ['clerk', 'reader'], write: [] }, customer_no: RW, name: RW, country: RW, notes: RW },
  rowFilters: TENANT,
  lookups: { country: [{ column: 'region', attribute: 'region' }] },
}
/** customer_no, half the key, kept from the clerk: a list, and so a file, would hand out every customer number. */
const HIDDEN_KEY: FormPolicy = { ...POLICY, fields: { ...POLICY.fields, customer_no: { read: [], write: ['clerk'] } } }
/** Tags, which every clerk may read: nothing in them is a tenant's. */
const TAG_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { code: RW, name: RW },
  rowFilters: [],
  lookups: {},
}
/** An order's lines with nothing scoping them while the order's options are filtered: a read reaches a line by a guessed token, and a list would hand out all of them. */
const UNSCOPED_LINE: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { order: RW, line_no: RW, quantity: RW },
  rowFilters: [],
  lookups: { order: TENANT },
}

const verifyIdentity: IdentityVerifier = async (token) => {
  const as = (id: string, roles: string[], attributes: Record<string, string>) => ({ ok: true as const, identity: { actor: { id, roles }, attributes } })
  if (token === 'clerk') return as('c', ['clerk'], { tenant: '1', region: 'EU' })
  if (token === 'stranger') return as('s', [], { tenant: '1', region: 'EU' })
  if (token === 'reader') return as('d', ['reader'], { tenant: '1', region: 'EU' })
  if (token === 'clerk-untenanted') return as('u', ['clerk'], { region: 'EU' })
  if (token === 'clerk-unregioned') return as('r', ['clerk'], { tenant: '1' })
  return { ok: false, reason: 'bad' }
}

const VERSION = '00000000000007d1'
type Stored = { values: Record<string, string | null>; version: string }
const customer = (number: number, name: string, country: string | null = null, notes: string | null = null): Stored => ({
  values: { tenant_id: '1', customer_no: String(number), name, country_code: country, notes },
  version: VERSION,
})
/** `count` customers numbered from 1, every third in Switzerland. */
const many = (count: number, notes: string | null = null): Stored[] =>
  Array.from({ length: count }, (_, index) => customer(index + 1, `Customer ${String(index + 1)}`, index % 3 === 0 ? 'CH' : null, notes))

const describedAs = (table: ObjectRef): DescribedTable => {
  const found = describedOf(SNAPSHOT, table)
  if (found === undefined) throw new Error(`the snapshot has no ${table.name}`)
  return { ...found, definition: 'the definition the fake catalog described' }
}
/** The customer's name retyped to an integer: a page decided over it is drift. */
const RETYPED: DescribedTable = (() => {
  const described = describedAs(ref('customer'))
  return { ...described, columns: described.columns.map((column) => (column.name === 'name' ? { ...column, type: INT32, databaseType: 'int' } : column)) }
})()

/** The rows the fake table holds, paged as an adapter pages them: from the offset, one row past the limit. */
let table: Stored[]
let lists: ListRequest[]
/** Runs before a page is answered: to hold it, to move the clock, or to answer it otherwise. */
let beforePage: (request: ListRequest) => Promise<ListOutcome | undefined>
let resolves: Array<{ source: string; tokens: readonly string[]; filters: RowFilters }>
/** What the fake resolve does: answers the labels it knows, or waits until its signal aborts. */
let resolving: 'answer' | 'wait'
/** Runs when a waiting resolve's signal aborts, with its reason and how long it really waited, before it rejects. */
let stopping: (reason: unknown, waitedMs: number) => void
let events: RuntimeAuditEvent[]
let root: string
const apps: FastifyInstance[] = []

const LABELS = new Map([['k1:CH', 'Switzerland']])

function registry(): ConnectionRegistry {
  const records: RecordAdapter = {
    describe: async (target) => ({ ok: true, described: describedAs(target) }),
    read: async () => {
      throw new Error('an export never reads a record by its token')
    },
    list: async (request) => {
      lists.push(request)
      const answered = await beforePage(request)
      return answered ?? { ok: true, described: describedAs(request.target.table), rows: table.slice(request.offset, request.offset + request.limit + 1) }
    },
    insert: async () => {
      throw new Error('an export never inserts')
    },
    update: async () => {
      throw new Error('an export never updates')
    },
    delete: async () => {
      throw new Error('an export never deletes')
    },
  }
  const lookups: LookupAdapter = {
    search: async () => {
      throw new Error('an export never searches a lookup')
    },
    resolve: async (config: LookupConfig, tokens, filters, signal) => {
      resolves.push({ source: config.source, tokens, filters })
      if (resolving === 'wait') {
        const started = performance.now()
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              stopping(signal.reason, performance.now() - started)
              reject(signal.reason)
            },
            { once: true },
          ),
        )
      }
      return tokens.flatMap((token) => (LABELS.has(token) ? [{ token, label: LABELS.get(token) as string }] : []))
    },
    rejects: async () => {
      throw new Error('an export never checks a selection')
    },
  }
  const adapter = {
    kind: 'sqlserver',
    ping: async () => ({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }),
    discover: async () => SNAPSHOT,
    close: async () => {},
  } as DatabaseAdapter
  return {
    ids: () => ['erp', 'crm'],
    scope: () => ({ schemas: ['sales'] }),
    open: async (id) => (id === 'erp' || id === 'crm' ? { adapter, lookups, records } : undefined),
    close: async () => {},
  }
}

async function server(options: { lookupDeadlineMs?: number } = {}): Promise<FastifyInstance> {
  const store = createFileConfigurationStore(root)
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  const app = await createDataServer({
    verifyIdentity,
    runtime: { registry: registry(), store, audit: { sink, now: () => '2026-10-17T12:00:00.000Z' }, ...options },
  })
  apps.push(app)
  return app
}

let app: FastifyInstance

beforeEach(async () => {
  table = [customer(7, 'Muster AG', 'CH'), customer(8, '=1+1', 'DE', 'a, b')]
  lists = []
  beforePage = async () => undefined
  resolves = []
  resolving = 'answer'
  stopping = () => {}
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-exports-'))
  const store = createFileConfigurationStore(root)
  const generated = generateForm(SNAPSHOT, {
    connection: 'erp',
    root: ref('customer'),
    formId: 'customer',
    title: 'Customer',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
    pinned: ['tenant_id'],
  })
  const bundle: PublishedBundle = { format: 1, connection: 'erp', form: generated.form, bindings: generated.bindings, policy: POLICY, snapshot: SNAPSHOT }
  await store.publish('customer', null, bundle)
  await store.publish('customer-crm', null, { ...bundle, connection: 'crm' })
  await store.publish('customer-2', null, bundle)
  await store.publish('hidden', null, { ...bundle, policy: HIDDEN_KEY })
  const line = generateForm(SNAPSHOT, {
    connection: 'erp',
    root: ref('line'),
    formId: 'line',
    title: 'Line',
    lookups: [{ foreignKey: 'fk_line_order', display: ['placed'] }],
  })
  await store.publish('unscoped-line', null, { ...bundle, form: line.form, bindings: line.bindings, policy: UNSCOPED_LINE })
  const tag = generateForm(SNAPSHOT, { connection: 'erp', root: ref('tag'), formId: 'tag', title: 'Tag', lookups: [] })
  await store.publish('tag', null, { ...bundle, form: tag.form, bindings: tag.bindings, policy: TAG_POLICY })
  app = await server()
})

afterEach(async () => {
  vi.useRealTimers()
  for (const each of apps.splice(0)) await each.close()
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const exported = (form: string, payload: unknown = {}, token = 'clerk', on = app) =>
  on.inject({
    method: 'POST',
    url: `/v1/forms/${form}/records/export`,
    headers: { ...as(token), accept: 'text/csv, application/json' },
    payload: payload as Record<string, unknown>,
  })
/** An answer's status and body, a refusal's read as JSON and a file's left as text: a file where a refusal was expected then fails as a file, not as JSON that does not parse. */
const answerOf = (response: Awaited<ReturnType<typeof exported>>) => ({
  status: response.statusCode,
  body: String(response.headers['content-type']).startsWith('application/json') ? response.json<unknown>() : response.body,
})

/** The header row the clerk's file of customers starts with, after the byte-order mark. */
const HEADER = '﻿Tenant id,Customer no,Name,Country,Country (key),Notes\r\n'

describe('the export route', () => {
  // The file is the readable fields in the form's order, each value as a
  // read holds it, a lookup as the label its resolve gave beside its token
  // -- an empty label where the resolve gave none, never the token in its
  // place -- and a formula behind its apostrophe. Answered as a download a
  // browser saves under the form's id, with a length a client can hold the
  // body to, and kept by no cache.
  test('answers the whole file, with the headers a download needs', async () => {
    const response = await exported('customer')
    const file = `${HEADER}1,7,Muster AG,Switzerland,k1:CH,\r\n1,8,'=1+1,,k1:DE,"a, b"\r\n`
    expect({ status: response.statusCode, body: response.body }).toEqual({ status: 200, body: file })
    expect(response.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(response.headers).toMatchObject({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="customer.csv"',
      'content-length': String(Buffer.byteLength(file, 'utf8')),
      'cache-control': 'no-store',
    })
  })

  // An export is every page a list would page through for the same search,
  // sort, parent and filter, from the first: each page the list's own
  // request at the next offset, the body's terms on every one -- the
  // filter's conditions as the planner spells them (0104). Watched failing
  // with every page asked at offset 0 (a file of the first page, repeated,
  // until the moved check refused it), with the sort dropped after the
  // first page, and with the filter dropped after the first page.
  test('pages the list from offset 0 with the body’s search, sort, parent and filter on every page', async () => {
    table = many(120)
    const body = {
      search: ' Customer ',
      sort: [{ field: 'name', direction: 'desc' }],
      parent: { field: 'country', record: 'k1:CH' },
      filter: [
        { field: 'notes', op: 'null' },
        { field: 'customer_no', op: 'range', from: '+01', to: '0200' },
      ],
    }
    const response = await exported('customer', body)
    expect(response.statusCode, response.body).toBe(200)
    expect(lists.map(({ offset, limit }) => [offset, limit])).toEqual([
      [0, LIST_PAGE_SIZE],
      [50, LIST_PAGE_SIZE],
      [100, LIST_PAGE_SIZE],
    ])
    for (const page of lists) {
      expect(page).toMatchObject({
        search: { text: 'Customer' },
        sort: [{ column: 'name', direction: 'desc' }, { column: 'tenant_id' }, { column: 'customer_no' }],
        equal: [{ name: 'country_code', value: 'CH' }],
        filter: [
          { op: 'null', column: 'notes' },
          { op: 'range', column: 'customer_no', type: INT32, from: '1', to: '200', before: null },
        ],
        filters: { kind: 'restricted', equal: [{ column: 'tenant_id', value: '1' }] },
      })
    }
    const lines = response.body.split('\r\n')
    expect(lines).toHaveLength(1 + 120 + 1)
    expect(lines[1]).toBe('1,1,Customer 1,Switzerland,k1:CH,')
    expect(lines[120]).toBe('1,120,Customer 120,,,')
  })

  // A label is asked for under the lookup's read filter (0012), the one the
  // host's grid resolves under, once per page for the page's tokens -- so
  // a person who may read and not create gets them. Watched failing with
  // the resolve asked unfiltered, and with the create filter: the reader
  // was refused the file 403.
  test('resolves each page’s labels once, under the lookup’s read filter', async () => {
    table = many(60)
    expect((await exported('customer', {}, 'reader')).statusCode).toBe(200)
    expect(resolves).toEqual([
      { source: expect.any(String), tokens: ['k1:CH'], filters: { kind: 'restricted', equal: [{ column: 'region', type: CODE, value: 'EU' }] } },
      { source: expect.any(String), tokens: ['k1:CH'], filters: { kind: 'restricted', equal: [{ column: 'region', type: CODE, value: 'EU' }] } },
    ])
  })

  // Nothing is exported for a person the host has not vouched for, the
  // policy does not let list, or whose context cannot scope the rows or the
  // labels -- and the port is never asked. A lookup filter the person
  // cannot be given refuses the file where the grid shows tokens: written
  // without labels it would look whole.
  test('is 401 without a token and 403 to whom the policy refuses, asking nothing', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/forms/customer/records/export', payload: {} })).statusCode).toBe(401)
    const refusals = await Promise.all([
      exported('customer', {}, 'stranger'),
      exported('customer', {}, 'clerk-untenanted'),
      exported('customer', {}, 'clerk-unregioned'),
      exported('hidden'),
      exported('unscoped-line'),
      exported('nope'),
    ])
    expect(refusals.map((response) => [response.statusCode, response.json().code])).toEqual([
      [403, 'operation-denied'],
      [403, 'missing-attribute'],
      [403, 'missing-attribute'],
      [403, 'field-denied'],
      [403, 'operation-unavailable'],
      [404, 'unknown-form'],
    ])
    expect({ lists, resolves }).toEqual({ lists: [], resolves: [] })
  })

  // The server pages from the first record to the last; a body that names
  // a page, or anything else, is a request this route does not read. A
  // filter is a list's, refused as a list refuses it: one of another shape
  // `malformed`, and a condition the form does not offer `not-filterable`
  // in the planner's sentence, which names the field and never the value
  // (0104) -- before any statement, so no page of a file is made under a
  // filter a grid would have been refused. Watched failing with
  // `not-filterable` left out of `planRefusal`: each was a 500.
  test('refuses an offset, a limit, a filter not offered or anything else in the body 400, asking nothing', async () => {
    for (const body of [
      { offset: 0 },
      { limit: 10 },
      { columns: ['name'] },
      { sort: [{ field: 'notes', direction: 'sideways' }] },
      { filter: [{ field: 'name', op: 'like', value: 'M%' }] },
    ]) {
      const response = await exported('customer', body)
      expect({ body, status: response.statusCode, code: response.json().code }).toEqual({ body, status: 400, code: 'malformed' })
    }
    expect((await exported('customer', { sort: [{ field: 'country', direction: 'asc' }] })).json()).toMatchObject({ code: 'not-sortable' })
    for (const [condition, message] of [
      [{ field: 'country', op: 'equals', value: 'k1:CH' }, 'country is not a field you may filter this list by.'],
      [{ field: 'customer_no', op: 'equals', value: '98765x' }, 'A value given for customer_no is not one it can hold.'],
      [{ field: 'name', op: 'not-null' }, 'name offers no not-null condition.'],
    ] as const) {
      const response = await exported('customer', { filter: [condition] })
      expect({ condition, answer: answerOf(response) }).toEqual({ condition, answer: { status: 400, body: { code: 'not-filterable', message } } })
      expect(response.body).not.toMatch(/98765|k1:CH/)
    }
    expect(lists).toEqual([])
  })

  // Past EXPORT_MAX_BYTES the file is refused whole: a 200 of what fit
  // would be a truncated file that looks whole. One customer is a million
  // bytes of notes, so sixteen fit under 16 MiB and the seventeenth does
  // not; the trail says how many records were read into it. Watched
  // failing with a 200 of what fit.
  test('refuses a file past its byte budget 422, with nothing of it', async () => {
    table = many(60, 'x'.repeat(1_000_000))
    expect(16 * 1_000_000 < EXPORT_MAX_BYTES && 17 * 1_000_000 > EXPORT_MAX_BYTES).toBe(true)
    const response = await exported('customer')
    expect({ status: response.statusCode, body: response.json() }).toEqual({
      status: 422,
      body: { code: 'export-too-large', message: 'The file would be larger than 16 MB. Search for fewer records and try again.' },
    })
    expect(response.body).not.toContain('xxxx')
    expect(events.map(({ outcome, rows }) => ({ outcome, rows }))).toEqual([{ outcome: 'export-too-large', rows: 16 }])
  })

  // The deadline is checked before every page and every resolve: a slow
  // page that passes it ends the export with 503 and nothing of the file --
  // before the next page where its own records needed no labels, and
  // before its labels where they did. The clock is moved by the page
  // itself, so the case runs in no time against the real budget. Watched
  // failing with the check before each page removed: the second page was
  // asked and the file answered 200.
  test('refuses a file not made within its deadline 503, with nothing of it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    beforePage = async () => {
      vi.setSystemTime(Date.now() + EXPORT_DEADLINE_MS)
      return undefined
    }
    const timedOut = {
      status: 503,
      body: { code: 'export-timeout', message: 'The file could not be made within 30 seconds. Search for fewer records and try again.' },
    }
    table = Array.from({ length: 60 }, (_, index) => customer(index + 1, 'Unlabelled'))
    const unlabelled = await exported('customer')
    expect({ status: unlabelled.statusCode, body: unlabelled.json() }).toEqual(timedOut)
    expect(lists).toHaveLength(1)
    table = many(60)
    const labelled = await exported('customer')
    expect({ status: labelled.statusCode, body: labelled.json() }).toEqual(timedOut)
    expect({ lists: lists.length, resolves }).toEqual({ lists: 2, resolves: [] })
    expect(events.map(({ outcome, rows }) => ({ outcome, rows }))).toEqual([
      { outcome: 'export-timeout', rows: 50 },
      { outcome: 'export-timeout', rows: 0 },
    ])
  })

  // A page is decided over the description its own statement carried, as a
  // list's is (0041): drift on the third page refuses the file, and nothing
  // of the first two reaches the body.
  test('refuses a file whose third page drift stops 409, with nothing of the first two', async () => {
    table = many(120)
    beforePage = async (request) => (request.offset === 100 ? { ok: true, described: RETYPED, rows: table.slice(100) } : undefined)
    const response = await exported('customer')
    expect({ status: response.statusCode, code: response.json().code }).toEqual({ status: 409, code: 'drift' })
    expect(response.body).not.toContain('Customer 1')
    expect(lists).toHaveLength(3)
  })

  // Each page is its own statement, so a row deleted before the offset
  // between two pages moves the next page up a row, and a record already
  // written appears again. The file is refused rather than holding a
  // record twice. Watched failing with the tokens kept per page only.
  test('refuses a file in which a record would appear twice 409 moved', async () => {
    table = many(60)
    table[50] = table[0] as Stored
    const response = await exported('customer')
    expect({ status: response.statusCode, body: response.json() }).toEqual({
      status: 409,
      body: { code: 'moved', message: 'The records changed while the file was made. Try again.' },
    })
  })

  // A record whose key needs more characters as a token than a token holds
  // is listed with none, and written, its fields being its data -- so a
  // check kept on tokens passes it by: one written from the first page and
  // repeated by the second would be in a file sent 200 twice. The check is
  // on the key itself. Watched failing with the check kept on tokens: 200.
  test('refuses a file in which a record whose key fits no token would appear twice 409 moved', async () => {
    table = Array.from({ length: 60 }, (_, index) => ({
      values: { code: `${'k'.repeat(250)}${String(index + 1).padStart(2, '0')}`, name: `Tag ${String(index + 1)}` },
      version: VERSION,
    }))
    // A guard on the guard: these records have no token, and a file of them, moved by nothing, is whole.
    const listed = await app.inject({ method: 'POST', url: '/v1/forms/tag/records/list', headers: as('clerk'), payload: {} })
    expect(listed.json<{ rows: Array<{ record: string | null }> }>().rows.map(({ record }) => record)).toEqual(
      Array.from({ length: LIST_PAGE_SIZE }, () => null),
    )
    const whole = await exported('tag')
    expect({ status: whole.statusCode, lines: whole.body.split('\r\n').length }).toEqual({ status: 200, lines: 1 + 60 + 1 })
    table[50] = table[0] as Stored
    const response = await exported('tag')
    const written = response.body.split('\r\n').filter((line) => line.endsWith(',Tag 1')).length
    expect({ status: response.statusCode, written }).toEqual({ status: 409, written: 0 })
    expect(response.json()).toEqual({ code: 'moved', message: 'The records changed while the file was made. Try again.' })
  })

  // A value UTF-8 cannot carry -- an unpaired surrogate SQL Server keeps --
  // refuses the file, naming the column and never the value; and so does a
  // label of the form's own, refused before any statement.
  test('refuses a file with text UTF-8 cannot carry 409 unencodable, naming the column', async () => {
    table = [customer(7, 'Muster AG'), customer(8, 'Zug\uD800AG')]
    const response = await exported('customer')
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ code: 'unencodable', message: 'Name holds text a CSV file cannot carry: an unpaired surrogate or a NUL character.' })

    const generated = generateForm(SNAPSHOT, {
      connection: 'erp',
      root: ref('customer'),
      formId: 'odd',
      title: 'Customer',
      lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
      pinned: ['tenant_id'],
    })
    const fields = generated.form.model.fields.map((field) => (field.key === 'name' ? { ...field, label: 'Na\uD800me' } : field))
    await createFileConfigurationStore(root).publish('odd', null, {
      format: 1,
      connection: 'erp',
      form: { ...generated.form, model: { ...generated.form.model, fields } },
      bindings: generated.bindings,
      policy: POLICY,
      snapshot: SNAPSHOT,
    })
    lists = []
    const header = await exported('odd')
    expect({ status: header.statusCode, body: header.json(), lists }).toEqual({
      status: 409,
      body: { code: 'unencodable', message: 'The header of column 3 holds text a CSV file cannot carry: an unpaired surrogate or a NUL character.' },
      lists: [],
    })
  })

  // A binary, rowversion or unsupported column has no text a cell could
  // hold. The generator never makes a field of one, and a format-2 bundle
  // is held to what it generates; a format-1 bundle is served as it was
  // stored, and one edited where it is stored can bind one, which
  // validateBundle accepts -- shown here, the fact 0079's design left
  // open. Its list is answered; its file is a 500 with nothing of it,
  // never a cell that is not the value.
  test('answers a form that binds a column with no text 500, with nothing of the file', async () => {
    const generated = generateForm(SNAPSHOT, {
      connection: 'erp',
      root: ref('customer'),
      formId: 'photo',
      title: 'Customer',
      lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
      pinned: ['tenant_id'],
    })
    expect(generated.bindings.fields.map((binding) => binding.field)).not.toContain('photo')
    const notes = generated.form.model.fields.find((field) => field.key === 'notes')
    const photo: FieldBinding = { kind: 'column', field: 'photo', column: 'photo', type: PHOTO, nullable: true, writes: { create: false, update: false } }
    await createFileConfigurationStore(root).publish('photo', null, {
      format: 1,
      connection: 'erp',
      form: {
        ...generated.form,
        model: {
          ...generated.form.model,
          fields: [...generated.form.model.fields, { ...notes, key: 'photo', label: 'Photo' } as (typeof generated.form.model.fields)[number]],
        },
      },
      bindings: { ...generated.bindings, fields: [...generated.bindings.fields, photo] },
      policy: { ...POLICY, fields: { ...POLICY.fields, photo: { read: ['clerk'], write: [] } } },
      snapshot: SNAPSHOT,
    })
    table = [{ ...customer(7, 'Muster AG'), values: { ...customer(7, 'Muster AG').values, photo: 'ffd8ff' } }]
    const listed = await app.inject({ method: 'POST', url: '/v1/forms/photo/records/list', headers: as('clerk'), payload: {} })
    expect(listed.statusCode, listed.body).toBe(200)
    const response = await exported('photo')
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toMatch(/Muster|ffd8ff/)
  })

  // One export at a time per connection: a second meanwhile is refused
  // before any statement -- of the same form, and of another form on that
  // connection, since the bound is on the pool's connections and not on a
  // form -- the first is answered whole, and an export from another
  // connection is not held up. Watched failing without the gate: both ran;
  // and with the gate kept per form: customer-2's file was made beside
  // customer's, 200.
  test('refuses a second export from the same connection meanwhile 503 export-busy', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => {}
    const asked = new Promise<void>((resolve) => {
      started = resolve
    })
    beforePage = async () => {
      if (lists.length === 1) {
        started()
        await held
      }
      return undefined
    }
    const first = exported('customer')
    await asked
    const busy = { status: 503, body: { code: 'export-busy', message: "Another file is being made from this form's database. Try again in a moment." } }
    expect(answerOf(await exported('customer'))).toEqual(busy)
    expect(answerOf(await exported('customer-2'))).toEqual(busy)
    expect(lists).toHaveLength(1)
    expect((await exported('customer-crm')).statusCode).toBe(200)
    release()
    const answered = await first
    expect({ status: answered.statusCode, body: answered.body }).toEqual({
      status: 200,
      body: `${HEADER}1,7,Muster AG,Switzerland,k1:CH,\r\n1,8,'=1+1,,k1:DE,"a, b"\r\n`,
    })
    expect((await exported('customer')).statusCode).toBe(200)
  })

  // Labels are a statement too, with the lookup's deadline (0061): one past
  // it refuses the file `unavailable`, which invites another try, and no
  // file of empty labels is sent.
  test('refuses a file whose labels pass the lookup deadline 503 unavailable', async () => {
    resolving = 'wait'
    const short = await server({ lookupDeadlineMs: 50 })
    const response = await exported('customer', {}, 'clerk', short)
    expect({ status: response.statusCode, body: response.json() }).toEqual({
      status: 503,
      body: { code: 'unavailable', message: 'The labels of the records could not be loaded, so no file was made.' },
    })
  })

  // A resolve gets the lookup's deadline cut to what is left of the
  // export's: with 40 ms left of the file's 30 s, a resolve given the
  // lookup's whole minute would hold the file, the gate and its connection
  // that long past the export's own deadline. The resolve stops when the
  // export's time is up, and the file is refused export-timeout. The page
  // leaves 40 ms; the resolve, once its signal aborts, moves the clock by
  // the time it really waited. Watched failing with the lookup's own
  // deadline given: the signal said 60000 ms, a minute later.
  test('gives a page’s labels only what is left of the export’s deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const LEFT_MS = 40
    beforePage = async () => {
      vi.setSystemTime(Date.now() + EXPORT_DEADLINE_MS - LEFT_MS)
      return undefined
    }
    let stoppedWith: unknown
    resolving = 'wait'
    stopping = (reason, waitedMs) => {
      stoppedWith = reason
      vi.setSystemTime(Date.now() + Math.ceil(waitedMs) + 1)
    }
    const long = await server({ lookupDeadlineMs: 60_000 })
    table = many(10)
    const response = await exported('customer', {}, 'clerk', long)
    expect({ status: response.statusCode, body: response.json() }).toEqual({
      status: 503,
      body: { code: 'export-timeout', message: 'The file could not be made within 30 seconds. Search for fewer records and try again.' },
    })
    expect(stoppedWith).toMatchObject({ name: 'TimeoutError', message: `The lookup passed its deadline of ${String(LEFT_MS)} ms.` })
    expect(events.map(({ status, outcome, rows }) => ({ status, outcome, rows }))).toEqual([{ status: 503, outcome: 'export-timeout', rows: 0 }])
  })

  // A person who leaves while a page's labels are being resolved stops the
  // resolve in the database (0061), and the export is abandoned, not
  // unavailable: a refusal that invites another try for nobody would tell
  // the trail the database failed. Watched failing with the abandonment
  // left unasked after a resolve: the trail said 503 unavailable.
  test('stops a resolve when the client leaves, and audits 499 abandoned', async () => {
    resolving = 'wait'
    table = many(10)
    const listening = await server({ lookupDeadlineMs: 60_000 })
    await listening.listen({ host: '127.0.0.1', port: 0 })
    const closed = new Promise<void>((resolve) => listening.server.on('connection', (socket: Socket) => socket.once('close', () => resolve())))
    const controller = new AbortController()
    const base = `http://127.0.0.1:${String((listening.server.address() as AddressInfo).port)}`
    const sent = fetch(`${base}/v1/forms/customer/records/export`, {
      method: 'POST',
      headers: { ...as('clerk'), 'content-type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    })
    while (resolves.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    await expect(sent).rejects.toThrow()
    await closed
    while (events.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    expect({ lists: lists.length, resolves: resolves.length }).toEqual({ lists: 1, resolves: 1 })
    expect(events.map(({ status, outcome, rows }) => ({ status, outcome, rows }))).toEqual([{ status: 499, outcome: 'abandoned', rows: 0 }])
  })

  // A person who leaves stops the export before its next statement; the
  // statement in flight finishes in the database. The trail's event says
  // 499 abandoned, with the records read before. Watched failing with no
  // check between pages: the second page was asked for nobody. Until that
  // statement returns, the export keeps its connection's gate, though
  // nobody waits for the file -- the statement holds one of the pool's
  // connections, which is what the gate bounds -- so another export from
  // that connection is refused export-busy meanwhile, the cost 0079 states.
  // Watched failing with the gate given back when the client left: the
  // other form's file was made beside the statement, 200.
  test('stops at the next page when the client leaves, and audits 499 abandoned', async () => {
    // No country, so no resolve: the check between the pages is the one that stops it.
    table = Array.from({ length: 60 }, (_, index) => customer(index + 1, 'Unlabelled'))
    const listening = await server()
    await listening.listen({ host: '127.0.0.1', port: 0 })
    const closed = new Promise<void>((resolve) => listening.server.on('connection', (socket: Socket) => socket.once('close', () => resolve())))
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    beforePage = async () => {
      if (lists.length === 1) await held
      return undefined
    }
    const controller = new AbortController()
    const base = `http://127.0.0.1:${String((listening.server.address() as AddressInfo).port)}`
    const sent = fetch(`${base}/v1/forms/customer/records/export`, {
      method: 'POST',
      headers: { ...as('clerk'), 'content-type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    })
    while (lists.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    await expect(sent).rejects.toThrow()
    await closed
    expect(answerOf(await exported('customer-2', {}, 'clerk', listening))).toMatchObject({ status: 503, body: { code: 'export-busy' } })
    release()
    while (events.length < 2) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(lists).toHaveLength(1)
    expect(events.map(({ form, status, outcome, rows }) => ({ form, status, outcome, rows }))).toEqual([
      { form: 'customer-2', status: 503, outcome: 'export-busy', rows: 0 },
      { form: 'customer', status: 499, outcome: 'abandoned', rows: 50 },
    ])
    expect((await exported('customer-2', {}, 'clerk', listening)).statusCode).toBe(200)
  })

  // One event per export, named `export`, naming no record, with how many
  // records the file holds -- never the search, the sort, the parent, the
  // filter or a value (0023): a filter's value is a person's data, as a
  // search is. Watched failing with `rows` left null for an export.
  test('is audited as export, with the rows and nothing the person sent', async () => {
    await exported('customer', {
      search: 'Muster',
      sort: [{ field: 'name', direction: 'asc' }],
      parent: { field: 'country', record: 'k1:CH' },
      filter: [{ field: 'notes', op: 'contains', text: 'filter-marker-0c7a' }],
    })
    await exported('customer', {}, 'stranger')
    await exported('customer', { filter: [{ field: 'customer_no', op: 'equals', value: '98765x' }] })
    expect(events).toEqual([
      {
        at: '2026-10-17T12:00:00.000Z',
        plane: 'runtime',
        actor: 'c',
        operation: 'export',
        form: 'customer',
        formVersion: 1,
        status: 200,
        outcome: 'ok',
        record: null,
        rows: 2,
      },
      {
        at: '2026-10-17T12:00:00.000Z',
        plane: 'runtime',
        actor: 's',
        operation: 'export',
        form: 'customer',
        formVersion: 1,
        status: 403,
        outcome: 'operation-denied',
        record: null,
        rows: 0,
      },
      {
        at: '2026-10-17T12:00:00.000Z',
        plane: 'runtime',
        actor: 'c',
        operation: 'export',
        form: 'customer',
        formVersion: 1,
        status: 400,
        outcome: 'not-filterable',
        record: null,
        rows: 0,
      },
    ])
    expect(JSON.stringify(events)).not.toMatch(/Muster|k1:|"name"|filter-marker|98765|notes/)
  })
})
