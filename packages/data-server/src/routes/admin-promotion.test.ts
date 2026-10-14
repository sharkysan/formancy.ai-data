import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, presentationOf } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, FormBindings, LookupAdapter, MetadataSnapshot, NormalizedType, RecordAdapter } from '@formancy/data-core'
import type { FormSchema, LayoutNode } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AdminAuditEvent } from '../audit.js'
import type { ConfigurationStore } from '../config-store.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * A published version moved to another deployment (0062): the version file
 * one store wrote, imported into another through `POST /v1/forms/:id/imports`,
 * which checks it as a publish does and refuses what the target database's
 * drift blocks, as a restore does. Two servers, each with a store of its
 * own and a fake database whose discovery the test changes: development,
 * where the form is published and its version read as the export, and
 * production, where it is imported. What this proves is the route's own
 * order of checks; admin-promotion.integration.test.ts proves the same on
 * both real engines.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})

/** One deployment's database as it is "now": a test changes production's to make drift. */
interface Database {
  columns: ColumnMeta[]
  engine: 'sqlserver' | 'postgres'
  reachable: boolean
}

function snapshotOf(database: Database): MetadataSnapshot {
  return createSnapshot({
    kind: database.engine, serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
    objects: [{
      ref: { schema: 'sales', name: 'employee' }, kind: 'table', comment: null, columns: database.columns,
      primaryKey: { name: 'pk_employee', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    }],
  })
}

/** Every id in `allowlist` names the deployment's one database; a database that is down throws what a driver throws, address and all. */
function registry(database: Database, allowlist: readonly string[]): ConnectionRegistry {
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0' }), discover: async () => snapshotOf(database), close: async () => {} } as DatabaseAdapter
  return {
    ids: () => [...allowlist],
    scope: (id) => (allowlist.includes(id) ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      if (!allowlist.includes(id)) return undefined
      if (!database.reachable) throw new Error('ECONNREFUSED 10.0.0.5:1433')
      return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
    },
    close: async () => {},
  }
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
    : token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: {} } }
      : { ok: false, reason: 'bad' }

const ADMIN = { authorization: 'Bearer admin' }
const columns = () => [col('id', 1, INT32), col('name', 2, TEXT), col('title', 3, TEXT, { nullable: true }), col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' })]

let development: Database
let production: Database
let roots: string[]
let source: { app: FastifyInstance; store: ConfigurationStore; root: string }
let target: { app: FastifyInstance; store: ConfigurationStore; root: string }
/** Production's administrator events. */
let events: AdminAuditEvent[]

async function deployment(database: Database, allowlist: readonly string[], sink: (event: AdminAuditEvent) => void = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-promotion-'))
  roots.push(root)
  const store = createFileConfigurationStore(root)
  const app = await createDataServer({
    verifyIdentity,
    admin: { registry: registry(database, allowlist), store, adminRoles: ['data-admin'], audit: { sink: (event) => (event.plane === 'admin' ? sink(event) : undefined) } },
  })
  return { app, store, root }
}

beforeEach(async () => {
  development = { columns: columns(), engine: 'sqlserver', reachable: true }
  production = { columns: columns(), engine: 'sqlserver', reachable: true }
  roots = []
  events = []
  // Development knows a second name for its database, which production's allowlist does not.
  source = await deployment(development, ['erp', 'crm'])
  target = await deployment(production, ['erp'], (event) => events.push(event))
})

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

const policyFor = (bindings: FormBindings) => ({
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
  rowFilters: [],
  lookups: {},
})

const grid = (form: FormSchema) => ((form.layouts?.[0]?.nodes[0] as { children: LayoutNode[] }).children[0] as { children: Array<{ path: string }> }).children

/** On `on`: propose, label `name` "Full name" and put it first, publish over `expectedBase`, as the studio does. */
async function publish(on: FastifyInstance, expectedBase: number | null = null, connection = 'erp') {
  const proposed = await on.inject({ method: 'POST', url: '/v1/form-proposals', headers: ADMIN, payload: { connection, root: { schema: 'sales', name: 'employee' }, formId: 'employee', title: 'Employee' } })
  expect(proposed.statusCode, proposed.body).toBe(200)
  const proposal = proposed.json() as { form: FormSchema; bindings: FormBindings; snapshot: MetadataSnapshot; generation: unknown }
  const edited = JSON.parse(JSON.stringify(proposal.form)) as FormSchema
  const name = edited.model.fields.find((field) => field.key === 'name')
  if (name !== undefined) name.label = 'Full name'
  const nodes = grid(edited)
  nodes.unshift(...nodes.splice(nodes.findIndex((node) => node.path === 'name'), 1))
  const derived = presentationOf(proposal.form, edited, proposal.bindings)
  if (!derived.ok) throw new Error(derived.problems.join('; '))
  const bundle = { format: 2, connection, generation: proposal.generation, base: proposal.form, presentation: derived.presentation, form: edited, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot }
  const published = await on.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase, bundle } })
  expect(published.statusCode, published.body).toBe(201)
}

