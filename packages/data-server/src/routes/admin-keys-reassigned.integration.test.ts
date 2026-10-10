import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'
import { createIdentityVerifier } from '../identity.js'

/*
 * A publish whose keys now name other columns is refused unless it says what
 * happens to their grants (0039), on both engines, against the shared
 * fixture's real servers, through a plain HTTP client -- fetch over a real
 * socket, not the studio, which held this alone before.
 *
 * The failure it prevents: a grant written for one column writing another
 * that the version before made read-only to that role. A table has two
 * columns that sanitise to one key (customer_note, "customer note": keys
 * customer_note and customer_note_2), published with a policy that lets a
 * clerk write customer_note and only read customer_note_2. The owner drops
 * customer_note and adds "customer-note", so both keys renumber onto other
 * columns. Published as regenerated, with the policy unchanged and nobody
 * deciding, the clerk's grant for customer_note wrote the column "customer
 * note": observed on 2026-10-10 against postgres:17-alpine and
 * mssql/server:2022-latest. Against the publish route before 0039, the first
 * assertion here to fail is the publish of the undecided regeneration (201,
 * version 2; those on the regeneration itself pass): what this test fails on
 * is the server accepting the grant unconfirmed, not the write that
 * acceptance allowed.
 *
 * The decision the studio makes then publishes: customer_note's grants
 * removed, customer_note_2's confirmed for what it stands for now, and the
 * clerk's write through customer_note is refused while the column keeps the
 * manager's note.
 */

const SECRET = 'a-reassigned-keys-host-secret-of-32-bytes!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

async function token(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('30m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

type Engine = 'pg' | 'ms'

/** `observeV1` reads the row before the ALTER, when "customer-note" does not exist yet; `observe` after it. */
const TABLE: Record<Engine, { create: string[]; alter: string[]; observeV1: string; observe: string }> = {
  pg: {
    create: [
      'create schema rekey',
      'create table rekey.note (id bigint generated always as identity constraint pk_note primary key, customer_note varchar(40), "customer note" varchar(40), row_version bigint not null default 1)',
      `insert into rekey.note (customer_note, "customer note") values ('a clerk''s note', 'a manager''s note')`,
    ],
    alter: ['alter table rekey.note drop column customer_note', 'alter table rekey.note add column "customer-note" varchar(40)'],
    observeV1: 'select customer_note, "customer note" as "customer note" from rekey.note where id = 1',
    observe: 'select "customer note" as "customer note", "customer-note" as "customer-note" from rekey.note where id = 1',
  },
  ms: {
    create: [
      'create schema rekey',
      'create table rekey.note (id bigint identity(1,1) constraint pk_note primary key, customer_note nvarchar(40) null, [customer note] nvarchar(40) null, rv rowversion)',
      `insert into rekey.note (customer_note, [customer note]) values (N'a clerk''s note', N'a manager''s note')`,
    ],
    alter: ['alter table rekey.note drop column customer_note', 'alter table rekey.note add [customer-note] nvarchar(40) null'],
    observeV1: 'select customer_note, [customer note] as [customer note] from rekey.note where id = 1',
    observe: 'select [customer note] as [customer note], [customer-note] as [customer-note] from rekey.note where id = 1',
  },
}

/** The grants: a clerk writes customer_note, and may only read customer_note_2 -- the column "customer note". */
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: {
    id: { read: ['clerk'], write: [] },
    customer_note: { read: ['clerk'], write: ['clerk'] },
    customer_note_2: { read: ['clerk'], write: [] },
  },
  rowFilters: [],
  lookups: {},
}

const MANAGERS_NOTE = "a manager's note"

let pg: PostgresFixture
let ms: SqlServerFixture
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance
let base: string
let admin: string
let clerk: string

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const pgUrl = new URL(pg.admin)
  const connections: ConnectionConfig[] = [
    {
      id: 'pg-rekey', kind: 'postgres', host: pgUrl.hostname, port: Number(pgUrl.port), database: pgUrl.pathname.slice(1), user: decodeURIComponent(pgUrl.username), password: 'env:PG_PASSWORD', schemas: ['rekey'], tls: { enabled: false },
    },
    {
      id: 'ms-rekey', kind: 'sqlserver', host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: 'env:MS_PASSWORD', schemas: ['rekey'], tls: { enabled: false, trustServerCertificate: true },
    },
  ]
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: decodeURIComponent(pgUrl.password), MS_PASSWORD: String(ms.admin.password) },
    readFile: async () => '',
  })
  root = await mkdtemp(join(tmpdir(), 'formancy-data-keys-reassigned-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: {} })
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  // A real socket and a plain HTTP client: whatever the studio holds, this does not.
  await app.listen({ host: '127.0.0.1', port: 0 })
  base = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'] })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function call(method: 'GET' | 'POST', path: string, bearer: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : JSON.parse(text) }
}

type Row = Record<string, string | null>

/** The table's owner, beside the server: makes the table, alters it, and reads what is really stored. */
async function owner(engine: Engine): Promise<{ run(statements: readonly string[]): Promise<void>; one(query: string): Promise<Row>; close(): Promise<void> }> {
  if (engine === 'pg') {
    const url = new URL(pg.admin)
    const sql = connectPostgres({
      host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), tls: { enabled: false, rejectUnauthorized: false },
    })
    return {
      run: async (statements) => { for (const statement of statements) await sql.unsafe(statement) },
      one: async (query) => ((await sql.unsafe(query)) as unknown as Row[])[0] as Row,
      close: () => sql.end({ timeout: 5 }),
    }
  }
  const pool = await connectSqlServer({
    host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: String(ms.admin.password), encrypt: false, trustServerCertificate: true,
  })
  return {
    run: async (statements) => { for (const statement of statements) await pool.request().batch(statement) },
    one: async (query) => (await pool.request().query<Row>(query)).recordset[0] as Row,
    close: () => pool.close(),
  }
}

