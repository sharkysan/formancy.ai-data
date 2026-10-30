import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, serverStanding } from '@formancy/data-core'
import type { DatabaseKind, DriftChange, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot, ServerFacts } from '@formancy/data-core'
import { SQLSERVER_IMAGE, startPostgresContainer, startSqlServerContainer } from '@formancy/data-fixtures'
import type { IdentityVerifier } from '@formancy/data-identity'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'

/*
 * A server this release was not tested on, through the administrator
 * plane's real routes, on both engines (0068): what the connection test
 * says, what discovery records, and that nothing refuses it -- a form is
 * proposed, published, reviewed for drift and imported, and the review and
 * the import each say the server is untested, for review.
 *
 * PostgreSQL 14 is no image of the matrix (0067): this file alone starts
 * it, to show what this file shows -- that a server of it is said to be
 * untested, is discovered and is served -- and not to test this release on
 * it. SQL Server is the default image, named here as every start of this
 * suite names it, which this release was tested on, with a
 * database at compatibility level 140, as one restored from 2017 keeps:
 * below the lowest a matrix leg's fixture database answered, so the
 * database, not the server, is what this release was not tested at. The
 * tables are the file's own, created by each container's owner; the
 * driver, the adapters and the databases are the real ones (0003).
 *
 * Watched failing on both engines: without the connection test's standing,
 * the first case; without drift's server-untested, the third, at the drift
 * report, after the publish was answered 201 as it is now. The second
 * passed then too: discovery has recorded the server since the adapters
 * read it.
 */

const POSTGRES_14 = 'postgres:14-alpine'
/** One table in a schema of its own, on each engine: all a form needs, and nothing the fixture's model would add. */
const ENTRY = {
  postgres: ['create schema ledger', 'create table ledger.entry (id integer not null constraint pk_entry primary key, memo varchar(200) not null)'],
  sqlserver: ['create schema ledger', 'create table ledger.entry (id int not null constraint pk_entry primary key, memo nvarchar(200) not null)'],
} as const

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } } : { ok: false, reason: 'bad' }
const ADMIN = { authorization: 'Bearer admin' }

let pg: Awaited<ReturnType<typeof startPostgresContainer>>['container']
let ms: Awaited<ReturnType<typeof startSqlServerContainer>>['container']
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance

/** Each connection, the engine it is, and the sentence its standing must name. */
const CONNECTIONS: ReadonlyArray<{ connection: string; kind: DatabaseKind; names: RegExp }> = [
  { connection: 'pg-14', kind: 'postgres', names: /not tested on PostgreSQL 14:/ },
  { connection: 'ms-140', kind: 'sqlserver', names: /compatibility level, 140, is below the lowest it was tested at/ },
]

beforeAll(async () => {
  const [postgres, sqlserver] = await Promise.all([startPostgresContainer(POSTGRES_14), startSqlServerContainer(SQLSERVER_IMAGE)])
  pg = postgres.container
  ms = sqlserver.container

  const owner = connectPostgres({
    host: pg.getHost(),
    port: pg.getPort(),
    database: pg.getDatabase(),
    user: pg.getUsername(),
    password: pg.getPassword(),
    tls: { enabled: false, rejectUnauthorized: false },
  })
  try {
    for (const statement of ENTRY.postgres) await owner.unsafe(statement)
  } finally {
    await owner.end({ timeout: 5 })
  }
  const sa = { host: ms.getHost(), port: ms.getPort(), user: ms.getUsername(), password: ms.getPassword(), encrypt: false, trustServerCertificate: true }
  const master = await connectSqlServer({ ...sa, database: 'master' })
  try {
    await master.request().batch('create database compat_140')
    await master.request().batch('alter database compat_140 set compatibility_level = 140')
  } finally {
    await master.close()
  }
  const old = await connectSqlServer({ ...sa, database: 'compat_140' })
  try {
    for (const statement of ENTRY.sqlserver) await old.request().batch(statement)
  } finally {
    await old.close()
  }

  const connections: ConnectionConfig[] = [
    {
      id: 'pg-14',
      kind: 'postgres',
      host: pg.getHost(),
      port: pg.getPort(),
      database: pg.getDatabase(),
      user: pg.getUsername(),
      password: 'env:PG_PASSWORD',
      schemas: ['ledger'],
      tls: { enabled: false },
    },
    {
      id: 'ms-140',
      kind: 'sqlserver',
      host: ms.getHost(),
      port: ms.getPort(),
      database: 'compat_140',
      user: ms.getUsername(),
      password: 'env:MS_PASSWORD',
      schemas: ['ledger'],
      tls: { enabled: false, trustServerCertificate: true },
    },
  ]
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: pg.getPassword(), MS_PASSWORD: ms.getPassword() },
    readFile: async () => '',
  })
  root = await mkdtemp(join(tmpdir(), 'formancy-data-admin-untested-'))
  app = await createDataServer({
    verifyIdentity,
    admin: { registry, store: createFileConfigurationStore(root), adminRoles: ['data-admin'], audit: { sink: () => {} } },
  })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

