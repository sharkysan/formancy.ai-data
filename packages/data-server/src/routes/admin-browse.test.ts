import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, DescribedTable, ListOutcome, ListRequest, LookupAdapter, NormalizedType, RecordAdapter } from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AdminAuditEvent, AuditSink } from '../audit.js'
import type { ConfigurationStore } from '../config-store.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { BrowseAnswer } from './admin-browse.js'

/*
 * `POST /v1/connections/:id/browse` over fake ports (0099). What the
 * database does with the page is the adapter suites' business, against
 * real servers (0003); what is under test here is what the route decides
 * before and after: who may browse, what reaches the port, how a page and
 * a refusal are answered, and what the trail says.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})

/** Planted where an event must never look: a search, and a value a row holds. */
const SEARCH = 'search-marker-31f0'
const VALUE = 'value-marker-c4d2'

const SNAPSHOT = createSnapshot({
  kind: 'postgres', serverVersion: '17.6', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    {
      ref: { schema: 'sales', name: 'employee' }, kind: 'table', comment: null,
      columns: [col('id', 1, INT32), col('name', 2, TEXT), col('photo', 3, { kind: 'binary', maxLength: null, fixedLength: false }, { nullable: true })],
      primaryKey: { name: 'pk_employee', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
    {
      ref: { schema: 'sales', name: 'headcount' }, kind: 'view', comment: null,
      columns: [col('team', 1, TEXT), col('people', 2, INT32)],
      primaryKey: null, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
  ],
})

/** Tokens by name: an administrator, a browser who administers too, and a publisher who administers and does not browse. */
const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
    : token === 'browser' ? { ok: true, identity: { actor: { id: 'b', roles: ['data-admin', 'data-browser'] }, attributes: {} } }
      : token === 'publisher' ? { ok: true, identity: { actor: { id: 'p', roles: ['data-admin', 'data-publisher'] }, attributes: {} } }
        : { ok: false, reason: 'bad' }

let requests: ListRequest[]
let answer: ListOutcome
let root: string
let store: ConfigurationStore
let events: AdminAuditEvent[]
const sink: AuditSink = (event) => {
  if (event.plane === 'admin') events.push(event)
}

function registry(): ConnectionRegistry {
  const adapter = { kind: 'postgres', discover: async () => SNAPSHOT, close: async () => {} } as unknown as DatabaseAdapter
  const records = {
    list: async (request: ListRequest) => {
      requests.push(request)
      return answer
    },
  } as unknown as RecordAdapter
  return {
    ids: () => ['erp'],
    scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined),
    open: async (id) => (id === 'erp' ? { adapter, lookups: {} as LookupAdapter, records } : undefined),
    close: async () => {},
  }
}

function serve(roles: { browse?: string[]; publish?: string[] } = { browse: ['data-browser'] }): Promise<FastifyInstance> {
  return createDataServer({
    verifyIdentity,
    admin: {
      registry: registry(), store, adminRoles: ['data-admin', 'data-browser', 'data-publisher'],
      ...(roles.browse === undefined ? {} : { browseRoles: roles.browse }),
      ...(roles.publish === undefined ? {} : { publisherRoles: roles.publish }),
      audit: { sink, now: () => 't' },
    },
  })
}

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const browse = (server: FastifyInstance, token: string, payload: unknown, connection = 'erp') =>
  server.inject({ method: 'POST', url: `/v1/connections/${connection}/browse`, headers: as(token), payload: payload as object })
const EMPLOYEE = { object: { schema: 'sales', name: 'employee' } }
const rows = (...names: string[]) => names.map((name, index) => ({ values: { id: String(index + 1), name }, version: null }))

beforeEach(async () => {
  requests = []
  events = []
  answer = { ok: true, described: describedOf(SNAPSHOT, { schema: 'sales', name: 'employee' }) as DescribedTable, rows: rows('Ada', VALUE) }
  root = await mkdtemp(join(tmpdir(), 'formancy-data-browse-'))
  store = createFileConfigurationStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('who may browse', () => {
  // Publishing a form never needed a business row; a deployment that upgrades and sets nothing must not find every administrator reading every table.
  test('with no browse role set, nobody may, and nothing is read', async () => {
    const server = await serve({})
    const response = await browse(server, 'admin', EMPLOYEE)
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'browse-role-required' })
    expect(requests).toEqual([])
  })

  // The studio disables its Browse step from this answer; were it derived from anything but the refusal itself, the step and the route could disagree.
  test('the administration answer says so, from the same decision', async () => {
    const server = await serve()
    const admin = (await server.inject({ method: 'GET', url: '/v1/administration', headers: as('admin') })).json()
    expect(admin.refuses.browse).toMatchObject({ code: 'browse-role-required' })
    const browser = (await server.inject({ method: 'GET', url: '/v1/administration', headers: as('browser') })).json()
    expect(browser.refuses.browse).toBeUndefined()
  })

  // Browsing is its own grant: review neither gives it to a publisher nor takes it from a browser.
  test('under review, a browser browses and a publisher without the role does not', async () => {
    const server = await serve({ browse: ['data-browser'], publish: ['data-publisher'] })
    expect((await browse(server, 'browser', EMPLOYEE)).statusCode).toBe(200)
    expect((await browse(server, 'publisher', EMPLOYEE)).statusCode).toBe(403)
  })

  // An embedder's list is held to the setting's rule: a role the plane refuses at its door could browse nothing.
  test('a browse role that is not an administrator role stops the plane', async () => {
    await expect(createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'], browseRoles: ['data-browser'], audit: { sink } } })).rejects.toThrow(
      'admin.browseRoles names "data-browser", which is not in admin.adminRoles',
    )
  })
})

describe('a page', () => {
  // The request is the planner's over the server's own snapshot: an object, columns and key the catalog named, and no filter but the account's own.
  test('reaches the port as planned, and answers the rows, the columns and what was left out', async () => {
    const server = await serve()
    const response = await browse(server, 'browser', { ...EMPLOYEE, search: 'Ad', sort: [{ column: 'name', direction: 'desc' }], limit: 1 })
    expect(response.statusCode).toBe(200)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      target: { table: { schema: 'sales', name: 'employee' }, identity: [{ name: 'id', type: INT32 }], concurrency: null },
      filters: { kind: 'unrestricted' },
      through: [],
      sort: [{ column: 'name', direction: 'desc', nulls: null }, { column: 'id', direction: 'asc', nulls: null }],
      offset: 0,
      limit: 1,
    })
    expect(response.json()).toEqual({
      object: { schema: 'sales', name: 'employee' },
      kind: 'table',
      columns: [{ name: 'id', type: INT32 }, { name: 'name', type: TEXT }],
      omitted: [{ column: 'photo', reason: 'no-text' }],
      ordered: 'key',
      rows: [{ id: '1', name: 'Ada' }],
      hasMore: true,
    } satisfies BrowseAnswer)
  })

  // A view has no key, and is browsed anyway: the answer says its order is every column, so the studio can say what that costs.
  test('a view is ordered by its columns, and says so', async () => {
    answer = { ok: true, described: describedOf(SNAPSHOT, { schema: 'sales', name: 'headcount' }) as DescribedTable, rows: [] }
    const server = await serve()
    const response = await browse(server, 'browser', { object: { schema: 'sales', name: 'headcount' } })
    expect(response.json()).toMatchObject({ kind: 'view', ordered: 'columns', rows: [], hasMore: false })
  })

  // The object is a name from the browser: one the server's snapshot does not hold is never sent to a database.
  test('an object the connection cannot see is 404, and nothing is read', async () => {
    const server = await serve()
    const response = await browse(server, 'browser', { object: { schema: 'hr', name: 'salary' } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'unknown-object' })
    expect(requests).toEqual([])
  })

  // A body checked after the discovery would cost a catalog read for a request that was never going to run.
  test('a malformed body is 400 before the connection is opened', async () => {
    const server = await serve()
    const response = await browse(server, 'browser', { object: 'sales.employee' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'malformed' })
    expect(requests).toEqual([])
  })

  // A database's refusal is told in a browse's words; an outcome only a write can have is an adapter's bug and is not dressed up as an answer.
  test.each([
    ['permission-denied', 403],
    ['schema-changed', 409],
    ['refused', 422],
    ['unavailable', 503],
    ['unknown-outcome', 500],
  ] as const)('a database refusal %s is %i', async (code, status) => {
    answer = { ok: false, code, message: 'from the adapter' }
    const server = await serve()
    expect((await browse(server, 'browser', EMPLOYEE)).statusCode).toBe(status)
  })
})

