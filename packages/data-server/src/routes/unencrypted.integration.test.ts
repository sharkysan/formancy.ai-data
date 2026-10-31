import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, recordToken } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { PRELOGIN_ENCRYPTION, preloginAnswer, SQLSERVER_IMAGE, startPreloginStandIn, startSqlServerFixture, TDS_PACKET } from '@formancy/data-fixtures'
import type { PreloginStandIn, SqlServerFixture } from '@formancy/data-fixtures'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry, parseConnections } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'

/*
 * A SQL login whose connection asks for TLS, answered by whoever stands in
 * the server's place that it will not encrypt (0081), through the server's
 * real routes and driver: what the connection test, an opened form, a
 * record read and a lookup answer, what the log says, and that the login
 * reached neither the stand-in nor anything the server wrote.
 *
 * The form is published over the connection while it is the default
 * image's SQL Server -- named, as every suite outside the adapters' names
 * its image (0067) -- and the server that serves it then has the same
 * connection, through the allowlist with TLS on as an operator writes it,
 * at the address of a stand-in from data-fixtures: it answers PRELOGIN with
 * ENCRYPTION = NOT_SUP and keeps the type of every packet the client sends
 * after. A network fixture, not a mocked driver (0003): the driver is the
 * real mssql and tedious. A 0.1.0 server sent it LOGIN7, the password in
 * it, on every connection it opened.
 *
 * The leak check is scripts/getting-started/stack.mjs's `leaks()`, written
 * again here over this suite's own capture, as entra.integration.test.ts
 * writes it, since no package's test imports scripts/.
 *
 * Watched failing on 2026-10-17 with the adapter's refusal removed: the
 * stand-in heard LOGIN7 on every connection, and the log said tedious's
 * "Connection lost - socket hang up" where the sentence was expected.
 */

const USER = 'erp_app'
const PASSWORD = 'Stand-in-Login-Password-4e7'
/** data-sqlserver's sentence for a server that answered it would not encrypt (encryption.ts). */
const UNENCRYPTED = 'The server answered that it would not encrypt the connection, so the login was not sent.'
const UNREACHABLE = { code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' }
const FORM = 'erp-order'

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === 'admin') return { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
  if (token === 'clerk') return { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'bad' }
}

let ms: SqlServerFixture
let standIn: PreloginStandIn
let root: string
let store: ConfigurationStore
let registry: ConnectionRegistry
let app: FastifyInstance
/** Every line the server wrote, every answer it gave and every audit event, as text. */
const written: string[] = []
const answered: string[] = []
const audited: string[] = []
let source: string

/** A clerk of tenant 1 may read and write every field the form writes; the customer lookup is pinned to the tenant. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(
      fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }]),
    ),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

/** The order form over `erp`, proposed and published while `erp` is the run's SQL Server. */
async function publishOverTheServer(): Promise<void> {
  const real = createConnectionRegistry(
    [
      {
        id: 'erp',
        kind: 'sqlserver',
        host: String(ms.admin.server),
        port: Number(ms.admin.port),
        database: String(ms.admin.database),
        schemas: ['sales'],
        tls: { enabled: false, trustServerCertificate: true },
        user: String(ms.admin.user),
        password: 'env:MS_PASSWORD',
      },
    ],
    DRIVER_FACTORIES,
    { env: { MS_PASSWORD: String(ms.admin.password) }, readFile: async () => '' },
  )
  const publisher = await createDataServer({ verifyIdentity, admin: { registry: real, store, adminRoles: ['data-admin'], audit: { sink: () => {} } } })
  try {
    const proposed = await publisher.inject({
      method: 'POST',
      url: '/v1/form-proposals',
      headers: { authorization: 'Bearer admin' },
      payload: {
        connection: 'erp',
        root: { schema: 'sales', name: 'order' },
        formId: FORM,
        title: 'Order',
        lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      },
    })
    expect(proposed.statusCode, proposed.body).toBe(200)
    const { form, bindings, snapshot, generation } = proposed.json<{
      form: FormSchema
      bindings: FormBindings
      snapshot: MetadataSnapshot
      generation: GenerationRequest
    }>()
    const bundle = {
      format: 2,
      connection: 'erp',
      generation,
      base: form,
      presentation: EMPTY_PRESENTATION,
      form,
      bindings,
      policy: clerkPolicy(bindings.fields),
      snapshot,
    }
    const published = await publisher.inject({
      method: 'POST',
      url: `/v1/forms/${FORM}/versions`,
      headers: { authorization: 'Bearer admin' },
      payload: { expectedBase: null, bundle },
    })
    expect(published.statusCode, published.body).toBe(201)
    const field = form.model.fields.find((candidate) => candidate.key === 'customer') as { optionsSource?: string } | undefined
    if (field?.optionsSource === undefined) throw new Error('the order form has no customer lookup')
    source = field.optionsSource
  } finally {
    await publisher.close()
    await real.close()
  }
}

