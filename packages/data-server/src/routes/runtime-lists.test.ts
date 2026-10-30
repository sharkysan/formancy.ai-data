import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, CURSOR_GONE, describedOf, EMPTY_PRESENTATION, generateForm, LIST_PAGE_SIZE, listColumns } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, Described, DescribedTable, FormBindings, FormPolicy, GenerationRequest, ListOutcome, ListRequest, ListView, LookupAdapter, NormalizedType, ObjectRef, RecordAdapter } from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import { MAX_RESOLVE } from './runtime.js'

/*
 * `POST /v1/forms/:id/records/list` over fake ports (0044). What the
 * database does with a list is the adapter suites' business, against real
 * servers (0003); what is under test here is what the route decides before
 * and after: who may list, what reaches the port, how a page and a refusal
 * are answered, and what the trail says.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const NAME: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })
const fk = (name: string, columns: string[], target: string, targetColumns: string[]) => ({ name, columns, references: { table: ref(target), columns: targetColumns }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }) as const

const SNAPSHOT = createSnapshot({
  kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    {
      ref: ref('country'), kind: 'table', comment: null,
      columns: [col('id', 1, INT32, { generated: 'identity-always' }), col('iso_code', 2, { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }), col('name', 3, NAME)],
      primaryKey: { name: 'pk_country', columns: ['id'] }, uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
    {
      ref: ref('customer'), kind: 'table', comment: null,
      columns: [
        col('tenant_id', 1, INT32),
        col('customer_no', 2, INT32),
        col('name', 3, NAME),
        col('country_code', 4, { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }, { nullable: true }),
        col('credit_limit', 5, { kind: 'decimal', precision: 14, scale: 2 }, { nullable: true }),
        col('row_version', 6, { kind: 'rowversion' }, { generated: 'rowversion' }),
      ],
      primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] }, uniqueKeys: [], foreignKeys: [fk('fk_customer_country', ['country_code'], 'country', ['iso_code'])], checks: [], rowSecurity: 'none',
    },
    {
      ref: ref('order'), kind: 'table', comment: null,
      columns: [col('id', 1, INT32), col('tenant_id', 2, INT32), col('placed', 3, { kind: 'date' })],
      primaryKey: { name: 'pk_order', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
    {
      ref: ref('tag'), kind: 'table', comment: null,
      columns: [col('id', 1, { kind: 'uuid' }), col('day', 2, { kind: 'date' })],
      primaryKey: { name: 'pk_tag', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
    {
      ref: ref('line'), kind: 'table', comment: null,
      columns: [col('order_id', 1, INT32), col('line_no', 2, INT32), col('quantity', 3, INT32), col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' })],
      primaryKey: { name: 'pk_line', columns: ['order_id', 'line_no'] }, uniqueKeys: [], foreignKeys: [fk('fk_line_order', ['order_id'], 'order', ['id'])], checks: [], rowSecurity: 'none',
    },
  ],
})

const RW = { read: ['clerk'], write: ['clerk'] }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]

const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { tenant_id: { read: ['clerk'], write: [] }, customer_no: RW, name: RW, country: RW, credit_limit: RW },
  rowFilters: TENANT,
  lookups: { country: [] },
}
/** The same form with customer_no, half its key, kept from the clerk: a list would hand out tokens spelling it. */
const HIDDEN_KEY: FormPolicy = { ...POLICY, fields: { ...POLICY.fields, customer_no: { read: [], write: ['clerk'] } } }
/** The same form with the credit limit kept from the clerk, who may still write it: listed, but never by it. */
const HIDDEN_LIMIT: FormPolicy = { ...POLICY, fields: { ...POLICY.fields, credit_limit: { read: [], write: ['clerk'] } } }
/** An order's lines, through their order (0043). */
const LINE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { order: RW, line_no: RW, quantity: RW },
  rowFilters: [],
  lookups: { order: TENANT },
  through: ['order'],
}

/** A tag has no field a search can match: a uuid key and a date. */
const TAG_POLICY: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: { id: RW, day: RW }, rowFilters: [], lookups: {} }

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } }
    : token === 'stranger' ? { ok: true, identity: { actor: { id: 's', roles: [] }, attributes: { tenant: '1' } } }
    : token === 'clerk-untenanted' ? { ok: true, identity: { actor: { id: 'u', roles: ['clerk'] }, attributes: {} } }
      : { ok: false, reason: 'bad' }

