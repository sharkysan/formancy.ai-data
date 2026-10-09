import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, LookupAdapter, MetadataSnapshot, NormalizedType, RecordAdapter } from '@formancy/data-core'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { ConfigurationStore } from '../config-store.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, ...extra,
})

/** The database as it is "now"; a test changes it to make drift. */
let columns: ColumnMeta[]
function snapshot(): MetadataSnapshot {
  return createSnapshot({
    kind: 'sqlserver', serverVersion: '16.0', scope: { schemas: ['sales'] }, gaps: [],
    objects: [{
      ref: { schema: 'sales', name: 'employee' }, kind: 'table', comment: null, columns,
      primaryKey: { name: 'pk_employee', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [],
    }],
  })
}

/** Accepts three literal tokens: an administrator, a clerk, and nothing else. */
const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
    : token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: 't' } } }
      : { ok: false, reason: 'bad' }

let root: string
let store: ConfigurationStore
let app: FastifyInstance
let reachable: boolean

function registry(): ConnectionRegistry {
  const adapter = {
    kind: 'sqlserver',
    ping: async () => ({ kind: 'sqlserver', version: '16.0' }),
    discover: async () => snapshot(),
    close: async () => {},
  } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      if (id !== 'erp') return undefined
      if (!reachable) throw new Error('ECONNREFUSED 10.0.0.5:1433')
      return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
    },
    close: async () => {},
  }
}

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const PROPOSAL = { connection: 'erp', root: { schema: 'sales', name: 'employee' }, formId: 'employee', title: 'Employee' }
const POLICY = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { id: { read: ['clerk'], write: ['clerk'] }, name: { read: ['clerk'], write: ['clerk'] } },
  rowFilters: [],
  lookups: {},
}

beforeEach(async () => {
  columns = [col('id', 1, INT32), col('name', 2, { kind: 'text', maxLength: 200, fixedLength: false }), col('row_version', 3, { kind: 'rowversion' }, { generated: 'rowversion' })]
  reachable = true
  root = await mkdtemp(join(tmpdir(), 'formancy-data-admin-'))
  store = createFileConfigurationStore(root)
  app = await createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'] } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Propose, then publish what was proposed with a policy, as an administrator would. */
async function publish(expectedBase: number | null = null) {
  const proposal = (await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: PROPOSAL })).json()
  const bundle = { format: 1, connection: 'erp', form: proposal.form, bindings: proposal.bindings, policy: POLICY, snapshot: proposal.snapshot }
  return app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as('admin'), payload: { expectedBase, bundle } })
}

