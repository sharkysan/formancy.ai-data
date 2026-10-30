import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { audit, unnamed } from './test-accessible.js'
import { answer, chooseForm, chooseRenderer, control, load, loaded, mount, said, save, signIn } from './test-host.js'
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

describe.each(ENGINES)('a change from a date on $engine', (engine) => {
  // The next version holds the open one's answers but its start, which the
  // person gives, and its end; the chain's key is drawn unwritable. Saved,
  // the version it followed ends on that date and the next is the record
  // the detail shows, open. Every control is named and axe finds nothing.
  test('opens the next version of an open one, and a save ends it there', async () => {
    const record = await openVersion(engine)
    const user = await priceOpen(engine, record)
    await user.click(changeButton() as HTMLElement)
    await screen.findByRole('heading', { level: 3, name: `Next version of ${record}` }, ARRIVES_WITHIN)
    await waitFor(() => expect(control('React', 'Valid from').value).toBe(''), ARRIVES_WITHIN)
    expect(control('React', 'Product no').disabled).toBe(true)
    expect(control('React', 'Valid to').disabled).toBe(true)
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])

    fireEvent.change(control('React', 'Valid from'), { target: { value: '2026-07-01' } })
    await answer(user, 'React', 'Amount', '10')
    await save(user, 'React')
    const next = (await said('React', /^Created record /)).slice('Created record '.length, -1)
    await screen.findByRole('heading', { level: 3, name: `Price ${next}` }, ARRIVES_WITHIN)

    const ended = await plane.clerk.read(engine.price, record)
    expect(ended.ok && ended.value.answers['valid_to']).toBe('2026-07-01')
    const started = await plane.clerk.read(engine.price, next)
    expect(started.ok && { from: started.value.answers['valid_from'], to: started.value.answers['valid_to'] }).toEqual({ from: '2026-07-01', to: null })
  })

  // A version that has ended is history: no change is offered from it, and
  // its fields are drawn as nothing to write. The open one after it offers
  // the change.
  test('offers no change from an ended version, and draws it read-only', async () => {
    const record = await openVersion(engine)
    const read = await plane.clerk.read(engine.price, record)
    if (!read.ok || read.value.version === null) throw new Error('the version was not read')
    const changed = await plane.clerk.supersede(engine.price, { record, version: read.value.version, answers: { valid_from: '2026-07-01', amount: '10.0000' } })
    if (!changed.ok || changed.value.record === null) throw new Error(`the change was not made: ${changed.ok ? 'no token' : changed.message}`)
    await priceOpen(engine, record)
    expect(changeButton()).toBeNull()
    expect(control('React', 'Amount').disabled).toBe(true)
    cleanup()
    await priceOpen(engine, changed.value.record)
    expect(changeButton()).not.toBeNull()
  })
})
