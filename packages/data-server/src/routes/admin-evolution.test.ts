import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, EMPTY_PRESENTATION, presentationOf } from '@formancy/data-core'
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
 * the database as it is now, a restore that republishes an older version
 * when drift blocks nothing, and since 0039 the publish of a regeneration
 * whose keys now name other columns. The database is a fake adapter whose
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
  // The plane's trail is admin-audit.test.ts's subject; here it is required and discarded.
  app = await createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'], audit: { sink: () => {} } } })
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

/**
 * Two columns that sanitise to one key (0030): job_title, and "job title" as
 * job_title_2 until the first is dropped.
 */
const JOB = [col('job_title', 5, TEXT, { nullable: true }), col('job title', 6, TEXT, { nullable: true })]
const column = (name: string) => ({ kind: 'column', column: name })
/** After `renumber()`: both keys stand for other columns than in the version published with JOB. */
const REASSIGNED = [
  { field: 'job_title', was: column('job_title'), now: column('job title') },
  { field: 'job_title_2', was: column('job title'), now: column('job-title') },
]

/** The owner drops job_title and adds "job-title": job_title now stands for "job title", job_title_2 for "job-title". */
function renumber(): void {
  columns = [...columns.filter((entry) => entry.name !== 'job_title'), col('job-title', 7, TEXT, { nullable: true })]
}

/** The newest version regenerated, as the server answers it. */
async function regenerated(): Promise<Record<string, unknown> & { version: number; keysReassigned: unknown[]; policy: { fields: Record<string, unknown> } }> {
  const response = await regenerate()
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

/** A regeneration published as it came, `policy` in place of the published one, `extra` beside the bundle in the body. */
function publishRegenerated(regeneration: Record<string, unknown>, extra: Record<string, unknown> = {}, policy?: unknown, expectedBase = regeneration['version']) {
  const { version: _version, drift: _drift, policyProblems: _problems, conflicts: _conflicts, lookupsDropped: _dropped, keysReassigned: _keys, notes: _notes, ...parts } = regeneration
  const bundle = { format: 2, connection: 'erp', ...parts, ...(policy === undefined ? {} : { policy }) }
  return app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase, bundle, ...extra } })
}

