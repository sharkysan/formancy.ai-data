import { createDataClient } from '@formancy/data-client'
import type { DataClient, FormRecord, PublishedForm } from '@formancy/data-client'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { CHANGED_SINCE_UNKNOWN, createSession, HELD } from './session.js'
import type { Session } from './session.js'
import { EDGES, ENGINES, holdingWrites, losingWrites, startPlane, TOKENS } from './test-plane.js'
import type { Holding, Losing, Plane } from './test-plane.js'

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

/** A session whose next create or update loses its answer: after the server stored it, or before it was sent on. */
async function losingSession(formId: string, when: 'after' | 'before', record?: FormRecord): Promise<{ session: Session; losing: Losing }> {
  const losing = losingWrites(plane.fetch, { when })
  const lossy = createDataClient({ token: () => TOKENS.clerk, fetch: losing.fetch })
  const session = createSession({ client: lossy, formId, definition: await definition(formId, lossy), renderer: 'react' })
  session.open(record)
  return { session, losing }
}

/** What the client says when the answer was lost between the page and the server (0031). */
const LOST_ON_THE_WAY = 'The answer to this save was lost between this page and the data server. It may have been saved.'

/** A fresh order of tenant 1's, made beside the session, read back as a session opens it. */
async function freshOrder(formId: string, session: Session, notes: string): Promise<FormRecord> {
  const created = await plane.clerk.create(formId, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '20', notes })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return stored(formId, created.value.record)
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