describe('the administrator plane', () => {
  // Publishing a form and writing a business record are different permissions.
  // A clerk the host vouches for is still not an administrator.
  test('requires a token, and an administrator role', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/connections' })).statusCode).toBe(401)
    const clerk = await app.inject({ method: 'GET', url: '/v1/connections', headers: as('clerk') })
    expect(clerk.statusCode).toBe(403)
    expect(clerk.json()).toMatchObject({ code: 'forbidden' })
    expect((await app.inject({ method: 'GET', url: '/v1/connections', headers: as('admin') })).json()).toEqual({ connections: ['erp'] })
  })

  // Test and discover reach the allowlisted connection and nothing else; a
  // database that is down is 503 without the driver's message, which names
  // hosts and ports.
  test('tests and discovers allowlisted connections, and says nothing about an unreachable one', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/connections/erp/test', headers: as('admin') })).json()).toEqual({ kind: 'sqlserver', version: '16.0' })
    expect((await app.inject({ method: 'GET', url: '/v1/connections/erp/metadata', headers: as('admin') })).json()).toMatchObject({ kind: 'sqlserver', objects: [{ ref: { name: 'employee' } }] })
    expect((await app.inject({ method: 'GET', url: '/v1/connections/elsewhere/metadata', headers: as('admin') })).statusCode).toBe(404)
    reachable = false
    const down = await app.inject({ method: 'POST', url: '/v1/connections/erp/test', headers: as('admin') })
    expect(down.statusCode).toBe(503)
    expect(down.body).not.toContain('10.0.0.5')
  })

  // A proposal is generateForm over a fresh discovery: the form, its bindings,
  // the notes, and the snapshot to publish them with.
  test('proposes a form from the database as it is now', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: PROPOSAL })
    expect(response.statusCode).toBe(200)
    const proposal = response.json()
    expect(proposal.form.id).toBe('employee')
    expect(proposal.bindings.concurrency).toEqual({ kind: 'rowversion', column: 'row_version', confirmed: true })
    expect(proposal.snapshot.fingerprint).toBe(proposal.bindings.snapshotFingerprint)
    const refused = await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, root: { schema: 'sales', name: 'nope' } } })
    expect(refused.statusCode).toBe(422)
    expect((await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, formId: 'Employee' } })).statusCode).toBe(400)
    // The policy's pinned columns reach the generator, so the field the tenant
    // comes from is read-only rather than a required field nobody may fill.
    const pinned = (await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, pinned: ['name'] } })).json()
    expect(pinned.bindings.fields.find((binding: { field: string }) => binding.field === 'name')).toMatchObject({ writable: false })
    expect((await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, pinned: 'name' } })).statusCode).toBe(400)
  })

  // Publication is compare-and-swap: the first publish names no base, a second
  // from a stale base is a conflict that names the current version.
  test('publishes a reviewed proposal, and refuses a stale base', async () => {
    const first = await publish()
    expect(first.statusCode).toBe(201)
    expect(first.json()).toEqual({ version: 1 })
    expect((await publish(1)).json()).toEqual({ version: 2 })
    const stale = await publish(1)
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'conflict', current: 2 })
    const latest = (await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/latest', headers: as('admin') })).json()
    expect(latest.version).toBe(2)
  })

  // A bundle that does not validate is never written; one whose form id is not
  // the route's, or whose connection is not allowlisted, neither.
  test('refuses a bundle that does not validate, belongs to another form, or names an unknown connection', async () => {
    const proposal = (await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: PROPOSAL })).json()
    const bundle = { format: 1, connection: 'erp', form: proposal.form, bindings: proposal.bindings, policy: POLICY, snapshot: proposal.snapshot }
    const loose = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as('admin'), payload: { expectedBase: null, bundle: { ...bundle, policy: { ...POLICY, fields: { ghost: { read: [], write: [] } } } } } })
    expect(loose.statusCode).toBe(422)
    expect(loose.json().problems).toContainEqual(expect.stringMatching(/ghost/))
    expect((await app.inject({ method: 'POST', url: '/v1/forms/other/versions', headers: as('admin'), payload: { expectedBase: null, bundle } })).statusCode).toBe(422)
    expect((await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as('admin'), payload: { expectedBase: null, bundle: { ...bundle, connection: 'elsewhere' } } })).statusCode).toBe(422)
    expect((await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as('admin'), payload: { bundle } })).statusCode).toBe(400)
    expect(await store.latest('employee')).toBeNull()
  })

  // A published version edited by hand on the volume is not served, and the
  // reason goes to the operator's log, not to the caller.
  test('a published version edited on disk is refused, not served', async () => {
    await publish()
    const file = join(root, 'employee', '1.json')
    // Widen the snapshot's column: the planner would then accept names the
    // database refuses. The form and bindings are left exactly as published.
    const stored = JSON.parse(await readFile(file, 'utf8')) as { snapshot: { objects: Array<{ columns: Array<{ name: string; type: { maxLength?: number } }> }> } }
    const name = stored.snapshot.objects[0]?.columns.find((entry) => entry.name === 'name')
    if (name !== undefined) name.type.maxLength = 4000
    await writeFile(file, JSON.stringify(stored, null, 2))
    const response = await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/latest', headers: as('admin') })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ code: 'corrupt-bundle' })
  })

  // Drift compares the published snapshot with the database now, through the
  // form's bindings: a dropped bound column blocks the form.
  test('reports drift between the published version and the database now', async () => {
    await publish()
    expect((await app.inject({ method: 'POST', url: '/v1/forms/employee/drift', headers: as('admin') })).json()).toMatchObject({ version: 1, changes: [], blocking: false })
    columns = columns.filter((entry) => entry.name !== 'name')
    const drift = (await app.inject({ method: 'POST', url: '/v1/forms/employee/drift', headers: as('admin') })).json()
    expect(drift.blocking).toBe(true)
    expect(drift.changes).toContainEqual(expect.objectContaining({ kind: 'column-dropped', severity: 'blocking' }))
    expect((await app.inject({ method: 'POST', url: '/v1/forms/nope/drift', headers: as('admin') })).statusCode).toBe(404)
  })

  // Each malformed request is refused with 400 before it reaches a database:
  // a lookup list of the wrong shape, a body that is not an object, a form id
  // with upper case (which would alias on a case-insensitive volume, 0013).
  // A well-formed lookup over a key that does not exist is generateForm's 422.
  test('refuses malformed requests before they reach a database', async () => {
    for (const lookups of ['fk', [{ foreignKey: 1, display: [] }], [{ foreignKey: 'fk', display: [1] }], [null]]) {
      expect((await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, lookups } })).statusCode).toBe(400)
    }
    const unknownKey = await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: { ...PROPOSAL, lookups: [{ foreignKey: 'fk_nope', display: ['name'] }] } })
    expect(unknownKey.statusCode).toBe(422)
    expect(unknownKey.json().message).toMatch(/no foreign key fk_nope/)
    expect((await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: { ...as('admin'), 'content-type': 'application/json' }, payload: '[1]' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/forms/Employee/versions', headers: as('admin'), payload: { expectedBase: null } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/v1/forms/Employee/versions/latest', headers: as('admin') })).statusCode).toBe(404)
  })

  // A connection that opens and then fails to answer is as unreachable as one
  // that never opened, and says as little about why.
  test('a database that opens and then fails is 503, with no detail', async () => {
    const failing: ConnectionRegistry = {
      ...registry(),
      open: async () => ({
        adapter: { kind: 'sqlserver', ping: async () => { throw new Error('login failed for sa on 10.0.0.5') }, discover: async () => { throw new Error('timeout on 10.0.0.5') }, close: async () => {} } as DatabaseAdapter,
        lookups: {} as LookupAdapter,
        records: {} as RecordAdapter,
      }),
    }
    await publish()
    const broken = await createDataServer({ verifyIdentity, admin: { registry: failing, store, adminRoles: ['data-admin'] } })
    for (const [method, url] of [['POST', '/v1/connections/erp/test'], ['GET', '/v1/connections/erp/metadata'], ['POST', '/v1/forms/employee/drift']] as const) {
      const response = await broken.inject({ method, url, headers: as('admin') })
      expect(response.statusCode, url).toBe(503)
      expect(response.body).not.toContain('10.0.0.5')
    }
  })

  // Without a store and registry, the plane does not exist: 404, not a stub.
  test('a server without the administrator plane does not answer for it', async () => {
    const bare = await createDataServer({ verifyIdentity })
    expect((await bare.inject({ method: 'GET', url: '/v1/connections', headers: as('admin') })).statusCode).toBe(404)
  })
})