describe('publishing over keys that now name other columns (0039)', () => {
  // The defect 0039 closes, at the route: a client other than the studio
  // published the regeneration as it came, and the clerk's grants written
  // for job_title applied to "job title". Refused, naming each key, with
  // nothing written, until every key the policy grants on is confirmed --
  // one confirmed is not both.
  test('a reassigned key the policy grants on is refused until it is confirmed, and nothing is written', async () => {
    columns.push(...JOB)
    await publish()
    renumber()
    const regeneration = await regenerated()
    expect(regeneration.keysReassigned).toEqual(REASSIGNED)

    const undecided = await publishRegenerated(regeneration)
    expect(undecided.statusCode).toBe(422)
    expect(undecided.json()).toEqual({
      code: 'keys-reassigned',
      message: 'Version 1 bound job_title, job_title_2 to other columns or lookups: confirm the grants on each for what it stands for now, or remove them.',
      keys: REASSIGNED,
      problems: [
        'Grants for job_title were written for column job_title; it now stands for column job title.',
        'Grants for job_title_2 were written for column job title; it now stands for column job-title.',
      ],
    })
    const one = await publishRegenerated(regeneration, { keysConfirmed: [REASSIGNED[0]] })
    expect(one.statusCode).toBe(422)
    expect(one.json().keys).toEqual([REASSIGNED[1]])
    expect(await store.versions('employee')).toEqual([1])

    const confirmed = await publishRegenerated(regeneration, { keysConfirmed: REASSIGNED })
    expect(confirmed.statusCode, confirmed.body).toBe(201)
    expect(confirmed.json()).toEqual({ version: 2 })
  })

  // A confirmation is of one reassignment: the key, the column it stood for
  // and the one it stands for now. A studio draft generated again after its
  // keys were decided can give a key yet another column, and a confirmation
  // matched by key alone would carry the decision to a column nobody saw.
  // One for a key that was not reassigned grants nothing, and is ignored.
  test('a confirmation of another column than the key stands for now is not one; one for a key not reassigned is ignored', async () => {
    columns.push(...JOB)
    await publish()
    renumber()
    const regeneration = await regenerated()
    const elsewhere = [REASSIGNED[0], { ...REASSIGNED[1], now: column('job title') }]
    const wrongWas = [REASSIGNED[0], { ...REASSIGNED[1], was: column('job_title') }]
    for (const keysConfirmed of [elsewhere, wrongWas]) {
      const refused = await publishRegenerated(regeneration, { keysConfirmed })
      expect(refused.statusCode).toBe(422)
      expect(refused.json().keys).toEqual([REASSIGNED[1]])
    }
    const extra = await publishRegenerated(regeneration, { keysConfirmed: [...REASSIGNED, { field: 'name', was: column('name'), now: column('title') }] })
    expect(extra.statusCode, extra.body).toBe(201)
  })

  // The other half of the studio's decision: removed, a key's grants are
  // gone from the policy -- no role on its field, no lookup filter -- and
  // there is nothing left to confirm. A field kept with empty roles grants
  // nothing either.
  test('a reassigned key with no role and no lookup filter needs no confirmation', async () => {
    columns.push(...JOB)
    await publish()
    renumber()
    const regeneration = await regenerated()
    const { job_title: _removed, ...fields } = regeneration.policy.fields
    const policy = { ...regeneration.policy, fields: { ...fields, job_title_2: { read: [], write: [] } } }
    const published = await publishRegenerated(regeneration, {}, policy)
    expect(published.statusCode, published.body).toBe(201)
  })

  // Read before anything is checked, so a client that sent a confirmation
  // the server cannot read learns that, rather than a 422 about keys it
  // thinks it confirmed or a 201 it did not mean.
  test('keysConfirmed that is not a list of { field, was, now }, each a column or a lookup, is 400', async () => {
    columns.push(...JOB)
    await publish()
    renumber()
    const regeneration = await regenerated()
    const was = column('job_title')
    for (const keysConfirmed of [null, 'job_title', [{ field: 'job_title' }], [{ field: 'job_title', was, now: { kind: 'table', name: 'job' } }], [{ field: 7, was, now: was }], [{ field: 'job_title', was, now: { kind: 'lookup', foreignKey: 3 } }]]) {
      const response = await publishRegenerated(regeneration, { keysConfirmed })
      expect(response.statusCode, JSON.stringify(keysConfirmed)).toBe(400)
      expect(response.json()).toMatchObject({ code: 'invalid-request' })
    }
    expect(await store.versions('employee')).toEqual([1])
  })

  // Reassigned against a version somebody has replaced since: the keys are
  // compared with the wrong version, so the answer is the conflict, after
  // which they are compared again with the version rebased onto.
  test('a reassignment against a base somebody has replaced is the conflict, not the keys', async () => {
    columns.push(...JOB)
    await publish()
    renumber()
    const regeneration = await regenerated()
    expect(await store.publish('employee', 1, JSON.parse(await file(1)))).toEqual({ ok: true, version: 2 })
    const stale = await publishRegenerated(regeneration)
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ code: 'conflict', message: expect.any(String), current: 2 })
  })

  // A version edited on the volume is not served (0019), so none of its
  // grants is in effect, and the server cannot say what its keys stood for.
  // Publishing over it is how the studio replaces it (publish.test.tsx);
  // refusing would leave the form unserved until somebody edits files.
  test('a version that cannot be read is not compared: a publish over it is accepted', async () => {
    columns.push(...JOB)
    await publish()
    const damaged = JSON.parse(await file(1)) as { form: { title: string } }
    damaged.form.title = 'Staff'
    await writeFile(join(root, 'employee', '1.json'), JSON.stringify(damaged, null, 2))
    renumber()
    const proposal = await propose()
    const bundle = { format: 2, connection: 'erp', generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot }
    const response = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase: 1, bundle } })
    expect(response.statusCode, response.body).toBe(201)
  })

  // A file that no longer parses is damaged the same way, and no more
  // served: the store throws on it, which before this case made the publish
  // that replaces it a 500 naming the store's path on disk, and closed the
  // repair path the case above keeps open (watched failing: 500).
  test('a version whose file does not parse is not compared either: a publish over it is accepted', async () => {
    columns.push(...JOB)
    await publish()
    const text = await file(1)
    await writeFile(join(root, 'employee', '1.json'), text.slice(0, Math.floor(text.length / 2)))
    renumber()
    const proposal = await propose()
    const bundle = { format: 2, connection: 'erp', generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot }
    const response = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase: 1, bundle } })
    expect(response.statusCode, response.body).toBe(201)
    expect(response.json()).toEqual({ version: 2 })
  })

  // Only a file that does not parse is passed over. A base the store could
  // not read for another reason -- a volume that failed the read -- may be
  // served a moment later with its grants in effect, so the check that
  // cannot answer refuses, and nothing is written (watched failing with
  // every throw passed over: 201).
  test('a base the store fails to read for another reason refuses the publish, and nothing is written', async () => {
    columns.push(...JOB)
    await publish()
    renumber()
    const regeneration = await regenerated()
    const failing: ConfigurationStore = {
      ...store,
      read: async (id, version) => {
        if (version === 1) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' })
        return store.read(id, version)
      },
    }
    const other = await createDataServer({ verifyIdentity, admin: { registry: registry(), store: failing, adminRoles: ['data-admin'], audit: { sink: () => {} } } })
    const { version: _version, drift: _drift, policyProblems: _problems, conflicts: _conflicts, lookupsDropped: _dropped, keysReassigned: _keys, notes: _notes, ...parts } = regeneration
    const response = await other.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase: 1, bundle: { format: 2, connection: 'erp', ...parts } } })
    expect(response.statusCode).toBe(500)
    expect(await store.versions('employee')).toEqual([1])
    await other.close()
  })

  // The route takes any whole number as the base, and names no version
  // below 1: compared, the store refused to read it and the publish was a
  // 500 where it had been the conflict every stale base is (watched failing:
  // 500 "0 is not a version").
  test('a base below 1 over a published form is the conflict, as any base that is not the newest', async () => {
    await publish()
    const proposal = await propose()
    const bundle = { format: 2, connection: 'erp', generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy: policyFor(proposal.bindings), snapshot: proposal.snapshot }
    for (const expectedBase of [0, -1]) {
      const response = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase, bundle } })
      expect(response.statusCode, `${String(expectedBase)}: ${response.body}`).toBe(409)
      expect(response.json()).toEqual({ code: 'conflict', message: expect.any(String), current: 1 })
    }
  })

  // What the check does not see, held so that the limitation it is written
  // down as stays true: it compares with the version replaced and no
  // other. Grants removed in one version and given back in the next are not
  // asked about -- which is also how a key's grants are given again when no
  // client can confirm them -- so one policy file pushed twice, the first
  // time with the reassigned keys taken out, carries version 1's grants to
  // the columns the keys name now.
  test('compared with the version replaced only: grants removed in one version and given back in the next are not asked about', async () => {
    columns.push(...JOB)
    await publish()
    const original = JSON.parse(await file(1)) as { policy: { fields: Record<string, unknown> } }
    renumber()
    const regeneration = await regenerated()
    expect(await publishRegenerated(regeneration, {}, original.policy).then((response) => response.statusCode)).toBe(422)
    const { job_title: _one, job_title_2: _two, ...fields } = original.policy.fields
    const without = await publishRegenerated(regeneration, {}, { ...original.policy, fields })
    expect(without.statusCode, without.body).toBe(201)
    const again = await publishRegenerated(regeneration, {}, original.policy, 2)
    expect(again.statusCode, again.body).toBe(201)
    expect((JSON.parse(await file(3)) as { policy: unknown }).policy).toEqual(original.policy)
  })

  // Anchors are a column's or a lookup's name within the form's root, so a
  // publish that moves the form to another table carries every grant by key
  // to the same-named column there, unasked. Held so that the limitation it
  // is written down as stays true; the studio starts such a draft from an
  // empty policy.
  test('a publish that moves the form to another table is not compared across tables', async () => {
    department = { name: TEXT, foreignKey: false }
    await publish()
    const proposal = await propose({ root: { schema: 'sales', name: 'dept' } })
    expect(proposal.bindings.root).toEqual({ schema: 'sales', name: 'dept' })
    const policy = { ...policyFor(proposal.bindings), operations: { read: ['clerk'], create: proposal.bindings.operations.create ? ['clerk'] : [], update: proposal.bindings.operations.update ? ['clerk'] : [] } }
    const bundle = { format: 2, connection: 'erp', generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy, snapshot: proposal.snapshot }
    const response = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: ADMIN, payload: { expectedBase: 1, bundle } })
    expect(response.statusCode, response.body).toBe(201)
  })

  // A restore republishes a version's policy with the bindings it was
  // published with, so its grants apply to the columns they were written
  // and confirmed for. Here version 1's job_title is the column job_title
  // again, though version 2 bound the key to "job title": checked like a
  // publish, the restore could not be confirmed and would be refused.
  test('a restore is not asked about keys: the policy comes back with the bindings it was written for', async () => {
    columns.push(...JOB)
    await publish()
    const original = columns
    columns = columns.filter((entry) => entry.name !== 'job_title')
    const regeneration = await regenerated()
    expect(regeneration.keysReassigned).toEqual([REASSIGNED[0]])
    const { job_title_2: _gone, ...fields } = regeneration.policy.fields
    const v2 = await publishRegenerated(regeneration, { keysConfirmed: [REASSIGNED[0]] }, { ...regeneration.policy, fields })
    expect(v2.statusCode, v2.body).toBe(201)

    columns = original
    const restored = await restore({ version: 1, expectedBase: 2 })
    expect(restored.statusCode, restored.body).toBe(201)
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

  // A version edited on the volume to spec 4, its base and form alike, so
  // every comparison a read makes still agrees: @formancy/spec 0.4.0's
  // validator accepts it, and at 0.3.0 it was refused as corrupt. Read and
  // restore both go through loadVersion, which holds it to the version the
  // generator writes (0042), so neither serves nor republishes it to a host
  // page whose renderer would refuse it. Watched failing before that check:
  // the read answered 200 and the restore 201.
  test('a version edited on disk to another spec version is refused on read and on restore', async () => {
    await publish()
    await publish(1)
    const edited = JSON.parse(await file(1)) as { base: { specVersion: string }; form: { specVersion: string } }
    edited.base.specVersion = '4'
    edited.form.specVersion = '4'
    await writeFile(join(root, 'employee', '1.json'), JSON.stringify(edited, null, 2))
    const read = await app.inject({ method: 'GET', url: '/v1/forms/employee/versions/1', headers: ADMIN })
    expect(read.statusCode).toBe(500)
    expect(read.json()).toMatchObject({ code: 'corrupt-bundle' })
    const restored = await restore({ version: 1, expectedBase: 2 })
    expect(restored.statusCode).toBe(500)
    expect(restored.json()).toMatchObject({ code: 'corrupt-bundle' })
    expect(await store.latest('employee')).toBe(2)
  })

  // The routes are on the administrator plane, behind its role check.
  test('every evolution route needs an administrator', async () => {
    for (const [method, url] of [['GET', '/v1/forms/employee/versions'], ['GET', '/v1/forms/employee/versions/1'], ['POST', '/v1/forms/employee/regenerations'], ['POST', '/v1/forms/employee/restorations']] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(401)
    }
  })
})