const VERSION = '00000000000007d1'
const STORED = { values: { tenant_id: '1', customer_no: '7', name: 'Muster AG', country_code: 'CH', credit_limit: null }, version: VERSION }
const DEFINITION = 'the definition the fake catalog described'
const KEY = 'an-audit-key-the-operator-keeps-secret'
/** Planted in a filter, where no audit event or log line may look. */
const FILTERED = 'filter-marker-5b9e'
/** The customer form's views (0105): one the grid opens on, by a credit limit, and one by name. */
const LARGE: ListView = { name: 'Large accounts', filter: [{ field: 'credit_limit', op: 'range', from: '1000.00', to: null }], sort: [], default: true }
const MUSTER: ListView = { name: 'Muster', filter: [{ field: 'name', op: 'contains', text: 'Muster' }], sort: [{ field: 'name', direction: 'asc' }] }

const describedAs = (table: ObjectRef, edit: (columns: DescribedTable['columns']) => void = () => {}): DescribedTable => {
  const found = describedOf(SNAPSHOT, table)
  if (found === undefined) throw new Error(`the snapshot has no ${table.name}`)
  const columns = found.columns.map((column) => ({ ...column }))
  edit(columns)
  return { ...found, columns, definition: DEFINITION }
}
/** The customer's name retyped to an integer: the form can no longer show its records faithfully. */
const RETYPED = describedAs(ref('customer'), (columns) => Object.assign(columns.find((column) => column.name === 'name') as object, { type: INT32, databaseType: 'int' }))
/** The customer's key gone: two rows can now share one. A read by token still shows what it finds. */
const KEY_GONE: DescribedTable = { ...describedAs(ref('customer')), primaryKey: null }
/** customer_no made nullable under a unique key over the same columns: rows with a NULL there have no token and no defined order. */
const KEY_NULLABLE: DescribedTable = {
  ...describedAs(ref('customer'), (columns) => Object.assign(columns.find((column) => column.name === 'customer_no') as object, { nullable: true })),
  primaryKey: null,
  uniqueKeys: [{ name: 'uq_customer', columns: ['tenant_id', 'customer_no'] }],
}

let lists: ListRequest[]
let describes: number
/** What the fake list answers; undefined is the table as published, beside one page of the stored customer, or none of anything else. */
let listOutcome: ListOutcome | undefined
/** What the fake catalog says to `describe`; undefined is the published snapshot's. */
let catalog: Described | undefined
let events: RuntimeAuditEvent[]
let root: string
let app: FastifyInstance
let customers: FormBindings

function registry(): ConnectionRegistry {
  const records: RecordAdapter = {
    describe: async (table) => {
      describes += 1
      return catalog ?? { ok: true, described: describedAs(table) }
    },
    read: async () => {
      throw new Error('a list never reads a record by its token')
    },
    list: async (request) => {
      lists.push(request)
      return listOutcome ?? { ok: true, described: describedAs(request.target.table), rows: request.target.table.name === 'customer' ? [STORED] : [], after: request.after === null ? null : 'found' }
    },
    insert: async () => {
      throw new Error('a list never inserts')
    },
    update: async () => {
      throw new Error('a list never updates')
    },
    supersede: async () => {
      throw new Error('these routes never change a version from a date')
    },
    delete: async () => {
      throw new Error('a list never deletes')
    },
  }
  const lookups: LookupAdapter = { search: async () => ({ rows: [], hasMore: false, omitted: 0 }), resolve: async () => [], rejects: async () => [] }
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }), discover: async () => SNAPSHOT, close: async () => {} } as DatabaseAdapter
  return { ids: () => ['erp'], scope: () => ({ schemas: ['sales'] }), open: async (id) => (id === 'erp' ? { adapter, lookups, records } : undefined), close: async () => {} }
}

