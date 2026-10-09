import { mkdtemp, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, LookupAdapter, MetadataSnapshot, NormalizedType, RecordAdapter } from '@formancy/data-core'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AdminAuditEvent, AuditEvent, AuditSink } from '../audit.js'
import type { ConfigurationStore, PublishOutcome } from '../config-store.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { HostIdentity, IdentityVerifier } from '../identity.js'
import { ADMIN_OPERATIONS } from './admin-audit.js'
import { adminRoutes } from './admin.js'
import { ROUTE_OPERATIONS, runtimeRoutes } from './runtime.js'

/*
 * The administrator's audit trail (0033), over the real server with a stub
 * registry, as admin.test.ts runs the plane. What is under test is the event:
 * one per request, whatever the ending, naming what was addressed once it is
 * established, and never what was sent -- not a bundle, a policy, a snapshot,
 * a message, a password or an address.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})

/** Planted where an event must never look: the form's title, a role the policy names, a column the database has, a driver's address and a password. */
const TITLE = 'Employee title-marker-5c1e'
const ROLE = 'role-marker-a9d4'
const COLUMN = 'column_marker_7b2f'
const HOST = '10.0.0.5'
const PASSWORD = 'S3cret-pw-e81'

/** The database as it is "now"; a test changes it to make drift. */
let columns: ColumnMeta[]
function snapshot(): MetadataSnapshot {
  return createSnapshot({
    kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
    objects: [{
      ref: { schema: 'sales', name: 'employee' }, kind: 'table', comment: null, columns,
      primaryKey: { name: 'pk_employee', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    }],
  })
}

/** Accepts three literal tokens: an administrator, a clerk, and nothing else. */
const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
    : token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: {} } }
      : { ok: false, reason: 'bad' }

/** The same, for a plane registered on a Fastify instance this suite builds itself. */
async function authenticate(request: FastifyRequest): Promise<HostIdentity | undefined> {
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
  if (token === undefined) return undefined
  const outcome = await verifyIdentity(token)
  return outcome.ok ? outcome.identity : undefined
}

let reachable: boolean
/** The allowlist knows `erp` and nothing else; a database that is down throws what a driver throws, address and all. */
function registry(): ConnectionRegistry {
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0' }), discover: async () => snapshot(), close: async () => {} } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      if (id !== 'erp') return undefined
      if (!reachable) throw new Error(`ECONNREFUSED ${HOST}:1433`)
      return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
    },
    close: async () => {},
  }
}

const NOW = '2026-10-09T12:00:00.000Z'
let root: string
let store: ConfigurationStore
let events: AdminAuditEvent[]
/** Keeps the administrator's events. A runtime event here would be a plane wired to the wrong sink: it is left out, so the comparison fails. */
const sink: AuditSink = (event) => {
  if (event.plane === 'admin') events.push(event)
}

function serve(overrides: { store?: ConfigurationStore } = {}): Promise<FastifyInstance> {
  return createDataServer({ verifyIdentity, admin: { registry: registry(), store: overrides.store ?? store, adminRoles: ['data-admin'], audit: { sink, now: () => NOW } } })
}

beforeEach(async () => {
  columns = [col('id', 1, INT32), col('name', 2, TEXT), col('row_version', 3, { kind: 'rowversion' }, { generated: 'rowversion' })]
  reachable = true
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-admin-audit-'))
  store = createFileConfigurationStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const PROPOSAL = { connection: 'erp', root: { schema: 'sales', name: 'employee' }, formId: 'employee', title: TITLE }
const POLICY = {
  version: 1,
  operations: { read: [ROLE], create: [ROLE], update: [ROLE] },
  fields: { id: { read: [ROLE], write: [ROLE] }, name: { read: [ROLE], write: [ROLE] } },
  rowFilters: [],
  lookups: {},
}

/** A proposal published as proposed, format 2 (0030). */
function bundleOf(proposal: any) {
  return { format: 2, connection: 'erp', generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy: POLICY, snapshot: proposal.snapshot }
}

async function propose(server: FastifyInstance) {
  return (await server.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: PROPOSAL })).json()
}

async function publish(server: FastifyInstance, expectedBase: number | null = null) {
  const bundle = bundleOf(await propose(server))
  return server.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as('admin'), payload: { expectedBase, bundle } })
}

const of = (operation: AdminAuditEvent['operation']) => events.filter((entry) => entry.operation === operation)

/** An expected event, every field present: what a case does not give is null, as the plane writes it. */
const event = (fields: Partial<AdminAuditEvent> & Pick<AdminAuditEvent, 'operation' | 'status' | 'outcome'>): AdminAuditEvent => ({
  at: NOW, plane: 'admin', actor: 'a', connection: null, form: null, formVersion: null, expectedBase: null, restoredFrom: null, ...fields,
})