/** The export: development's version read through the route the studio downloads it from. */
async function exported(version = 1): Promise<Record<string, any>> {
  const read = await source.app.inject({ method: 'GET', url: `/v1/forms/employee/versions/${String(version)}`, headers: ADMIN })
  expect(read.statusCode, read.body).toBe(200)
  return read.json().bundle
}

const importInto = (payload: unknown, id = 'employee', headers: Record<string, string> = ADMIN) =>
  target.app.inject({ method: 'POST', url: `/v1/forms/${id}/imports`, headers, payload: payload as Record<string, unknown> })
const file = (root: string, version: number) => readFile(join(root, 'employee', `${String(version)}.json`), 'utf8')

describe('an import', () => {
  // What production serves is what development reviewed. An import that
  // reformatted or regenerated the bundle would serve something nobody
  // read; the target's store writes what it was handed, as every store
  // writes a version, so the file is development's byte for byte.
  test("another store's file is imported as the same bytes, with the drift that allowed it", async () => {
    await publish(source.app)
    const bundle = await exported()
    expect(`${JSON.stringify(bundle, null, 2)}\n`).toBe(await file(source.root, 1))
    const imported = await importInto({ expectedBase: null, bundle })
    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json()).toEqual({ version: 1, drift: expect.objectContaining({ changes: [], blocking: false }) })
    expect(await file(target.root, 1)).toBe(await file(source.root, 1))
    const served = await target.app.inject({ method: 'GET', url: '/v1/forms/employee/versions/latest', headers: ADMIN })
    expect(served.json().bundle).toEqual(bundle)
  })

  // A base somebody relaxed by hand -- a name of 4000 characters for a
  // column of 200 -- with the form relaxed alike, so the base and its
  // presentation still give the form and the bundle validates. Only the
  // generator says the database never said 4000, and an import is a
  // publish: watched failing (201) with that check left out, as a restore
  // leaves it out.
  test('a relaxed maxLength with a consistent presentation is 422, and nothing is written', async () => {
    await publish(source.app)
    const bundle = await exported()
    for (const form of [bundle['base'], bundle['form']]) form.model.fields.find((field: { key: string }) => field.key === 'name').maxLength = 4000
    const refused = await importInto({ expectedBase: null, bundle })
    expect(refused.statusCode).toBe(422)
    expect(refused.json()).toMatchObject({ code: 'invalid-bundle', problems: ['base: is not what this server generates from the stored snapshot and generation request'] })
    expect(await target.store.latest('employee')).toBeNull()
  })

  // An import keeps the connection's name, which each deployment's
  // allowlist resolves to its own database: a lookup's source name is made
  // from it, so a renamed connection is another generated base. A name
  // production does not have is refused with that sentence, and the trail
  // records no connection, since an unknown name is not known to be one.
  test('a connection the target does not allowlist is 422, and the event names no connection', async () => {
    await publish(source.app, null, 'crm')
    const refused = await importInto({ expectedBase: null, bundle: await exported() })
    expect(refused.statusCode).toBe(422)
    expect(refused.json()).toEqual({
      code: 'invalid-bundle',
      message: "No connection is called crm in this deployment: an import keeps the connection's name, which each deployment's allowlist resolves to its own database.",
    })
    expect(events.at(-1)).toMatchObject({ operation: 'import', connection: null, form: 'employee', status: 422, outcome: 'invalid-bundle' })
    expect(await target.store.latest('employee')).toBeNull()
  })

  // What a publish refuses an import refuses: a bundle for another form
  // than the path names, a bundle in format 1, which keeps no generation
  // request, and a snapshot edited after it was taken, which no longer
  // hashes to its fingerprint.
  test('another form id, format 1 and an edited snapshot are 422, and nothing is written', async () => {
    await publish(source.app)
    const bundle = await exported()
    const other = await importInto({ expectedBase: null, bundle }, 'staff')
    expect([other.statusCode, other.json().code]).toEqual([422, 'invalid-bundle'])

    const { generation: _generation, base: _base, presentation: _presentation, ...parts } = bundle
    const formatOne = await importInto({ expectedBase: null, bundle: { ...parts, format: 1 } })
    expect(formatOne.statusCode).toBe(422)
    expect(formatOne.json()).toMatchObject({ code: 'invalid-bundle', problems: ['publish format 2: since 0030 a version keeps its generation request, generated base and presentation'] })

    const edited = JSON.parse(JSON.stringify(bundle))
    edited.snapshot.objects[0].columns.find((column: { name: string }) => column.name === 'name').type.maxLength = 4000
    const snapshot = await importInto({ expectedBase: null, bundle: edited })
    expect(snapshot.statusCode).toBe(422)
    expect(snapshot.json().problems).toContain('the snapshot does not hash to its own fingerprint: it was edited after it was taken')
    expect(await target.store.latest('employee')).toBeNull()
  })

  // Production's table lost a column the form binds: the form would offer
  // a field every save of which the database refuses. Refused with only
  // the changes that block -- the added column beside it is not one -- and
  // nothing written. Watched failing (201) with the gate taken out.
  test('a bound column dropped on the target is 409 incompatible with only the blocking changes, and nothing is written', async () => {
    await publish(source.app)
    production.columns = [...production.columns.filter((column) => column.name !== 'title'), col('email', 5, TEXT, { nullable: true })]
    const refused = await importInto({ expectedBase: null, bundle: await exported() })
    expect(refused.statusCode).toBe(409)
    const body = refused.json()
    expect(body.code).toBe('incompatible')
    expect(body.changes.map((change: { kind: string; severity: string }) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])
    expect(await target.store.latest('employee')).toBeNull()
  })

  // A nullable column production has and development does not changes
  // nothing the form rests on: a gate stricter than restore's would refuse
  // harmless differences between two deployments' databases. Imported, and
  // the difference is in the answer for the administrator to review.
  test('an added nullable column imports, with that drift in the answer', async () => {
    await publish(source.app)
    production.columns.push(col('email', 5, TEXT, { nullable: true }))
    const imported = await importInto({ expectedBase: null, bundle: await exported() })
    expect(imported.statusCode, imported.body).toBe(201)
    const { version, drift } = imported.json()
    expect(version).toBe(1)
    expect(drift.blocking).toBe(false)
    expect(drift.changes.map((change: { kind: string; severity: string }) => [change.kind, change.severity])).toEqual([['column-added', 'review']])
  })

  // Production's erp is a PostgreSQL database and the version's bindings
  // are SQL Server's: drift refuses to compare across engines, and the
  // import says so as the caller's problem, not the server's. Watched
  // failing as 500 internal, which is what restore answered before 0062.
  test('a target database of another engine is 422 other-engine, and nothing is written', async () => {
    await publish(source.app)
    production.engine = 'postgres'
    const refused = await importInto({ expectedBase: null, bundle: await exported() })
    expect(refused.statusCode).toBe(422)
    expect(refused.json()).toEqual({ code: 'other-engine', message: 'This version cannot be imported: connection erp is a postgres database here, and the version is bound to sqlserver. A form\'s bindings belong to one engine.' })
    expect(await target.store.latest('employee')).toBeNull()
  })

  // An import is compare-and-swap like any publish: over a base production
  // has replaced, it is the conflict naming the current version, and
  // nothing is written. Imported again over the newest, the same bundle is
  // a new version, as a restore of the same version is.
  test('a stale base is 409 conflict and writes nothing; the same file again over the newest is a new version', async () => {
    await publish(source.app)
    const bundle = await exported()
    expect((await importInto({ expectedBase: null, bundle })).statusCode).toBe(201)
    const stale = await importInto({ expectedBase: null, bundle })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ code: 'conflict', message: expect.any(String), current: 1 })
    expect(await target.store.versions('employee')).toEqual([1])
    const again = await importInto({ expectedBase: 1, bundle })
    expect([again.statusCode, again.json().version]).toEqual([201, 2])
    expect(await file(target.root, 2)).toBe(await file(target.root, 1))
  })

  // 0039 against production's own base: production published the form
  // while its table had job_title and "job title", so job_title_2 stood
  // for "job title". Both databases then lost job_title and gained
  // "job-title", and development published from that: every key there
  // stands for another column than production's version 1 says, and the
  // clerk's grants would follow the keys unasked. Refused until each is
  // confirmed as the server listed it; the stale base is the conflict
  // first, because the keys were compared with a version somebody replaced.
  test('an unconfirmed reassigned key is 422 keys-reassigned; confirmed, 201; against a stale base, the conflict', async () => {
    const job = [col('job_title', 5, TEXT, { nullable: true }), col('job title', 6, TEXT, { nullable: true })]
    production.columns.push(...job)
    await publish(target.app)
    const renumbered = (database: Database) => [...database.columns.filter((column) => column.name !== 'job_title' && column.name !== 'job title'), job[1] as ColumnMeta, col('job-title', 7, TEXT, { nullable: true })]
    production.columns = renumbered(production)
    development.columns = renumbered(development)
    await publish(source.app)
    const bundle = await exported()

    const column = (name: string) => ({ kind: 'column', column: name })
    const reassigned = [
      { field: 'job_title', was: column('job_title'), now: column('job title') },
      { field: 'job_title_2', was: column('job title'), now: column('job-title') },
    ]
    const undecided = await importInto({ expectedBase: 1, bundle })
    expect(undecided.statusCode).toBe(422)
    expect(undecided.json()).toMatchObject({ code: 'keys-reassigned', keys: reassigned })
    expect(await target.store.versions('employee')).toEqual([1])

    // Somebody republishes version 1 as 2: the keys were compared with the version replaced.
    expect(await target.store.publish('employee', 1, JSON.parse(await file(target.root, 1)))).toEqual({ ok: true, version: 2 })
    const stale = await importInto({ expectedBase: 1, bundle })
    expect([stale.statusCode, stale.json()]).toEqual([409, { code: 'conflict', message: expect.any(String), current: 2 }])

    const confirmed = await importInto({ expectedBase: 2, bundle, keysConfirmed: reassigned })
    expect(confirmed.statusCode, confirmed.body).toBe(201)
    expect(confirmed.json().version).toBe(3)
  })

  // A database that cannot be reached says as little as everywhere else on
  // the plane: the driver's message names hosts and ports.
  test('an unreachable target database is 503 with no address, and nothing is written', async () => {
    await publish(source.app)
    production.reachable = false
    const down = await importInto({ expectedBase: null, bundle: await exported() })
    expect(down.statusCode).toBe(503)
    expect(down.json().code).toBe('unavailable')
    expect(down.body).not.toContain('10.0.0.5')
    expect(await target.store.latest('employee')).toBeNull()
  })

  // Importing writes a version: the administrator plane's role, as for
  // publish. A clerk the host vouches for is refused before the body is read.
  test('a clerk is 403, and no token 401', async () => {
    await publish(source.app)
    const bundle = await exported()
    expect((await importInto({ expectedBase: null, bundle }, 'employee', { authorization: 'Bearer clerk' })).statusCode).toBe(403)
    expect((await importInto({ expectedBase: null, bundle }, 'employee', {})).statusCode).toBe(401)
    expect(await target.store.latest('employee')).toBeNull()
  })

  // Read before anything else, so a request the server cannot read learns
  // that before it is checked, and never reaches a database: no base, a
  // base that is not a version, no bundle, a confirmation of another
  // shape, a form id the store cannot hold.
  test('a body of another shape is 400 before a database is asked', async () => {
    await publish(source.app)
    const bundle = await exported()
    production.reachable = false
    for (const payload of [{ bundle }, { expectedBase: '1', bundle }, { expectedBase: 1.5, bundle }, { expectedBase: null }, { expectedBase: null, bundle: [bundle] }, { expectedBase: null, bundle, keysConfirmed: 'job_title' }]) {
      const response = await importInto(payload)
      expect(response.statusCode, JSON.stringify(Object.keys(payload))).toBe(400)
      expect(response.json().code).toBe('invalid-request')
    }
    expect((await importInto({ expectedBase: null, bundle }, 'Employee')).statusCode).toBe(400)
  })
})
