import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WRITE_ID_HEADER } from '@formancy/data-core'
import type { FormMenu, PublishedForm as OpenedForm } from '@formancy/data-core'
import { POSTGRES_IMAGE, readFixture, startPostgresContainer } from '@formancy/data-fixtures'
import type { StartedPostgreSqlContainer, StartedServer } from '@formancy/data-fixtures'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, createIdentityVerifier, DRIVER_FACTORIES, parseConnections } from '@formancy/data-server'
import type { ConnectionRegistry } from '@formancy/data-server'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { generateDemoData } from '../data/generate.js'
import { demoSql } from '../data/render.js'
import { DEMO_FORMS, PERSONAS, ROLE_GRANTS } from '../personas.js'
import { AUDIENCE, ISSUER, mintToken, TENANT_CLAIM } from '../token.js'
import { DEMO_FORM_SPECS, demoBundle, generationRequest } from './forms.js'
import type { DemoFormSpec, Proposal } from './forms.js'
import { publishDemoForms, waitForHealth } from './publish.js'
import type { PublishedForm } from './publish.js'

/**
 * The image's build, short of the image: PostgreSQL 17 (data-fixtures'
 * POSTGRES_IMAGE, which the image is built from, named so FORMANCY_IMAGES
 * never moves it, and started through startPostgresContainer, so the
 * release report records it) loaded as deploy/demo/build.sh loads it -- the fixture's
 * postgres.sql, the demo's rows and deploy/demo/accounts.sql in one `psql
 * -1` with ON_ERROR_STOP, then deploy/demo/password.sql with the password
 * in psql's environment -- inside the container, from the same files. The
 * real data server in process, both planes on, over the account
 * deploy/demo/connections.json names, verifying tokens as the image's
 * settings say; the forms published over a socket by publishDemoForms, as
 * the image's cli.ts publishes them. Then each persona, with a token from
 * mintToken, asks what personas.ts says they may do, and a clerk does it.
 *
 * What it leaves to the image's gate: the image itself -- its users and
 * paths, the server started by main.ts from the image's environment, the
 * password nulled after the build and set again on every start.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const demoFile = (name: string): string => readFileSync(join(repo, 'deploy', 'demo', name), 'utf8')

const KEY = randomBytes(32).toString('base64url')
/** The role build.sh gives the build-time server's administrator's plane; the running image has none. */
const ADMIN_ROLE = 'data-admin'
const data = generateDemoData()

let started: StartedServer<StartedPostgreSqlContainer>
let registry: ConnectionRegistry | undefined
let app: Awaited<ReturnType<typeof createDataServer>> | undefined
let storeDir: string | undefined
let base: string
let published: PublishedForm[]
const tokens = new Map<string, string>()

