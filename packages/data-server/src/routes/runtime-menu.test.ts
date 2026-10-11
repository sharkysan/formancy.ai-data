import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, generateForm } from '@formancy/data-core'
import type { ColumnMeta, FormPolicy, NormalizedType, ObjectRef } from '@formancy/data-core'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * `GET /v1/forms` (0045): the forms a person may read, and the children
 * under each, from the published bundles. Who is told of which form is the
 * policy's decision in the core (`menuForm` and `formMenu`, menu.test.ts);
 * what is under test here is what the route reads to decide it -- every
 * bundle the store has, each validated as every read is (0019), bound to a
 * connection the allowlist has, and read alone -- what it says about the
 * forms it leaves out, which is nothing, what it asks the databases, which
 * is nothing, what it answers when the store cannot list, and what the
 * trail says.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })

const SNAPSHOT = createSnapshot({
  kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    {
      ref: ref('order'), kind: 'table', comment: null,
      columns: [col('id', 1, INT32), col('tenant_id', 2, INT32), col('placed', 3, { kind: 'date' }), col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' })],
      primaryKey: { name: 'pk_order', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
    {
      ref: ref('line'), kind: 'table', comment: null,
      columns: [col('order_id', 1, INT32), col('line_no', 2, INT32), col('quantity', 3, INT32), col('row_version', 4, { kind: 'rowversion' }, { generated: 'rowversion' })],
      primaryKey: { name: 'pk_line', columns: ['order_id', 'line_no'] }, uniqueKeys: [],
      foreignKeys: [{ name: 'fk_line_order', columns: ['order_id'], references: { table: ref('order'), columns: ['id'] }, onUpdate: 'no-action', onDelete: 'cascade', enforced: true, validated: true }],
      checks: [], rowSecurity: 'none',
    },
  ],
})

const RW = { read: ['clerk'], write: ['clerk'] }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
/** Clerks keep their tenant's orders; a buyer may read them too, and no line. */
const ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'buyer'], create: ['clerk'], update: ['clerk'] },
  fields: { id: { read: ['clerk', 'buyer'], write: [] }, tenant_id: { read: ['clerk'], write: [] }, placed: RW },
  rowFilters: TENANT,
  lookups: {},
}
/** An order's lines, through their order (0043). */
const LINE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { order: RW, line_no: RW, quantity: RW },
  rowFilters: [],
  lookups: { order: TENANT },
  through: ['order'],
}
/** A form only managers read; a clerk may only create with it, which the menu, opening grids, does not offer. */
const SECRET_POLICY: FormPolicy = { ...ORDER_POLICY, operations: { read: ['manager'], create: ['clerk'], update: [] } }

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } }
    : token === 'buyer' ? { ok: true, identity: { actor: { id: 'b', roles: ['buyer'] }, attributes: { tenant: '1' } } }
    : token === 'stranger' ? { ok: true, identity: { actor: { id: 's', roles: [] }, attributes: { tenant: '1' } } }
      : { ok: false, reason: 'bad' }

let root: string
let store: ConfigurationStore
let opened: string[]
let events: RuntimeAuditEvent[]
let lines: Array<Record<string, unknown>>
let app: FastifyInstance
let order: PublishedBundle

/** A registry that records every connection asked for, and answers none: the menu has no business with a database. */
function registry(): ConnectionRegistry {
  return {
    ids: () => ['erp'],
    scope: () => ({ schemas: ['sales'] }),
    open: async (id) => {
      opened.push(id)
      throw new Error('the menu asks no database')
    },
    close: async () => {},
  }
}

beforeEach(async () => {
  opened = []
  events = []
  lines = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-menu-'))
  store = createFileConfigurationStore(root)
  const generated = generateForm(SNAPSHOT, { connection: 'erp', root: ref('order'), formId: 'order', title: 'Order', lookups: [], pinned: ['tenant_id'] })
  order = { format: 1, connection: 'erp', form: generated.form, bindings: generated.bindings, policy: ORDER_POLICY, snapshot: SNAPSHOT }
  await store.publish('order', null, order)
  const line = generateForm(SNAPSHOT, { connection: 'erp', root: ref('line'), formId: 'order-line', title: 'Order line', lookups: [{ foreignKey: 'fk_line_order', display: ['placed'] }] })
  await store.publish('order-line', null, { ...order, form: line.form, bindings: line.bindings, policy: LINE_POLICY })
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  app = await createDataServer({
    verifyIdentity,
    logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } },
    runtime: { registry: registry(), store, audit: { sink, now: () => '2026-10-11T12:00:00.000Z' } },
  })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const menu = (token: string) => app.inject({ method: 'GET', url: '/v1/forms', headers: { authorization: `Bearer ${token}` } })