describe.each(ENGINES)('a save whose answer is lost, on $engine (0031)', ({ formId, connection }) => {
  // The answer was lost after the server stored the order. Shown as "not
  // saved", the person presses Save again and makes a second order -- the
  // renderer owns the button, so the session itself holds the form: the
  // press sends nothing and says why. An order's key is numbered by the
  // database, so nothing can find it, and checking says so without asking;
  // only the person's word lets one more create through.
  test('a create lost after it was stored holds the form until the person says to enter it again', async () => {
    const { session, losing } = await losingSession(formId, 'after')
    const notes = `lost in the session ${connection} ${String(Date.now())}`
    const pick = await customer(session, 'Muster')
    const from = plane.sent.length
    const result = await session.save(submitted(session, { customer: pick, order_date: EDGES.orderDate, status: 'placed', amount: '21', notes }))
    expect(result).toMatchObject({ kind: 'unknown', message: LOST_ON_THE_WAY, unknown: { operation: 'create', record: null, version: null, origin: 'transport' } })
    expect(losing.lost).toEqual([`/v1/forms/${formId}/records/create`])
    expect(await plane.db.countOrders(connection, notes)).toBe(1)
    expect(session.state()).toEqual({ record: undefined, version: undefined, operation: 'create' })

    expect(await session.save(submitted(session, {}))).toEqual({ kind: 'held', message: HELD })
    expect(creates(formId, from)).toBe(1)
    expect(await session.check()).toEqual({ ok: true, state: 'unverifiable' })
    expect(plane.sent.length - from).toBe(1)

    session.allowAgain()
    expect(await session.save(submitted(session, {}))).toMatchObject({ kind: 'created' })
    expect(creates(formId, from)).toBe(2)
    // Two, because the person said so: the hold made it their choice, not a press's.
    expect(await plane.db.countOrders(connection, notes)).toBe(2)
    expect(session.unknown()).toBeUndefined()
  })

  // The hold is the form's, not the session's: New starts another record,
  // which nothing has been sent for. A hold that outlived the form would
  // refuse every new order after one lost answer.
  test('New clears the hold, and the new form saves', async () => {
    const { session } = await losingSession(formId, 'after')
    const pick = await customer(session, 'Muster')
    await session.save(submitted(session, { customer: pick, order_date: EDGES.orderDate, status: 'placed', amount: '22', notes: `held, then New ${connection}` }))
    expect(session.unknown()).toMatchObject({ operation: 'create' })
    session.open()
    expect(session.unknown()).toBeUndefined()
    expect(await session.check()).toMatchObject({ ok: false, code: 'nothing-to-check' })
    expect(await session.save(submitted(session, { customer: pick, order_date: EDGES.orderDate, status: 'placed', amount: '23' }))).toMatchObject({ kind: 'created' })
  })

  // An update lost after it was stored holds nothing -- its version makes a
  // resend safe -- and keeps the version it sent, which a session that
  // applied nothing must. Checking reads the record and finds it moved on,
  // with the change in it, for the person to load.
  test('an update lost after it was stored is unknown, keeps its version, and checks as changed', async () => {
    const reader = await losingSession(formId, 'after')
    const loaded = await freshOrder(formId, reader.session, 'before the lost update')
    const { session } = await losingSession(formId, 'after', loaded)
    const notes = `lost update in the session ${connection} ${String(Date.now())}`
    const result = await session.save(submitted(session, { notes }))
    expect(result).toMatchObject({ kind: 'unknown', unknown: { operation: 'update', record: loaded.record, version: loaded.version, origin: 'transport' } })
    expect(session.state().version).toBe(loaded.version)
    const checked = await session.check()
    expect(checked).toMatchObject({ ok: true, state: 'changed', current: { record: loaded.record, answers: { notes } } })
    expect(checked.ok && checked.state === 'changed' ? checked.current.version : undefined).not.toBe(loaded.version)
  })

  // The 502's sentence invites Save with the same version, and when the
  // lost update was stored that Save is answered 409 stale -- the record
  // changed, by the person's own earlier save. Shown as a stale "Not saved",
  // the person is told nothing was saved and the session forgets the earlier
  // save may have been. It stays unknown: said as such, still checkable,
  // and the check finds the record moved on, with the change in it.
  test('an update lost after it was stored, saved again, is stale by its own doing and stays unknown', async () => {
    const reader = await losingSession(formId, 'after')
    const loaded = await freshOrder(formId, reader.session, 'before the lost update, then Save')
    const { session } = await losingSession(formId, 'after', loaded)
    const notes = `lost update, saved again ${connection} ${String(Date.now())}`
    expect(await session.save(submitted(session, { notes }))).toMatchObject({ kind: 'unknown' })
    const again = await session.save(submitted(session, {}))
    expect(again).toMatchObject({ kind: 'unknown', message: CHANGED_SINCE_UNKNOWN, unknown: { operation: 'update', record: loaded.record, version: loaded.version } })
    expect(session.unknown()).toMatchObject({ operation: 'update', record: loaded.record, version: loaded.version })
    expect(await session.check()).toMatchObject({ ok: true, state: 'changed', current: { record: loaded.record, answers: { notes } } })
  })

  // Lost before it reached the server: nothing is stored, the record is
  // still at the version sent, and checking says so -- "unchanged", not
  // "saved". Pressing Save then sends the same version, which is how "it is
  // stored at most once" holds, and it is stored.
  test('an update lost before it was sent checks as unchanged, and Save then stores it with the version it sent', async () => {
    const reader = await losingSession(formId, 'before')
    const loaded = await freshOrder(formId, reader.session, 'before the unsent update')
    const { session, losing } = await losingSession(formId, 'before', loaded)
    const notes = `unsent update ${connection} ${String(Date.now())}`
    const from = plane.sent.length
    expect(await session.save(submitted(session, { notes }))).toMatchObject({ kind: 'unknown', message: LOST_ON_THE_WAY })
    expect(losing.lost).toHaveLength(1)
    expect(plane.sent.length).toBe(from)
    expect(await session.check()).toMatchObject({ ok: true, state: 'unchanged', current: { version: loaded.version } })

    expect(await session.save(submitted(session, {}))).toEqual({ kind: 'saved', message: 'Saved.' })
    const update = plane.sent.slice(from).find((request) => request.path === `/v1/forms/${formId}/records/update`)
    expect(JSON.parse(update?.body ?? '{}')).toMatchObject({ record: loaded.record, version: loaded.version })
    expect((await stored(formId, String(loaded.record))).answers['notes']).toBe(notes)
  })

  // A check that finds the create absent lifts the hold: creating again is
  // safe, because the key the insert named stops a second row. No form this
  // plane publishes names its own key -- an order's is numbered -- so the
  // answer is the client's (reconcile.test proves it from a 404) and what is
  // proved here is only what the session does with it.
  test('a check that finds the create absent lifts the hold', async () => {
    const losing = losingWrites(plane.fetch, { when: 'before' })
    const lossy = createDataClient({ token: () => TOKENS.clerk, fetch: losing.fetch })
    const absent: DataClient = { ...lossy, reconcile: async () => ({ ok: true, state: 'absent' }) }
    const session = createSession({ client: absent, formId, definition: await definition(formId, lossy), renderer: 'angular' })
    session.open()
    const data = submitted(session, { customer: await customer(session, 'Muster'), order_date: EDGES.orderDate, status: 'placed', amount: '24' })
    expect(await session.save(data)).toMatchObject({ kind: 'unknown' })
    expect(await session.save(data)).toEqual({ kind: 'held', message: HELD })
    expect(await session.check()).toEqual({ ok: true, state: 'absent' })
    expect(await session.save(data)).toMatchObject({ kind: 'created' })
  })
})