beforeEach(async () => {
  lists = []
  describes = 0
  listOutcome = undefined
  catalog = undefined
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-lists-'))
  const store = createFileConfigurationStore(root)
  const generation: GenerationRequest = { connection: 'erp', root: ref('customer'), formId: 'customer', title: 'Customer', lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }], pinned: ['tenant_id'] }
  const customer = generateForm(SNAPSHOT, generation)
  customers = customer.bindings
  const bundle: PublishedBundle = { format: 1, connection: 'erp', form: customer.form, bindings: customer.bindings, policy: POLICY, snapshot: SNAPSHOT }
  await store.publish('customer', null, bundle)
  const viewed: PublishedBundle = { ...bundle, format: 2, generation, base: customer.form, presentation: { ...EMPTY_PRESENTATION, views: [LARGE, MUSTER] } }
  await store.publish('viewed', null, viewed)
  await store.publish('viewed-hidden-limit', null, { ...viewed, policy: HIDDEN_LIMIT })
  await store.publish('hidden', null, { ...bundle, policy: HIDDEN_KEY })
  await store.publish('hidden-limit', null, { ...bundle, policy: HIDDEN_LIMIT })
  const line = generateForm(SNAPSHOT, { connection: 'erp', root: ref('line'), formId: 'line', title: 'Line', lookups: [{ foreignKey: 'fk_line_order', display: ['placed'] }] })
  await store.publish('line', null, { ...bundle, form: line.form, bindings: line.bindings, policy: LINE_POLICY })
  const { through: _through, ...unscoped } = LINE_POLICY
  await store.publish('unscoped-line', null, { ...bundle, form: line.form, bindings: line.bindings, policy: unscoped })
  const tag = generateForm(SNAPSHOT, { connection: 'erp', root: ref('tag'), formId: 'tag', title: 'Tag', lookups: [] })
  await store.publish('tag', null, { ...bundle, form: tag.form, bindings: tag.bindings, policy: TAG_POLICY })
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  app = await createDataServer({ verifyIdentity, runtime: { registry: registry(), store, audit: { sink, key: KEY, now: () => '2026-10-11T12:00:00.000Z' } } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const list = (form: string, payload: unknown, token = 'clerk') => app.inject({ method: 'POST', url: `/v1/forms/${form}/records/list`, headers: as(token), payload: payload as Record<string, unknown> })

describe('the list route', () => {
  // What the route hands the port is the planner's request for what the
  // browser asked, no more: the search trimmed, the order made total, the
  // tenant's filter, the readable fields' columns and the key. And the page
  // comes back as reads do, the extra row telling more from the last page.
  // Watched failing with the route paging from the first row whatever
  // cursor was sent.
  test('hands the port the planned request, and answers each row as a read would', async () => {
    const response = await list('customer', { search: ' Muster ', sort: [{ field: 'credit_limit', direction: 'desc' }], after: 'c1:1,6', limit: 25 })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ rows: [{ record: 'k1:1,7', version: VERSION, answers: { tenant_id: 1, customer_no: 7, name: 'Muster AG', country: 'k1:CH', credit_limit: null } }], hasMore: false, next: null })
    expect(lists).toEqual([
      {
        target: { table: ref('customer'), identity: [{ name: 'tenant_id', type: INT32 }, { name: 'customer_no', type: INT32 }], concurrency: { kind: 'rowversion', column: 'row_version' } },
        columns: [
          { name: 'tenant_id', type: INT32 },
          { name: 'customer_no', type: INT32 },
          { name: 'name', type: NAME },
          { name: 'country_code', type: { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true } },
          { name: 'credit_limit', type: { kind: 'decimal', precision: 14, scale: 2 } },
        ],
        filters: { kind: 'restricted', equal: [{ column: 'tenant_id', type: INT32, value: '1' }] },
        through: [],
        equal: [],
        filter: [],
        search: { text: 'Muster', columns: [{ name: 'tenant_id', type: INT32 }, { name: 'customer_no', type: INT32 }, { name: 'name', type: NAME }] },
        sort: [
          { column: 'credit_limit', direction: 'desc', nulls: 'last' },
          { column: 'tenant_id', direction: 'asc', nulls: null },
          { column: 'customer_no', direction: 'asc', nulls: null },
        ],
        after: [
          { name: 'tenant_id', type: INT32, value: '1' },
          { name: 'customer_no', type: INT32, value: '6' },
        ],
        offset: 0,
        limit: 25,
      },
    ])
    // More follow: the page's cursor is its last row's key, which the next page is asked for after (0108).
    listOutcome = { ok: true, described: describedAs(ref('customer')), rows: [STORED, { ...STORED, values: { ...STORED.values, customer_no: '8' } }], after: null }
    expect((await list('customer', { limit: 1 })).json()).toMatchObject({ rows: [{ record: 'k1:1,7' }], hasMore: true, next: 'c1:1,7' })
    // An empty body is the first page, in key order, of the largest page.
    expect((await list('customer', {})).statusCode).toBe(200)
    expect(lists.at(-1)).toMatchObject({ search: null, after: null, offset: 0, limit: LIST_PAGE_SIZE, sort: [{ column: 'tenant_id' }, { column: 'customer_no' }] })
  })

  // A cursor that names no key of this form is the client's mistake, said
  // before any statement; an offset is what a list took before 0108, and a
  // client still sending one is told rather than shown the first page again.
  // Watched failing with the planner's refusal left unmapped: 500.
  test('refuses a cursor naming no key of the form, and an offset, without asking the port', async () => {
    for (const [payload, code] of [
      [{ after: 'k1:1,7' }, 'invalid-cursor'],
      [{ after: 'c1:1' }, 'invalid-cursor'],
      [{ after: 'c1:1,07' }, 'invalid-cursor'],
      [{ after: 7 }, 'malformed'],
      [{ offset: 50 }, 'malformed'],
    ] as const) {
      const response = await list('customer', payload)
      expect({ status: response.statusCode, code: response.json().code }, JSON.stringify(payload)).toEqual({ status: 400, code })
    }
    expect(lists).toEqual([])
  })

  // The page's statement looks for the row it continues after (0108):
  // gone -- deleted, or no longer one the person may read -- the page has
  // no place to start. 409, the first page being where to start again, and
  // nothing of the rows in the body; said in the log and the audit as the
  // list it is. Watched failing with the outcome's answer left unread: 200
  // and an empty page that said nothing follows.
  test('refuses a page after a row its statement found gone', async () => {
    listOutcome = { ok: true, described: describedAs(ref('customer')), rows: [STORED], after: 'gone' }
    const response = await list('customer', { after: 'c1:1,6' })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ code: 'cursor-gone', message: CURSOR_GONE })
    expect(response.body).not.toContain('Muster')
    expect(events.at(-1)).toMatchObject({ operation: 'list', status: 409, outcome: 'cursor-gone', record: null })
  })

  // A line has no tenant (0043): its list carries the order's through to the
  // port, and a parent narrows it to one order's lines by the order's key.
  test("carries a line's through and its parent to the port", async () => {
    expect((await list('line', { parent: { field: 'order', record: 'k1:42' } })).statusCode).toBe(200)
    expect(lists[0]).toMatchObject({
      filters: { kind: 'unrestricted' },
      through: [{ columns: [{ name: 'order_id', type: INT32 }], target: ref('order'), targetColumns: [{ name: 'id', type: INT32 }], filters: { kind: 'restricted', equal: [{ column: 'tenant_id', value: '1' }] } }],
      equal: [{ name: 'order_id', type: INT32, value: '42' }],
    })
  })

  // A person's filter reaches the port as `columnFilter` plans each
  // condition (0104): by the field's column, the text a contains finds
  // trimmed, a number spelled as its column reads it back -- no plus, no
  // leading zero, a decimal padded to its scale -- and beside the tenant's
  // own filter, which it narrows and never replaces. Watched failing with
  // the route planning the body's query with its filter dropped: the port
  // was handed `filter: []`, a list of every customer.
  test('hands the port each condition as the planner spells it, beside the tenant’s filter', async () => {
    const response = await list('customer', {
      filter: [
        { field: 'name', op: 'contains', text: ' Muster ' },
        { field: 'customer_no', op: 'equals', value: ' +007 ' },
        { field: 'credit_limit', op: 'range', from: '-1.5', to: null },
      ],
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(lists).toHaveLength(1)
    expect(lists[0]?.filters).toEqual({ kind: 'restricted', equal: [{ column: 'tenant_id', type: INT32, value: '1' }] })
    expect(lists[0]?.filter).toEqual([
      { op: 'contains', column: 'name', type: NAME, text: 'Muster' },
      { op: 'equals', column: 'customer_no', type: INT32, value: '7' },
      { op: 'range', column: 'credit_limit', type: { kind: 'decimal', precision: 14, scale: 2 }, from: '-1.50', to: null, before: null },
    ])
    expect((await list('customer', { filter: [{ field: 'credit_limit', op: 'null' }] })).statusCode).toBe(200)
    expect(lists[1]?.filter).toEqual([{ op: 'null', column: 'credit_limit' }])
  })

  // A condition the form does not offer is refused before any statement,
  // 400 `not-filterable` in the planner's own sentence, which names the
  // field and never the value: a lookup, which holds a token and not the
  // label a person reads; an operator its kind has not got; NULL on a
  // column that holds none; a value or a bound it cannot hold; a field the
  // person may not read, which a filter would otherwise disclose one
  // condition at a time; and a field the form does not have. Watched
  // failing with `not-filterable` left out of `planRefusal`: every one
  // was a 500.
  test('refuses a condition the form does not offer 400 not-filterable, naming the field and never the value, and asks nothing', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['customer', { field: 'country', op: 'equals', value: 'k1:CH' }, 'country is not a field you may filter this list by.'],
      ['customer', { field: 'customer_no', op: 'contains', text: '7' }, 'customer_no offers no contains condition.'],
      ['customer', { field: 'name', op: 'null' }, 'name offers no null condition.'],
      ['customer', { field: 'credit_limit', op: 'equals', value: '98765.4321' }, 'A value given for credit_limit is not one it can hold.'],
      ['customer', { field: 'customer_no', op: 'range', from: '98765x', to: null }, 'A value given for customer_no is not one it can hold.'],
      ['hidden-limit', { field: 'credit_limit', op: 'not-null' }, 'credit_limit is not a field you may filter this list by.'],
      ['customer', { field: 'row_version', op: 'not-null' }, 'row_version is not a field you may filter this list by.'],
    ]
    for (const [form, condition, message] of cases) {
      const response = await list(form, { filter: [condition] })
      expect({ condition, status: response.statusCode, body: response.json() }).toEqual({ condition, status: 400, body: { code: 'not-filterable', message } })
      expect(response.body).not.toMatch(/98765|k1:CH/)
    }
    expect(lists).toEqual([])
  })

  // Nothing is listed for a person the host has not vouched for, the policy
  // grants no read, or whose context cannot scope the read -- and the port is
  // never asked.
  test('is 401 without a token, and 403 to a person the policy does not let read', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/forms/customer/records/list', payload: {} })).statusCode).toBe(401)
    expect((await list('customer', {}, 'stranger')).json()).toMatchObject({ code: 'operation-denied' })
    expect((await list('line', {}, 'clerk-untenanted')).json()).toMatchObject({ code: 'missing-attribute' })
    expect((await list('nope', {})).statusCode).toBe(404)
    expect(lists).toEqual([])
  })

  // Each refusal of what the browser sent has its own code and asks nothing
  // of the database: a body with a property this release does not read, a
  // search or a page a lookup would refuse too, a filter of another shape
  // -- a field named twice, an operator with a property it has not got, a
  // range with no bound -- or text to find that a search would refuse, a
  // sort by a lookup field, and a parent that is not a readable lookup or
  // names no row it could.
  test('answers each malformed or unofferable request 400 with its code, and asks nothing', async () => {
    const cases: Array<[unknown, string, string]> = [
      [{ filters: [] }, 'customer', 'malformed'],
      [{ filter: { name: 'Muster' } }, 'customer', 'malformed'],
      [{ filter: [{ field: 'name', op: 'equals', value: 'a' }, { field: 'name', op: 'contains', text: 'b' }] }, 'customer', 'malformed'],
      [{ filter: [{ field: 'name', op: 'contains', text: 'a', value: 'b' }] }, 'customer', 'malformed'],
      [{ filter: [{ field: 'credit_limit', op: 'range', from: null, to: null }] }, 'customer', 'malformed'],
      [{ filter: [{ field: 'name', op: 'like', value: 'a%' }] }, 'customer', 'malformed'],
      [{ filter: [{ field: 'name', op: 'contains', text: 'x'.repeat(201) }] }, 'customer', 'not-filterable'],
      [{ sort: [{ field: 'name', direction: 'sideways' }] }, 'customer', 'malformed'],
      [{ search: 'x'.repeat(201) }, 'customer', 'search-too-long'],
      [{ search: 'a\u0000b' }, 'customer', 'search-control-character'],
      [{ offset: -1 }, 'customer', 'malformed'],
      [{ after: 'c1:1,x' }, 'customer', 'invalid-cursor'],
      [{ limit: LIST_PAGE_SIZE + 1 }, 'customer', 'limit-out-of-range'],
      [{ sort: [{ field: 'country', direction: 'asc' }] }, 'customer', 'not-sortable'],
      [{ search: 'x' }, 'tag', 'not-searchable'],
      [{ parent: { field: 'name', record: 'k1:7' } }, 'customer', 'invalid-request'],
      [{ parent: { field: 'order', record: 'k1:007' } }, 'line', 'invalid-record-token'],
    ]
    for (const [body, form, code] of cases) {
      const response = await list(form, body)
      expect({ body, status: response.statusCode, code: response.json().code }).toEqual({ body, status: 400, code })
    }
    expect(lists).toEqual([])
  })

  // A list hands out a token for every row it admits, and a token spells the
  // key. A person kept from customer_no is refused a list rather than handed
  // every customer number -- and `GET` offers them none, so a page never
  // shows a grid the server refuses. Watched failing with `GET` offering the
  // list whatever `listable` says.
  test('refuses a list whose key the person may not read, and the form offers none', async () => {
    const refused = await list('hidden', {})
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual({ code: 'field-denied', message: "This form's records are named by fields you may not read, so they are not listed for you." })
    expect(lists).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/v1/forms/hidden', headers: as('clerk') })).json().list).toBeNull()
  })

  // A line form published as 0043 found them -- no row filter, no through,
  // the order lookup's options the tenant's -- reaches any tenant's line by a
  // token somebody guesses. Its list would hand all of them out in one
  // request, so it has none, and the form offers none.
  test("refuses a list of rows nothing scopes while a lookup's options are filtered, and the form offers none", async () => {
    const refused = await list('unscoped-line', {})
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({
      status: 403,
      body: { code: 'operation-unavailable', message: "Nothing scopes this form's records, though the options of order are filtered, so they are not listed." },
    })
    expect(lists).toEqual([])
    const form = await app.inject({ method: 'GET', url: '/v1/forms/unscoped-line', headers: as('clerk') })
    expect({ status: form.statusCode, list: form.json().list }).toEqual({ status: 200, list: null })
  })

  // What a page may search, sort and filter by is the planner's own answer,
  // sent with the form, so a grid offers exactly the headers, search and
  // conditions the server accepts (0104): each readable column field with
  // its kind's operators, `null` and `not-null` only where the column holds
  // NULLs, never a lookup, and never a field the person may not read -- a
  // filter on one would tell them its values a condition at a time. And
  // one page's tokens for one lookup fit one resolve. Watched failing with
  // `GET` sending the list with `filterable` emptied.
  test('the form says what its list may search, sort and filter by, in the planner’s words', async () => {
    const served = (await app.inject({ method: 'GET', url: '/v1/forms/customer', headers: as('clerk') })).json()
    expect(served.list).toEqual(listColumns(customers, served.readable, []))
    expect(served.list).toEqual({
      searchable: ['tenant_id', 'customer_no', 'name'],
      sortable: ['tenant_id', 'customer_no', 'name', 'credit_limit'],
      filterable: [
        { field: 'tenant_id', operators: ['equals', 'range'], input: 'integer', days: null },
        { field: 'customer_no', operators: ['equals', 'range'], input: 'integer', days: null },
        { field: 'name', operators: ['equals', 'contains'], input: 'text', days: null },
        { field: 'credit_limit', operators: ['equals', 'range', 'null', 'not-null'], input: 'decimal', days: null },
      ],
      views: [],
    })
    const kept = (await app.inject({ method: 'GET', url: '/v1/forms/hidden-limit', headers: as('clerk') })).json()
    expect(kept.list.filterable.map((offer: { field: string }) => offer.field)).toEqual(['tenant_id', 'customer_no', 'name'])
    expect(LIST_PAGE_SIZE).toBeLessThanOrEqual(MAX_RESOLVE)
  })

  // A view is offered to a person only when they could have built it from
  // what their list offers them (0105): the clerk who may not read credit
  // limits is not offered "Large accounts", which would sort out the large
  // ones without showing a single limit -- not offered it without its
  // condition either, which would be every account under that name -- and
  // its default goes with it, so their grid opens on every record. Watched
  // failing with `GET` offering the published views as they are stored.
  test('the form offers the views this person could have built, and the default only with its view', async () => {
    const all = (await app.inject({ method: 'GET', url: '/v1/forms/viewed', headers: as('clerk') })).json()
    expect(all.list.views).toEqual([LARGE, MUSTER])
    const withheld = (await app.inject({ method: 'GET', url: '/v1/forms/viewed-hidden-limit', headers: as('clerk') })).json()
    expect(withheld.list.views).toEqual([MUSTER])
  })

  // The database's own answers are a read's: out of reach is 503, a grant it
  // refuses 403. A list writes nothing, so an adapter that answered "may have
  // been saved" is a bug, a 500, never a 502 that tells a person it may.
  test('answers the database’s refusals as a read does, and a lost answer as a bug', async () => {
    listOutcome = { ok: false, code: 'unavailable', message: 'timeout on 10.0.0.5' }
    const down = await list('customer', {})
    expect(down.statusCode).toBe(503)
    expect(down.body).not.toContain('10.0.0.5')
    listOutcome = { ok: false, code: 'permission-denied', message: 'denied' }
    expect((await list('customer', {})).statusCode).toBe(403)
    listOutcome = { ok: false, code: 'unknown-outcome', message: 'ECONNRESET' }
    expect((await list('customer', {})).statusCode).toBe(500)
  })

  // A page is decided over the description its own statement carried, as a
  // read is (0041): a form the database can no longer show faithfully is
  // refused, and the page's values never reach the body. A list the database
  // refused because a column it names is gone is decided over a description
  // asked once more. Watched failing with the description left undecided.
  test('refuses a page drift stops reading, and shows none of it', async () => {
    listOutcome = { ok: true, described: RETYPED, rows: [STORED], after: null }
    const refused = await list('customer', {})
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ code: 'drift', message: expect.stringMatching(/can no longer show its records faithfully/) })
    expect(refused.body).not.toContain('Muster AG')
    expect(describes).toBe(0)
    listOutcome = { ok: false, code: 'schema-changed', column: 'name', message: 'column name does not exist' }
    catalog = { ok: true, described: RETYPED }
    expect((await list('customer', {})).json()).toMatchObject({ code: 'drift' })
    catalog = undefined
    expect((await list('customer', {})).json()).toMatchObject({ code: 'schema-changed' })
    expect(describes).toBe(2)
  })

  // A page pages by the key, and the order is total only while the table
  // holds the key unique and NOT NULL. Drift review reports a key that is
  // gone as stopping update and a key column made nullable as a note, and a
  // read allows both; a page decided as a read would build a page with one
  // record twice -- a 500 -- or rows with no token in an order the engine
  // does not define. Refused as drift instead, its values in no body, and
  // `GET` offers no list over such a table. Watched failing with the page
  // decided as a read: 500 for the key gone, 200 for the nullable key, and
  // `GET` offering a list over both.
  test('refuses a page over a table that no longer holds the key to a total order, and the form offers no list', async () => {
    for (const [name, described, rows] of [
      ['gone', KEY_GONE, [STORED, STORED]],
      ['nullable', KEY_NULLABLE, [STORED, { ...STORED, values: { ...STORED.values, customer_no: null } }]],
    ] as const) {
      listOutcome = { ok: true, described, rows: [...rows], after: null }
      const refused = await list('customer', {})
      expect({ name, status: refused.statusCode, body: refused.json() }).toEqual({ name, status: 409, body: { code: 'drift', message: expect.stringMatching(/no longer have an order a page can rely on/) } })
      expect(refused.body).not.toContain('Muster AG')
      catalog = { ok: true, described }
      const form = await app.inject({ method: 'GET', url: '/v1/forms/customer', headers: as('clerk') })
      expect({ name, status: form.statusCode, list: form.json().list }).toEqual({ name, status: 200, list: null })
      catalog = undefined
    }
  })

  // An operator matches the log to the trail: a page refused for drift is
  // said in the log as a list, which is what the audit event names, never as
  // a read. Watched failing with the list's refusals logged as reads.
  test('says a refused page in the log as a list', async () => {
    const lines: Array<Record<string, unknown>> = []
    const logged = await createDataServer({ verifyIdentity, logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } }, runtime: { registry: registry(), store: createFileConfigurationStore(root) } })
    const refusals = () => lines.filter((line) => line['msg'] === 'refused: the database no longer fits this form as published').map((line) => [line['operation'], line['changes']])
    listOutcome = { ok: true, described: KEY_GONE, rows: [STORED], after: null }
    await logged.inject({ method: 'POST', url: '/v1/forms/customer/records/list', headers: as('clerk'), payload: {} })
    listOutcome = { ok: false, code: 'schema-changed', column: 'name', message: 'column name does not exist' }
    catalog = { ok: true, described: RETYPED }
    await logged.inject({ method: 'POST', url: '/v1/forms/customer/records/list', headers: as('clerk'), payload: {} })
    expect(refusals()).toEqual([
      ['list', [{ kind: 'identity-key-changed', affects: ['tenant_id', 'customer_no'] }]],
      ['list', [expect.objectContaining({ affects: ['name'] })]],
    ])
  })

  // One event per list, named `list`, naming no record -- never the search,
  // the sort, the parent or the filter, which are what the person typed and
  // chose (0023): a filter's value is a person's data, as a search is.
  test('is audited as list, with no record and nothing the person sent', async () => {
    await list('line', { search: 'Muster', sort: [{ field: 'quantity', direction: 'desc' }], parent: { field: 'order', record: 'k1:42' }, filter: [{ field: 'quantity', op: 'range', from: '31337', to: null }] })
    await list('customer', {}, 'stranger')
    await list('customer', { filter: [{ field: 'name', op: 'contains', text: FILTERED }] })
    await list('customer', { filter: [{ field: 'credit_limit', op: 'equals', value: '98765.4321' }] })
    expect(events).toEqual([
      { at: '2026-10-11T12:00:00.000Z', plane: 'runtime', actor: 'c', operation: 'list', form: 'line', formVersion: 1, status: 200, outcome: 'ok', record: null, rows: null, moved: null },
      { at: '2026-10-11T12:00:00.000Z', plane: 'runtime', actor: 's', operation: 'list', form: 'customer', formVersion: 1, status: 403, outcome: 'operation-denied', record: null, rows: null, moved: null },
      { at: '2026-10-11T12:00:00.000Z', plane: 'runtime', actor: 'c', operation: 'list', form: 'customer', formVersion: 1, status: 200, outcome: 'ok', record: null, rows: null, moved: null },
      { at: '2026-10-11T12:00:00.000Z', plane: 'runtime', actor: 'c', operation: 'list', form: 'customer', formVersion: 1, status: 400, outcome: 'not-filterable', record: null, rows: null, moved: null },
    ])
    expect(JSON.stringify(events)).not.toMatch(/Muster|quantity|k1:|31337|98765|filter-marker/)
  })

  // The server's log is read by whoever runs the collector, and the audit
  // events go to it too (0033): a filter's value -- found, compared, or
  // refused as one its column cannot hold -- is in no line of it, and the
  // body that carried it in no URL, since a list is a POST. Watched failing
  // with the route logging the query it read at info.
  test('writes no value of a filter to the log, whether the list is answered or refused', async () => {
    const written: string[] = []
    const logged = await createDataServer({
      verifyIdentity,
      logger: { stream: { write: (line: string) => void written.push(line) } },
      runtime: { registry: registry(), store: createFileConfigurationStore(root), audit: { sink: (event) => void written.push(JSON.stringify(event)), key: KEY } },
    })
    const send = (payload: unknown) => logged.inject({ method: 'POST', url: '/v1/forms/customer/records/list', headers: as('clerk'), payload: payload as Record<string, unknown> })
    const answers = [
      await send({ filter: [{ field: 'name', op: 'contains', text: FILTERED }, { field: 'credit_limit', op: 'range', from: '31337', to: null }] }),
      await send({ filter: [{ field: 'credit_limit', op: 'equals', value: '98765.4321' }] }),
      await send({ filter: [{ field: 'name', op: 'like', value: FILTERED }] }),
    ]
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 400, 400])
    expect(written.filter((line) => line.includes('"operation":"list"'))).toHaveLength(3)
    expect(written.filter((line) => /filter-marker|31337|98765/.test(line))).toEqual([])
  })
})
