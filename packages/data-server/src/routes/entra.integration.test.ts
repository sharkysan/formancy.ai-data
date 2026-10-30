import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { EMPTY_PRESENTATION, recordToken } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { startSqlServerFixture } from '@formancy/data-fixtures'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry, parseConnections } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'

/*
 * A connection that logs in as an Entra principal, through the server's
 * real routes, the real driver and a real SQL Server (0074): what the
 * connection test, an opened form, a record read and a lookup answer when
 * the login fails, and that nothing of the principal -- its secret, its
 * tenant, its client, or the path a resolved secret is read from --
 * reaches the server's log, an answer or an audit event.
 *
 * An Entra login logs in over TDS 8.0 alone, and of the matrix only SQL
 * Server 2025 takes it, with a certificate configured (measured:
 * data-sqlserver's entra.integration.test.ts). So the server here is 2025,
 * named for that fact, started with a certificate for `localhost` that this
 * process trusts. It takes no Entra login and refuses one at once, so every
 * login here fails, and that is all this shows: no test of this release
 * logs in as an Entra principal. A form is published over each connection
 * while it is still a SQL login, and the server that serves it then has the
 * same connections as Entra principals.
 *
 * The Entra connections are an operator's entries, through
 * parseConnections: TLS on and the certificate checked, as the allowlist
 * requires. The leak check is scripts/getting-started/stack.mjs's
 * `leaks()`, written again here over this suite's own capture, since no
 * package's test imports scripts/.
 *
 * Watched failing on 2026-10-17: with drivers.ts naming the tenant, the
 * client and the secret's reference in the error it rethrows (the log's
 * sentence and the leak check), and with the runtime plane's connection
 * step rethrowing instead of answering (500 where 503 was expected, for
 * both connections).
 */

const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
const SECRET = 'Zq8~entra-client-secret-value-e81'
const SECRET_PATH = '/run/secrets/erp-client-secret'
/** A secret file that is not there: an operator's mount that went missing. */
const UNMOUNTED_PATH = '/run/secrets/erp-unmounted-client-secret'
/** The image this file names for a fact of its own: the one of the matrix that takes TDS 8.0. */
const SQLSERVER_2025_IMAGE = 'mcr.microsoft.com/mssql/server:2025-latest'
/** The adapter's sentence for a login the server refused (data-sqlserver's entra.ts). */
const REFUSED = 'The SQL Server login as an Entra principal failed: the server refused it.'
const UNREACHABLE = { code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' }

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === 'admin') return { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
  if (token === 'clerk') return { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'bad' }
}

/** Each Entra connection, the principal it logs in as, and the form published over it. */
const CONNECTIONS: ReadonlyArray<{ id: string; login: NonNullable<ConnectionConfig['login']> }> = [
  { id: 'erp-sp', login: { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: `file:${SECRET_PATH}` } },
  { id: 'erp-mi', login: { type: 'entra-managed-identity', client: CLIENT } },
]

/** The process's trusted certificates before this file added the container's. */
const trusted = getCACertificates('default')
let ms: SqlServerFixture
let root: string
let store: ConfigurationStore
let registry: ConnectionRegistry
let app: FastifyInstance
/** Every line the server wrote, every answer it gave and every audit event, as text. */
const written: string[] = []
const answered: string[] = []
const audited: string[] = []
/** The lookup source of each published form's customer field. */
const sources = new Map<string, string>()

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