/** psql in the container, as build.sh runs it: the superuser over the socket, stopping at the first error, nothing from ~/.psqlrc. */
async function psql(args: string[], env: Record<string, string> = {}): Promise<void> {
  const result = await started.container.exec(['psql', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-U', started.container.getUsername(), ...args], { env })
  if (result.exitCode !== 0) throw new Error(`psql ${args.join(' ')} exited ${String(result.exitCode)}: ${result.stderr}`)
}

interface Answer {
  status: number
  json: any
}

async function call(token: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? undefined : JSON.parse(text) }
}

const write = (token: string, path: string, body: unknown) => call(token, path, body, { [WRITE_ID_HEADER]: randomBytes(16).toString('hex') })
const as = (id: string): string => tokens.get(id) as string

beforeAll(async () => {
  started = await startPostgresContainer(POSTGRES_IMAGE)
  await started.container.copyContentToContainer([
    { content: readFixture('postgres.sql'), target: '/demo/postgres.sql' },
    { content: demoSql(data), target: '/demo/demo-data.sql' },
    { content: demoFile('accounts.sql'), target: '/demo/accounts.sql' },
    { content: demoFile('password.sql'), target: '/demo/password.sql' },
  ])
  const [connection] = JSON.parse(demoFile('connections.json')) as Array<Record<string, unknown>>
  await psql(['-d', 'postgres', '-c', `create database ${String(connection?.['database'])}`])
  await psql(['-d', String(connection?.['database']), '-1', '-f', '/demo/postgres.sql', '-f', '/demo/demo-data.sql', '-f', '/demo/accounts.sql'])
  const password = randomBytes(32).toString('base64url')
  await psql(['-d', String(connection?.['database']), '-1', '-f', '/demo/password.sql'], { FORMANCY_DEMO_DB_PASSWORD: password })

  // The file as written, but for where this run's database listens.
  const parsed = parseConnections([{ ...connection, host: started.container.getHost(), port: started.container.getPort() }])
  if (!parsed.ok) throw new Error(parsed.problems.join('; '))
  registry = createConnectionRegistry(parsed.connections, DRIVER_FACTORIES, { env: { FORMANCY_DEMO_DB_PASSWORD: password }, readFile: async () => '' })
  storeDir = await mkdtemp(join(tmpdir(), 'formancy-live-demo-store-'))
  const store = createFileConfigurationStore(storeDir)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: KEY }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: TENANT_CLAIM } })
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: [ADMIN_ROLE], audit: { sink: () => {} } }, runtime: { registry, store } })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
  await waitForHealth(base)

  const admin = await mintToken(KEY, { subject: 'image-build', roles: [ADMIN_ROLE] })
  tokens.set('image-build', admin.token)
  published = await publishDemoForms({ base, token: admin.token })
  for (const each of PERSONAS) tokens.set(each.id, (await mintToken(KEY, { subject: each.id, roles: each.roles, tenant: each.tenant })).token)
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await started?.container.stop()
  if (storeDir !== undefined) await rm(storeDir, { recursive: true, force: true })
})

describe('the demo forms, published over the demo account', () => {
  // A form discovered as the container's superuser would offer what the
  // demo's account may not do, and fail at the first write instead.
  test("are every form the personas name, each generated from the demo account's snapshot", () => {
    const [connection] = JSON.parse(demoFile('connections.json')) as Array<{ user: string }>
    expect(published.map((form) => form.id)).toEqual(DEMO_FORMS.map((form) => form.id))
    for (const form of published) expect(form.account).toBe(connection?.user)
  })

  // A clerk does what each form offers (ROLE_GRANTS): what the generator
  // offers is decided by accounts.sql's grants and the fixture's version
  // columns -- no update or delete of a customer, which has none; no
  // delete of a line, whose version restarts with a re-created key -- so a
  // grant added there, or one taken away, shows here as a clerk who may
  // do less than the form offers, or a publish refused.
  test('offer the clerk exactly what each form offers', () => {
    for (const form of published) {
      const offered = (['create', 'update', 'delete'] as const).filter((operation) => form.offers[operation] === true)
      expect(ROLE_GRANTS.clerk.may[form.id].filter((operation) => operation !== 'read'), form.id).toEqual(offered)
    }
  })

  // Each persona sentence is a claim: the menu names the forms ROLE_GRANTS
  // lets them read, with exactly those operations, and the master-detail
  // chain under them -- customers, their orders, an order's deliveries
  // and lines. Opening each asks the database as it is now (0041), so a
  // grant accounts.sql lacks shows here and not on a visitor's first save.
  test.each(PERSONAS.map((each) => [each.id, each] as const))('%s may do exactly what the page says', async (_id, each) => {
    const menu = (await call(as(each.id), '/v1/forms')).json as FormMenu
    const grants = ROLE_GRANTS[each.roles[0] as keyof typeof ROLE_GRANTS].may
    expect(menu.forms).toEqual([
      { id: 'customer', title: 'Customer', operations: grants.customer, children: [{ form: 'order', field: 'customer', one: false, when: null }] },
      { id: 'delivery', title: 'Delivery', operations: grants.delivery, children: [] },
      {
        id: 'order',
        title: 'Order',
        operations: grants.order,
        children: [
          { form: 'delivery', field: 'order', one: false, when: null },
          { form: 'order-line', field: 'order', one: false, when: null },
        ],
      },
      { id: 'order-line', title: 'Order line', operations: grants['order-line'], children: [] },
    ])
    for (const form of DEMO_FORMS) {
      const opened = await call(as(each.id), `/v1/forms/${form.id}`)
      expect(opened.status).toBe(200)
      expect((opened.json as OpenedForm).operations).toEqual(grants[form.id])
    }
  })

  // Two lookups of one table, both "Employee" as generated: the
  // presentation names them by what each references.
  test('label who created an order and who approved it', async () => {
    const opened = (await call(as('clara'), '/v1/forms/order')).json as OpenedForm
    const labels = opened.form.model.fields.map((field) => field.label)
    expect(labels).toContain('Created by')
    expect(labels).toContain('Approved by')
    expect(labels).not.toContain('Employee')
  })
})