describe('what holds the trail in place', () => {
  // A route added to either plane without an audit name would answer
  // unaudited, and nobody would notice until somebody asked who did it. The
  // registration refuses it, so every suite that starts the plane fails --
  // the runtime's too, which has no sink here: the check does not depend on one.
  test('a route without an audit name stops either plane from starting, naming the route', async () => {
    const admin = Fastify()
    void admin.register(async (instance) => {
      await adminRoutes(instance, { registry: registry(), store, adminRoles: ['data-admin'], authenticate, audit: { sink } })
      instance.post('/v1/forms/:id/unnamed', async () => ({}))
    })
    await expect(admin.ready()).rejects.toThrow('POST /v1/forms/:id/unnamed has no audit name (0023, 0033)')

    const runtime = Fastify()
    void runtime.register(async (instance) => {
      await runtimeRoutes(instance, { registry: registry(), store, authenticate })
      instance.get('/v1/forms/:id/unnamed', async () => ({}))
    })
    await expect(runtime.ready()).rejects.toThrow('GET /v1/forms/:id/unnamed has no audit name (0023, 0033)')
  })

  // The routes are read from the router, not from a list kept beside it: a
  // route that emitted nothing, or emitted twice, or under another route's
  // name, fails here whichever route it is. HEAD is sent too, as the GET it
  // answers for. The table has no name for a route that no longer exists,
  // and the router no route the table does not name -- one registered above
  // the plane's hooks, where `onRoute` never sees it, included.
  test.each([
    { plane: 'admin', names: ADMIN_OPERATIONS, register: (instance: FastifyInstance, to: AuditSink) => adminRoutes(instance, { registry: registry(), store, adminRoles: ['data-admin'], authenticate, audit: { sink: to } }) },
    { plane: 'runtime', names: ROUTE_OPERATIONS, register: (instance: FastifyInstance, to: AuditSink) => runtimeRoutes(instance, { registry: registry(), store, authenticate, audit: { sink: to } }) },
  ] as const)('every route the $plane plane registers emits exactly one event, named from its table', async ({ plane, names, register }) => {
    const routes: Array<{ method: string; url: string }> = []
    let heard: AuditEvent[] = []
    const bare = Fastify({ routerOptions: { maxParamLength: 128 } })
    bare.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) routes.push({ method, url: route.url })
    })
    await bare.register(async (instance) => register(instance, (entry) => void heard.push(entry)))
    await bare.ready()

    const key = ({ method, url }: { method: string; url: string }) => `${method === 'HEAD' ? 'GET' : method} ${url}`
    expect(new Set(routes.map(key))).toEqual(new Set(Object.keys(names)))
    for (const route of routes) {
      const path = route.url.replace(':id', route.url.startsWith('/v1/connections/') ? 'erp' : 'employee').replace(':version', '1').replace(':source', 'customer')
      heard = []
      const response = await bare.inject({ method: route.method as 'GET', url: path })
      expect({ route, status: response.statusCode }).toEqual({ route, status: 401 })
      expect(heard.map((entry) => ({ route, plane: entry.plane, operation: entry.operation, actor: entry.actor, status: entry.status, outcome: entry.outcome }))).toEqual([
        { route, plane, operation: names[key(route)], actor: null, status: 401, outcome: 'unauthenticated' },
      ])
    }
  })

  // `onRoute` sees only the routes registered after it, and the hooks that
  // write the event cover every route of the context: a route registered
  // above the plane's hooks would start, answer, and leave no event, its
  // handler run. Such a route is refused instead, every time, and the
  // operator's log says which -- shown on the runtime plane; both planes
  // share the hook.
  test('a route registered before the plane audits does not answer, and the log names it', async () => {
    const lines: string[] = []
    let ran = false
    const early = Fastify({ logger: { level: 'error', stream: { write: (line: string) => void lines.push(line) } } })
    void early.register(async (instance) => {
      instance.post('/v1/forms/:id/records/delete', async () => {
        ran = true
        return { deleted: true }
      })
      await runtimeRoutes(instance, { registry: registry(), store, authenticate, audit: { sink } })
    })
    await early.ready()
    const response = await early.inject({ method: 'POST', url: '/v1/forms/employee/records/delete', headers: as('clerk') })
    expect({ status: response.statusCode, body: response.json() as unknown, ran }).toEqual({ status: 500, body: { code: 'unaudited-route', message: expect.any(String) }, ran: false })
    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toContain('POST /v1/forms/:id/records/delete has no audit name (0023, 0033)')
  })

  // An administrator's plane with no trail would publish and restore with
  // nobody able to say who. The type requires a sink; this is the check for
  // a caller the type cannot reach -- a .mjs file, or a cast.
  test('the administrator plane does not start without an audit sink', async () => {
    await expect(createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'] } as never })).rejects.toThrow("The administrator's plane needs an audit sink")
    await expect(createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'], audit: {} } as never })).rejects.toThrow("The administrator's plane needs an audit sink")
  })
})

