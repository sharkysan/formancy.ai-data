import { answerBytes, EDGE_VALUES } from '@formancy/data-fixtures'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataClient } from './client.js'
import type { DataClient, Refusal } from './client.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Lossy, Plane } from './test-plane.js'
import { isUnknownWrite } from './writes.js'
import type { UnknownWrite } from './writes.js'

/*
 * A write whose answer the database sent and the network lost, through the
 * client, on both engines (0031): across real HTTP into the real server, its
 * drivers and pools, through a TCP hop in front of each database that drops
 * the answer carrying the write's marker. The client must report what the
 * server said -- unknown, from the database, naming what was addressed --
 * send it once, and reconcile it by reading, never by sending it again.
 *
 * As in data-server's e2e-lost-answer: the hop matching the answer is not
 * proof of a commit (P2b), so the owner's own connection is polled until the
 * write is visible before the connection that carried it is cut.
 */

let plane: Plane
let lossy: Lossy

beforeAll(async () => {
  plane = await startPlane({ hops: true })
  if (plane.lossy === undefined) throw new Error('the plane started without its hops')
  lossy = plane.lossy
})

afterAll(async () => {
  await plane?.close()
})

function expectOk<T>(outcome: { ok: true; value: T } | Refusal): T {
  if (!outcome.ok) throw new Error(`expected success, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
  return outcome.value
}

function expectUnknown(outcome: { ok: boolean }): UnknownWrite {
  if (!isUnknownWrite(outcome)) throw new Error(`expected an unknown write, got ${JSON.stringify(outcome)}`)
  return outcome
}

/** `promise`, or a failure saying what never happened. */
async function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), 20_000)))
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Polls until the owner sees exactly one order with these notes: committed, on a connection around the hop. */
async function committed(connection: 'pg' | 'ms', notes: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while ((await lossy.ordersWithNotes(connection, notes)) !== 1) {
    if (Date.now() > deadline) throw new Error(`the write with notes "${notes}" never became visible`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function customer(client: DataClient, formId: string): Promise<string> {
  const definition = expectOk(await client.form(formId))
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const row = expectOk(await client.query(formId, source, { operation: 'create', search: 'Muster' })).rows[0]
  if (row === undefined) throw new Error('no customer to order for')
  return row.token
}

describe.each(ENGINES)('an answer lost after the commit, through the client, on $engine', ({ engine, connection }) => {
  const formId = `${connection}-hop-order`
  const kind = connection === 'pg' ? 'postgres' : 'sqlserver'

  /** Sends `write` with its answer swallowed, cuts once the owner sees it, and says how often the marker reached the database. */
  async function lostAfterCommit<T>(notes: string, write: () => Promise<T>): Promise<{ outcome: T; sent: number }> {
    const hop = lossy.hops[connection]
    const bytes = answerBytes(kind, notes)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = write()
    await bounded(lost.matched, `the marker never appeared in an answer on ${engine}`)
    await committed(connection, notes)
    lost.cut()
    return { outcome: await pending, sent: sent() }
  }

  // The server's 502 reaches the host as an unknown write from the database,
  // naming the record and version the update sent -- not as a refusal, which
  // would be shown as "Not saved" over a change that is stored. Reconciling
  // reads the record and finds it moved on, with the change in it.
  test('an update is unknown from the database, sent once, and reconciles to changed', async () => {
    const client = plane.client()
    const created = expectOk(await client.create(formId, { customer: await customer(client, formId), order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '1', notes: 'before' }))
    const record = created.record ?? ''
    const version = created.version ?? ''
    const notes = `lost through the client ${connection} ${String(Date.now())}`
    const { outcome, sent } = await lostAfterCommit(notes, () => client.update(formId, { record, version, answers: { ...created.answers, notes } }))
    expect(expectUnknown(outcome)).toMatchObject({ status: 502, operation: 'update', record, version, origin: 'database' })
    expect(sent).toBe(1)

    const reconciled = await client.reconcile(formId, expectUnknown(outcome))
    expect(reconciled).toMatchObject({ ok: true, state: 'changed', current: { record, answers: { notes } } })
    expect(await lossy.ordersWithNotes(connection, notes)).toBe(1)
  })

  // An order's key is numbered by the database: the server cannot name the
  // record, and reconciling says nobody here can tell -- without a request,
  // which could only be about some other record. The order exists once.
  test('an order create is unknown with no record, and reconciles to unverifiable without a request', async () => {
    const client = plane.client()
    const notes = `lost create through the client ${connection} ${String(Date.now())}`
    const answers = { customer: await customer(client, formId), order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '2', notes }
    const { outcome, sent } = await lostAfterCommit(notes, () => client.create(formId, answers))
    const unknown = expectUnknown(outcome)
    expect(unknown).toMatchObject({ status: 502, operation: 'create', record: null, version: null, origin: 'database' })
    expect(sent).toBe(1)

    const before = plane.sent.length
    expect(await client.reconcile(formId, unknown)).toEqual({ ok: true, state: 'unverifiable' })
    expect(plane.sent.length).toBe(before)
    expect(await lossy.ordersWithNotes(connection, notes)).toBe(1)
  })

  // What Chromium does below the page when a reused connection closes before
  // any answer: the same request, sent again (measured, 0031). Without the
  // client's write id and the server's answer to it, the order would be
  // stored twice behind the second sending's "Created". Here the browser is
  // a fetch that sends every request twice and hands back the second answer.
  test('a create the browser sends twice is stored once, and the second answer is the first', async () => {
    const twice: typeof fetch = async (input, init) => {
      await plane.fetch(input, init)
      return plane.fetch(input, init)
    }
    const client = createDataClient({ token: () => plane.tokens.clerk, base: plane.base, fetch: twice })
    const notes = `sent twice by the browser ${connection} ${String(Date.now())}`
    const created = expectOk(await client.create(formId, { customer: await customer(client, formId), order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '3', notes }))
    expect(created.answers['notes']).toBe(notes)
    expect(await lossy.ordersWithNotes(connection, notes)).toBe(1)
  })
})
