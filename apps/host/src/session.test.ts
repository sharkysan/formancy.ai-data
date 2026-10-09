import { createDataClient } from '@formancy/data-client'
import type { DataClient, FormRecord, PublishedForm } from '@formancy/data-client'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createSession } from './session.js'
import type { Session } from './session.js'
import { EDGES, ENGINES, holdingWrites, startPlane, TOKENS } from './test-plane.js'
import type { Holding, Plane } from './test-plane.js'

/*
 * What one pane's session does with a save, against the real server on both
 * engines and without a renderer: the decisions D7 of 0029 makes -- what is
 * created, saved, stale, invalid or refused, and what each does to the engine
 * that holds the person's answers. The React and Angular panes only show what
 * this returns, so a renderer cannot be where one of these goes wrong.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

function client(token: string = TOKENS.clerk): DataClient {
  return createDataClient({ token: () => token, fetch: plane.fetch })
}

async function definition(formId: string, from: DataClient = client()): Promise<PublishedForm> {
  const outcome = await from.form(formId)
  if (!outcome.ok) throw new Error(`the form did not open: ${outcome.message}`)
  return outcome.value
}

/** The token of the first customer a search for `search` offers this clerk. */
async function customer(session: Session, search: string): Promise<string> {
  const source = session.sources[session.definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? '']
  if (source === undefined) throw new Error('the order form has no customer source')
  const [first] = await source.resolve({ kind: 'search', query: search, values: [], limit: 10, signal: new AbortController().signal })
  if (first === undefined) throw new Error(`no customer matches ${search}`)
  return first.value
}

/** Fill the session's engine as a person would, and submit it as a renderer does: touched, validated, its value as data. */
function submitted(session: Session, answers: Record<string, unknown>): { ok: boolean; data?: unknown } {
  const { engine } = session.opened()
  for (const [key, value] of Object.entries(answers)) engine.setValue([key], value)
  // The value goes along either way, so it is the `ok` the session obeys.
  return { ok: engine.submit().ok, data: engine.value() }
}

async function stored(formId: string, record: string): Promise<FormRecord> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok) throw new Error(`the record did not read: ${read.message}`)
  return read.value
}

/** A session whose creates and updates are answered only when `holding.answer()` says so. */
async function heldSession(formId: string, renderer: 'react' | 'angular' = 'react'): Promise<{ session: Session; holding: Holding }> {
  const holding = holdingWrites(plane.fetch)
  const held = createDataClient({ token: () => TOKENS.clerk, fetch: holding.fetch })
  const session = createSession({ client: held, formId, definition: await definition(formId, held), renderer })
  session.open()
  return { session, holding }
}

/** Wait until `count` writes are written and held. */
async function writesHeld(holding: Holding, count: number): Promise<void> {
  await vi.waitFor(() => expect(holding.held).toHaveLength(count), { timeout: 15_000 })
}

/**
 * Press Save again and return what the press answered -- or, when it sent a
 * write instead, which is now held and cannot answer until released, say so
 * rather than wait for an answer that will not come.
 */
async function press(session: Session, holding: Holding): Promise<unknown> {
  const before = holding.held.length
  let answered = false
  const sent = vi
    .waitFor(() => {
      if (!answered) expect(holding.held.length).toBeGreaterThan(before)
    }, { timeout: 5_000 })
    .then(() => (answered ? undefined : 'it sent a write'))
  const result = await Promise.race([session.save(submitted(session, {})), sent])
  answered = true
  return result
}

/** How many creates the page has sent for `formId` since `from`. */
function creates(formId: string, from: number): number {
  return plane.sent.slice(from).filter((request) => request.path === `/v1/forms/${formId}/records/create`).length
}