describe("a clerk's day on the demo's data", () => {
  const tenantNames = (tenant: number) => data.customers.filter((customer) => customer.tenantId === tenant).map((customer) => customer.name)

  // The order's customer lookup is filtered by the token's tenant (and
  // must be: it sets the pinned tenant_id); a typeahead that offered the
  // other tenant's customers would write their tenant into this one's order.
  test("offers each clerk their own tenant's customers, and finds none of the other's", async () => {
    const opened = (await call(as('clara'), '/v1/forms/order')).json as OpenedForm
    const source = opened.form.model.fields.find((field) => field.key === 'customer')?.optionsSource as string
    const offered = async (who: string, search: string) => ((await call(as(who), `/v1/forms/order/lookups/${source}/query`, { operation: 'create', search })).json.rows as Array<{ label: string }>).map((row) => row.label)
    const first = await offered('clara', '')
    expect(first.length).toBeGreaterThan(0)
    for (const label of first) expect(tenantNames(1)).toContain(label)
    const only = tenantNames(1).find((name) => !tenantNames(2).some((other) => other.toLowerCase().includes(name.toLowerCase())))
    if (only === undefined) throw new Error("every name of tenant 1 is also found among tenant 2's: nothing here can show the search keeps to a tenant")
    expect(await offered('clara', only)).toContain(only)
    expect(await offered('otto', only)).toEqual([])
  })

  // A delivery or a line names its order through a lookup. Shown by its
  // date alone, the generator draws it as a list of its first page, and
  // only 50 of a tenant's 420 orders could be chosen; by its number, any
  // of the tenant's can, and none of the other's.
  test("lets a clerk choose any order of their tenant's by its number, and none of the other's", async () => {
    const last = (tenant: number) => String(Math.max(...data.orders.filter((order) => order.tenantId === tenant).map((order) => order.id)))
    for (const form of ['delivery', 'order-line']) {
      const opened = (await call(as('clara'), `/v1/forms/${form}`)).json as OpenedForm
      const source = opened.form.model.fields.find((field) => field.key === 'order')?.optionsSource as string
      const found = async (who: string, search: string) => ((await call(as(who), `/v1/forms/${form}/lookups/${source}/query`, { operation: 'create', search })).json.rows as Array<{ token: string }>).map((row) => row.token)
      expect(await found('clara', last(1)), form).toContain(`k1:${last(1)}`)
      expect(await found('otto', last(1)), form).not.toContain(`k1:${last(1)}`)
    }
  })

  // When a customer was created is the database's to say, by the column's
  // default. With INSERT on the whole table the generator offers it on
  // create, and a visitor could backdate a new customer by a decade.
  test("stamps a new customer's creation in the database, and refuses one a clerk sends", async () => {
    const clara = as('clara')
    const opened = (await call(clara, '/v1/forms/customer')).json as OpenedForm
    expect(opened.form.logic?.rules).toContainEqual({ target: 'created_at', kind: 'disabled', cel: 'true' })
    const customerNo = Math.max(...data.customers.map((customer) => customer.customerNo)) + 1
    const answers = { customer_no: customerNo, name: 'Created Here AG', active: true }
    const backdated = await write(clara, '/v1/forms/customer/records/create', { answers: { ...answers, created_at: '2016-10-01T00:00:00Z' } })
    expect(backdated.status).toBe(403)
    expect(backdated.json).toMatchObject({ code: 'over-posting' })
    const before = Date.now()
    const created = await write(clara, '/v1/forms/customer/records/create', { answers })
    expect(created.status, JSON.stringify(created.json)).toBe(201)
    const read = await call(clara, '/v1/forms/customer/records/read', { record: created.json.record })
    expect(Math.abs(Date.parse(read.json.answers.created_at as string) - before)).toBeLessThan(60_000)
  })

  // The journey the page offers, end to end through the demo account's
  // grants: an order for one of the clerk's customers, a line and a
  // delivery under it -- each found as the order's child -- a change, and
  // a delete that takes the line and the delivery with it. The other
  // tenant's clerk never finds the order; the auditor reads it and may
  // change nothing.
  test('creates an order with a line and a delivery, changes it, and deletes it with both', async () => {
    const clara = as('clara')
    const order = (await call(clara, '/v1/forms/order')).json as OpenedForm
    const source = (key: string) => order.form.model.fields.find((field) => field.key === key)?.optionsSource as string
    const customer = (await call(clara, `/v1/forms/order/lookups/${source('customer')}/query`, { operation: 'create', search: '' })).json.rows[0].token as string
    const created = await write(clara, '/v1/forms/order/records/create', { answers: { customer, order_date: '2026-10-01', status: 'placed', amount: '12.5' } })
    expect(created.status).toBe(201)
    const record = created.json.record as string

    const line = await write(clara, '/v1/forms/order-line/records/create', { answers: { order: record, line_no: 1, quantity: 5, unit_price: '2.50' } })
    expect(line.status).toBe(201)
    const delivery = await write(clara, '/v1/forms/delivery/records/create', { answers: { order: record, carrier: 'Swiss Post' } })
    expect(delivery.status).toBe(201)
    const children = async (form: string) => ((await call(clara, `/v1/forms/${form}/records/list`, { parent: { field: 'order', record } })).json.rows as Array<{ record: string }>).map((row) => row.record)
    expect(await children('order-line')).toEqual([line.json.record])
    expect(await children('delivery')).toEqual([delivery.json.record])

    expect((await call(as('otto'), '/v1/forms/order/records/read', { record })).status).toBe(404)
    const read = await call(as('vera'), '/v1/forms/order/records/read', { record })
    expect(read.status).toBe(200)
    expect((await write(as('vera'), '/v1/forms/order/records/update', { record, version: read.json.version, answers: { ...read.json.answers, status: 'shipped' } })).status).toBe(403)
    expect((await write(as('vera'), '/v1/forms/order/records/create', { answers: { customer, order_date: '2026-10-01', status: 'placed', amount: '1' } })).status).toBe(403)

    const changed = await write(clara, '/v1/forms/order/records/update', { record, version: read.json.version, answers: { ...read.json.answers, status: 'shipped' } })
    expect(changed.status).toBe(200)
    const deleted = await write(clara, '/v1/forms/order/records/delete', { record, version: changed.json.version })
    expect(deleted.status).toBe(200)
    expect((await call(clara, '/v1/forms/order/records/read', { record })).status).toBe(404)
    expect((await call(clara, '/v1/forms/order-line/records/read', { record: line.json.record })).status).toBe(404)
    expect((await call(clara, '/v1/forms/delivery/records/read', { record: delivery.json.record })).status).toBe(404)
  })
})