describe("the administrator plane's events", () => {
  // "Who published version 1, and when" is the question 0033 answers. The
  // event says it in full, and holds nothing of what was published: a
  // title or a role in the trail would make the log a second copy of the
  // configuration, with none of the store's checks.
  test('a publish names who wrote which version of which form, and nothing of the bundle', async () => {
    const server = await serve()
    expect((await publish(server)).statusCode).toBe(201)
    expect(of('publish')).toEqual([event({ operation: 'publish', form: 'employee', connection: 'erp', formVersion: 1, status: 201, outcome: 'ok' })])
    expect(of('proposal')).toEqual([event({ operation: 'proposal', form: 'employee', connection: 'erp', status: 200, outcome: 'ok' })])
    expect(JSON.stringify(events)).not.toContain(TITLE)
    expect(JSON.stringify(events)).not.toContain(ROLE)
  })

  // A stale publish wrote nothing: the event names the base the
  // administrator said they edited and no version, so it cannot be read as
  // a second publish of the version somebody else wrote.
  test('a stale publish is a conflict that names its base and no version', async () => {
    const server = await serve()
    await publish(server)
    await publish(server, 1)
    expect((await publish(server, 1)).statusCode).toBe(409)
    expect(of('publish').map(({ formVersion, expectedBase, status, outcome }) => ({ formVersion, expectedBase, status, outcome }))).toEqual([
      { formVersion: 1, expectedBase: null, status: 201, outcome: 'ok' },
      { formVersion: 2, expectedBase: 1, status: 201, outcome: 'ok' },
      { formVersion: null, expectedBase: 1, status: 409, outcome: 'conflict' },
    ])
  })

  // A restored version is a copy written as a new number: on disk nothing
  // says it is one. The event is the only record of which version it
  // copied. One the database no longer fits is refused, and the drift that
  // refused it -- a column's name, what changed -- stays out of the trail.
  test('a restore names the version it wrote and the one it copied, and a refused one holds no change', async () => {
    const server = await serve()
    await publish(server)
    await publish(server, 1)
    const restored = await server.inject({ method: 'POST', url: '/v1/forms/employee/restorations', headers: as('admin'), payload: { version: 1, expectedBase: 2 } })
    expect(restored.statusCode, restored.body).toBe(201)
    expect(of('restore')).toEqual([event({ operation: 'restore', form: 'employee', connection: 'erp', formVersion: 3, expectedBase: 2, restoredFrom: 1, status: 201, outcome: 'ok' })])

    events = []
    columns = columns.filter((entry) => entry.name !== 'name')
    const refused = await server.inject({ method: 'POST', url: '/v1/forms/employee/restorations', headers: as('admin'), payload: { version: 1, expectedBase: 3 } })
    expect(refused.json()).toMatchObject({ code: 'incompatible', changes: [expect.objectContaining({ kind: 'column-dropped' })] })
    expect(events).toEqual([event({ operation: 'restore', form: 'employee', connection: 'erp', expectedBase: 3, restoredFrom: 1, status: 409, outcome: 'incompatible' })])
    expect(JSON.stringify(events)).not.toContain('column-dropped')
  })

  // Every read on this plane hands back a policy or a schema, so each names
  // the version it served: an operator asked who looked at version 1 has an
  // answer. The list names a form and no version, since it served none.
  test('each read names the version it served, and none of what it returned', async () => {
    const server = await serve()
    await publish(server)
    events = []
    for (const [method, url] of [
      ['GET', '/v1/connections'], ['GET', '/v1/forms/employee/versions'], ['GET', '/v1/forms/employee/versions/latest'],
      ['GET', '/v1/forms/employee/versions/1'], ['GET', '/v1/forms/employee/versions/9'], ['POST', '/v1/forms/employee/drift'], ['POST', '/v1/forms/employee/regenerations'],
    ] as const) {
      await server.inject({ method, url, headers: as('admin') })
    }
    expect(events).toEqual([
      event({ operation: 'connection-list', status: 200, outcome: 'ok' }),
      event({ operation: 'version-list', form: 'employee', status: 200, outcome: 'ok' }),
      event({ operation: 'version-latest', form: 'employee', connection: 'erp', formVersion: 1, status: 200, outcome: 'ok' }),
      event({ operation: 'version-read', form: 'employee', connection: 'erp', formVersion: 1, status: 200, outcome: 'ok' }),
      event({ operation: 'version-read', form: 'employee', status: 404, outcome: 'unknown-version' }),
      event({ operation: 'drift', form: 'employee', connection: 'erp', formVersion: 1, status: 200, outcome: 'ok' }),
      event({ operation: 'regeneration', form: 'employee', connection: 'erp', formVersion: 1, status: 200, outcome: 'ok' }),
    ])
    expect(JSON.stringify(events)).not.toContain(TITLE)
    expect(JSON.stringify(events)).not.toContain(ROLE)
  })

  // A refused attempt at administration is the event an operator most
  // needs. A clerk the host vouches for is named, which needs the identity
  // set before the role check refuses; a request with no token has no actor.
  // An allowlisted connection in the path is named either way.
  test('a refusal names the actor it refused, and no token names none', async () => {
    const server = await serve()
    await server.inject({ method: 'GET', url: '/v1/connections/erp/metadata', headers: as('clerk') })
    await server.inject({ method: 'POST', url: '/v1/connections/erp/test' })
    expect(events).toEqual([
      event({ operation: 'discovery', actor: 'c', connection: 'erp', status: 403, outcome: 'forbidden' }),
      event({ operation: 'connection-test', actor: null, connection: 'erp', status: 401, outcome: 'unauthenticated' }),
    ])
  })

  // The plane authenticates after the body is read, so a body Fastify
  // refuses -- JSON that does not parse, a type nothing parses, one past the
  // limit -- is refused before anybody is known, and is recorded with no
  // actor whatever token it carried; 0033 says so, and why the token is not
  // read first. An event naming an actor here would be a claim the plane
  // never checked; one with no event would be a refusal nobody can see.
  test('a body the server cannot read is audited by its code, with no actor whatever the token', async () => {
    const server = await serve()
    const json = { 'content-type': 'application/json' }
    for (const [headers, payload] of [
      [{ ...as('admin'), ...json }, '{'],
      [{ ...as('admin'), 'content-type': 'application/xml' }, '<form/>'],
      [{ ...as('admin'), ...json }, `"${'x'.repeat(1024 * 1024)}"`],
    ] as const) {
      await server.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers, payload })
    }
    expect(events).toEqual([
      event({ operation: 'publish', form: 'employee', actor: null, status: 400, outcome: 'FST_ERR_CTP_INVALID_JSON_BODY' }),
      event({ operation: 'publish', form: 'employee', actor: null, status: 415, outcome: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' }),
      event({ operation: 'publish', form: 'employee', actor: null, status: 413, outcome: 'FST_ERR_CTP_BODY_TOO_LARGE' }),
    ])
  })

  // A database that is down is 503 with no detail to the caller, because a
  // driver's message names hosts and ports; the trail is read by more people
  // than the operator's log, and says no more than the caller was told.
  test('a database that is down is unavailable, with no address in the trail', async () => {
    const server = await serve()
    reachable = false
    await server.inject({ method: 'POST', url: '/v1/connections/erp/test', headers: as('admin') })
    await server.inject({ method: 'GET', url: '/v1/connections/erp/metadata', headers: as('admin') })
    expect(events).toEqual([
      event({ operation: 'connection-test', connection: 'erp', status: 503, outcome: 'unavailable' }),
      event({ operation: 'discovery', connection: 'erp', status: 503, outcome: 'unavailable' }),
    ])
    expect(JSON.stringify(events)).not.toContain('ECONNREFUSED')
    expect(JSON.stringify(events)).not.toContain(HOST)
  })

  // Discovery hands back the customer's schema. The event says it happened,
  // against which connection; a column name in it would put the schema in
  // the log.
  test('a discovery names its connection and nothing of the snapshot', async () => {
    const server = await serve()
    columns = [...columns, col(COLUMN, 4, INT32, { nullable: true })]
    const discovered = await server.inject({ method: 'GET', url: '/v1/connections/erp/metadata', headers: as('admin') })
    expect(discovered.body).toContain(COLUMN)
    expect(events).toEqual([event({ operation: 'discovery', connection: 'erp', status: 200, outcome: 'ok' })])
    expect(JSON.stringify(events)).not.toContain(COLUMN)
  })

  // A body's names are recorded only once they are known to be names: a
  // form id once it has the store's shape, a connection once the allowlist
  // knows it. A connection string pasted where a connection's name belongs
  // is an address with a password in it, and is never written down.
  test('a proposal names its form and connection only once they are known to be names', async () => {
    const server = await serve()
    await server.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: PROPOSAL })
    await server.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, formId: 'Employee' } })
    await server.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, connection: `postgres://sa:${PASSWORD}@${HOST}:5432/erp` } })
    expect(events).toEqual([
      event({ operation: 'proposal', form: 'employee', connection: 'erp', status: 200, outcome: 'ok' }),
      event({ operation: 'proposal', status: 400, outcome: 'invalid-request' }),
      event({ operation: 'proposal', form: 'employee', status: 404, outcome: 'unknown-connection' }),
    ])
    expect(JSON.stringify(events)).not.toContain(PASSWORD)
    expect(JSON.stringify(events)).not.toContain(HOST)
  })

  // What answers before a route runs. A request over the rate limit is still
  // a request to the route, refused before anybody is known, and is audited
  // by its status, since the limit's body carries no code. A path no route
  // matches, a parameter past the router's limit, or one whose percent-encoding
  // does not decode, never reaches the plane: the router answers it, runs no
  // hook, and it leaves no event. 0033 says so rather than claim every request.
  test('a rate-limited request is audited by its status, and one the router refuses is not audited', async () => {
    const limited = await createDataServer({ verifyIdentity, rateLimit: { max: 1, timeWindowMs: 60_000 }, admin: { registry: registry(), store, adminRoles: ['data-admin'], audit: { sink, now: () => NOW } } })
    await limited.inject({ method: 'GET', url: '/v1/connections', headers: as('admin') })
    expect((await limited.inject({ method: 'GET', url: '/v1/connections', headers: as('admin') })).statusCode).toBe(429)
    const server = await serve()
    expect((await server.inject({ method: 'GET', url: '/v1/forms/employee/nothing', headers: as('admin') })).statusCode).toBe(404)
    expect((await server.inject({ method: 'GET', url: `/v1/forms/e${'x'.repeat(128)}/versions/latest`, headers: as('admin') })).statusCode).toBe(414)
    const undecodable = await server.inject({ method: 'POST', url: '/v1/forms/%E0/versions', headers: as('admin') })
    expect({ status: undecodable.statusCode, code: (undecodable.json() as { code: string }).code }).toEqual({ status: 400, code: 'FST_ERR_BAD_URL' })
    expect(events).toEqual([
      event({ operation: 'connection-list', status: 200, outcome: 'ok' }),
      event({ operation: 'connection-list', actor: null, status: 429, outcome: 'http-429' }),
    ])
  })

  // By the time the event exists the version is written; refusing to answer
  // because the trail failed would hide that it was. The failure goes to the
  // operator's log instead.
  test('a sink that throws does not fail a publish, and the failure is logged', async () => {
    const lines: string[] = []
    const logged = Fastify({ logger: { level: 'error', stream: { write: (line: string) => void lines.push(line) } } })
    await logged.register(adminRoutes, {
      registry: registry(), store, adminRoles: ['data-admin'], authenticate,
      audit: {
        sink: () => {
          throw new Error('disk full')
        },
      },
    })
    const published = await publish(logged)
    expect(published.statusCode, published.body).toBe(201)
    expect(await store.latest('employee')).toBe(1)
    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toContain('an audit event could not be written')
  })
})