describe.each(ENGINES)('a pane session on $engine', ({ formId, connection }) => {
  // A new record is created, the session then holds its token and version and
  // asks lookups under update's filter -- through the same source map, which
  // in Angular cannot be swapped without a new application. A session that
  // kept 'create' would ask the wrong question of the policy after every
  // first save.
  test('a first save creates, and the session then updates', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'react' })
    session.open()
    expect(session.state()).toEqual({ record: undefined, version: undefined, operation: 'create' })
    const answers = { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '7.5', notes: 'from the session suite' }
    const result = await session.save(submitted(session, answers))
    const { record, version } = session.state()
    expect(result).toEqual({ kind: 'created', message: `Created record ${String(record)}.` })
    expect(record).toMatch(/^k1:/)
    expect(version).toEqual(expect.any(String))
    expect(session.state().operation).toBe('update')

    const sent = plane.sent.length
    await customer(session, 'Muster')
    expect(JSON.parse(plane.sent[sent]?.body ?? '{}')).toMatchObject({ operation: 'update' })
  })

  // The stored spelling is put back into the form the person is looking at:
  // 12.5 is stored as 12.5000 in numeric(18,4), and a form that kept showing
  // 12.5 would disagree with every later read. The engine is kept, not
  // rebuilt, so nothing the renderer holds -- focus, a scroll -- is lost.
  test('a save shows the stored spelling in the same engine, and takes the new version', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'angular' })
    session.open()
    await session.save(submitted(session, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '1' }))
    const { engine } = session.opened()
    const before = session.state().version
    const result = await session.save(submitted(session, { amount: '12.5' }))
    expect(result).toEqual({ kind: 'saved', message: 'Saved.' })
    expect(session.opened().engine).toBe(engine)
    expect(engine.value()).toMatchObject({ amount: '12.5000' })
    expect(session.state().version).not.toBe(before)
    expect((await stored(formId, session.state().record ?? '')).answers['amount']).toBe('12.5000')
  })

  // Plan step 7. Two sessions read the same version; the first save wins and
  // the second is stale. The second engine still holds what the person typed
  // -- a session that reopened the record would throw their work away -- and
  // the database holds the first save, not a merge.
  test('a save from an old version is stale, and keeps the draft', async () => {
    const first = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'react' })
    first.open()
    await first.save(submitted(first, { customer: await customer(first, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '2' }))
    const loaded = await stored(formId, first.state().record ?? '')
    const second = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'angular' })
    second.open(loaded)
    first.open(loaded)

    expect(await first.save(submitted(first, { amount: '3' }))).toEqual({ kind: 'saved', message: 'Saved.' })
    const { engine } = second.opened()
    const stale = await second.save(submitted(second, { amount: '4' }))
    expect(stale).toEqual({ kind: 'stale', message: 'The record changed since it was read. Reload it, review the changes, and save again.' })
    expect(second.opened().engine).toBe(engine)
    expect(engine.value()).toMatchObject({ amount: '4' })
    expect((await stored(formId, loaded.record ?? '')).answers['amount']).toBe('3.0000')

    // Loading the saved record is the one way out, and it discards the draft.
    expect(await second.reload()).toBeNull()
    expect(second.opened().engine).not.toBe(engine)
    expect(second.opened().engine.value()).toMatchObject({ amount: '3.0000' })
  })

  // A selection that stopped being one of the options: the server names the
  // field, and the engine carries its sentence there, where both renderers
  // print it beside Customer and in the error summary. The other answers are
  // untouched.
  test('a refused selection is invalid on the customer field, as the server sentence', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'react' })
    session.open()
    const no = connection === 'pg' ? 7101 : 7102
    await plane.db.insertCustomer(connection, no, `Session Kunde ${String(no)}`)
    const picked = await customer(session, `Session Kunde ${String(no)}`)
    await plane.db.deleteCustomer(connection, no)
    const result = await session.save(submitted(session, { customer: picked, order_date: EDGES.orderDate, status: 'placed', amount: '5' }))
    expect(result).toEqual({ kind: 'invalid', message: 'A selection is not one of the options.' })
    const { engine } = session.opened()
    expect(engine.getFieldSnapshot(['customer']).errors).toEqual(['This is not one of the options this form offers.'])
    expect(engine.value()).toMatchObject({ customer: picked, amount: '5', status: 'placed' })
    expect(session.state().record).toBeUndefined()
  })

  // Anything else the server refuses is its sentence, verbatim, and is sent
  // once: an unreachable database is 503 "Nothing was saved", which a session
  // that retried would make untrue the moment the database came back (0015).
  test('a refusal is the server sentence, sent once', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'angular' })
    session.open()
    const data = submitted(session, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '6' })
    const sent = plane.sent.length
    plane.unreachable.add(connection)
    try {
      expect(await session.save(data)).toEqual({ kind: 'refused', message: 'The database cannot be reached. Nothing was saved.' })
    } finally {
      plane.unreachable.delete(connection)
    }
    expect(plane.sent.slice(sent).map((request) => request.path)).toEqual([`/v1/forms/${formId}/records/create`])
  })

  // A form the engine refused locally is not the server's to judge: the
  // renderer already shows its errors, and a request would cost a round trip
  // to be told the same thing in other words.
  test('a submit the engine refused sends nothing', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'react' })
    session.open()
    const sent = plane.sent.length
    expect(await session.save(submitted(session, { amount: 'twelve' }))).toBeNull()
    expect(plane.sent.length).toBe(sent)
  })

  // "Load the saved record" on a form that was never saved has nothing to
  // load, and says so rather than sending a read for no record -- which the
  // server would refuse in words about a request the person never made.
  test('reload() without a saved record says so and sends nothing', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'react' })
    const { engine } = session.opened()
    const sent = plane.sent.length
    expect(await session.reload()).toBe('There is no saved record to load: this form has not been saved yet.')
    expect(plane.sent.length).toBe(sent)
    expect(session.opened().engine).toBe(engine)
  })

  // The operation follows what the definition allows: a record loaded by
  // somebody who may update asks under update, a new one under create.
  test('open() picks the operation from the record and the definition', async () => {
    const session = createSession({ client: client(), formId, definition: await definition(formId), renderer: 'react' })
    session.open(await stored(formId, EDGES.seededOrder))
    expect(session.state()).toEqual({ record: EDGES.seededOrder, version: expect.any(String) as unknown, operation: 'update' })
    session.open()
    expect(session.state().operation).toBe('create')
    const readOnly = createSession({ client: client(), formId, definition: { ...(await definition(formId)), operations: ['read'] }, renderer: 'react' })
    readOnly.open()
    expect(readOnly.state().operation).toBe('read')
  })

  // A save is a request in flight, and the form stays editable meanwhile:
  // neither 0.3.0 renderer holds input during a submit. What the person types
  // then is theirs, and newer than what was sent -- a session that set every
  // stored answer back would replace it, and then say "Created" over the loss.
  // Only the answers still as they were sent take the stored spelling; the
  // newer one stays, and the result says it is not saved. A second press
  // while the first is unanswered sends nothing and says so, rather than
  // handing back the first press's result as if it were its own.
  test('an edit made while a save is in flight is kept, and a second press says nothing was sent', async () => {
    const { session, holding } = await heldSession(formId)
    const { engine } = session.opened()
    const from = plane.sent.length
    const first = session.save(submitted(session, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '7', notes: 'first' }))
    await writesHeld(holding, 1)

    engine.setValue(['notes'], 'typed while saving')
    const second = await press(session, holding)
    expect(second).toEqual({ kind: 'busy', message: 'The previous save has not been answered yet. This press sent nothing: press Save again once it has.' })
    expect(creates(formId, from)).toBe(1)

    holding.answer()
    const result = await first
    const record = String(session.state().record)
    expect(result).toEqual({ kind: 'created', message: `Created record ${record}. Changes made while it was saving are still in the form, not saved.` })
    expect(engine.value()).toMatchObject({ amount: '7.0000', notes: 'typed while saving' })

    // And the next press sends them, as an update from the version just made.
    const next = session.save(submitted(session, {}))
    await writesHeld(holding, 1)
    holding.answer()
    expect(await next).toEqual({ kind: 'saved', message: 'Saved.' })
    expect((await stored(formId, record)).answers['notes']).toBe('typed while saving')
  })

  // New (or Load) while a create is in flight: the new form is not the old
  // one's, so the answer must not move its record -- but the record was
  // written, and a session that dropped the answer would leave the person
  // not knowing it exists, free to enter it again. The answer is said,
  // marked as the replaced form's, and the new form is untouched.
  test("a create answered after New is said as the replaced form's, and leaves the new form alone", async () => {
    const { session, holding } = await heldSession(formId, 'angular')
    const first = session.save(submitted(session, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '8' }))
    await writesHeld(holding, 1)
    const fresh = session.open()

    holding.answer()
    const result = await first
    const made = /^The save sent before this form was replaced: Created record (k1:\S+)\.$/.exec(result?.message ?? '')
    expect({ kind: result?.kind, made: made !== null }).toEqual({ kind: 'replaced', made: true })
    expect((await stored(formId, String(made?.[1]))).answers['amount']).toBe('8.0000')
    expect(session.state()).toEqual({ record: undefined, version: undefined, operation: 'create' })
    expect(session.opened().engine).toBe(fresh)
    expect(fresh.value()).not.toMatchObject({ amount: '8.0000' })
  })

  // The same for a refusal: "Nothing was saved" (or a 502's "may have been
  // saved") is what the person needs to hear about the form they left, and a
  // session that returned nothing would hide it.
  test("a refusal answered after New is said as the replaced form's", async () => {
    const { session, holding } = await heldSession(formId)
    const data = submitted(session, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '9' })
    plane.unreachable.add(connection)
    let first: Promise<unknown> = Promise.resolve()
    try {
      first = session.save(data)
      await writesHeld(holding, 1)
    } finally {
      plane.unreachable.delete(connection)
    }
    session.open()
    holding.answer()
    expect(await first).toEqual({ kind: 'replaced', message: 'The save sent before this form was replaced: The database cannot be reached. Nothing was saved.' })
  })

  // The guard against a double press belongs to the form that set it. A save
  // of a replaced form that settles while the new form's save is in flight
  // must not clear the new one's guard: a press then would send the same
  // create twice, and one form fill would become two records.
  test("a replaced form's save settling does not let a double press create twice", async () => {
    const { session, holding } = await heldSession(formId)
    const pick = await customer(session, 'Muster')
    const from = plane.sent.length
    const a = session.save(submitted(session, { customer: pick, order_date: EDGES.orderDate, status: 'placed', amount: '10' }))
    await writesHeld(holding, 1)
    session.open()
    const b = session.save(submitted(session, { customer: pick, order_date: EDGES.orderDate, status: 'placed', amount: '11' }))
    await writesHeld(holding, 2)

    holding.answer()
    expect(await a).toMatchObject({ kind: 'replaced' })
    expect(await press(session, holding)).toMatchObject({ kind: 'busy' })
    expect(creates(formId, from)).toBe(2)
    holding.answer()
    expect(await b).toMatchObject({ kind: 'created' })
  })
})
