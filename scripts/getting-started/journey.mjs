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
 * `description` the ping does not give, so they are null; collect.mjs refuses
 * a record of any other shape, which is how the two writers are held alike.
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
      writeFileSync(join(folder, `${record.script}-${record.engine}-${String(process.pid)}-${String(recorded)}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

/** A write's id as data-client makes one: 32 hex characters, new for every write (0031). */
const writeId = () => randomBytes(16).toString('hex')

/** The admin's half for one form: propose through the writer's account and publish with journey.json's policy. */
async function publish(base, admin, form, journey) {
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
  if (!notes.some((note) => note.subject === field && note.kind === 'access' && note.message.startsWith(`Row-level security applies to this connection on ${table}`))) {
    throw new Error(`${at} the proposal does not note that row-level security applies on ${table}`)
  }
  // The labels the guide's host table names, as the generator wrote them.
  for (const entry of [{ field: 'customer', label: journey.order.customer.label }, ...journey.order.create, journey.order.update]) {
    expectEqual(`${at} the label of ${entry.field}`, generated.model.fields.find((candidate) => candidate.key === entry.field)?.label, entry.label)
  }

  const policy = { version: 1, ...journey.policy }
  policy.fields = fieldsFromOperations(policy, bindings)
  const bundle = { format: 2, connection: form.connection, generation, base: generated, presentation: EMPTY_PRESENTATION, form: generated, bindings, policy, snapshot }
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
  expectEqual(`${at} the customers tenant 1 finds for "${customer.search}"`, options.json.rows.map((option) => option.label), [customer.choose])

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

  // Another tenant: the order does not exist for them, and the writer's
  // row-level security on customer shows that account tenant 1's rows only.
  const hidden = await call(base, 'POST', path('records/read'), { token: tokens.clerk2, body: { record } })
  expectStatus(`${at} tenant 2 reading tenant 1's order`, hidden, 404)
  const theirs = await call(base, 'POST', path(`lookups/${source}/query`), { token: tokens.clerk2, body: { operation: 'create', search: '' } })
  expectStatus(`${at} tenant 2's customer lookup`, theirs, 200)
  expectEqual(`${at} the customers tenant 2 is offered`, theirs.json.rows, [])
  return record
}

/** One engine's journey, admin then clerks. Returns the record tenant 1's clerk created. Throws a sentence naming the engine and the request. */
export async function journeyFor(base, tokens, form, journey) {
  await publish(base, tokens.admin, form, journey)
  return use(base, tokens, form, journey)
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
