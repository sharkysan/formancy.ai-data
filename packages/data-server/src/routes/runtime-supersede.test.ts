import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, generateForm, recordToken } from '@formancy/data-core'
import type {
  ColumnMeta,
  DatabaseAdapter,
  DescribedRoot,
  FormPolicy,
  InsertRequest,
  LookupAdapter,
  NormalizedType,
  RecordAdapter,
  RecordOutcome,
  SupersedeRequest,
  UpdateRequest,
} from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'

/*
 * A change from a date on the runtime plane (0113), over fake ports: a
 * product's prices, each valid from one date until the next starts. What is
 * under test is what the routes decide before the adapter is asked and how
 * they answer what it says. The planner's cases are data-core's
 * `supersede.test.ts`; what each engine's write does is each adapter's
 * integration suite, against both real servers.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const DATE: NormalizedType = { kind: 'date' }
const AMOUNT: NormalizedType = { kind: 'decimal', precision: 18, scale: 4 }
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

const SNAPSHOT = createSnapshot({
  kind: 'sqlserver',
  serverVersion: '16.0',
  account: { user: 'dbo', login: 'sa' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [
    {
      ref: { schema: 'sales', name: 'price' },
      kind: 'table',
      comment: null,
      columns: [
        col('tenant_id', 1, INT32),
        col('product_no', 2, INT32),
        col('valid_from', 3, DATE),
        col('valid_to', 4, DATE, { nullable: true }),
        col('amount', 5, AMOUNT),
        col('rv', 6, { kind: 'rowversion' }, { generated: 'rowversion' }),
      ],
      primaryKey: { name: 'pk_price', columns: ['tenant_id', 'product_no', 'valid_from'] },
      uniqueKeys: [],
      foreignKeys: [],
      checks: [],
      rowSecurity: 'none',
      access: { delete: true },
      referencedBy: [],
    },
  ],
})

const BOTH = ['clerk', 'auditor']
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: BOTH, create: ['clerk'], update: ['clerk'] },
  fields: {
    tenant_id: { read: BOTH, write: [] },
    product_no: { read: BOTH, write: ['clerk'] },
    valid_from: { read: BOTH, write: ['clerk'] },
    valid_to: { read: BOTH, write: [] },
    amount: { read: BOTH, write: ['clerk'] },
  },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' || token === 'auditor'
    ? { ok: true, identity: { actor: { id: token[0] ?? '', roles: [token] }, attributes: { tenant: '1' } } }
    : { ok: false, reason: 'bad' }

const encoded = recordToken(['tenant_id', 'product_no', 'valid_from'], { tenant_id: '1', product_no: '7', valid_from: '2026-01-01' })
if (!encoded.ok) throw new Error(encoded.message)
const RECORD = encoded.token
const VERSION = '00000000000007d1'
const NEXT_VERSION = '00000000000007d3'

let calls: { inserts: InsertRequest[]; updates: UpdateRequest[]; changes: SupersedeRequest[] }
/** Where the open version ends as the fake row holds it, and what the adapter answers a change, when a case says. */
let ends: string | null
let answer: RecordOutcome | undefined
let events: RuntimeAuditEvent[]
let root: string
let app: FastifyInstance

const stored = () => ({ tenant_id: '1', product_no: '7', valid_from: '2026-01-01', valid_to: ends, amount: '9.5000' })