describe('a publish that cannot', () => {
  /** A server on a socket of its own that answers every request as `answer` does, closed after `work`. */
  async function serving(answer: Parameters<typeof createServer>[1], work: (origin: string) => Promise<void>): Promise<void> {
    const server = createServer(answer)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      await work(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }

  // The image's build prints this sentence and stops; it names the form
  // and the request and gives the server's own reason, never the token.
  test("says which form and request were refused, in the server's words", async () => {
    const refused = publishDemoForms({ base, token: as('clara') })
    await expect(refused).rejects.toThrow(/^customer: POST \/v1\/form-proposals answered 403, not 200: \S+ \S/)
    await expect(refused).rejects.not.toThrow(as('clara'))
    // The forms are there already, and expectedBase null says they are not.
    await expect(publishDemoForms({ base, token: as('image-build') })).rejects.toThrow(/^customer: POST \/v1\/forms\/customer\/versions answered 409, not 201: /)
  })

  // A refused bundle's reasons are its problems; without them a build log
  // says "The bundle cannot be published." and nothing a person can act on.
  // The order's policy without the keys its delete acts through: the
  // server judges a bundle before it compares the version it replaces.
  test("lists a refused bundle's problems", async () => {
    const withoutCascades: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { bundle?: { policy: { cascades?: unknown } } }
      if (body.bundle !== undefined) delete body.bundle.policy.cascades
      return fetch(input, { ...init, body: JSON.stringify(body) })
    }
    const refused = publishDemoForms({ base, token: as('image-build'), fetch: withoutCascades }, [spec('order')])
    await expect(refused).rejects.toThrow(/^order: POST \/v1\/forms\/order\/versions answered 422, not 201: invalid-bundle .+\n {2}policy: .*fk_order_line_order/s)
  })

  // A proxy's error page is not JSON; reading it as JSON would fail with a
  // parser's sentence and lose the status that says what happened.
  test('says the status of an answer that is not JSON', async () => {
    await serving(
      (_request, response) => {
        response.writeHead(502, { 'content-type': 'text/html' })
        response.end('<html><body>Bad gateway</body></html>')
      },
      async (origin) => {
        await expect(publishDemoForms({ base: origin, token: as('image-build') })).rejects.toThrow(/^customer: POST \/v1\/form-proposals answered 502, not 200$/)
      },
    )
  })

  // A server that never comes up, or comes up unwell, fails the build at
  // the deadline rather than never.
  test('gives up on a server whose /health never answers 200', async () => {
    await serving(
      (_request, response) => {
        response.writeHead(503)
        response.end()
      },
      async (origin) => {
        await expect(waitForHealth(origin, { deadlineMs: 300, pollMs: 50 })).rejects.toThrow(`The server at ${origin} did not answer /health within 300 ms.`)
      },
    )
    // And one that never listens: the socket of a server closed already.
    let closed = ''
    await serving(() => {}, async (origin) => {
      closed = origin
    })
    await expect(waitForHealth(closed, { deadlineMs: 300, pollMs: 50 })).rejects.toThrow(`The server at ${closed} did not answer /health within 300 ms.`)
  })

  // A label that says what the generator already says is refused by the
  // server (0030); refused before it is sent, with applyPresentation's reason.
  test("refuses a label the generated form already has", async () => {
    const order = spec('order')
    const proposal = (await call(as('image-build'), '/v1/form-proposals', generationRequest(order))).json as Proposal
    const same: DemoFormSpec = { ...order, lookups: order.lookups.map((lookup) => (lookup.foreignKey === 'fk_order_created_by' ? { ...lookup, label: 'Employee' } : lookup)) }
    expect(() => demoBundle(same, proposal)).toThrow(/^order: the demo's labels do not apply to the generated form: .*equals the base's/)
  })
})

function spec(id: string): DemoFormSpec {
  return DEMO_FORM_SPECS.find((candidate) => candidate.id === id) as DemoFormSpec
}
