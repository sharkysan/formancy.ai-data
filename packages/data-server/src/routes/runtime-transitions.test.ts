import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, generateForm } from '@formancy/data-core'
import type {
  ColumnMeta,
  DatabaseAdapter,
  DescribedRoot,
  FormPolicy,
  InsertRequest,
  LookupAdapter,
  NormalizedType,
  RecordAdapter,
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
 * A state field's moves on the runtime plane (0112), over fake ports: a
 * ticket a clerk opens and closes and a manager archives. What is under
 * test is what the routes decide before the adapter is asked -- which
 * move they send, which they refuse and with what, and what the audit
 * trail says of it. The planner's own cases are data-core's
 * `transition.test.ts`; the version guard the move rests on is each
 * adapter's update, against both real servers.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 20, lengthUnit: 'utf16-code-units', fixedLength: false }
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
      ref: { schema: 'sales', name: 'ticket' },
      kind: 'table',
      comment: null,
      columns: [
        col('id', 1, INT32, { generated: 'identity-always' }),
        col('tenant_id', 2, INT32),
        col('note', 3, TEXT, { nullable: true }),
        col('status', 4, TEXT, { hasDefault: true }),
        col('rv', 5, { kind: 'rowversion' }, { generated: 'rowversion' }),
      ],
      primaryKey: { name: 'pk_ticket', columns: ['id'] },
      uniqueKeys: [],
      foreignKeys: [],
      checks: [],
      rowSecurity: 'none',
    },
  ],
})

const BOTH = ['clerk', 'manager']
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: BOTH, create: ['clerk'], update: BOTH },
  fields: { id: { read: BOTH, write: [] }, tenant_id: { read: BOTH, write: [] }, note: { read: BOTH, write: BOTH }, status: { read: BOTH, write: BOTH } },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
  transitions: {
    field: 'status',
    moves: [
      { from: null, to: 'open', roles: ['clerk'] },
      { from: 'open', to: 'closed', roles: ['clerk'] },
      { from: 'closed', to: 'archived', roles: ['manager'] },
    ],
  },
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' || token === 'manager'
    ? { ok: true, identity: { actor: { id: token[0] ?? '', roles: [token] }, attributes: { tenant: '1' } } }
    : { ok: false, reason: 'bad' }

const RECORD = 'k1:5'
const VERSION = '00000000000007d1'
const NEWER = '00000000000007d2'

let calls: { inserts: InsertRequest[]; updates: UpdateRequest[] }
/** The ticket's state as the fake row holds it, and the version it is at. */
let status: string
let rowVersion: string
let events: RuntimeAuditEvent[]
let root: string
let app: FastifyInstance

const stored = () => ({ id: '5', tenant_id: '1', note: 'as stored', status })