function registry(): ConnectionRegistry {
  const described = { ...(describedOf(SNAPSHOT, { schema: 'sales', name: 'price' }) as DescribedRoot), definition: 'unchanged' }
  const records: RecordAdapter = {
    describe: async () => ({ ok: true, described }),
    read: async () => ({ ok: true, described, record: { values: stored(), version: VERSION } }),
    list: async () => ({ ok: true, described, rows: [], after: null }),
    insert: async (request) => {
      calls.inserts.push(request)
      return answer ?? { ok: true, values: stored(), version: VERSION }
    },
    update: async (request) => {
      calls.updates.push(request)
      return answer ?? { ok: true, values: stored(), version: NEXT_VERSION }
    },
    supersede: async (request) => {
      calls.changes.push(request)
      return (
        answer ?? { ok: true, values: { tenant_id: '1', product_no: '7', valid_from: '2026-07-01', valid_to: null, amount: '10.0000' }, version: NEXT_VERSION }
      )
    },
    delete: async () => {
      throw new Error('a form over versions offers no delete')
    },
  }
  const lookups: LookupAdapter = { search: async () => ({ rows: [], hasMore: false, omitted: 0 }), resolve: async () => [], rejects: async () => [] }
  const adapter = {
    kind: 'sqlserver',
    ping: async () => ({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }),
    discover: async () => SNAPSHOT,
    close: async () => {},
  } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: () => ({ schemas: ['sales'] }),
    open: async (id) => (id === 'erp' ? { adapter, lookups, records } : undefined),
    close: async () => {},
  }
}