describe('the menu route', () => {
  // A clerk is told of the order form and its lines, the lines under the
  // order as its child; a buyer, who may read orders and no line, of the
  // order alone; a person the policy grants nothing, of nothing. None of it
  // opens a connection: a menu over every form is no statement, and a
  // database that is down hides no form from it.
  test('names the forms this person may read, with their children, and asks no database', async () => {
    const clerk = await menu('clerk')
    expect(clerk.statusCode, clerk.body).toBe(200)
    expect(clerk.json()).toEqual({
      forms: [
        { id: 'order', title: 'Order', operations: ['read', 'create', 'update'], children: [{ form: 'order-line', field: 'order' }] },
        { id: 'order-line', title: 'Order line', operations: ['read', 'create', 'update'], children: [] },
      ],
    })
    expect((await menu('buyer')).json()).toEqual({ forms: [{ id: 'order', title: 'Order', operations: ['read'], children: [] }] })
    expect((await menu('stranger')).json()).toEqual({ forms: [] })
    expect((await app.inject({ method: 'GET', url: '/v1/forms' })).statusCode).toBe(401)
    expect(opened).toEqual([])
  })

  // The answer says nothing about a form the person may not read: not its
  // id, not its title, not that it exists, nor how many there are. So
  // publishing one, and a version more of it, leaves a clerk's answer the
  // same to the byte. Watched failing with the core's read check removed:
  // the managers' form was named, with the create the clerk holds on it.
  test('is the same to the byte when a form this person may not read is published', async () => {
    const before = (await menu('clerk')).body
    await store.publish('secret', null, { ...order, policy: SECRET_POLICY })
    await store.publish('secret', 1, { ...order, policy: SECRET_POLICY })
    await store.publish('a-secret', null, { ...order, policy: SECRET_POLICY })
    expect((await menu('clerk')).body).toBe(before)
  })

  // A version edited by hand is never served (0019), and here it is left
  // out rather than answered 500: one bad file would otherwise hide every
  // form from everybody. The log says which and why; the person is told
  // nothing. The same for a file that is not JSON at all, which the store
  // throws on rather than return. Watched failing with the menu loading
  // each form as a form's route does, which answers its 500: the whole
  // menu was 500.
  test('leaves out a version that no longer validates, or does not parse, and says so in the log', async () => {
    await store.publish('edited', null, { ...order, snapshot: { ...SNAPSHOT, fingerprint: 'sha256:edited by hand' } })
    await mkdir(join(root, 'mangled'))
    await writeFile(join(root, 'mangled', '1.json'), '{ "format": 1, ', 'utf8')
    const answer = await menu('clerk')
    expect(answer.statusCode, answer.body).toBe(200)
    expect(answer.json().forms.map((entry: { id: string }) => entry.id)).toEqual(['order', 'order-line'])
    expect(lines).toContainEqual(expect.objectContaining({ form: 'edited', version: 1, msg: 'a published bundle failed validation' }))
    expect(lines).toContainEqual(expect.objectContaining({ form: 'mangled', error: expect.stringMatching(/1\.json is not valid JSON/), msg: 'a published form cannot be read, and is not served' }))
  })

  // A hand edit that is valid JSON can leave a part where the check, or
  // the menu, reads another shape: a list of bindings that is null, which
  // the check took apart and threw on; an identity that is a string, which
  // the check passes and the menu cannot compare; a version that is a
  // directory, which the store throws on. Each is left out for its form
  // alone, the log naming it: one damaged file is not a 500 for everybody,
  // nor an answer that names a form the person may not read or the store's
  // path. Watched failing on the code before: the menu was 500, its body
  // "Cannot read properties of null (reading 'map')", "names.map is not a
  // function" and "EISDIR: illegal operation on a directory, read".
  test('leaves out a version it cannot read or take apart, whatever the person may read', async () => {
    await store.publish('a-fields', null, { ...order, policy: SECRET_POLICY, bindings: { ...order.bindings, fields: null } })
    await store.publish('b-identity', null, { ...order, bindings: { ...order.bindings, identity: 'id' } })
    await mkdir(join(root, 'c-directory', '1.json'), { recursive: true })
    const answer = await menu('clerk')
    expect(answer.statusCode, answer.body).toBe(200)
    expect(answer.json().forms.map((entry: { id: string }) => entry.id)).toEqual(['order', 'order-line'])
    for (const form of ['a-fields', 'b-identity', 'c-directory']) expect(lines).toContainEqual(expect.objectContaining({ form, level: 50 }))
  })

  // A form bound to a connection the allowlist no longer has is refused
  // when opened (`unknown-connection`), so naming it would offer a form
  // nobody can open. The allowlist is the server's own, and saying so asks
  // no database. Watched failing: the clerk was told of `archived`.
  test('leaves out a form bound to a connection the allowlist does not have', async () => {
    await store.publish('archived', null, { ...order, connection: 'archive' })
    expect((await menu('clerk')).json().forms.map((entry: { id: string }) => entry.id)).toEqual(['order', 'order-line'])
    expect(lines).toContainEqual(expect.objectContaining({ form: 'archived', connection: 'archive', msg: 'a published form names a connection the allowlist does not have, and is not served' }))
    expect(opened).toEqual([])
  })

  // A store that cannot list its forms at all -- its directory unreadable
  // -- leaves the menu nothing to answer from: a 500 that says so, and
  // names neither the store's path nor the error, which the log keeps.
  // Watched failing: Fastify's own 500 carried the error's message, the
  // store's path in it.
  test('is a 500 naming no path when the store cannot list its forms', async () => {
    const failing: ConfigurationStore = {
      ...store,
      list: async () => {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${root}'`), { code: 'EACCES' })
      },
    }
    const server = await createDataServer({
      verifyIdentity,
      logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } },
      runtime: { registry: registry(), store: failing },
    })
    try {
      const answer = await server.inject({ method: 'GET', url: '/v1/forms', headers: { authorization: 'Bearer clerk' } })
      expect(answer.statusCode).toBe(500)
      expect(answer.json()).toEqual({ code: 'store-unavailable', message: 'The forms cannot be listed now.' })
      expect(answer.body).not.toContain(root)
      expect(lines).toContainEqual(expect.objectContaining({ error: expect.stringContaining(root), msg: 'the configuration store cannot list its forms' }))
    } finally {
      await server.close()
    }
  })

  // One event per request, under its own name; it addresses no form, so it
  // names none, no version and no record (0023).
  test("is audited as form-list, naming no form, version or record", async () => {
    await menu('clerk')
    expect(events).toEqual([
      { at: '2026-10-11T12:00:00.000Z', plane: 'runtime', actor: 'c', operation: 'form-list', form: null, formVersion: null, status: 200, outcome: 'ok', record: null },
    ])
  })
})