const inject = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
  const answer = await app.inject({ method, url, headers: ADMIN, ...(payload === undefined ? {} : { payload }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test reads an untyped body on purpose, and asserts on the part it names
  return { status: answer.statusCode, json: answer.json<Record<string, any>>(), body: answer.body }
}

/** The facts a standing is decided from, out of a ping's answer or a snapshot's `server`. */
const factsOf = ({ product, major, compatibility }: ServerFacts): ServerFacts =>
  compatibility === undefined ? { product, major } : { product, major, compatibility }

/** Whoever may read every field, and nobody may write: a policy every generated form of this table fits. */
function readOnly(bindings: FormBindings): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: [], update: [] },
    fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: [] }])),
    rowFilters: [],
    lookups: {},
  }
}

/** The server-untested changes of a report: what each review must say once, for review. */
const untested = (changes: readonly DriftChange[]) => changes.filter((change) => change.kind === 'server-untested')

describe.each(CONNECTIONS)('a server this release was not tested on, $connection', ({ connection, kind, names }) => {
  const formId = `${connection}-entry`

  // The answer an administrator reads before anything is generated. Without
  // a standing, an estate this release never ran on reads exactly as the
  // matrix does; refused, it could not be connected at all.
  test('the connection test answers it, and says this release was not tested on it', async () => {
    const tested = await inject('POST', `/v1/connections/${connection}/test`)
    expect(tested.status, tested.body).toBe(200)
    expect(tested.json['kind']).toBe(kind)
    expect(tested.json['standing']).toEqual({ tested: false, says: serverStanding(kind, factsOf(tested.json as ServerFacts)).says })
    expect(tested.json['standing'].says).toMatch(names)
  })

  // Discovery and the ping read the server with one query in each adapter;
  // a snapshot that recorded another server than the test answered would
  // be reviewed against facts nobody was shown.
  test('discovery reads it and records the server the connection test answered', async () => {
    const [tested, discovered] = await Promise.all([
      inject('POST', `/v1/connections/${connection}/test`),
      inject('GET', `/v1/connections/${connection}/metadata`),
    ])
    expect(discovered.status, discovered.body).toBe(200)
    const snapshot = discovered.json as MetadataSnapshot
    expect(snapshot.server).toEqual(factsOf(tested.json as ServerFacts))
    expect(snapshot.objects.map((object) => `${object.ref.schema}.${object.ref.name}`)).toEqual(['ledger.entry'])
  })

  // Nothing refuses a server for being untested (0068): published, reviewed
  // and imported, each answered as on a tested server, and each review says
  // the server once, for review -- drift against the very snapshot it was
  // published from too, because the server is outside the fingerprint and
  // an equal fingerprint is no reason to say less.
  test('a form over it is published, reviewed and imported, and each review says the server is untested, for review', async () => {
    const proposed = await inject('POST', '/v1/form-proposals', { connection, root: { schema: 'ledger', name: 'entry' }, formId, title: 'Entry' })
    expect(proposed.status, proposed.body).toBe(200)
    const proposal = proposed.json as { form: FormSchema; bindings: FormBindings; snapshot: MetadataSnapshot; generation: GenerationRequest }
    const bundle = {
      format: 2,
      connection,
      generation: proposal.generation,
      base: proposal.form,
      presentation: EMPTY_PRESENTATION,
      form: proposal.form,
      bindings: proposal.bindings,
      policy: readOnly(proposal.bindings),
      snapshot: proposal.snapshot,
    }
    const published = await inject('POST', `/v1/forms/${formId}/versions`, { expectedBase: null, bundle })
    expect(published.status, published.body).toBe(201)

    const drift = await inject('POST', `/v1/forms/${formId}/drift`)
    expect(drift.status, drift.body).toBe(200)
    expect(drift.json['blocking']).toBe(false)
    expect(drift.json['changes']).toEqual([
      { kind: 'server-untested', severity: 'review', subject: { kind: 'scope' }, affects: [], message: expect.stringMatching(names) as unknown },
    ])

    // The export, and the import of that file over it: the gate a restore passes, answered and written.
    const exported = await inject('GET', `/v1/forms/${formId}/versions/1`)
    expect(exported.status, exported.body).toBe(200)
    const imported = await inject('POST', `/v1/forms/${formId}/imports`, { expectedBase: 1, bundle: exported.json['bundle'] })
    expect(imported.status, imported.body).toBe(201)
    expect(imported.json['version']).toBe(2)
    expect(untested(imported.json['drift'].changes)).toEqual(untested(drift.json['changes']))
    expect(untested(imported.json['drift'].changes)).toHaveLength(1)
  })
})
