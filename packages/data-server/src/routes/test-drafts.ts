import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, FormBindings, LookupAdapter, MetadataSnapshot, NormalizedType, RecordAdapter } from '@formancy/data-core'
import type { HostIdentity, IdentityVerifier } from '@formancy/data-identity'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { afterEach, beforeEach, expect } from 'vitest'
import { createDataServer } from '../app.js'
import type { ConfigurationStore } from '../config-store.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import { adminRoutes } from './admin.js'

/*
 * Publication under review (0065), as the drafts suites set it up: a
 * server under review over a real file store and a fake database whose
 * discovery a test changes, as in admin-promotion.test.ts, with two
 * authors, a publisher, a submitter holding both roles and a clerk. What
 * the suites prove is the routes' own decisions; what a database does with
 * a draft is admin-drafts.integration.test.ts's.
 *
 * Read by admin-drafts.test.ts and admin-drafts-store.test.ts only; never
 * part of the package.
 */

export const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
export const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
export const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
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

/** sales.employee as each test starts with it. */
export const EMPLOYEE = (): ColumnMeta[] => [
  col('id', 1, INT32),
  col('name', 2, TEXT),
  col('title', 3, TEXT, { nullable: true }),
  col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' }),
]

/**
 * The database as it is "now", the allowlist that reaches it, and what
 * happens while it is discovered, where a test puts somebody else's
 * action: a test changes any of them.
 */
export const db: { columns: ColumnMeta[]; engine: 'sqlserver' | 'postgres'; reachable: boolean; allowlist: string[]; discovering: () => Promise<void> } = {
  columns: EMPLOYEE(),
  engine: 'sqlserver',
  reachable: true,
  allowlist: ['erp'],
  discovering: async () => {},
}

function snapshot(): MetadataSnapshot {
  return createSnapshot({
    kind: db.engine,
    serverVersion: '16.0',
    account: { user: 'dbo', login: 'sa' },
    scope: { schemas: ['sales'] },
    gaps: [],
    objects: [
      {
        ref: { schema: 'sales', name: 'employee' },
        kind: 'table',
        comment: null,
        columns: db.columns,
        primaryKey: { name: 'pk_employee', columns: ['id'] },
        uniqueKeys: [],
        foreignKeys: [],
        checks: [],
        rowSecurity: 'none',
      },
    ],
  })
}

/** Every allowlisted id names the one database; one that is down throws what a driver throws, address and all. */
export function registry(): ConnectionRegistry {
  const discover = async () => {
    await db.discovering()
    return snapshot()
  }
  const adapter = {
    kind: 'sqlserver',
    ping: () => Promise.resolve({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }),
    discover,
    close: () => Promise.resolve(),
  } as DatabaseAdapter
  return {
    ids: () => [...db.allowlist],
    scope: (id) => (db.allowlist.includes(id) ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      if (!db.allowlist.includes(id)) return undefined
      if (!db.reachable) throw new Error('ECONNREFUSED 10.0.0.5:1433')
      return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
    },
    close: async () => {},
  }
}

export const ADMIN_ROLES = ['data-admin', 'data-publisher']
export const PUBLISHER_ROLES = ['data-publisher']

/**
 * Two authors, who administer and do not publish; a publisher, whose one
 * role is an administrator role too; a submitter who holds both roles; and
 * a clerk, who administers nothing.
 */
const IDENTITIES: Record<string, HostIdentity> = {
  author: { actor: { id: 'author', roles: ['data-admin'] }, attributes: {} },
  colleague: { actor: { id: 'colleague', roles: ['data-admin'] }, attributes: {} },
  publisher: { actor: { id: 'publisher', roles: ['data-publisher'] }, attributes: {} },
  submitter: { actor: { id: 'submitter', roles: ['data-admin', 'data-publisher'] }, attributes: {} },
  clerk: { actor: { id: 'clerk', roles: ['clerk'] }, attributes: {} },
}
export const verifyIdentity: IdentityVerifier = (token) => {
  const identity = IDENTITIES[token]
  return Promise.resolve(identity === undefined ? { ok: false, reason: 'bad' } : { ok: true, identity })
}
function authenticate(request: FastifyRequest): Promise<HostIdentity | undefined> {
  return Promise.resolve(IDENTITIES[/^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? ''])
}

let roots: string[] = []
/** This test's store, its directory, the server under review over it, and the lines that server logged. */
export let root: string
export let store: ConfigurationStore
export let app: FastifyInstance
export let lines: Array<{ msg: string; form?: string; entry?: number }> = []

/** A store of its own, in a directory of its own, for what follows. */
export async function fresh(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'formancy-data-drafts-'))
  roots.push(root)
  store = createFileConfigurationStore(root)
}

