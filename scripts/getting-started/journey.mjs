// What the guide's operator does in the studio and on the host page, done over
// HTTP through the composed stack's one origin (0032), with the values
// journey.json holds -- the same file the guide's tables are generated from.
//
// Through the web port only, so every request crosses nginx as the browser's
// would: the proxy's routing, its body limit and the headers it passes are
// in the path. The assertions read status codes and documented response
// fields, nothing else.
//
// The studio's clicks are not repeated here. The studio's journey test and
// browser gate prove it makes exactly the administrator plane's requests this
// file makes (0024); what this file proves is that the composed stack answers
// them, on both engines, through the order form's own account.

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * packages/data-core/src/presentation/types.ts's EMPTY_PRESENTATION, copied
 * because the gate runs from a checkout with nothing installed.
 * steps.test.mjs fails when the two are not deep-equal.
 */
export const EMPTY_PRESENTATION = { version: 1, fields: [], sections: [] }

/**
 * What the studio's "Fill every field from the operations" gives
 * (apps/studio/src/policy-model.ts, fillFromOperations), copied for the same
 * reason: read to whoever may read; write to whoever may create or update,
 * where the form writes the field at all and no row filter pins its column.
 * steps.test.mjs fails when the two disagree.
 */
export function fieldsFromOperations(policy, bindings) {
  const pinned = new Set(policy.rowFilters.map((rule) => rule.column))
  const writers = [...new Set([...policy.operations.create, ...policy.operations.update])]
  const fields = {}
  for (const binding of bindings.fields) {
    const pinnedColumn = binding.kind === 'column' && pinned.has(binding.column)
    const written = binding.writes.create || binding.writes.update
    fields[binding.field] = { read: [...policy.operations.read], write: written && !pinnedColumn ? [...writers] : [] }
  }
  return fields
}

/** The fixture's two tenants: tenant 1 owns Muster AG, tenant 2 another customer the writer's policy hides. */
const TENANTS = { clerk1: '1', clerk2: '2' }

/**
 * Which of the guide's identities a token is, by what the server derived from
 * it (`/v1/whoami`), not by what the gate expects it to hold: an admin role,
 * or the clerk role with tenant 1 or tenant 2. Undefined for anything else.
 */
export function classify(identity, { adminRoles, clerkRole }) {
  const roles = identity?.actor?.roles ?? []
  if (roles.some((role) => adminRoles.includes(role))) return 'admin'
  if (!roles.includes(clerkRole)) return undefined
  return Object.keys(TENANTS).find((name) => String(identity?.attributes?.tenant) === TENANTS[name])
}

/** The sentence a missing identity fails with. */
export const MISSING = {
  admin: 'the guide mints no administrator token',
  clerk1: 'the guide mints no clerk token for tenant 1',
  clerk2: 'the guide mints no clerk token for tenant 2',
}

/** A request through the web port. Never prints the token; a refusal's body is the server's own sentence. */
export async function call(base, method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, headers: response.headers, text, json }
}

function expectStatus(where, answer, status) {
  if (answer.status !== status) {
    const said = typeof answer.json?.message === 'string' ? `: ${answer.json.code ?? ''} ${answer.json.message}` : ''
    throw new Error(`${where} answered ${String(answer.status)}, not ${String(status)}${said}`)
  }
}

