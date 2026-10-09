import { createFormEngine } from '@formancy/core'
import { EDGE_VALUES } from '@formancy/data-fixtures'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { DataClient, Refusal } from './client.js'
import { fieldProblems } from './problems.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A published form's records through the client, on both engines, across real
 * HTTP into the real server and its drivers (0003, 0029). What "stale" is --
 * an application version column on PostgreSQL, rowversion on SQL Server --
 * and whether a decimal comes back exact are database answers, so they are
 * asked of the databases.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

beforeEach(() => {
  plane.sent.length = 0
})

function expectOk<T>(outcome: { ok: true; value: T } | Refusal): T {
  if (!outcome.ok) throw new Error(`expected success, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
  return outcome.value
}

function expectRefusal(outcome: { ok: true } | Refusal): Refusal {
  if (outcome.ok) throw new Error('expected a refusal, got success')
  return outcome
}

/** The source name the published order form gives its customer lookup. */
async function customerSource(client: DataClient, formId: string): Promise<string> {
  const definition = expectOk(await client.form(formId))
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource
  if (source === undefined) throw new Error('the generated order form has no customer lookup')
  return source
}

/** The token of the first customer this client's lookup offers for a search. */
async function customer(client: DataClient, formId: string, search: string): Promise<string> {
  const found = expectOk(await client.query(formId, await customerSource(client, formId), { operation: 'update', search }))
  const row = found.rows[0]
  if (row === undefined) throw new Error(`no customer matches ${search}`)
  return row.token
}

/** The browser's clock, as a host supplies it: the generated form carries logic rules, and the engine reads no ambient clock. */
const capabilities = {
  now: () => Date.now(),
  today: () => new Date().toISOString().slice(0, 10),
  random: () => Math.random(),
}

describe.each(ENGINES)('records on $engine', ({ connection }) => {
  const formId = `${connection}-order`

  // (a) The definition, what this clerk may do and see -- and the token went
  // in the Authorization header and nowhere else. A token in a query string is
  // in every proxy's access log; in a body, in every request dump.
  test('form() returns the published form, its operations and readable fields, with the token only in the header', async () => {
    const definition = expectOk(await plane.client().form(formId))
    expect(definition.form.id).toBe(formId)
    expect(definition.operations).toEqual(['read', 'create', 'update'])
    expect(definition.readable).toEqual(expect.arrayContaining(['customer', 'order_date', 'status', 'amount', 'notes']))
    expect(plane.sent).toHaveLength(1)
    const [sent] = plane.sent
    expect(sent).toMatchObject({ method: 'GET', url: `${plane.base}/v1/forms/${formId}`, body: undefined })
    expect(sent?.headers).toEqual({ authorization: `Bearer ${plane.tokens.clerk}`, accept: 'application/json' })
    expect(sent?.url).not.toContain(plane.tokens.clerk)
  })

  // (b) The server's refusal, passed through: a client that turned 401 into
  // its own words, or into a thrown error, would leave a host unable to tell
  // "sign in again" from "the server is down".
  test('a token the server does not accept is a 401 with the server sentence', async () => {
    const refused = expectRefusal(await plane.client('not-a-token').form(formId))
    expect(refused).toEqual({ ok: false, status: 401, code: 'unauthenticated', message: 'A valid host token is required.' })
  })

  // The token is asked for on every request, so a host whose session renews
  // the token is never answered for the old one. A client that read it once
  // at construction would keep acting as the first person signed in.
  test('the token is read once per request', async () => {
    let held = plane.tokens.clerk
    let asked = 0
    const client = plane.client(() => {
      asked += 1
      return held
    })
    const source = await customerSource(client, formId)
    const mine = expectOk(await client.query(formId, source, { operation: 'create', search: '' }))
    held = plane.tokens.otherClerk
    const theirs = expectOk(await client.query(formId, source, { operation: 'create', search: '' }))
    expect(asked).toBe(3)
    expect(mine.rows.map((row) => row.label)).toEqual(['Muster AG'])
    expect(theirs.rows.map((row) => row.label)).toEqual(['Other Tenant GmbH'])
  })

  // (c) and (d): create at the largest amount numeric(18,4) holds, read it
  // back digit for digit, save a change and get the stored spelling and a new
  // version, then have a save from the old version refused as stale -- with
  // the database still holding the first save. Each request's body is exactly
  // what its route defines: nothing a host or a document could add rides along.
  test('create, read back exactly, update, and a stale update is refused', async () => {
    const client = plane.client()
    const answers = { customer: await customer(client, formId, 'Muster'), order_date: EDGE_VALUES.orderDate, status: 'placed', amount: EDGE_VALUES.largestAmount, notes: 'from the client suite' }
    plane.sent.length = 0
    const created = expectOk(await client.create(formId, answers))
    expect(created.record).toEqual(expect.any(String))
    expect(JSON.parse(plane.sent[0]?.body ?? 'null')).toEqual({ answers })
    const record = created.record ?? ''

    const read = expectOk(await client.read(formId, record))
    expect(read.answers).toMatchObject(answers)
    expect(read.version).toBe(created.version)
    expect(JSON.parse(plane.sent[1]?.body ?? 'null')).toEqual({ record })

    const version = read.version ?? ''
    const saved = expectOk(await client.update(formId, { record, version, answers: { ...read.answers, amount: '12.5' } }))
    expect(saved.answers['amount']).toBe('12.5000')
    expect(saved.version).not.toBe(version)
    expect(Object.keys(JSON.parse(plane.sent[2]?.body ?? '{}') as object)).toEqual(['record', 'version', 'answers'])

    const stale = expectRefusal(await client.update(formId, { record, version, answers: { ...read.answers, amount: '13' } }))
    expect(stale).toEqual({ ok: false, status: 409, code: 'stale', message: 'The record changed since it was read. Reload it, review the changes, and save again.' })
    expect(expectOk(await client.read(formId, record)).answers['amount']).toBe('12.5000')
  })

  // A record this clerk cannot see does not exist for them: tenant 1's seeded
  // order, read by tenant 2's clerk. The server says 404 and the client passes
  // it on as such -- not as a transport failure, and not as "forbidden", which
  // would say the record is there. An invented token is no such case: `k1:1`
  // is the order the create case has just made on PostgreSQL.
  test('a record that is not there is a 404 with the server sentence', async () => {
    const tenantOnesOrder = 'k1:9007199254740993'
    expectOk(await plane.client().read(formId, tenantOnesOrder))
    const missing = expectRefusal(await plane.client(plane.tokens.otherClerk).read(formId, tenantOnesOrder))
    expect(missing).toEqual({ ok: false, status: 404, code: 'not-found', message: 'No such record.' })
  })

  // (e) Plan step 6 at the wire: tenant 2's customer, found through tenant
  // 2's own lookup, offered for tenant 1's order. The server refuses it on the
  // field, and fieldProblems turns that into the sentence a renderer prints
  // beside Customer -- not the code, which a renderer would print verbatim.
  test("another tenant's customer is a 422 on the customer field", async () => {
    const client = plane.client()
    const mine = await customer(client, formId, 'Muster')
    const theirs = await customer(plane.client(plane.tokens.otherClerk), formId, '')
    const created = expectOk(await client.create(formId, { customer: mine, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '1', notes: null }))
    const refused = expectRefusal(
      await client.update(formId, { record: created.record ?? '', version: created.version ?? '', answers: { ...created.answers, customer: theirs } }),
    )
    expect(refused).toMatchObject({ status: 422, code: 'invalid-values', fieldErrors: [{ field: 'customer', code: 'not-an-option' }] })
    expect(fieldProblems(refused)).toEqual({ customer: ['This is not one of the options this form offers.'] })
    expect(expectOk(await client.read(formId, created.record ?? '')).answers['customer']).toBe(mine)
  })

  // (i) The engine and the server agree on what an answer looks like. The
  // headless engine is what both renderers run: built from the published form
  // with a read record as its initial value, it must submit something the
  // server accepts and stores exactly. A server that read amounts as numbers,
  // or an engine that coerced the token, would pass every other case here.
  test('a headless engine round trip saves exactly', async () => {
    const client = plane.client()
    const definition = expectOk(await client.form(formId))
    const created = expectOk(
      await client.create(formId, { customer: await customer(client, formId, 'Muster'), order_date: EDGE_VALUES.orderDate, status: 'draft', amount: '5', notes: 'engine' }),
    )
    const read = expectOk(await client.read(formId, created.record ?? ''))
    const engine = createFormEngine({ schema: definition.form, formId: `${formId}-headless`, initialValue: read.answers, capabilities })
    engine.setValue(['amount'], EDGE_VALUES.largestAmount)
    const submitted = engine.submit()
    expect(submitted.ok, JSON.stringify(submitted.errors)).toBe(true)
    const saved = expectOk(await client.update(formId, { record: read.record ?? '', version: read.version ?? '', answers: engine.value() as Record<string, unknown> }))
    expect(saved.answers).toEqual({ ...read.answers, amount: EDGE_VALUES.largestAmount })
    expect(expectOk(await client.read(formId, read.record ?? '')).answers).toEqual(saved.answers)
  })
})