beforeEach(async () => {
  calls = { inserts: [], updates: [], changes: [] }
  ends = null
  answer = undefined
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-supersede-'))
  const store = createFileConfigurationStore(root)
  const { form, bindings } = generateForm(SNAPSHOT, {
    connection: 'erp',
    root: { schema: 'sales', name: 'price' },
    formId: 'price',
    title: 'Price',
    lookups: [],
    pinned: ['tenant_id'],
    validity: { from: 'valid_from', to: 'valid_to' },
  })
  const bundle: PublishedBundle = { format: 1, connection: 'erp', form, bindings, policy: POLICY, snapshot: SNAPSHOT }
  await store.publish('price', null, bundle)
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  app = await createDataServer({ verifyIdentity, runtime: { registry: registry(), store, audit: { sink, now: () => '2026-10-30T12:00:00.000Z' } } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const post = (who: string, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${who}` }, payload: payload as Record<string, unknown> })
const change = (answers: Record<string, unknown>, who = 'clerk') =>
  post(who, '/v1/forms/price/records/supersede', { record: RECORD, version: VERSION, answers })
/** What a renderer submits for the open version's copy: every field, the start moved and the price changed. */
const COPY = { tenant_id: 1, product_no: 7, valid_from: '2026-07-01', valid_to: null, amount: '10.0000' }

describe('a change from a date (0113)', () => {
  // The open version is read, the copy's echoes are dropped, and one
  // request ends it and inserts the next: the answer is the next version,
  // 201, with its own token. The trail names the operation and the version
  // addressed. Watched failing with the route left unregistered: 404.
  test('ends the open version and answers the next one', async () => {
    const changed = await change(COPY)
    expect(changed.statusCode, changed.body).toBe(201)
    expect(changed.json()).toMatchObject({ answers: { valid_from: '2026-07-01', valid_to: null, amount: '10.0000' }, version: NEXT_VERSION })
    expect(
      calls.changes.map((request) => ({
        ends: request.ends,
        start: request.start.value,
        chain: request.chain.map((entry) => entry.name),
        values: request.values.map((value) => [value.name, value.value]),
      })),
    ).toEqual([{ ends: 'valid_to', start: '2026-07-01', chain: ['tenant_id', 'product_no'], values: [['amount', '10.0000']] }])
    expect(events.map(({ operation, status, outcome }) => ({ operation, status, outcome }))).toEqual([{ operation: 'supersede', status: 201, outcome: 'ok' }])
  })

  // Decided from the version as read before anything is written: an ended
  // version is history, and a start not after the open one's is the
  // person's to correct. Neither reaches the adapter.
  test('refuses an ended version and a start not after the open one, before the adapter', async () => {
    ends = '2026-06-01'
    const ended = await change(COPY)
    expect(ended.statusCode).toBe(409)
    expect(ended.json()).toMatchObject({ code: 'version-ended' })
    ends = null
    const early = await change({ ...COPY, valid_from: '2026-01-01' })
    expect(early.statusCode).toBe(422)
    expect(early.json()).toMatchObject({ fieldErrors: [{ field: 'valid_from', code: 'not-after' }] })
    expect(calls.changes).toEqual([])
  })

  // What the adapter finds is answered as a person can act on it: a version
  // ended since it was read, and a lost answer naming what was addressed,
  // which sending again with the same version stores at most once. Watched
  // failing with `version-ended` left out of the record failures: 500.
  test('answers what the adapter found: ended since it was read, or a lost answer', async () => {
    answer = { ok: false, code: 'version-ended', message: 'ended' }
    const ended = await change(COPY)
    expect(ended.statusCode).toBe(409)
    expect(ended.json()).toEqual({ code: 'version-ended', message: 'This version has ended, and only the open version is changed. Nothing was saved.' })
    answer = { ok: false, code: 'unknown-outcome', message: 'cut' }
    const lost = await change(COPY)
    expect(lost.statusCode).toBe(502)
    expect(lost.json()).toMatchObject({ code: 'unknown-outcome', operation: 'supersede', record: RECORD, version: VERSION })
  })

  // A change ends one version and starts another, so it takes both update
  // and create; a reader is refused before anything is read.
  test('is the policy’s to grant, as update and create', async () => {
    const refused = await change(COPY, 'auditor')
    expect(refused.statusCode).toBe(403)
    expect(calls.changes).toEqual([])
  })
})

describe('what a person may write of a form (0117)', () => {
  // The fields each write accepts from this person, by the check that
  // refuses the rest: on create the chain's key, its start and the amount --
  // never the pinned tenant or the end the server writes; on update the
  // amount alone, the key and the start written on create only. A reader is
  // offered no write and named none. Watched failing with `writable` left
  // out of the reply.
  test('names the fields each write it offers accepts, and none to a reader', async () => {
    const opened = await app.inject({ method: 'GET', url: '/v1/forms/price', headers: { authorization: 'Bearer clerk' } })
    expect(opened.json().writable).toEqual({ create: ['product_no', 'valid_from', 'amount'], update: ['amount'] })
    const read = await app.inject({ method: 'GET', url: '/v1/forms/price', headers: { authorization: 'Bearer auditor' } })
    expect(read.json().writable).toEqual({ create: null, update: null })
  })
})

describe('a form over versions (0113)', () => {
  // The form says where a version starts and ends to whoever may change
  // one, and nothing to a reader; a create starts a chain only where there
  // is none, and an update holds only an open version -- each the
  // statement's to enforce, and each refusal answered for the person.
  test('names its versions’ fields, and guards its create and its update', async () => {
    const opened = await app.inject({ method: 'GET', url: '/v1/forms/price', headers: { authorization: 'Bearer clerk' } })
    expect(opened.json()).toMatchObject({
      versions: { from: 'valid_from', to: 'valid_to', key: ['tenant_id', 'product_no'] },
      operations: ['read', 'create', 'update'],
    })
    const read = await app.inject({ method: 'GET', url: '/v1/forms/price', headers: { authorization: 'Bearer auditor' } })
    expect(read.json()).toMatchObject({ versions: null })

    answer = { ok: false, code: 'chain-exists', message: 'there' }
    const created = await post('clerk', '/v1/forms/price/records/create', { answers: { product_no: 7, valid_from: '2026-01-01', amount: '9.5000' } })
    expect(created.statusCode).toBe(409)
    expect(created.json()).toMatchObject({ code: 'chain-exists' })
    expect(calls.inserts.map((request) => request.fresh)).toEqual([['tenant_id', 'product_no']])

    answer = { ok: false, code: 'version-ended', message: 'ended' }
    const updated = await post('clerk', '/v1/forms/price/records/update', { record: RECORD, version: VERSION, answers: { amount: '9.9000' } })
    expect(updated.statusCode).toBe(409)
    expect(calls.updates.map((request) => request.open)).toEqual(['valid_to'])
  })
})