describe('the trail', () => {
  // Who read which table is what an operator asks after the fact; the search and the rows are business data the trail must never copy.
  test('names the connection and the object, never the search or a value', async () => {
    const server = await serve()
    await browse(server, 'browser', { ...EMPLOYEE, search: SEARCH })
    expect(events).toEqual([
      { at: 't', plane: 'admin', actor: 'b', operation: 'browse', connection: 'erp', form: null, formVersion: null, expectedBase: null, restoredFrom: null, draft: null, object: 'sales.employee', status: 200, outcome: 'ok' },
    ])
    expect(JSON.stringify(events)).not.toContain(SEARCH)
    expect(JSON.stringify(events)).not.toContain(VALUE)
  })

  // A name only the body said is not an object anybody read: recorded, the trail would say a table was browsed that does not exist for this connection.
  test('names no object the snapshot does not hold, and a refused browser is still a browse', async () => {
    const server = await serve()
    await browse(server, 'browser', { object: { schema: 'hr', name: 'salary' } })
    await browse(server, 'admin', EMPLOYEE)
    expect(events.map((event) => ({ actor: event.actor, operation: event.operation, object: event.object, status: event.status }))).toEqual([
      { actor: 'b', operation: 'browse', object: null, status: 404 },
      { actor: 'a', operation: 'browse', object: null, status: 403 },
    ])
  })
})