describe('what a caller cannot write into the trail', () => {
  // A connection named in the path is recorded only once the allowlist knows
  // it. Anybody who can reach the port, with or without a token, could
  // otherwise put a connection string -- host, user and password -- into
  // the trail by pasting it where a connection's name goes.
  test('a connection string in the path is never recorded, with a token or without', async () => {
    const server = await serve()
    for (const address of [`postgres://sa:${PASSWORD}@${HOST}:5432/erp`, `Server=${HOST};User Id=sa;Password=${PASSWORD}`]) {
      const id = encodeURIComponent(address)
      for (const headers of [{}, as('admin')]) {
        await server.inject({ method: 'POST', url: `/v1/connections/${id}/test`, headers })
        await server.inject({ method: 'GET', url: `/v1/connections/${id}/metadata`, headers })
      }
    }
    expect(events.map(({ operation, connection, status }) => ({ operation, connection, status }))).toEqual(
      Array.from({ length: 2 }, () => [
        { operation: 'connection-test', connection: null, status: 401 },
        { operation: 'discovery', connection: null, status: 401 },
        { operation: 'connection-test', connection: null, status: 404 },
        { operation: 'discovery', connection: null, status: 404 },
      ]).flat(),
    )
    expect(JSON.stringify(events)).not.toContain(PASSWORD)
    expect(JSON.stringify(events)).not.toContain(HOST)
  })

  // A form id is recorded only when it has the store's shape, as the
  // runtime's is: otherwise any text up to the router's limit lands in the
  // trail under `form`, naming a form that cannot exist.
  test('a path that is not a form id is recorded as no form, with a token or without', async () => {
    const server = await serve()
    const forged = encodeURIComponent(`Server=${HOST};Password=${PASSWORD}`)
    for (const headers of [{}, as('admin')]) {
      await server.inject({ method: 'POST', url: `/v1/forms/${forged}/versions`, headers, payload: { expectedBase: null } })
      await server.inject({ method: 'GET', url: `/v1/forms/${forged}/versions/latest`, headers })
    }
    await server.inject({ method: 'POST', url: '/v1/forms/Employee/drift', headers: as('admin') })
    expect(events.map(({ operation, form, status }) => ({ operation, form, status }))).toEqual([
      { operation: 'publish', form: null, status: 401 },
      { operation: 'version-latest', form: null, status: 401 },
      { operation: 'publish', form: null, status: 400 },
      { operation: 'version-latest', form: null, status: 404 },
      { operation: 'drift', form: null, status: 404 },
    ])
    expect(JSON.stringify(events)).not.toContain(PASSWORD)
    expect(JSON.stringify(events)).not.toContain(HOST)
  })

  // The limit of the shape, said rather than hidden: a form id may hold dots,
  // hyphens and digits, so an IP address, a host name or a lower-case word
  // that happens to be a password is a form id, and is recorded as the form
  // addressed. What the shape keeps out is a connection string, which needs
  // a `:`, `;`, `@`, `=` or `/`; 0033 and the README claim no more than that.
  test('an address or a word with a form id\'s shape is recorded as the form addressed', async () => {
    const server = await serve()
    await server.inject({ method: 'GET', url: `/v1/forms/${HOST}/versions/latest` })
    await server.inject({ method: 'GET', url: '/v1/forms/db.internal.example/versions' })
    await server.inject({ method: 'GET', url: `/v1/forms/${PASSWORD.toLowerCase()}/versions` })
    expect(events.map(({ form, status }) => ({ form, status }))).toEqual([
      { form: HOST, status: 401 },
      { form: 'db.internal.example', status: 401 },
      { form: PASSWORD.toLowerCase(), status: 401 },
    ])
  })
})

