import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, presentationOf } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, FormBindings, LookupAdapter, MetadataSnapshot, NormalizedType, ObjectMeta, PresentationOverrides, RecordAdapter } from '@formancy/data-core'
import type { FormSchema, LayoutNode } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { ConfigurationStore } from '../config-store.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * The administrator plane's evolution routes (0030): the versions list and
 * one version, a regeneration that carries the published presentation to
 * the database as it is now, and a restore that republishes an older
 * version when drift blocks nothing. The database is a fake adapter whose
 * discovery the test changes; what it proves is the routes' own logic, and
 * the e2e suite proves the same journey on both real engines.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind === 'binary' ? 'varbinary(200)' : type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})

/** The employee table as it is "now"; each test changes it to make drift. */
let columns: ColumnMeta[]
/** The department lookup's target and foreign key, when a test turns them on. */
let department: { name: NormalizedType; foreignKey: boolean } | null
let reachable: boolean
/** The engine discovery reports; a test changes it to point the connection at another one. */
let engine: 'sqlserver' | 'postgres'

function snapshot(): MetadataSnapshot {
  const dept: ObjectMeta[] = department === null ? [] : [{
    ref: { schema: 'sales', name: 'dept' }, kind: 'table', comment: null,
    columns: [col('id', 1, INT32), col('name', 2, department.name)],
    primaryKey: { name: 'pk_dept', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
  }]
  return createSnapshot({
    kind: engine, serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
    objects: [{
      ref: { schema: 'sales', name: 'employee' }, kind: 'table', comment: null,
      columns: department === null ? columns : [...columns, col('dept_id', 9, INT32, { nullable: true })],
      primaryKey: { name: 'pk_employee', columns: ['id'] }, uniqueKeys: [],
      foreignKeys: department?.foreignKey === true ? [{
        name: 'fk_employee_dept', columns: ['dept_id'], references: { table: { schema: 'sales', name: 'dept' }, columns: ['id'] },
        onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true,
      }] : [],
      checks: [], rowSecurity: 'none',
    }, ...dept],
  })
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } } : { ok: false, reason: 'bad' }

let root: string
let store: ConfigurationStore
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0' }), discover: async () => snapshot(), close: async () => {} } as DatabaseAdapter
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

beforeEach(async () => {
  columns = [col('id', 1, INT32), col('name', 2, TEXT), col('title', 3, TEXT, { nullable: true }), col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' })]
  department = null
  reachable = true
  engine = 'sqlserver'
  root = await mkdtemp(join(tmpdir(), 'formancy-data-evolution-'))
  store = createFileConfigurationStore(root)
  app = await createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'] } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ADMIN = { authorization: 'Bearer admin' }
const PROPOSAL = { connection: 'erp', root: { schema: 'sales', name: 'employee' }, formId: 'employee', title: 'Employee' }

interface Proposal { form: FormSchema; bindings: FormBindings; snapshot: MetadataSnapshot; generation: Record<string, unknown> }

const policyFor = (bindings: FormBindings) => ({
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
  rowFilters: [],
  lookups: Object.fromEntries(bindings.fields.filter((binding) => binding.kind === 'lookup').map((binding) => [binding.field, []])),
})

const grid = (form: FormSchema) => ((form.layouts?.[0]?.nodes[0] as { children: LayoutNode[] }).children[0] as { children: Array<{ path: string }> }).children
const keys = (form: FormSchema) => grid(form).map((node) => node.path)

async function propose(extra: Record<string, unknown> = {}): Promise<Proposal> {
  const response = await app.inject({ method: 'POST', url: '/v1/form-proposals', headers: ADMIN, payload: { ...PROPOSAL, ...extra } })
  expect(response.statusCode, response.body).toBe(200)
  return response.json() as Proposal
}

/** Propose, label `name` "Full name" and put it first, derive, publish: as the studio does. */
async function publish(expectedBase: number | null = null, extra: Record<string, unknown> = {}, label = 'Full name') {
  const proposal = await propose(extra)
  const edited = JSON.parse(JSON.stringify(proposal.form)) as FormSchema
  const name = edited.model.fields.find((field) => field.key === 'name')
  if (name !== undefined) name.label = label
  const nodes = grid(edited)
  nodes.unshift(...nodes.splice(nodes.findIndex((node) => node.path === 'name'), 1))
  const derived = presentationOf(proposal.form, edited, proposal.bindings)
  if (!derived.ok) throw new Error(derived.problems.join('; '))
  const bundle = { format: 2, connection: 'erp', generation: proposal.generation, base: proposal.form, presentation: derived.presentation, form: edited, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot }
  const response = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase, bundle } })
  expect(response.statusCode, response.body).toBe(201)
  return { bundle, presentation: derived.presentation as PresentationOverrides }
}