function expectEqual(where, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

/** A connection of deploy/connections.json, by the id journey.json names. */
function connectionEntry(connection) {
  const entries = JSON.parse(readFileSync(join(repo, 'deploy', 'connections.json'), 'utf8'))
  const entry = entries.find((candidate) => candidate.id === connection)
  if (entry === undefined) throw new Error(`deploy/connections.json has no connection ${connection}, which journey.json names`)
  return entry
}

/** The account each connection logs in as, from deploy/connections.json: what the snapshot must say it saw. */
function connectionUser(connection) {
  return connectionEntry(connection).user
}

/**
 * The composed database behind `form`'s connection, as the release report
 * records every server a run talked to (0035): its version as the product's
 * own adapter reports it, through the administrator plane's connection test,
 * and its image from compose's resolved configuration (`config`). The
 * record has data-fixtures' shape, whose `updateLevel`, `edition` and
 * `description` the ping does not give, so they are null, and whose
 * `compatibility` is the level the test answers for the SQL Server database
 * the connection reaches (0068), null for PostgreSQL; collect.mjs refuses a
 * record of any other shape, which is how the two writers are held alike.
 */
export async function composedServer(base, admin, form, config) {
  const at = `${form.connection}:`
  const answer = await call(base, 'POST', `/v1/connections/${form.connection}/test`, { token: admin })
  expectStatus(`${at} POST /v1/connections/${form.connection}/test`, answer, 200)
  const service = connectionEntry(form.connection).host
  const image = config.services?.[service]?.image
  if (typeof image !== 'string') throw new Error(`${at} compose's configuration names no image for the service ${service} the connection reaches`)
  return {
    engine: answer.json.kind,
    image,
    version: answer.json.version,
    updateLevel: null,
    edition: null,
    description: null,
    compatibility: answer.json.compatibility ?? null,
    caller: 'scripts/getting-started.mjs',
    script: 'getting-started',
    at: new Date().toISOString(),
  }
}

/** Numbers this process's records, as data-fixtures numbers its own. */
let recorded = 0

/** Writes `record` where collect.mjs reads a job's records: `<dir>/test-results/servers/`, never over another. */
export function writeServerRecord(record, dir = repo) {
  const folder = join(dir, 'test-results', 'servers')
  mkdirSync(folder, { recursive: true })
  for (;;) {
    recorded += 1
    try {
      writeFileSync(join(folder, `${record.script}-${record.engine}-${String(process.pid)}-${String(recorded)}.json`), `${JSON.stringify(record, null, 2)}\n`, {
        flag: 'wx',
      })
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

/** A write's id as data-client makes one: 32 hex characters, new for every write (0031). */
const writeId = () => randomBytes(16).toString('hex')

/** The admin's half for one form: propose through the writer's account and publish with journey.json's policy, or `policyOf`'s. */
async function publish(base, admin, form, journey, policyOf = (policy) => policy) {
  const at = `${form.connection}:`
  const connections = await call(base, 'GET', '/v1/connections', { token: admin })
  expectStatus(`${at} GET /v1/connections`, connections, 200)
  for (const entry of journey.forms) {
    if (!connections.json.connections.includes(entry.connection)) throw new Error(`${at} GET /v1/connections does not list ${entry.connection}`)
  }

  const request = {
    connection: form.connection,
    root: form.root,
    formId: form.formId,
    title: form.title,
    lookups: form.lookups,
    pinned: form.pinned,
    ...(form.versionColumn === undefined ? {} : { versionColumn: form.versionColumn }),
  }
  const proposal = await call(base, 'POST', '/v1/form-proposals', { token: admin, body: request })
  expectStatus(`${at} POST /v1/form-proposals`, proposal, 200)
  const { form: generated, bindings, snapshot, generation, notes } = proposal.json
  expectEqual(`${at} the account the proposal's snapshot saw`, snapshot.account.user, connectionUser(form.connection))

  // The sentence the guide's section 4 says about what the generator chose (0027).
  const createOnly = bindings.fields.find((binding) => binding.field === journey.generator.createOnly)
  expectEqual(`${at} what the proposal writes ${journey.generator.createOnly} on`, createOnly?.writes, { create: true, update: false })
  const { field, table } = journey.generator.rowLevelSecurity
  if (
    !notes.some(
      (note) => note.subject === field && note.kind === 'access' && note.message.startsWith(`Row-level security applies to this connection on ${table}`),
    )
  ) {
    throw new Error(`${at} the proposal does not note that row-level security applies on ${table}`)
  }
  // The labels the guide's host table names, as the generator wrote them.
  for (const entry of [{ field: 'customer', label: journey.order.customer.label }, ...journey.order.create, journey.order.update]) {
    expectEqual(`${at} the label of ${entry.field}`, generated.model.fields.find((candidate) => candidate.key === entry.field)?.label, entry.label)
  }

  const policy = policyOf({ version: 1, ...journey.policy })
  policy.fields = fieldsFromOperations(policy, bindings)
  const bundle = {
    format: 2,
    connection: form.connection,
    generation,
    base: generated,
    presentation: EMPTY_PRESENTATION,
    form: generated,
    bindings,
    policy,
    snapshot,
  }
  const published = await call(base, 'POST', `/v1/forms/${form.formId}/versions`, { token: admin, body: { expectedBase: null, bundle } })
  expectStatus(`${at} POST /v1/forms/${form.formId}/versions`, published, 201)
}

/** The clerks' half: what the guide's section 5 does on the host page, and what another tenant cannot. */
async function use(base, tokens, form, journey) {
  const at = `${form.connection}:`
  const path = (rest) => `/v1/forms/${form.formId}/${rest}`
  const definition = await call(base, 'GET', `/v1/forms/${form.formId}`, { token: tokens.clerk1 })
  expectStatus(`${at} GET /v1/forms/${form.formId}`, definition, 200)
  const source = definition.json.form.model.fields.find((candidate) => candidate.key === 'customer')?.optionsSource
  if (typeof source !== 'string') throw new Error(`${at} the published form's customer field names no options source`)

  const { customer } = journey.order
  const options = await call(base, 'POST', path(`lookups/${source}/query`), { token: tokens.clerk1, body: { operation: 'create', search: customer.search } })
  expectStatus(`${at} the customer lookup for "${customer.search}"`, options, 200)
  expectEqual(
    `${at} the customers tenant 1 finds for "${customer.search}"`,
    options.json.rows.map((option) => option.label),
    [customer.choose],
  )

  const answers = { customer: options.json.rows[0].token, ...Object.fromEntries(journey.order.create.map((entry) => [entry.field, entry.value])) }
  const id = writeId()
  const created = await call(base, 'POST', path('records/create'), { token: tokens.clerk1, body: { answers }, headers: { 'formancy-write-id': id } })
  expectStatus(`${at} records/create`, created, 201)
  const { record, version } = created.json

  // The browser resends a write whose connection closed (0031); the server
  // answers the resend with the first answer only if the proxy passes the
  // write id through. A second record here is a write applied twice.
  const resent = await call(base, 'POST', path('records/create'), { token: tokens.clerk1, body: { answers }, headers: { 'formancy-write-id': id } })
  expectStatus(`${at} records/create sent again with its write id`, resent, 201)
  expectEqual(`${at} the record a create sent again with its write id names`, resent.json.record, record)

  const read = await call(base, 'POST', path('records/read'), { token: tokens.clerk1, body: { record } })
  expectStatus(`${at} records/read`, read, 200)
  for (const entry of journey.order.create.filter((candidate) => candidate.stored !== undefined)) {
    expectEqual(`${at} ${entry.field} as stored`, read.json.answers[entry.field], entry.stored)
  }

  const change = { record, version, answers: { ...read.json.answers, [journey.order.update.field]: journey.order.update.value } }
  const saved = await call(base, 'POST', path('records/update'), { token: tokens.clerk1, body: change, headers: { 'formancy-write-id': writeId() } })
  expectStatus(`${at} records/update`, saved, 200)
  const stale = await call(base, 'POST', path('records/update'), { token: tokens.clerk1, body: change, headers: { 'formancy-write-id': writeId() } })
  expectStatus(`${at} records/update at the version before the save`, stale, 409)
  expectEqual(`${at} the code of an update at the version before the save`, stale.json?.code, 'stale')

  // A page of the orders, as a host's grid asks for one (0044): tenant 1's
  // holds the order just created, and tenant 2's does not.
  const listed = async (token) => {
    const page = await call(base, 'POST', path('records/list'), { token, body: { sort: [{ field: 'order_date', direction: 'desc' }] } })
    expectStatus(`${at} records/list`, page, 200)
    return page.json.rows.map((row) => row.record)
  }
  if (!(await listed(tokens.clerk1)).includes(record)) throw new Error(`${at} tenant 1's list of orders does not hold the order tenant 1 created`)

  // Another tenant: the order does not exist for them, and the writer's
  // row-level security on customer shows that account tenant 1's rows only.
  if ((await listed(tokens.clerk2)).includes(record)) throw new Error(`${at} tenant 2's list of orders holds tenant 1's order`)
  await exportOrders(base, tokens, form.formId, record, definition.json.form.model.fields.find((candidate) => candidate.key === 'id')?.label, at)
  const hidden = await call(base, 'POST', path('records/read'), { token: tokens.clerk2, body: { record } })
  expectStatus(`${at} tenant 2 reading tenant 1's order`, hidden, 404)
  const theirs = await call(base, 'POST', path(`lookups/${source}/query`), { token: tokens.clerk2, body: { operation: 'create', search: '' } })
  expectStatus(`${at} tenant 2's customer lookup`, theirs, 200)
  expectEqual(`${at} the customers tenant 2 is offered`, theirs.json.rows, [])
  return record
}

/**
 * The cells under `header` in a CSV file's text, quotes taken off and a
 * doubled quote made one: RFC 4180, each record ended by CRLF, after a
 * byte-order mark -- or with none, since `fetch`'s text() takes it off.
 * Exported for journey.test.mjs.
 */
export function csvColumn(text, header) {
  const body = text.startsWith('﻿') ? text.slice(1) : text
  const records = []
  let cells = []
  let cell = ''
  let quoted = false
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at]
    if (quoted && char === '"' && body[at + 1] === '"') {
      cell += '"'
      at += 1
    } else if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') {
      cells.push(cell)
      cell = ''
    } else if (!quoted && char === '\r' && body[at + 1] === '\n') {
      records.push([...cells, cell])
      cells = []
      cell = ''
      at += 1
    } else cell += char
  }
  const index = (records[0] ?? []).indexOf(header)
  if (index < 0) throw new Error(`the file has no column headed ${header}`)
  return records.slice(1).map((record) => record[index])
}

/**
 * The orders as one CSV file each tenant's clerk downloads (0079), over
 * HTTP through the proxy: tenant 1's file holds the order tenant 1 created,
 * in the column the form's id field heads, and tenant 2's does not -- the
 * row filter a list has, on a route that reads every page. Exported for
 * journey.test.mjs.
 */
export async function exportOrders(base, tokens, formId, record, idHeader, at) {
  if (typeof idHeader !== 'string') throw new Error(`${at} the published form's id field has no label to head its column`)
  const id = record.slice(record.indexOf(':') + 1)
  const ids = async (token, who) => {
    const file = await call(base, 'POST', `/v1/forms/${formId}/records/export`, { token, body: {}, headers: { accept: 'text/csv, application/json' } })
    expectStatus(`${at} records/export as ${who}`, file, 200)
    const type = file.headers.get('content-type') ?? 'none'
    if (!type.startsWith('text/csv')) throw new Error(`${at} records/export as ${who} answered ${type}, not text/csv`)
    return csvColumn(file.text, idHeader)
  }
  if (!(await ids(tokens.clerk1, 'tenant 1')).includes(id)) throw new Error(`${at} tenant 1's file of orders does not hold the order tenant 1 created`)
  if ((await ids(tokens.clerk2, 'tenant 2')).includes(id)) throw new Error(`${at} tenant 2's file of orders holds tenant 1's order`)
}

/**
 * A delete of an order with what it reaches (0051), on a second form over
 * the same table: journey.json's policy, delete granted to the clerks, and
 * every key a delete of an order acts through named in `cascades` -- its
 * lines and deliveries, and the deliveries' parcels. The order is the
 * fixture's own, tenant 1's, which has a line, three deliveries and two
 * parcels, so the delete reaches rows in every one of those tables. The
 * guide's own form stays as the studio publishes it, which has no delete
 * roles to choose yet, and the order the journey created stays for the
 * start after `down`. Tenant 1's clerk reads the order, tenant 2's is told
 * 404 for its delete, tenant 1's deletes it, and it is then not found.
 * Exported for journey.test.mjs.
 */
export async function deletion(base, tokens, form, journey) {
  const at = `${form.connection}:`
  const deleting = { ...form, formId: `${form.formId}${journey.deleting.formSuffix}` }
  await publish(base, tokens.admin, deleting, journey, (policy) => ({
    ...policy,
    operations: { ...policy.operations, delete: [...policy.operations.read] },
    cascades: journey.deleting.cascades,
  }))
  const definition = await call(base, 'GET', `/v1/forms/${deleting.formId}`, { token: tokens.clerk1 })
  expectStatus(`${at} GET /v1/forms/${deleting.formId}`, definition, 200)
  if (!definition.json.operations.includes('delete')) throw new Error(`${at} ${deleting.formId} does not offer tenant 1's clerk delete`)
  expectEqual(`${at} what a delete of an order on ${deleting.formId} also does`, definition.json.deleting, { cascades: true, clears: false, restricted: false })

  await deleteOrder(base, tokens, deleting.formId, journey.deleting.order, at)
}

/**
 * The clerks' half of `deletion`, over HTTP: tenant 1's clerk reads the
 * order for the version a delete names, tenant 2's delete of it is not
 * found, tenant 1's deletes it -- answered with its token and nothing of it
 * -- and reading it again is not found. Exported for journey.test.mjs.
 */
export async function deleteOrder(base, tokens, formId, record, at) {
  const path = (rest) => `/v1/forms/${formId}/${rest}`
  const read = await call(base, 'POST', path('records/read'), { token: tokens.clerk1, body: { record } })
  expectStatus(`${at} reading the order on ${formId}`, read, 200)
  const { version } = read.json
  const theirs = await call(base, 'POST', path('records/delete'), {
    token: tokens.clerk2,
    body: { record, version },
    headers: { 'formancy-write-id': writeId() },
  })
  expectStatus(`${at} tenant 2 deleting tenant 1's order`, theirs, 404)
  const deleted = await call(base, 'POST', path('records/delete'), {
    token: tokens.clerk1,
    body: { record, version },
    headers: { 'formancy-write-id': writeId() },
  })
  expectStatus(`${at} records/delete of tenant 1's order`, deleted, 200)
  expectEqual(`${at} what records/delete answered`, deleted.json, { record, deleted: true })
  const gone = await call(base, 'POST', path('records/read'), { token: tokens.clerk1, body: { record } })
  expectStatus(`${at} reading the order tenant 1 deleted`, gone, 404)
}

/** One engine's journey, admin then clerks, then a delete. Returns the record tenant 1's clerk created and kept. Throws a sentence naming the engine and the request. */
export async function journeyFor(base, tokens, form, journey) {
  await publish(base, tokens.admin, form, journey)
  const record = await use(base, tokens, form, journey)
  await deletion(base, tokens, form, journey)
  return record
}

/** One request with its target exactly as written, on a connection of its own: node:http sends the path it is given, where fetch's URL parser may rewrite one. */
function asWritten(base, method, target) {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: hostname, port, method, path: target, headers: { accept: 'application/json' }, agent: false, timeout: 60_000 },
      (incoming) => {
        let text = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk) => (text += chunk))
        incoming.on('end', () => {
          let json
          try {
            json = JSON.parse(text)
          } catch {
            json = undefined
          }
          resolve({ status: incoming.statusCode, json })
        })
      },
    )
    outgoing.on('timeout', () => outgoing.destroy(new Error(`${method} ${target} had no answer within 60 seconds`)))
    outgoing.on('error', reject)
    outgoing.end()
  })
}