/** A door a store's method waits at: `entered` once something reaches it, and through once the test opens it. */
function gate() {
  let enter!: () => void
  let open!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  const opened = new Promise<void>((resolve) => (open = resolve))
  return {
    entered,
    open,
    pass: async () => {
      enter()
      await opened
    },
  }
}

/**
 * A store whose version list and publish each wait at a gate until the test
 * opens it, and which says when a publish has written: a request held on its
 * socket, and a write whose moment the test chooses.
 */
function heldStore(inner: ConfigurationStore) {
  const listing = gate()
  const publishing = gate()
  let wrote!: () => void
  const written = new Promise<void>((resolve) => (wrote = resolve))
  const held: ConfigurationStore = {
    ...inner,
    versions: async (id) => {
      await listing.pass()
      return inner.versions(id)
    },
    publish: async (id, expectedBase, value): Promise<PublishOutcome> => {
      await publishing.pass()
      const outcome = await inner.publish(id, expectedBase, value)
      wrote()
      return outcome
    },
  }
  return { store: held, listing, publishing, written }
}

/** One HTTP/1.1 request as it goes over the wire, so a test can send two on one socket, or half of one. */
function wire(method: 'GET' | 'POST', path: string, headers: Record<string, string>, payload?: unknown): string {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  const head = [`${method} ${path} HTTP/1.1`, 'Host: audit.test']
  if (payload !== undefined) head.push('Content-Type: application/json', `Content-Length: ${String(Buffer.byteLength(body))}`)
  for (const [name, value] of Object.entries(headers)) head.push(`${name}: ${value}`)
  return `${head.join('\r\n')}\r\n\r\n${body}`
}