const regenerate = () => app.inject({ method: 'POST', url: '/v1/forms/employee/regenerations', headers: ADMIN })
const restore = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/forms/employee/restorations', headers: ADMIN, payload: payload as Record<string, unknown> })
const file = (version: number) => readFile(join(root, 'employee', `${String(version)}.json`), 'utf8')

describe('regeneration', () => {
  // Nothing changed, so nothing is reported and the person's choices come
  // back exactly. And a regeneration writes nothing: it is a draft to
  // review, published only through the ordinary compare-and-swap.
  test('an unchanged database carries the presentation with no conflict, and writes nothing', async () => {
    const { presentation } = await publish()
    const response = await regenerate()
    expect(response.statusCode, response.body).toBe(200)
    const regeneration = response.json()
    expect(regeneration).toMatchObject({ version: 1, conflicts: [], lookupsDropped: [], keysReassigned: [], policyProblems: [], drift: { changes: [], blocking: false } })
    expect(canonicalize(regeneration.presentation)).toBe(canonicalize(presentation))
    expect(regeneration.generation).toEqual({ ...PROPOSAL, lookups: [], pinned: [] })
    expect(keys(regeneration.form)).toEqual(['name', 'id', 'title'])
    expect(await store.latest('employee')).toBe(1)
  })

  // A compatible change: the new column is placed after its generated
  // predecessor and the person's label and order are kept.
  test('a column added is placed, and the overrides are kept', async () => {
    await publish()
    columns.push(col('email', 5, TEXT, { nullable: true }))
    const regeneration = (await regenerate()).json()
    expect(regeneration.drift.changes).toEqual([expect.objectContaining({ kind: 'column-added', severity: 'review' })])
    expect(keys(regeneration.base)).toEqual(['id', 'name', 'title', 'email'])
    expect(keys(regeneration.form)).toEqual(['name', 'id', 'title', 'email'])
    expect(regeneration.form.model.fields.find((field: { key: string }) => field.key === 'name').label).toBe('Full name')
    expect(regeneration.conflicts).toEqual([])
  })

  // The label chosen for a dropped column is reported dropped, and the
  // published policy's grant for it is reported against the new bindings,
  // so the administrator removes it before publishing.
  test('a column dropped is field-gone, and the policy that names it is reported', async () => {
    await publish()
    columns = columns.filter((entry) => entry.name !== 'name')
    const regeneration = (await regenerate()).json()
    expect(regeneration.drift.blocking).toBe(true)
    expect(regeneration.conflicts).toEqual([expect.objectContaining({ kind: 'field-gone', field: 'name', property: 'label', yours: 'Full name' })])
    expect(regeneration.policyProblems).toEqual(['policy: fields.name: the form has no field name'])
    expect(regeneration.policy).toEqual(policyFor((JSON.parse(await file(1)) as { bindings: FormBindings }).bindings))
  })

  // A lookup the runtime would now refuse — its foreign key gone, or its
  // display column one no label can be read from (0028) — is left out, and
  // the rest of the form generated without it. Kept, the form would
  // publish and every search would fail.
  test('a lookup whose foreign key is gone, or whose display column became binary, is dropped and the rest generated', async () => {
    department = { name: TEXT, foreignKey: true }
    await publish(null, { lookups: [{ foreignKey: 'fk_employee_dept', display: ['name'] }] })
    department = { name: TEXT, foreignKey: false }
    const gone = (await regenerate()).json()
    expect(gone.lookupsDropped).toEqual([{ foreignKey: 'fk_employee_dept', message: 'employee has no foreign key fk_employee_dept' }])
    expect(gone.generation.lookups).toEqual([])
    expect(keys(gone.base)).toEqual(['id', 'name', 'title', 'dept_id'])

    department = { name: { kind: 'binary', maxLength: 200, fixedLength: false }, foreignKey: true }
    const binary = (await regenerate()).json()
    expect(binary.lookupsDropped).toEqual([{ foreignKey: 'fk_employee_dept', message: expect.stringMatching(/display column name is varbinary\(200\), which has no text form for a label/) }])
    expect(binary.policyProblems).toContainEqual('policy: lookups.dept: dept is not a lookup field of this form')
  })

  // A pinned column gone is not a lookup the runtime refuses: the form
  // cannot be generated at all, and the drift says why.
  test('a pinned column gone is 422 cannot-generate, with the drift', async () => {
    await publish(null, { pinned: ['title'] })
    columns = columns.filter((entry) => entry.name !== 'title')
    const response = await regenerate()
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ code: 'cannot-generate', message: 'employee has no column title to pin', drift: { blocking: true } })
  })

  // A regeneration generates from the stored request, and its draft is
  // checked at publish against that same request, so a request retitled or
  // re-rooted on the volume would reach the next version with nobody told.
  // The version is not served, and nothing is regenerated from it.
  test('a request edited by hand on disk is 500 corrupt-bundle, and nothing is regenerated from it', async () => {
    await publish()
    for (const edit of [{ title: 'Payroll' }, { root: { schema: 'sales', name: 'dept' } }]) {
      const stored = JSON.parse(await file(1)) as { generation: Record<string, unknown> }
      await writeFile(join(root, 'employee', '1.json'), JSON.stringify({ ...stored, generation: { ...stored.generation, ...edit } }, null, 2))
      const response = await regenerate()
      expect(response.statusCode).toBe(500)
      expect(response.json()).toMatchObject({ code: 'corrupt-bundle' })
      await writeFile(join(root, 'employee', '1.json'), JSON.stringify(stored, null, 2))
    }
    expect(await store.versions('employee')).toEqual([1])
  })

  // A version published before 0030 kept no request and no base, so there
  // is nothing to regenerate from and nothing to rebase onto.
  test('latest published in format 1 is 409 published-before-0030', async () => {
    const proposal = await propose()
    await store.publish('employee', null, { format: 1, connection: 'erp', form: proposal.form, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot })
    const response = await regenerate()
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ code: 'published-before-0030', message: 'Version 1 was published before 0030 and kept no generation request: propose the form again.' })
  })

  // An operator who points the connection at a database of another engine
  // has made every published binding meaningless; drift refuses to compare
  // across engines, and the route says so as an internal failure with the
  // reason in the log, rather than regenerating against the wrong database.
  test('a connection now pointing at another engine is 500, for regeneration and restore alike', async () => {
    await publish()
    engine = 'postgres'
    const regenerated = await regenerate()
    expect(regenerated.statusCode).toBe(500)
    expect(regenerated.json()).toMatchObject({ code: 'internal' })
    expect((await restore({ version: 1, expectedBase: 1 })).json()).toMatchObject({ code: 'internal' })
    expect(await store.latest('employee')).toBe(1)
  })

  // An unknown form, and a database that cannot be reached, say as little
  // as drift does.
  test('an unknown form is 404 and an unreachable database 503, with no detail', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/forms/nope/regenerations', headers: ADMIN })).statusCode).toBe(404)
    await publish()
    reachable = false
    const down = await regenerate()
    expect(down.statusCode).toBe(503)
    expect(down.body).not.toContain('10.0.0.5')
  })
})