/** The server over `over`, this test's store unless another is given, under review unless `review` is false, writing its log to `lines`. */
export function serve(review = true, over: ConfigurationStore = store): Promise<FastifyInstance> {
  return createDataServer({
    verifyIdentity,
    logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as (typeof lines)[number]) } },
    admin: { registry: registry(), store: over, adminRoles: ADMIN_ROLES, ...(review ? { publisherRoles: PUBLISHER_ROLES } : {}), audit: { sink: () => {} } },
  })
}

/** The plane alone, under review, with every route it registers read from its router, as admin-audit.test.ts reads them. */
export async function plane(): Promise<{ app: FastifyInstance; routes: Array<{ method: string; url: string }> }> {
  const routes: Array<{ method: string; url: string }> = []
  const bare = Fastify({ routerOptions: { maxParamLength: 128 } })
  bare.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) if (method !== 'HEAD') routes.push({ method, url: route.url })
  })
  await bare.register(async (instance) =>
    adminRoutes(instance, { registry: registry(), store, adminRoles: ADMIN_ROLES, publisherRoles: PUBLISHER_ROLES, authenticate, audit: { sink: () => {} } }),
  )
  await bare.ready()
  return { app: bare, routes }
}

/** Each test: the database as `EMPLOYEE` has it and reachable, a store of its own, and a server under review over it. */
export function useDrafts(): void {
  beforeEach(async () => {
    db.columns = EMPLOYEE()
    db.engine = 'sqlserver'
    db.reachable = true
    db.allowlist = ['erp']
    db.discovering = async () => {}
    roots = []
    lines = []
    await fresh()
    app = await serve()
  })

  afterEach(async () => {
    await Promise.all(roots.map((each) => rm(each, { recursive: true, force: true })))
  })
}

export const as = (token: string) => ({ authorization: `Bearer ${token}` })

const policyFor = (bindings: FormBindings, role: string) => ({
  version: 1,
  operations: { read: [role], create: [role], update: [role] },
  fields: Object.fromEntries(
    bindings.fields.map((binding) => [binding.field, { read: [role], write: binding.writes.create || binding.writes.update ? [role] : [] }]),
  ),
  rowFilters: [],
  lookups: {},
})

/** A proposal as an author proposes it, made into the bundle the studio would publish: a policy granting `role`, nothing chosen over the base. */
export async function proposed({ formId = 'employee', connection = 'erp', role = 'clerk', title = 'Employee', on = app } = {}) {
  const response = await on.inject({
    method: 'POST',
    url: '/v1/form-proposals',
    headers: as('author'),
    payload: { connection, root: { schema: 'sales', name: 'employee' }, formId, title },
  })
  expect(response.statusCode, response.body).toBe(200)
  const proposal = response.json<{ form: unknown; bindings: FormBindings; snapshot: unknown; generation: unknown }>()
  return {
    format: 2,
    connection,
    generation: proposal.generation,
    base: proposal.form,
    presentation: EMPTY_PRESENTATION,
    form: proposal.form,
    bindings: proposal.bindings,
    policy: policyFor(proposal.bindings, role),
    snapshot: proposal.snapshot,
  }
}

export const submit = (token: string, payload: Record<string, unknown>, form = 'employee', on = app) =>
  on.inject({ method: 'POST', url: `/v1/forms/${form}/drafts`, headers: as(token), payload })
export const approve = (token: string, draft: number | string, form = 'employee', on = app) =>
  on.inject({ method: 'POST', url: `/v1/forms/${form}/drafts/${String(draft)}/approval`, headers: as(token) })
export const reject = (token: string, draft: number | string, form = 'employee', on = app) =>
  on.inject({ method: 'POST', url: `/v1/forms/${form}/drafts/${String(draft)}/rejection`, headers: as(token) })
export const read = (token: string, draft: number | string, form = 'employee', on = app) =>
  on.inject({ method: 'GET', url: `/v1/forms/${form}/drafts/${String(draft)}`, headers: as(token) })
export const queue = (token: string) => app.inject({ method: 'GET', url: '/v1/drafts', headers: as(token) })
export const versionFile = (version: number, form = 'employee') => readFile(join(root, form, `${String(version)}.json`), 'utf8')
export const answer = (response: { statusCode: number; json: () => unknown }) => [response.statusCode, response.json()]

/** Submitted by `by` and approved by the publisher: the way a version is written under review. */
export async function published(bundle: unknown, expectedBase: number | null = null, by = 'author'): Promise<number> {
  const submitted = await submit(by, { expectedBase, bundle })
  expect(submitted.statusCode, submitted.body).toBe(201)
  const approved = await approve('publisher', submitted.json<{ draft: number }>().draft)
  expect(approved.statusCode, approved.body).toBe(201)
  return approved.json<{ version: number }>().version
}

export const INTERNAL = { code: 'internal', message: "This could not be completed; the operator's log says why." }