function registry(): ConnectionRegistry {
  const described = { ...(describedOf(SNAPSHOT, { schema: 'sales', name: 'ticket' }) as DescribedRoot), definition: 'unchanged' }
  const records: RecordAdapter = {
    describe: async () => ({ ok: true, described }),
    read: async () => ({ ok: true, described, record: { values: stored(), version: rowVersion } }),
    list: async () => ({ ok: true, described, rows: [], after: null }),
    insert: async (request) => {
      calls.inserts.push(request)
      return { ok: true, values: stored(), version: VERSION }
    },
    update: async (request) => {
      calls.updates.push(request)
      // An adapter's answer to an update guarded by a version the row no longer has.
      if (request.expectedVersion !== rowVersion) return { ok: false, code: 'stale', message: 'changed' }
      return { ok: true, values: stored(), version: NEWER }
    },
    supersede: async () => {
      throw new Error('these routes never change a version from a date')
    },
    delete: async () => {
      throw new Error('these routes never delete')
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
  calls = { inserts: [], updates: [] }
  status = 'open'
  rowVersion = VERSION
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-transitions-'))
  const store = createFileConfigurationStore(root)
  const { form, bindings } = generateForm(SNAPSHOT, {
    connection: 'erp',
    root: { schema: 'sales', name: 'ticket' },
    formId: 'ticket',
    title: 'Ticket',
    lookups: [],
    pinned: ['tenant_id'],
  })
  const bundle: PublishedBundle = { format: 1, connection: 'erp', form, bindings, policy: POLICY, snapshot: SNAPSHOT }
  await store.publish('ticket', null, bundle)
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
const update = (who: string, answers: Record<string, unknown>) => post(who, '/v1/forms/ticket/records/update', { record: RECORD, version: VERSION, answers })
const create = (answers: Record<string, unknown>) => post('clerk', '/v1/forms/ticket/records/create', { answers })
/** What the trail said of each request: its operation, how it ended, and whether it moved. */
const trail = () => events.map(({ operation, status: code, outcome, moved }) => ({ operation, status: code, outcome, moved }))

describe('a state field’s moves on the runtime plane (0112)', () => {
  // A listed move for one of the actor's roles is sent as the update the
  // person asked for, and the trail says a move was made -- never from
  // where or to where. Watched failing with the plan's move left off the
  // trail: moved was null.
  test('a listed move is saved, and the trail says a move was made and names no state', async () => {
    const saved = await update('clerk', { status: 'closed' })
    expect(saved.statusCode).toBe(200)
    expect(calls.updates.map((each) => each.set.map(({ name, value }) => [name, value]))).toEqual([[['status', 'closed']]])
    expect(trail()).toEqual([{ operation: 'update', status: 200, outcome: 'ok', moved: true }])
    expect(JSON.stringify(events)).not.toMatch(/open|closed/)
  })

  // A move no rule lists for the actor's roles -- another role's, a step
  // skipped, a step back -- is 403 before any update is sent, with a
  // sentence that names the field and no state. Watched failing with the
  // code left out of the 403s: the route answered 500.
  test('a move not listed for the actor’s roles is 403, names no state, and sends nothing', async () => {
    for (const [who, from, to] of [
      ['clerk', 'open', 'archived'],
      ['manager', 'open', 'archived'],
      ['clerk', 'closed', 'open'],
    ]) {
      status = from ?? ''
      const refused = await update(who ?? '', { status: to })
      expect(refused.statusCode, `${String(who)}: ${String(from)} to ${String(to)}`).toBe(403)
      expect(refused.json()).toEqual({
        code: 'transition-denied',
        message: 'status may not move from where it is to where this update puts it, for your roles.',
      })
    }
    expect(calls.updates).toEqual([])
    expect(trail().map(({ outcome, moved }) => ({ outcome, moved }))).toEqual(Array.from({ length: 3 }, () => ({ outcome: 'transition-denied', moved: null })))
  })

  // A save that leaves the state where it is -- a note changed, the status
  // echoed as read -- moves nothing, and the trail says so.
  test('a save that leaves the state where it is moves nothing', async () => {
    const saved = await update('manager', { note: 'seen', status: 'open' })
    expect(saved.statusCode).toBe(200)
    expect(trail()).toEqual([{ operation: 'update', status: 200, outcome: 'ok', moved: false }])
  })

  // The record moved since the person read it: their move starts from a
  // state they never saw, and the version guard is the answer -- 409
  // stale, reload -- not a refusal of a move from where it went since.
  test('a move from a state the person never read is stale, not refused', async () => {
    status = 'archived'
    rowVersion = NEWER
    const stale = await update('clerk', { status: 'closed' })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'stale' })
    expect(calls.updates).toHaveLength(1)
  })

  // A create starts the state where a move from nothing puts it, or leaves
  // it to the column's default, which the schema chose; started anywhere
  // else it is refused before the insert.
  test('a create starts where a move from nothing puts it, or where the schema does', async () => {
    const refused = await create({ note: 'new', status: 'closed' })
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual({ code: 'transition-denied', message: 'status may not start where this create puts it, for your roles.' })
    expect(calls.inserts).toEqual([])
    expect((await create({ note: 'new', status: 'open' })).statusCode).toBe(201)
    expect((await create({ note: 'new' })).statusCode).toBe(201)
    expect(trail()).toEqual([
      { operation: 'create', status: 403, outcome: 'transition-denied', moved: null },
      { operation: 'create', status: 201, outcome: 'ok', moved: true },
      { operation: 'create', status: 201, outcome: 'ok', moved: false },
    ])
  })
})