describe('restoration', () => {
  // A restore is a new version holding exactly the document the old one
  // held, so what is served is what was reviewed then, never a
  // re-generation. The store writes it as it writes every version: for a
  // version it wrote itself, that is the same bytes.
  test('a compatible version is restored as the same document, in the same bytes when this store wrote it', async () => {
    await publish()
    await publish(1, {}, 'Name in full')
    columns.push(col('email', 5, TEXT, { nullable: true }))
    const response = await restore({ version: 1, expectedBase: 2 })
    expect(response.statusCode, response.body).toBe(201)
    expect(response.json()).toMatchObject({ version: 3, restoredFrom: 1, drift: { blocking: false } })
    expect(await file(3)).toBe(await file(1))
  })

  // What a restore promises is the document, not the file: one reformatted
  // on the volume still validates and is restored in the store's own
  // spelling. A claim of the old file's bytes would be true only for files
  // this store wrote, and this case is the one where it is not.
  test('a version reformatted on the volume is restored as the same document, in the store\'s spelling', async () => {
    await publish()
    await publish(1, {}, 'Name in full')
    const document = JSON.parse(await file(1)) as unknown
    await writeFile(join(root, 'employee', '1.json'), JSON.stringify(document))
    const response = await restore({ version: 1, expectedBase: 2 })
    expect(response.statusCode, response.body).toBe(201)
    expect(canonicalize(JSON.parse(await file(3)))).toBe(canonicalize(document))
    expect(await file(3)).toBe(`${JSON.stringify(document, null, 2)}\n`)
    expect(await file(3)).not.toBe(await file(1))
  })

  // Restoring a version the database can no longer serve would publish a
  // form whose writes fail; refused, with the changes that block it, and
  // nothing written.
  test('a version drift blocks is 409 incompatible with only the blocking changes, and nothing is written', async () => {
    await publish()
    await publish(1, {}, 'Name in full')
    columns = columns.filter((entry) => entry.name !== 'title')
    columns.push(col('email', 5, TEXT, { nullable: true }))
    const response = await restore({ version: 1, expectedBase: 2 })
    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.code).toBe('incompatible')
    expect(body.changes.map((change: { kind: string; severity: string }) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])
    expect(await store.latest('employee')).toBe(2)
  })

  // Restore is compare-and-swap like publish: from a stale base it is a
  // conflict naming the current version.
  test('a stale base is 409 conflict; an unknown version 404; a version that is not a number 400', async () => {
    await publish()
    await publish(1)
    expect((await restore({ version: 1, expectedBase: 1 })).json()).toEqual({ code: 'conflict', message: expect.any(String), current: 2 })
    expect((await restore({ version: 7, expectedBase: 2 })).json()).toMatchObject({ code: 'unknown-version' })
    expect((await app.inject({ method: 'POST', url: '/v1/forms/nope/restorations', headers: ADMIN, payload: { version: 1, expectedBase: 1 } })).json()).toMatchObject({ code: 'unknown-form' })
    reachable = false
    const down = await restore({ version: 1, expectedBase: 2 })
    expect(down.statusCode).toBe(503)
    expect(down.body).not.toContain('10.0.0.5')
    reachable = true
    for (const payload of [{ version: '1', expectedBase: 2 }, { version: 0, expectedBase: 2 }, { version: 1 }, { version: 1.5, expectedBase: 2 }]) {
      expect((await restore(payload)).statusCode).toBe(400)
    }
  })

  // A format-1 version is configuration that was being served; it can be
  // restored, though not regenerated.
  test('a format-1 version may be restored', async () => {
    const proposal = await propose()
    await store.publish('employee', null, { format: 1, connection: 'erp', form: proposal.form, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot })
    await publish(1)
    expect((await restore({ version: 1, expectedBase: 2 })).statusCode).toBe(201)
    expect(await file(3)).toBe(await file(1))
  })
})