interface Proposal {
  form: FormSchema
  bindings: FormBindings
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

const anchors = (bindings: FormBindings) => Object.fromEntries(bindings.fields.map((binding) => [binding.field, binding.kind === 'column' ? binding.column : binding.foreignKey]))

describe.each([
  { engine: 'PostgreSQL', kind: 'pg' as Engine },
  { engine: 'SQL Server', kind: 'ms' as Engine },
])('a publish whose keys now name other columns, on $engine', ({ kind }) => {
  const connection = `${kind}-rekey`
  const formId = `${kind}-rekey`

  test('is refused until it says what happens to their grants, and a grant written for one column never writes the other', async () => {
    const ddl = await owner(kind)
    try {
      await ddl.run(TABLE[kind].create)

      const proposed = await call('POST', '/v1/form-proposals', admin, {
        connection, root: { schema: 'rekey', name: 'note' }, formId, title: 'Note', lookups: [], ...(kind === 'pg' ? { versionColumn: 'row_version' } : {}),
      })
      expect(proposed.status, JSON.stringify(proposed.json)).toBe(200)
      const proposal = proposed.json as Proposal
      expect(anchors(proposal.bindings)).toEqual({ id: 'id', customer_note: 'customer_note', customer_note_2: 'customer note' })
      const v1 = await call('POST', `/v1/forms/${formId}/versions`, admin, {
        expectedBase: null,
        bundle: { format: 2, connection, generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy: POLICY, snapshot: proposal.snapshot },
      })
      expect(v1.status, JSON.stringify(v1.json)).toBe(201)

      // The control, under version 1: the column "customer note" is read-only to a clerk.
      const read1 = await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record: 'k1:1' })
      expect(read1.status).toBe(200)
      const control = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { record: 'k1:1', version: read1.json.version, answers: { customer_note_2: 'a clerk tries' } })
      expect(control.status).toBe(403)
      expect((await ddl.one(TABLE[kind].observeV1))['customer note']).toBe(MANAGERS_NOTE)

      // The owner drops the first colliding column and adds a third: both keys now stand for other columns.
      await ddl.run(TABLE[kind].alter)
      const regenerated = await call('POST', `/v1/forms/${formId}/regenerations`, admin)
      expect(regenerated.status, JSON.stringify(regenerated.json)).toBe(200)
      const { version, drift: _drift, policyProblems, conflicts: _conflicts, lookupsDropped: _dropped, keysReassigned, notes: _notes, ...parts } = regenerated.json
      const reassigned = [
        { field: 'customer_note', was: { kind: 'column', column: 'customer_note' }, now: { kind: 'column', column: 'customer note' } },
        { field: 'customer_note_2', was: { kind: 'column', column: 'customer note' }, now: { kind: 'column', column: 'customer-note' } },
      ]
      expect(keysReassigned).toEqual(reassigned)
      // The policy fits the new form: every key it names still exists, so nothing else would have refused it.
      expect(policyProblems).toEqual([])
      expect(parts.policy).toEqual(POLICY)

      // Published as regenerated, nobody deciding: refused, naming both keys, and nothing written.
      const undecided = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: version, bundle: { format: 2, connection, ...parts } })
      expect(undecided.status, JSON.stringify(undecided.json)).toBe(422)
      expect(undecided.json).toMatchObject({ code: 'keys-reassigned', keys: reassigned })
      expect((await call('GET', `/v1/forms/${formId}/versions`, admin)).json).toEqual({ versions: [1] })

      // The decision the studio makes: customer_note's grants removed, customer_note_2's kept for "customer-note".
      const { customer_note: _removed, ...fields } = POLICY.fields
      const decided = await call('POST', `/v1/forms/${formId}/versions`, admin, {
        expectedBase: version,
        bundle: { format: 2, connection, ...parts, policy: { ...POLICY, fields } },
        keysConfirmed: [reassigned[1]],
      })
      expect(decided.status, JSON.stringify(decided.json)).toBe(201)
      expect(decided.json).toEqual({ version: 2 })

      // The clerk's write through customer_note -- the column "customer note" now -- is refused, and the column keeps its note.
      const read2 = await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record: 'k1:1' })
      expect(read2.status, JSON.stringify(read2.json)).toBe(200)
      const write = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { record: 'k1:1', version: read2.json.version, answers: { customer_note: 'written by a clerk' } })
      expect(write.status, JSON.stringify(write.json)).toBe(403)
      expect((await ddl.one(TABLE[kind].observe))['customer note']).toBe(MANAGERS_NOTE)
    } finally {
      await ddl.close()
    }
  })
})
