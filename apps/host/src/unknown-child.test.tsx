import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName, paragraphs } from './test-accessible.js'
import { CHANGED_SINCE_UNKNOWN } from './session.js'
import {
  answeredOnce,
  chooseForm,
  chooseRenderer,
  gridSection,
  mount,
  newRecord,
  notice,
  said,
  searchRecords,
  showChild,
  signIn,
  stamp,
  unknownNotice,
  unsavedNotice,
} from './test-host.js'
import { done, openRows, recordSave, rowAnswer, rowCell, rowsTab, rowTexts } from './test-rows.js'
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
  plane = await startPlane({ children: true, saves: true })
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
  await showChild(user, 'Order line')
  await answeredOnce('Order line')
  await user.click(within(gridSection('Order line')).getByRole('button', { name: 'New Order line' }))
  const pane = await waitFor(() => screen.getByRole('region', { name: 'New Order line React' }), ARRIVES)
  const field = (name: RegExp): HTMLInputElement => within(pane).getByLabelText<HTMLInputElement>(name)
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

describe.each(ENGINES)('a lost save of an order with its lines on $engine (0031, 0155)', (engine) => {
  /** The order's line `first` changed to `quantity` in React, and the save of it pressed with its answer lost after it committed: its notice. */
  async function lostChange(user: User, first: string, quantity: string): Promise<HTMLElement> {
    await user.click(rowCell(first))
    await rowAnswer(user, 'React', `Order line k1:${first}`, 'Quantity', quantity)
    await done(user, 'React', `Order line k1:${first}`)
    await waitFor(() => expect(rowTexts()[0]?.[4]).toBe('Changed'), ARRIVES)
    plane.loseSave.set(engine.parity, 'after')
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave('React'))
    await waitFor(() => expect(plane.loseSave.has(engine.parity)).toBe(false), ARRIVES)
    return waitFor(() => {
      const found = unknownNotice('React')
      if (found === null) throw new Error('no unknown notice')
      return found
    }, ARRIVES)
  }

  // A save of an order with a line changed, its answer lost after it
  // committed: the page says it may have been saved, with the keyboard on
  // that, and sends nothing again; its check reads the order alone, which
  // every save moves -- changed, by this save or another's -- and Load the
  // saved record, once the guard has asked about the line's change it
  // drops, opens the order as stored and lists its lines again, so what
  // the tab shows is what is stored (watched failing with the order loaded
  // alone: the line still marked Changed; and with Load the saved record
  // dropping the line's change unasked: no question).
  test('a lost save checks by the record, then loads the record and its rows', async () => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('lost'), 2)
    plane.sent.length = 0
    const user = await openRows(plane, engine, record)
    const [first] = rowTexts().map((row) => String(row[0]))
    const notice = await lostChange(user, String(first), '6')
    await waitFor(() => expect(focusedName()).toBe('React It may have been saved'), ARRIVES)
    await user.click(within(notice).getByRole('button', { name: 'Check whether it was saved' }))
    await waitFor(
      () => expect(within(notice).getByRole('status').textContent).toBe('The record has changed since it was read, by this save or by someone else.'),
      ARRIVES,
    )
    await user.click(within(notice).getByRole('button', { name: 'Load the saved record' }))
    const asked = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(within(asked).getByRole('list').textContent).toBe(`Order ${record} with 1 Order line row changed: changes that are not saved.`)
    await user.click(within(asked).getByRole('button', { name: 'Discard and continue' }))
    await showChild(user, 'Order line')
    await waitFor(
      () =>
        expect(rowTexts().map((row) => row.slice(1, 5))).toEqual([
          ['1', '6', '', ''],
          ['2', '2', '', ''],
        ]),
      ARRIVES,
    )
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 6 },
      { no: 2, quantity: 2 },
    ])
    expect(plane.sent.filter((request) => request.path.endsWith('/records/save'))).toHaveLength(1)
  })

  // Saved again at the version the lost save sent, the order is stale --
  // most likely by that save -- so the page says so and stays unknown,
  // rather than "Not saved" alone, which would let the person think none
  // of it was stored (watched failing with that sentence for a lost update
  // alone: a stale notice took the unknown one's place, over a save that
  // was stored).
  test('a lost save of a saved order, saved again, is stale by its own doing and stays unknown', async () => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('lost-again'), 2)
    const user = await openRows(plane, engine, record)
    const [first] = rowTexts().map((row) => String(row[0]))
    await lostChange(user, String(first), '7')
    await user.click(recordSave('React'))
    await waitFor(() => expect(paragraphs(unknownNotice('React') as HTMLElement)[0]).toBe(CHANGED_SINCE_UNKNOWN), ARRIVES)
    expect(notice('React')).toBeNull()
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 7 },
      { no: 2, quantity: 2 },
    ])
  })

  // A new order created with its line, its answer lost after it committed:
  // a second press sends nothing until it is checked, in the pane that
  // sent it and in the other renderer's, whose own draft is empty -- the
  // line is one set for both panes, and a second create would store it
  // under a second order -- so one order and its one line are stored
  // (watched failing with a lost save that created the record not held:
  // the second press said "Created record" and stored a second order with
  // the line; and with the hold the pane's alone: the Angular pane's press
  // did).
  test('a lost create with its line holds every pane until it is checked', async () => {
    const note = stamp('lost-new')
    plane.sent.length = 0
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.savedOrder)
    await chooseRenderer(user)
    await newRecord(user)
    const paper = await waitFor(() => screen.getByRole('form', { name: 'Order, React' }), ARRIVES)
    await user.type(await waitFor(() => within(paper).getByLabelText(/^Note\b/), ARRIVES), note)
    await showChild(user, 'Order line')
    await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
    await rowAnswer(user, 'React', 'New Order line 1', 'Line no', '1')
    await rowAnswer(user, 'React', 'New Order line 1', 'Quantity', '3')
    await done(user, 'React', 'New Order line 1')
    plane.loseSave.set(engine.parity, 'after')
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave('React'))
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull(), ARRIVES)
    for (const renderer of ['React', 'Angular'] as const) {
      await user.click(recordSave(renderer))
      await said(renderer, /^Nothing was sent: the last save may have been stored\. Check whether it was saved first\.$/)
    }
    expect(await plane.db.countSavedOrders(engine.connection, note)).toBe(1)
    expect(plane.sent.filter((request) => request.path.endsWith('/records/save'))).toHaveLength(1)
  })
})