/** The order form over each connection, proposed and published while the connection is a SQL login. */
async function publishAsSqlLogin(): Promise<void> {
  const address = {
    kind: 'sqlserver' as const,
    host: String(ms.admin.server),
    port: Number(ms.admin.port),
    database: String(ms.admin.database),
    schemas: ['sales'],
    tls: { enabled: false, trustServerCertificate: true },
  }
  const sqlLogins = createConnectionRegistry(
    CONNECTIONS.map(({ id }) => ({ id, ...address, user: String(ms.admin.user), password: 'env:MS_PASSWORD' })),
    DRIVER_FACTORIES,
    { env: { MS_PASSWORD: String(ms.admin.password) }, readFile: async () => '' },
  )
  const publisher = await createDataServer({ verifyIdentity, admin: { registry: sqlLogins, store, adminRoles: ['data-admin'], audit: { sink: () => {} } } })
  try {
    for (const { id } of CONNECTIONS) {
      const proposed = await publisher.inject({
        method: 'POST',
        url: '/v1/form-proposals',
        headers: { authorization: 'Bearer admin' },
        payload: {
          connection: id,
          root: { schema: 'sales', name: 'order' },
          formId: `${id}-order`,
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
        connection: id,
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
        url: `/v1/forms/${id}-order/versions`,
        headers: { authorization: 'Bearer admin' },
        payload: { expectedBase: null, bundle },
      })
      expect(published.statusCode, published.body).toBe(201)
      const field = form.model.fields.find((candidate) => candidate.key === 'customer') as { optionsSource?: string } | undefined
      if (field?.optionsSource === undefined) throw new Error('the order form has no customer lookup')
      sources.set(id, field.optionsSource)
    }
  } finally {
    await publisher.close()
    await sqlLogins.close()
  }
}

beforeAll(async () => {
  ms = await startSqlServerFixture(SQLSERVER_2025_IMAGE, { certificate: true })
  if (ms.certificate === undefined) throw new Error('the container was started without its certificate')
  setDefaultCACertificates([...trusted, ms.certificate])
  root = await mkdtemp(join(tmpdir(), 'formancy-data-entra-'))
  store = createFileConfigurationStore(root)
  await publishAsSqlLogin()

  const address = { kind: 'sqlserver', host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), schemas: ['sales'] }
  const unmounted = {
    id: 'erp-unmounted',
    ...address,
    login: { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: `file:${UNMOUNTED_PATH}` },
  }
  const parsed = parseConnections([...CONNECTIONS.map(({ id, login }) => ({ id, ...address, login })), unmounted])
  if (!parsed.ok) throw new Error(parsed.problems.join('\n'))
  registry = createConnectionRegistry(parsed.connections, DRIVER_FACTORIES, {
    env: {},
    readFile: async (path) => {
      if (path !== SECRET_PATH) throw new Error('no such file')
      return `${SECRET}\n`
    },
  })
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
  setDefaultCACertificates(trusted)
  await app?.close()
  await registry?.close()
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

describe.each(CONNECTIONS)('a connection that logs in as an Entra principal, $id ($login.type)', ({ id }) => {
  const form = `${id}-order`

  // The administrator's connection test: the fixed 503, as for any
  // connection that cannot be opened, naming the connection and nothing of
  // its principal (routes/admin.ts).
  test('the connection test answers 503 unavailable', async () => {
    expect(await ask('POST', `/v1/connections/${id}/test`, 'admin')).toEqual({
      status: 503,
      json: { code: 'unavailable', message: `Connection ${id} cannot be reached.` },
    })
  })

  // A person opening the form, reading a record and searching the customer
  // lookup each meet the login's failure where the connection is opened,
  // and each is the runtime plane's fixed 503: nothing was sent, and
  // nothing was saved (routes/runtime.ts).
  test('an opened form, a record read and a lookup each answer 503 unavailable', async () => {
    const token = recordToken(['id'], { id: '1' })
    if (!token.ok) throw new Error(token.message)
    expect(await ask('GET', `/v1/forms/${form}`, 'clerk')).toEqual({ status: 503, json: UNREACHABLE })
    expect(await ask('POST', `/v1/forms/${form}/records/read`, 'clerk', { record: token.token })).toEqual({ status: 503, json: UNREACHABLE })
    expect(await ask('POST', `/v1/forms/${form}/lookups/${String(sources.get(id))}/query`, 'clerk', { operation: 'create', search: 'Muster' })).toEqual({
      status: 503,
      json: UNREACHABLE,
    })
  })

  // What the operator reads is the adapter's sentence, not mssql's empty
  // message or tedious's "Login failed for user ''.", on every line that
  // says the connection could not be opened.
  test('the log says why in the adapter’s sentence', () => {
    const opened = written
      .map((line) => JSON.parse(line) as { msg?: string; connection?: string; error?: string })
      .filter((line) => line.msg === 'connection could not be opened' && line.connection === id)
    expect(opened.length).toBeGreaterThanOrEqual(4)
    for (const line of opened) expect(line.error).toBe(REFUSED)
  })
})

// A service principal whose secret file cannot be read -- a mount that
// went missing -- is refused where the connection is opened, as a SQL
// login's password is (secrets.ts): the answer is the fixed 503, and the
// log line names the file, which is what the operator has to fix, and
// nothing else of the principal. The file's path is the allowlist's, never
// the secret. Watched failing with resolveSecret's sentence naming no file.
test('a secret file that cannot be read is named in the log, and in no answer or audit event', async () => {
  expect(await ask('POST', '/v1/connections/erp-unmounted/test', 'admin')).toEqual({
    status: 503,
    json: { code: 'unavailable', message: 'Connection erp-unmounted cannot be reached.' },
  })
  const opened = written
    .map((line) => JSON.parse(line) as { msg?: string; connection?: string; error?: string })
    .filter((line) => line.msg === 'connection could not be opened' && line.connection === 'erp-unmounted')
  expect(opened.map((line) => line.error)).toEqual([`the secret file ${UNMOUNTED_PATH} cannot be read`])
  const found = leaks(
    [["unread secret's path", UNMOUNTED_PATH]],
    [
      { where: 'an answer', text: answered.join('\n') },
      { where: 'an audit event', text: audited.join('\n') },
    ],
  )
  expect(found).toEqual([])
})

// After every request above: the principal's secret, tenant, client and
// the path its secret is read from are nowhere in the server's log, in an
// answer or in an audit event, for either login whose secret resolved.
test('nothing of a principal reaches the log, an answer or an audit event', () => {
  expect(written.length).toBeGreaterThan(0)
  expect(audited.length).toBeGreaterThan(0)
  const found = leaks(
    [
      ['client secret', SECRET],
      ['tenant id', TENANT],
      ['client id', CLIENT],
      ["secret's path", SECRET_PATH],
    ],
    [
      { where: "the server's log", text: written.join('\n') },
      { where: 'an answer', text: answered.join('\n') },
      { where: 'an audit event', text: audited.join('\n') },
    ],
  )
  expect(found).toEqual([])
})