/**
 * What a proxy in front of the stack -- the Cloudflare guide's tunnel --
 * relies on, through the web port (0037): the server's answers say
 * `Cache-Control: no-store`, a published form's and a refusal's, through
 * nginx, whose own Cache-Control is empty for /v1/; and a path that is not
 * plain, sent as written, is the server's 400 path-not-plain, which shows
 * nginx forwards it as sent and the server refuses it before any route's
 * work. Problems, as sentences.
 */
export async function proxyProblems(base, token, formId) {
  const problems = []
  for (const [what, answer] of [
    [`GET /v1/forms/${formId}`, await call(base, 'GET', `/v1/forms/${formId}`, { token })],
    ['GET /v1/whoami without a token', await call(base, 'GET', '/v1/whoami')],
  ]) {
    const value = answer.headers.get('cache-control')
    if (value !== 'no-store') problems.push(`${what} answered ${String(answer.status)} with Cache-Control ${value ?? 'none'}, not no-store`)
  }
  const target = '/v1/forms/a/versions/..%2F..%2Fb'
  const refused = await asWritten(base, 'GET', target)
  if (refused.status !== 400 || refused.json?.code !== 'path-not-plain') {
    problems.push(
      `GET ${target}, sent as written, answered ${String(refused.status)} ${String(refused.json?.code)}, not 400 path-not-plain: nginx did not forward it as sent, or the server routed it`,
    )
  }
  return problems
}

/**
 * What the guide's section 6 promises of a start after `down`: the published
 * form still there, and the order the journey created and saved still there,
 * as it was saved -- the store volume and the databases' volumes kept. That
 * the tokens are still accepted, the secrets kept, the gate asks of each.
 */
export async function stillThere(base, tokens, form, record, journey) {
  const at = `${form.connection}, after the stack was stopped and started again:`
  const definition = await call(base, 'GET', `/v1/forms/${form.formId}`, { token: tokens.clerk1 })
  expectStatus(`${at} GET /v1/forms/${form.formId}`, definition, 200)
  const read = await call(base, 'POST', `/v1/forms/${form.formId}/records/read`, { token: tokens.clerk1, body: { record } })
  expectStatus(`${at} records/read of the order the journey created`, read, 200)
  const { update } = journey.order
  expectEqual(`${at} ${update.field} as the journey saved it`, read.json.answers[update.field], update.value)
  for (const entry of journey.order.create.filter((candidate) => candidate.stored !== undefined)) {
    expectEqual(`${at} ${entry.field} as stored`, read.json.answers[entry.field], entry.stored)
  }
}