/** Bytes over a socket of its own, so a test can leave before the answer as a closed tab or a proxy's timeout does. */
function rawSend(server: FastifyInstance, bytes: string): Socket {
  const socket = connect((server.server.address() as AddressInfo).port, '127.0.0.1')
  // The socket is destroyed on purpose; its own error is not the test's.
  socket.on('error', () => {})
  socket.write(bytes)
  return socket
}

/** The next turn of the event loop: what follows a write here -- the reply, onSend, the sink -- is promise continuations, all run by then. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

/**
 * Waits until the trail holds `count` events, for an ending the server
 * reaches in its own time once a socket has gone. The bound is not a
 * measurement: the event comes within a turn or two, and the bound only turns
 * a missing one into a failed comparison instead of a test that hangs.
 */
async function eventsReach(count: number): Promise<void> {
  for (let turn = 0; turn < 200 && events.length < count; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5))
}

/**
 * The most `close` listeners the connection held while `behind` connection
 * lists waited, pipelined behind a held version list, for their answers to
 * be written; each has reached `onSend` before the held one is let go.
 */
async function pipelinedPeak(behind: number): Promise<number> {
  const held = heldStore(store)
  let listed = 0
  const counting: ConnectionRegistry = {
    ...registry(),
    ids: () => {
      listed += 1
      return ['erp']
    },
  }
  const server = await createDataServer({ verifyIdentity, admin: { registry: counting, store: held.store, adminRoles: ['data-admin'], audit: { sink, now: () => NOW } } })
  await server.listen({ host: '127.0.0.1', port: 0 })
  try {
    const accepted = new Promise<Socket>((resolve) => server.server.once('connection', resolve))
    const lists = Array.from({ length: behind }, () => wire('GET', '/v1/connections', as('admin'))).join('')
    const client = rawSend(server, wire('GET', '/v1/forms/employee/versions', as('admin')) + lists)
    let answers = 0
    client.on('data', (chunk: Buffer) => (answers += chunk.toString('utf8').split('HTTP/1.1 ').length - 1))
    const serverSide = await accepted
    let peak = serverSide.listenerCount('close')
    // Emitted before the listener is added, so the count it is about to reach.
    serverSide.on('newListener', (name: string) => {
      if (name === 'close') peak = Math.max(peak, serverSide.listenerCount('close') + 1)
    })
    await held.listing.entered
    while (listed < behind) await settle()
    await settle()
    held.listing.open()
    while (answers < behind + 1) await settle()
    client.destroy()
    return peak
  } finally {
    await server.close()
  }
}