beforeAll(async () => {
  ms = await startSqlServerFixture(SQLSERVER_IMAGE)
  root = await mkdtemp(join(tmpdir(), 'formancy-data-unencrypted-'))
  store = createFileConfigurationStore(root)
  await publishOverTheServer()

  standIn = await startPreloginStandIn(preloginAnswer(PRELOGIN_ENCRYPTION.NOT_SUP))
  const parsed = parseConnections([
    { id: 'erp', kind: 'sqlserver', host: '127.0.0.1', port: standIn.port, database: 'erp', schemas: ['sales'], user: USER, password: 'env:ERP_PASSWORD' },
  ])
  if (!parsed.ok) throw new Error(parsed.problems.join('\n'))
  registry = createConnectionRegistry(parsed.connections, DRIVER_FACTORIES, { env: { ERP_PASSWORD: PASSWORD }, readFile: async () => '' })
  const sink = (event: unknown) => {
    audited.push(JSON.stringify(event))
  }
  app = await createDataServer({
    verifyIdentity,
    logger: { stream: { write: (line: string) => void written.push(line) } },
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink } },
    runtime: { registry, store, audit: { sink } },
  })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await standIn?.close()
  await ms?.stop()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function ask(method: 'GET' | 'POST', url: string, bearer: string, payload?: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const answer = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload === undefined ? {} : { payload }) })
  answered.push(answer.body)
  return { status: answer.statusCode, json: answer.json<unknown>() }
}

/** stack.mjs's `leaks()`: where each value appears among `haystacks`, as sentences naming the value's name and the place, never the value. */
function leaks(values: ReadonlyArray<readonly [string, string]>, haystacks: ReadonlyArray<{ where: string; text: string }>): string[] {
  const found: string[] = []
  for (const haystack of haystacks) for (const [name, value] of values) if (haystack.text.includes(value)) found.push(`the ${name} is in ${haystack.where}`)
  return found
}

// The administrator's connection test, a person opening the form, reading
// a record and searching the customer lookup: each meets the refusal where
// the connection is opened, and each is the plane's fixed 503, as for any
// connection that cannot be opened. Nothing was sent, and nothing was saved.
test('the connection test, an opened form, a record read and a lookup each answer 503 unavailable', async () => {
  const token = recordToken(['id'], { id: '1' })
  if (!token.ok) throw new Error(token.message)
  expect(await ask('POST', '/v1/connections/erp/test', 'admin')).toEqual({
    status: 503,
    json: { code: 'unavailable', message: 'Connection erp cannot be reached.' },
  })
  expect(await ask('GET', `/v1/forms/${FORM}`, 'clerk')).toEqual({ status: 503, json: UNREACHABLE })
  expect(await ask('POST', `/v1/forms/${FORM}/records/read`, 'clerk', { record: token.token })).toEqual({ status: 503, json: UNREACHABLE })
  expect(await ask('POST', `/v1/forms/${FORM}/lookups/${source}/query`, 'clerk', { operation: 'create', search: 'Muster' })).toEqual({
    status: 503,
    json: UNREACHABLE,
  })
})

// Every connection the server opened to the stand-in ended after the
// client's PRELOGIN: no LOGIN7, so no password, crossed the network.
test('every connection ends after PRELOGIN, and LOGIN7 is never sent', async () => {
  await standIn.settled()
  expect(standIn.sent.length).toBeGreaterThanOrEqual(4)
  for (const sent of standIn.sent) expect(sent).toEqual([TDS_PACKET.PRELOGIN])
})

// What the operator reads is the adapter's sentence, on every line that
// says the connection could not be opened, and not tedious's "Connection
// lost", which would send them looking for a network fault.
test('the log says why in the adapter’s sentence', () => {
  const opened = written
    .map((line) => JSON.parse(line) as { msg?: string; connection?: string; error?: string })
    .filter((line) => line.msg === 'connection could not be opened' && line.connection === 'erp')
  expect(opened.length).toBeGreaterThanOrEqual(4)
  for (const line of opened) expect(line.error).toBe(UNENCRYPTED)
})

// After every request above: neither the login's password nor its user is
// in the server's log, an answer or an audit event. Watched failing with
// connectSqlServer's refusal naming both.
test('nothing of the login reaches the log, an answer or an audit event', () => {
  expect(written.length).toBeGreaterThan(0)
  expect(audited.length).toBeGreaterThan(0)
  const found = leaks(
    [
      ['password', PASSWORD],
      ['user', USER],
    ],
    [
      { where: "the server's log", text: written.join('\n') },
      { where: 'an answer', text: answered.join('\n') },
      { where: 'an audit event', text: audited.join('\n') },
    ],
  )
  expect(found).toEqual([])
})
