import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { audit, unnamed } from './test-accessible.js'
import { chooseForm, chooseRenderer, gridSection, load, loaded, mount, pane, said, signIn } from './test-host.js'
import type { User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Change from a date (0115), through the page, against the real server on
 * both engines: a product's prices, `parity.price`, each a version valid
 * from one date until the next starts. On an open version the record's
 * header offers Change from a date, which opens its next version -- the
 * start to give, the chain's key and the end the server's -- and a save
 * ends the version it follows on that date and creates the next, in one
 * write (0113). An ended version is history: drawn read-only, and offered
 * no change.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ versions: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const ARRIVES_WITHIN = { timeout: 15_000 }
/** A product of its own for each case, so no case's chain is another's. */
let products = 7000 + Math.floor(Math.random() * 1000) * 10
const nextProduct = (): number => (products += 1)

/** An open version of a fresh product's price, made beside the page, and its token. */
async function openVersion({ price }: Engine): Promise<string> {
  const created = await plane.clerk.create(price, { product_no: nextProduct(), valid_from: '2026-01-01', amount: '9.5000' })
  if (!created.ok || created.value.record === null) throw new Error(`the price was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** The page signed in, on the price form, React alone, with `record` loaded. */
async function priceOpen(engine: Engine, record: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.price)
  await chooseRenderer(user, 'React')
  await load(user, record)
  await loaded(record, 'Price')
  return user
}

const changeButton = (): HTMLElement | null => screen.queryByRole('button', { name: 'Change from a date' })

/** The price's React paper, and a control of it by its name: the shared helpers' paper is the order's. */
const paper = (): HTMLElement => within(pane('React')).getByRole('form', { name: 'Price, React' })
const control = (name: string): HTMLInputElement => within(paper()).getByLabelText<HTMLInputElement>(name, { exact: true })

/** A version of a fresh product, ended by a change from 2026-07-01 made beside the page, and the open version after it. */
async function endedVersion(engine: Engine): Promise<{ ended: string; open: string }> {
  const record = await openVersion(engine)
  const read = await plane.clerk.read(engine.price, record)
  if (!read.ok || read.value.version === null) throw new Error('the version was not read')
  const changed = await plane.clerk.supersede(engine.price, { record, version: read.value.version, answers: { valid_from: '2026-07-01', amount: '10.0000' } })
  if (!changed.ok || changed.value.record === null) throw new Error(`the change was not made: ${changed.ok ? 'no token' : changed.message}`)
  return { ended: record, open: changed.value.record }
}

/** The page on `record`, Change from a date pressed, and its next version open. */
async function nextOpen(engine: Engine, record: string): Promise<User> {
  const user = await priceOpen(engine, record)
  await user.click(changeButton() as HTMLElement)
  await screen.findByRole('heading', { level: 3, name: `Next version of ${record}` }, ARRIVES_WITHIN)
  await waitFor(() => expect(control('Valid from').value).toBe(''), ARRIVES_WITHIN)
  return user
}

describe.each(ENGINES)('a change from a date on $engine', (engine) => {
  // The next version holds the open one's answers but its start, which the
  // person gives, and its end; the chain's key and the end are drawn
  // unwritable, as the server takes them from the version it follows.
  // Every control is named and axe finds nothing. Watched failing with the
  // next version drawn as a new record: its product was writable.
  test('opens the next version of an open one, the chain’s key and end unwritable', async () => {
    await nextOpen(engine, await openVersion(engine))
    expect(control('Amount').value).not.toBe('')
    expect(control('Product no').disabled).toBe(true)
    expect(control('Valid to').disabled).toBe(true)
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
  })

  // Saved, the version it followed ends on the date given and the next is
  // the record the detail shows, open: one write, through supersede.
  // Watched failing with the next version saved as a create: nothing was
  // created, the chain having a version.
  test('a save of the next version ends the one it follows there', async () => {
    const record = await openVersion(engine)
    const user = await nextOpen(engine, record)
    fireEvent.change(control('Valid from'), { target: { value: '2026-07-01' } })
    await user.clear(control('Amount'))
    await user.type(control('Amount'), '10')
    await user.click(within(paper()).getByRole('button', { name: 'Save' }))
    const next = (await said('React', /^Created record /)).slice('Created record '.length, -1)
    await screen.findByRole('heading', { level: 3, name: `Price ${next}` }, ARRIVES_WITHIN)
    const ended = await plane.clerk.read(engine.price, record)
    expect(ended.ok && ended.value.answers['valid_to']).toBe('2026-07-01')
    const started = await plane.clerk.read(engine.price, next)
    expect(started.ok && { from: started.value.answers['valid_from'], to: started.value.answers['valid_to'] }).toEqual({ from: '2026-07-01', to: null })
  })

  // What the clerk writes in no operation -- the pinned tenant, the end,
  // and the note the policy lets them read and not write -- is drawn as
  // nothing writes it, on a new price and an open one, and is in no body
  // the page sends (0117). Watched failing with the unwritten fields left
  // out of the drawn form: the note was writable.
  test('draws what the clerk writes in no operation unwritable, and sends none of it', async () => {
    const record = await openVersion(engine)
    const user = await priceOpen(engine, record)
    for (const name of ['Tenant id', 'Valid to', 'Note']) expect({ name, disabled: control(name).disabled }).toEqual({ name, disabled: true })
    expect(control('Amount').disabled).toBe(false)
    plane.sent.length = 0
    await user.clear(control('Amount'))
    await user.type(control('Amount'), '11')
    await user.click(within(paper()).getByRole('button', { name: 'Save' }))
    await said('React', /^Saved\.$/)
    const update = plane.sent.find((request) => request.path === `/v1/forms/${engine.price}/records/update`)
    expect(Object.keys((JSON.parse(update?.body ?? '{}') as { answers?: object }).answers ?? {}).sort()).toEqual(['amount', 'product_no', 'valid_from'])
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(control('Note').value).toBe(''), ARRIVES_WITHIN)
    expect(control('Note').disabled).toBe(true)
  })

  // A version that has ended is history: no change is offered from it. The
  // open one after it offers the change. Watched failing with the button
  // offered on every version: the ended one had it.
  test('offers no change from an ended version, and offers it from the open one', async () => {
    const { ended, open } = await endedVersion(engine)
    await priceOpen(engine, ended)
    expect(changeButton()).toBeNull()
    cleanup()
    await priceOpen(engine, open)
    expect(changeButton()).not.toBeNull()
  })

  // And its fields are drawn as nothing to write, as a record the person
  // may not update is: the server would refuse its update. Watched failing
  // with no version taken for ended: its amount was writable.
  test('draws an ended version read-only', async () => {
    const { ended } = await endedVersion(engine)
    await priceOpen(engine, ended)
    expect(control('Amount').disabled).toBe(true)
  })
})