describe('versions', () => {
  // The list a restore is chosen from, and each version read as the latest
  // is: validated, and refused when edited by hand.
  test('lists and reads versions, and refuses one edited on disk', async () => {
    await publish()
    await publish(1)
    expect((await app.inject({ method: 'GET', url: '/v1/forms/employee/versions', headers: ADMIN })).json()).toEqual({ versions: [1, 2] })
    expect((await app.inject({ method: 'GET', url: '/v1/forms/nope/versions', headers: ADMIN })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/v1/forms/Employee/versions', headers: ADMIN })).statusCode).toBe(404)
    const first = (await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/1', headers: ADMIN })).json()
    expect(first.version).toBe(1)
    expect(first.bundle).toEqual(JSON.parse(await file(1)))
    expect((await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/latest', headers: ADMIN })).json().version).toBe(2)
    expect((await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/9', headers: ADMIN })).json()).toMatchObject({ code: 'unknown-version' })
    for (const version of ['abc', '0', '01', '1.5', '99999999999999999']) {
      expect((await app.inject({ method: 'GET', url: `/v1/forms/employee/versions/${version}`, headers: ADMIN })).statusCode, version).toBe(400)
    }

    const edited = JSON.parse(await file(1)) as { form: { title: string } }
    edited.form.title = 'Staff'
    await writeFile(join(root, 'employee', '1.json'), JSON.stringify(edited, null, 2))
    const corrupt = await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/1', headers: ADMIN })
    expect(corrupt.statusCode).toBe(500)
    expect(corrupt.json()).toMatchObject({ code: 'corrupt-bundle' })
    expect((await restore({ version: 1, expectedBase: 2 })).statusCode).toBe(500)
  })

  // The routes are on the administrator plane, behind its role check.
  test('every evolution route needs an administrator', async () => {
    for (const [method, url] of [['GET', '/v1/forms/employee/versions'], ['GET', '/v1/forms/employee/versions/1'], ['POST', '/v1/forms/employee/regenerations'], ['POST', '/v1/forms/employee/restorations']] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(401)
    }
  })
})
