import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { answeredOnce, chooseForm, gridSection, mount, searchRecords, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * 0031's `present` and `absent`, reached through the page (0047): a child
 * row's key is typed by the person -- an order line is its order and its
 * line number -- so a create whose answer was lost can be checked by its
 * key, where an order's, numbered by the database, cannot. Until the
 * workspace, no host suite reached either state through the page.
 *
 * On both engines, against the real server and database, with the
 * adapter's answer replaced by `unknown-outcome` (the plane's `lose`): after
 * the real insert stored the line, and with no insert at all. The server
 * then answers 502 with the record the typed key names. The loss is made up
 * around a real write; that a connection really dropped between the server
 * and the database makes the adapters say `unknown-outcome` is data-server's
 * e2e-lost-answer. A loss between the page and the server cannot reach
 * either state -- the page never hears which record the server would have
 * made -- and is the unverifiable case page.test.tsx holds.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ARRIVES = { timeout: 15_000 }

/** A fresh order of tenant 1's noted `notes`, made beside the page. */
async function freshOrder(engine: Engine, notes: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, {
    customer: found.value.rows[0].token,
    order_date: EDGES.orderDate,
    status: 'placed',
    amount: '1',
    notes,
  })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

/** A new line under a fresh order, typed and saved in React, its answer lost between the server and the database. */
async function lostLine(engine: Engine, when: 'after' | 'before'): Promise<{ user: User; pane: HTMLElement; order: string }> {
  const words = stamp('lost')
  const order = await freshOrder(engine, words)
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.formId)
  await searchRecords(user, words, [order.slice(3)])
  const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
  await user.click(
    within(grid)
      .getAllByRole('gridcell')
      .find((cell) => cell.textContent === order.slice(3)) as HTMLElement,
  )
  await waitFor(() => gridSection('Order line'), ARRIVES)
  await answeredOnce('Order line')
  await user.click(within(gridSection('Order line')).getByRole('button', { name: 'New Order line' }))
  const pane = await waitFor(() => screen.getByRole('region', { name: 'New Order line React' }), ARRIVES)
  const field = (name: RegExp): HTMLInputElement => within(pane).getByLabelText(name) as HTMLInputElement
  await waitFor(() => field(/^Line no\b/), ARRIVES)
  await user.type(field(/^Line no\b/), '5')
  await user.type(field(/^Quantity\b/), '2')
  await user.type(field(/^Unit price\b/), '3.00')
  plane.lose.set(engine.connection, when)
  await user.click(within(pane).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(plane.lose.has(engine.connection)).toBe(false), ARRIVES)
  return { user, pane, order }
}

/** The notice a save whose answer was lost opens in a child row's pane. */
function lost(pane: HTMLElement): HTMLElement {
  return within(pane).getByRole('region', { name: 'New Order line React It may have been saved' })
}

describe.each(ENGINES)('a lost line on $engine (0031, 0047)', (engine) => {
  // Stored, and its answer lost: the line's key is the order and the number
  // the person typed, so the check reads it back and says it is there.
  test('stored and lost is present, by the key the person typed', async () => {
    const { user, pane, order } = await lostLine(engine, 'after')
    const notice = await waitFor(() => lost(pane), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe('New Order line React It may have been saved'))
    await user.click(within(notice).getByRole('button', { name: 'Check whether it was saved' }))
    await waitFor(
      () =>
        expect(within(notice).getByRole('status').textContent).toBe(
          `A record with this key is stored, record k1:${order.slice(3)},5. Load it to see whether it holds what was entered here.`,
        ),
      ARRIVES,
    )
    expect(within(notice).getByRole('button', { name: 'Load the saved record' })).toBeTruthy()
  })

  // Lost before it reached the server: nothing is stored under that key, so
  // the check says so and saving again is safe -- the key stops a second row.
  test('lost on the way is absent, and saving again stores it once', async () => {
    const { user, pane, order } = await lostLine(engine, 'before')
    const notice = await waitFor(() => lost(pane), ARRIVES)
    await user.click(within(notice).getByRole('button', { name: 'Check whether it was saved' }))
    await waitFor(
      () =>
        expect(within(notice).getByRole('status').textContent).toBe(
          'This form cannot find a record with its key. Saving it again is safe: the key stops a second copy.',
        ),
      ARRIVES,
    )
    await user.click(within(pane).getByRole('button', { name: 'Save' }))
    await waitFor(
      () =>
        expect(
          within(pane)
            .getAllByRole('status')
            .map((status) => status.textContent),
        ).toContain(`Created record k1:${order.slice(3)},5.`),
      ARRIVES,
    )
  })
})