describe('over a real socket, however the connection ends', () => {
  // Fastify runs onResponse only when the response finishes, and a response
  // whose socket closed while the route still ran never does: the publish
  // commits and, with the event written there alone, nothing says so --
  // exactly "who published version 1" with no answer. Measured against
  // Fastify 5.12.5 on Node 22: the handler completes, onSend runs with the
  // response already destroyed, onResponse and onRequestAbort never run.
  test('a publish whose client disconnected is audited once, naming the version it wrote', async () => {
    const held = heldStore(store)
    const server = await serve({ store: held.store })
    const bundle = bundleOf(await propose(server))
    events = []
    await server.listen({ host: '127.0.0.1', port: 0 })
    try {
      const accepted = new Promise<Socket>((resolve) => server.server.once('connection', resolve))
      const client = rawSend(server, wire('POST', '/v1/forms/employee/versions', as('admin'), { expectedBase: null, bundle }))
      const serverSide = await accepted
      await held.publishing.entered
      const gone = new Promise((resolve) => serverSide.once('close', resolve))
      client.destroy()
      await gone
      held.publishing.open()
      await held.written
      await settle()
    } finally {
      await server.close()
    }
    expect(await store.latest('employee')).toBe(1)
    expect(events).toEqual([event({ operation: 'publish', form: 'employee', connection: 'erp', formVersion: 1, status: 201, outcome: 'ok' })])
  })

  // HTTP/1.1 lets a client send a request before the one ahead of it is
  // answered, and Node holds the second answer until the first is written:
  // until then it has no socket, so when the connection goes first it emits
  // neither `finish` nor `close`. The publish behind runs all the same and
  // commits. Whether the connection goes after its answer was decided or
  // before, its event is written once, naming the version it wrote; with the
  // response's own `close` as the last way to hear of it, it was never written.
  test.each(['after', 'before'] as const)('a publish pipelined behind a held request is audited once when the connection goes %s its answer is decided', async (when) => {
    const plain = await serve()
    expect((await publish(plain)).statusCode).toBe(201)
    const bundle = bundleOf(await propose(plain))
    const held = heldStore(store)
    if (when === 'after') held.publishing.open()
    const server = await serve({ store: held.store })
    events = []
    await server.listen({ host: '127.0.0.1', port: 0 })
    try {
      const accepted = new Promise<Socket>((resolve) => server.server.once('connection', resolve))
      const client = rawSend(server, wire('GET', '/v1/forms/employee/versions', as('admin')) + wire('POST', '/v1/forms/employee/versions', as('admin'), { expectedBase: 1, bundle }))
      const serverSide = await accepted
      await held.listing.entered
      if (when === 'after') {
        await held.written
        await settle()
      } else {
        await held.publishing.entered
      }
      const gone = new Promise((resolve) => serverSide.once('close', resolve))
      client.destroy()
      await gone
      held.publishing.open()
      await held.written
      held.listing.open()
      await eventsReach(2)
    } finally {
      await server.close()
    }
    expect(await store.latest('employee')).toBe(2)
    expect(of('publish')).toEqual([event({ operation: 'publish', form: 'employee', connection: 'erp', formVersion: 2, expectedBase: 1, status: 201, outcome: 'ok' })])
    expect(of('version-list')).toEqual([event({ operation: 'version-list', form: 'employee', status: 200, outcome: 'ok' })])
  })

  // A client gone halfway through its body is refused by Fastify's body
  // reader as ECONNRESET before any route runs. It is still a request to the
  // route, and is audited as one -- with no actor, since the token is read
  // after the body.
  test('a body cut off by a client that left is audited by its code', async () => {
    const server = await serve()
    await server.listen({ host: '127.0.0.1', port: 0 })
    try {
      const received = new Promise((resolve) => server.server.once('request', resolve))
      const bytes = wire('POST', '/v1/forms/employee/versions', as('admin'), { expectedBase: null, bundle: { padding: 'x'.repeat(4096) } })
      const client = rawSend(server, bytes.slice(0, bytes.length - 2048))
      await received
      client.destroy()
      await eventsReach(1)
    } finally {
      await server.close()
    }
    expect(events).toEqual([event({ operation: 'publish', form: 'employee', actor: null, status: 400, outcome: 'ECONNRESET' })])
  })

  // The third way a request ends: the socket goes after onSend has decided
  // the answer and before the response finishes -- a reset while a large
  // answer is still in the socket's buffers, after which Node emits neither
  // `finish` nor `error`, so onResponse never runs. No client lands there
  // except by timing, so this test puts the loss there by hand: an onSend
  // hook after the trail's own destroys the socket.
  test('a socket lost after the answer was decided and before it finished is audited once', async () => {
    const bare = Fastify()
    await bare.register(async (instance) => {
      await adminRoutes(instance, { registry: registry(), store, adminRoles: ['data-admin'], authenticate, audit: { sink, now: () => NOW } })
      instance.addHook('onSend', async (_request, reply, payload) => {
        reply.raw.socket?.destroy()
        return payload
      })
    })
    await bare.listen({ host: '127.0.0.1', port: 0 })
    try {
      const accepted = new Promise<Socket>((resolve) => bare.server.once('connection', resolve))
      rawSend(bare, wire('POST', '/v1/connections/erp/test', as('admin'), {}))
      const serverSide = await accepted
      await new Promise((resolve) => serverSide.once('close', resolve))
      await settle()
    } finally {
      await bare.close()
    }
    expect(events).toEqual([event({ operation: 'connection-test', connection: 'erp', status: 200, outcome: 'ok' })])
  })

  // The other half of "exactly once": over a real socket a response that
  // finishes runs onResponse, and its connection, asked to close, closes
  // around it; each is a way the event can be written. Only one may.
  test('a publish answered over a socket is audited exactly once', async () => {
    const server = await serve()
    const bundle = bundleOf(await propose(server))
    events = []
    await server.listen({ host: '127.0.0.1', port: 0 })
    let answer = ''
    try {
      const accepted = new Promise<Socket>((resolve) => server.server.once('connection', resolve))
      const client = rawSend(server, wire('POST', '/v1/forms/employee/versions', { ...as('admin'), Connection: 'close' }, { expectedBase: null, bundle }))
      const heard = new Promise((resolve) => {
        client.on('data', (chunk: Buffer) => (answer += chunk.toString('utf8')))
        client.once('close', resolve)
      })
      const serverSide = await accepted
      // Both ends: the server's socket is half-open and can close before the
      // client has read the answer, and the response's own close follows its
      // socket's.
      const gone = new Promise((resolve) => serverSide.once('close', resolve))
      await Promise.all([heard, gone])
      await settle()
    } finally {
      await server.close()
    }
    expect(answer).toMatch(/^HTTP\/1\.1 201 /)
    expect(events).toEqual([event({ operation: 'publish', form: 'employee', connection: 'erp', formVersion: 1, status: 201, outcome: 'ok' })])
  })

  // A keep-alive connection carries one request after another, and each
  // waits for its answer on the same socket: the trail listens for that
  // socket's close while an answer waits, and lets go once it is written, or
  // a long-lived connection would keep a listener, and every request it
  // ever carried, until it closed. After one request and after twenty the
  // socket has as many as before the first.
  test('a keep-alive connection keeps no listener once its answers are written', async () => {
    const server = await serve()
    await server.listen({ host: '127.0.0.1', port: 0 })
    const listeners: number[] = []
    try {
      const accepted = new Promise<Socket>((resolve) => server.server.once('connection', resolve))
      const client = rawSend(server, '')
      const serverSide = await accepted
      listeners.push(serverSide.listenerCount('close'))
      let answers = 0
      client.on('data', (chunk: Buffer) => (answers += chunk.toString('utf8').split('HTTP/1.1 200').length - 1))
      for (let n = 1; n <= 20; n += 1) {
        client.write(wire('GET', '/v1/connections', as('admin')))
        while (answers < n) await settle()
        // onResponse, which writes the event and lets go of the connection, runs once the answer is flushed.
        await settle()
        if (n === 1 || n === 20) listeners.push(serverSide.listenerCount('close'))
      }
      client.destroy()
    } finally {
      await server.close()
    }
    expect(events).toHaveLength(20)
    expect(listeners).toEqual([listeners[0], listeners[0], listeners[0]])
  })

  // A client may send many requests on one connection before the first is
  // answered, token or none, and every one waits there for its answer to be
  // written. The trail listens to the connection once, however many wait on
  // it: a listener per waiting request let any client put one on a socket
  // per request it pipelined -- measured, forty behind one held request put
  // forty-two on its socket, and Node warned of a leak. Twenty behind a held
  // request reach the same peak as one.
  test('requests pipelined behind a held one share one listener on their connection', async () => {
    const peaks: number[] = []
    for (const behind of [1, 20]) peaks.push(await pipelinedPeak(behind))
    expect(peaks[1]).toBe(peaks[0])
  })

  // While the server closes, Fastify answers a request that arrives on a
  // connection it still holds with 503 of its own, before any hook of any
  // plane (lib/route.js in 5.12.5): no route runs, nothing is written, and
  // there is nothing to audit. 0033 says so rather than claim every request.
  test('a request answered 503 because the server is closing leaves no event', async () => {
    const held = heldStore(store)
    const server = await serve({ store: held.store })
    await server.listen({ host: '127.0.0.1', port: 0 })
    let answer = ''
    const accepted = new Promise<Socket>((resolve) => server.server.once('connection', resolve))
    const client = rawSend(server, wire('GET', '/v1/forms/employee/versions', as('admin')))
    client.on('data', (chunk: Buffer) => (answer += chunk.toString('utf8')))
    const ended = new Promise((resolve) => client.once('close', resolve))
    await accepted
    await held.listing.entered
    const closed = server.close()
    while (server.server.listening) await settle()
    const second = new Promise((resolve) => server.server.once('request', resolve))
    client.write(wire('POST', '/v1/connections/erp/test', as('admin'), {}))
    await second
    held.listing.open()
    await ended
    await closed
    await settle()
    expect(events.map(({ operation, status }) => ({ operation, status }))).toEqual([{ operation: 'version-list', status: 404 }])
    expect(answer).toMatch(/HTTP\/1\.1 404 [\s\S]*HTTP\/1\.1 503 /)
  })

  // Node's HTTP parser refuses some requests before Fastify sees a request at
  // all -- headers past Node's limit, a body framed two ways at once -- and
  // Fastify's `clientError` handler answers them: no route, no hook, nothing
  // done, and no event. 0033 says so rather than claim every request; an
  // event here would be a request that reached the plane.
  test("a request Node's parser refuses leaves no event", async () => {
    const server = await serve()
    await server.listen({ host: '127.0.0.1', port: 0 })
    const statusLine = (bytes: string) =>
      new Promise<string>((resolve) => {
        let answer = ''
        const client = rawSend(server, bytes)
        client.on('data', (chunk: Buffer) => (answer += chunk.toString('utf8')))
        client.once('close', () => resolve(answer.split('\r\n')[0] ?? ''))
      })
    const answers: string[] = []
    try {
      answers.push(await statusLine(wire('POST', '/v1/connections/erp/test', { ...as('admin'), 'X-Padding': 'x'.repeat(20 * 1024) }, {})))
      answers.push(await statusLine(wire('POST', '/v1/connections/erp/test', { ...as('admin'), 'Transfer-Encoding': 'chunked' }, {})))
      await settle()
    } finally {
      await server.close()
    }
    expect(answers).toEqual(['HTTP/1.1 431 Request Header Fields Too Large', 'HTTP/1.1 400 Bad Request'])
    expect(events).toEqual([])
  })
})
