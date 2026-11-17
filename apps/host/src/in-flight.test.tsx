import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { SAVE_OUT } from './deletion.js'
import { RUN_HELD, RUNNING } from './running.js'
import { CLOSE_WORDS } from './test-actions.js'
import { focusedName } from './test-accessible.js'
import { askClose, closed, closeRegion, closing, openActionOrder, runIt, runsSent } from './test-acting.js'
import {
  answer,
  chooseCustomer,
  chooseForm,
  chooseRenderer,
  control,
  dataRows,
  load,
  mount,
  newRecord,
  openWith,
  RENDERERS,
  said,
  save,
  showChild,
  shows,
  signIn,
  stamp,
  statuses,
  unsavedNotice,
} from './test-host.js'
import { done, openRows, rowAnswer, rowCell, rowControl, rowsLine, rowsTab, rowTexts } from './test-rows.js'
import type { User } from './test-host.js'
import { holdingWrites } from './test-network.js'
import type { Holding } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A save the server has not answered yet, through the page. Neither renderer
 * holds the form during a submit, at 0.3.0 to 0.13.0, so in that moment a
 * person goes on typing, presses Save again, or opens another record -- and on
 * `app.inject` the moment is too short to reach, so the writes here are held
 * after the server has made them (`holdingWrites`) and answered when the test
 * says. What the page owes the person then: their newer typing kept and said to
 * be unsaved, a second press that says it sent nothing, every answer heard even
 * when its words repeat, and the answer for a form they have left still said
 * rather than dropped (0029, D7).
 *
 * Both renderers, on both engines: the decisions are the session's, and each
 * pane is where one of them could be lost on the way to the person. And an
 * action's run over the record (0162), held the same way: a second press
 * while it is out sends nothing, and Run it waits for a save of the record.
 * How many runs went is read off the wire, which no role names.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ saves: true, actions: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

/** The page, signed in as tenant 1's clerk, with every create and update held until `holding.answer()`. */
async function openHeld(formId: string): Promise<{ user: User; holding: Holding }> {
  const holding = holdingWrites(plane.fetch)
  const user = await openWith(holding.fetch, formId)
  return { user, holding }
}

/** Wait until `count` writes are made and held. */
async function writesHeld(holding: Holding, count: number): Promise<void> {
  await waitFor(() => expect(holding.held).toHaveLength(count), { timeout: 15_000 })
}

/** A fresh order of tenant 1's, made beside the page, as the stale suite makes one. */
async function freshOrder({ formId }: Engine): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, name, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1' })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

describe.each(ENGINES)('a save in flight on $engine', (engine) => {
  // Typed while the save was out: the answer the server stored for Notes is
  // older than what the field holds, and a pane that set it back would erase
  // the person's words and then say "Saved." over the loss. The second press
  // carried those words and sent nothing; it says so instead of being
  // handed the first press's "Saved.". And every answer is heard: the line
  // reads "Saving…" while a save is out, so "Saved." twice in a row is two
  // changes to the live region, not one change and a silence.
  test.each(RENDERERS)('in %s, typing during a save is kept and said to be unsaved, and every save is heard', async (renderer) => {
    const record = await freshOrder(engine)
    const { user, holding } = await openHeld(engine.formId)
    await load(user, record)
    await shows(renderer, 'Amount', '1.0000')

    await answer(user, renderer, 'Amount', '3')
    await save(user, renderer)
    await writesHeld(holding, 1)
    await said(renderer, /^Saving…$/)
    await answer(user, renderer, 'Notes', 'typed while saving')
    await save(user, renderer)
    await said(renderer, /^The previous save has not been answered yet\. This press sent nothing: press Save again once it has\.$/)
    expect(holding.held).toHaveLength(1)

    holding.answer()
    await said(renderer, /^Saved\. Changes made while it was saving are still in the form, not saved\.$/)
    await shows(renderer, 'Amount', '3.0000')
    expect(control(renderer, 'Notes').value).toBe('typed while saving')

    // The words the next save sends are the newer ones, and while it is out
    // the line no longer says what it said before.
    await save(user, renderer)
    await writesHeld(holding, 1)
    await said(renderer, /^Saving…$/)
    expect(statuses(renderer)).not.toContain('Saved.')
    holding.answer()
    await said(renderer, /^Saved\.$/)
    await save(user, renderer)
    await writesHeld(holding, 1)
    expect(statuses(renderer)).not.toContain('Saved.')
    holding.answer()
    await said(renderer, /^Saved\.$/)
    const stored = await plane.clerk.read(engine.formId, record)
    expect(stored.ok && stored.value.answers['notes']).toBe('typed while saving')
  })

  // New while a create is out: the record is written, and the person needs
  // its token -- without it they may well enter the order again. A save
  // still out is work New would drop, so the page asks first (0047); told to
  // discard, it opens the new form, and the answer is still said on the
  // pane's line as the replaced form's, and the new, empty form stays empty
  // and stays a new record.
  test.each(RENDERERS)('in %s, a create answered after New is said, and the new form stays empty', async (renderer) => {
    const { user, holding } = await openHeld(engine.formId)
    await chooseCustomer(user, renderer, 'Muster', 'Muster AG')
    await answer(user, renderer, 'Order date', EDGES.orderDate)
    await answer(user, renderer, 'Amount', '6')
    await save(user, renderer)
    await writesHeld(holding, 1)

    await newRecord(user)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    const asking = unsavedNotice() as HTMLElement
    expect(within(asking).getByRole('list').textContent).toContain(`New record, ${renderer}: a save the server has not answered yet.`)
    await user.click(within(asking).getByRole('button', { name: 'Discard and continue' }))
    await shows(renderer, 'Amount', '')
    holding.answer()
    const line = await said(renderer, /^The save sent before this form was replaced: Created record k1:\S+\.$/)
    const token = /(k1:\S+)\.$/.exec(line)?.[1] ?? ''
    const stored = await plane.clerk.read(engine.formId, token)
    expect(stored.ok && stored.value.answers['amount']).toBe('6.0000')
    await shows(renderer, 'Amount', '')
    await shows(renderer, 'Customer', '')
  })
})

describe.each(ENGINES)('an action run in flight on $engine (0162)', (engine) => {
  // While a run is out, a second press of Run it, and the action asked
  // again from the header, send nothing: the region says it is running,
  // takes the keyboard again when asked again, and the order closes once.
  // A press of the order's Save says it sent nothing too, since the run
  // moves the version the save would name (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // Run it sending again while the run was out: "expected { runs: 2, held:
  // 2 } to deeply equal { runs: 1, held: 1 }"; with the forms not held
  // while it was out: the pane said "Saving…", the save sent beside the
  // run; and with the region not focused when asked again: "expected
  // 'Close the order' to be 'Close the order: Order k1:1?'").
  test.each(RENDERERS)('in %s, a second press while the run is out sends nothing, and the order closes once', async (renderer) => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const holding = holdingWrites(plane.fetch)
    const user = await openActionOrder(holding.fetch, engine, record, renderer)
    await askClose(user, record, renderer, 'closed once')
    const from = plane.sent.length
    await runIt(user, record)
    await writesHeld(holding, 1)
    await waitFor(() => expect(within(closeRegion(record, true)).getByRole('status').textContent).toBe(RUNNING))
    await runIt(user, record)
    await user.click(screen.getByRole('button', { name: CLOSE_WORDS.label }))
    await waitFor(() => expect(focusedName()).toBe(closing(record, true)))
    await save(user, renderer)
    await said(renderer, new RegExp(`^${RUN_HELD}$`))
    expect({ runs: runsSent(plane, from), held: holding.held.length }).toEqual({ runs: 1, held: 1 })
    holding.answer()
    await closed(record)
    expect(runsSent(plane, from)).toBe(1)
    expect((await plane.db.actionOrder(engine.connection, record)).closes).toBe(1)
  })

  // A save of the order out moves the version a run would name: Run it
  // says so, is described by why, and sends nothing; once the save is
  // answered it runs over the version the save stored -- the newest the
  // detail heard as Run it is pressed -- and is done (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // Run it sent while the save was out: "expected 1 to be +0", a run sent).
  test.each(RENDERERS)('in %s, Run it waits for a save of the order out, then runs over the version it stored', async (renderer) => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const holding = holdingWrites(plane.fetch)
    const user = await openActionOrder(holding.fetch, engine, record, renderer)
    await answer(user, renderer, 'Amount', '13.5')
    await save(user, renderer)
    await writesHeld(holding, 1)
    const confirming = await askClose(user, record, renderer, 'closed after the save')
    const run = within(confirming).getByRole('button', { name: 'Run it' })
    expect({ disabled: run.getAttribute('aria-disabled'), why: computeAccessibleDescription(run) }).toEqual({ disabled: 'true', why: SAVE_OUT })
    const from = plane.sent.length
    await runIt(user, record)
    expect(runsSent(plane, from)).toBe(0)
    holding.answer()
    await said(renderer, /^Saved\.$/)
    await waitFor(() => expect(run.getAttribute('aria-disabled')).toBeNull())
    await runIt(user, record)
    await writesHeld(holding, 1)
    holding.answer()
    await closed(record)
    expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', version: 3, amount: '13.50', closes: 1 })
  })

  // Escape in the confirmation is Keep it: nothing sent, the region gone
  // and the keyboard back on the action; while the run is out it is
  // nothing, as both answers are, and the order closes once (watched
  // failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with the confirmation's
  // Escape taken out: "expected 'Close the order: Order k1:5?' to be 'Close
  // the order'"; and with Escape acting while the run was out: "Unable to
  // find an accessible element with the role "region" and name "Close the
  // order: Order k1:5?"").
  test('Escape in the confirmation is Keep it, and nothing while the run is out', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const holding = holdingWrites(plane.fetch)
    const user = await openActionOrder(holding.fetch, engine, record)
    await askClose(user, record, 'React', 'kept by Escape')
    await waitFor(() => expect(focusedName()).toBe(closing(record, true)))
    const from = plane.sent.length
    await user.keyboard('{Escape}')
    await waitFor(() => expect(focusedName()).toBe(CLOSE_WORDS.label))
    expect(screen.queryByRole('region', { name: closing(record, true) })).toBeNull()
    expect(runsSent(plane, from)).toBe(0)
    await askClose(user, record, 'React', 'closed past Escape')
    await runIt(user, record)
    await writesHeld(holding, 1)
    await user.keyboard('{Escape}')
    expect(within(closeRegion(record, true)).getByRole('status').textContent).toBe(RUNNING)
    holding.answer()
    await closed(record)
    expect(runsSent(plane, from)).toBe(1)
    expect((await plane.db.actionOrder(engine.connection, record)).closes).toBe(1)
  })
})

describe.each(ENGINES)('a save of an order with its lines in flight on $engine (0155)', (engine) => {
  // A second press while the save is out says it sent nothing; a line
  // typed into meanwhile keeps its newer answers and its mark, with the
  // stored version applied, and the answer says those changes are not
  // saved; and the next save, of that line alone, is heard too -- each
  // answer a change to the pane's line, never the last one's words again
  // (watched failing with the newer typing dropped for the stored row: the
  // line said nothing of it).
  test.each(RENDERERS)('in %s, a second press is busy, a line typed into meanwhile keeps its answers, and every answer is heard', async (renderer) => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('flight'), 2)
    const holding = holdingWrites(plane.fetch)
    const user = await openRows(plane, engine, record, undefined, holding.fetch)
    const [first] = rowTexts().map((row) => String(row[0]))
    const line = `Order line k1:${String(first)}`
    await user.click(rowCell(String(first)))
    await rowAnswer(user, renderer, line, 'Quantity', '5')
    await done(user, renderer, line)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await save(user, renderer)
    await writesHeld(holding, 1)
    await said(renderer, /^Saving…$/)
    await save(user, renderer)
    await said(renderer, /^The previous save has not been answered yet\. This press sent nothing: press Save again once it has\.$/)
    expect(holding.held).toHaveLength(1)

    await showChild(user, 'Order line')
    await user.click(rowCell(String(first)))
    await rowAnswer(user, renderer, line, 'Quantity', '6')
    await done(user, renderer, line)
    holding.answer()
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await said(renderer, /^Saved the Order: 1 Order line row changed\. Changes made while it was saving are still in the form, not saved\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 5 },
      { no: 2, quantity: 2 },
    ])
    await showChild(user, 'Order line')
    await waitFor(() => expect(rowTexts()[0]?.slice(1, 5)).toEqual(['1', '6', '', 'Changed']), { timeout: 15_000 })

    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await save(user, renderer)
    await writesHeld(holding, 1)
    await said(renderer, /^Saving…$/)
    holding.answer()
    await said(renderer, /^Saved the Order: 1 Order line row changed\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 6 },
      { no: 2, quantity: 2 },
    ])
  })

  // A new order's line typed into while the save creating both is out:
  // the line has no Remove until the save is answered, since one taken off
  // the page meanwhile would be stored and shown nowhere, and the line says
  // so; when the answer lands the field being typed into keeps the
  // keyboard and the lines' tab stays shown, though the line's key became
  // its token and the order its record; the order is opened without
  // asking about its own line; and its next Save stores the newer typing
  // (watched failing with the line's forms keyed by its grid key: the
  // keyboard was on the page itself; with the record's tabs started again
  // for the created order: the order's tab was shown; with the created
  // order's rows another pane's work: the page asked about them, and the
  // order was not opened; and with Remove drawn while its line was out:
  // each new line's Remove).
  test('a new line typed into while its order is created keeps the keyboard, and is saved next', async () => {
    const holding = holdingWrites(plane.fetch)
    const user = mount(holding.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.savedOrder)
    await chooseRenderer(user)
    await newRecord(user)
    const note = stamp('flight-new')
    const paper = await waitFor(() => screen.getByRole('form', { name: 'Order, React' }), { timeout: 15_000 })
    await user.type(await waitFor(() => within(paper).getByLabelText(/^Note\b/), { timeout: 15_000 }), note)
    await showChild(user, 'Order line')
    // Two lines, so that each has its Remove above the order's least.
    for (const no of ['1', '2']) {
      await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
      await rowAnswer(user, 'React', `New Order line ${no}`, 'Line no', no)
      await rowAnswer(user, 'React', `New Order line ${no}`, 'Quantity', '2')
      await done(user, 'React', `New Order line ${no}`)
    }
    expect(within(rowsTab()).getByRole('button', { name: 'Remove New Order line 1' })).toBeTruthy()
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await save(user, 'React')
    await writesHeld(holding, 1)

    await showChild(user, 'Order line')
    await waitFor(() => expect(rowsLine()).toMatch(/\. The rows in the save still out can be removed once it is answered\. /), { timeout: 15_000 })
    expect(within(rowsTab()).queryAllByRole('button', { name: /^Remove / })).toEqual([])
    const grid = within(rowsTab()).getByRole('grid', { name: 'Order line' })
    const row = dataRows(grid).find((each) => within(each).getAllByRole('gridcell')[1]?.textContent === '1') as HTMLElement
    await user.click(within(row).getAllByRole('gridcell')[1] as HTMLElement)
    await rowAnswer(user, 'React', 'New Order line 1', 'Quantity', '25')
    const typing = rowControl('React', 'New Order line 1', 'Quantity')
    expect(document.activeElement).toBe(typing)
    holding.answer()
    const stored = await waitFor(() => within(rowsTab()).getByRole('form', { name: /^Order line k1:\d+, React$/ }), { timeout: 15_000 })
    const name = (stored.getAttribute('aria-label') ?? '').replace(/, React$/, '')
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: /^Order k1:\d+$/ })).toBeTruthy(), { timeout: 15_000 })
    expect(document.activeElement).toBe(rowControl('React', name, 'Quantity'))
    expect(screen.getByRole('tab', { name: 'Order line' }).getAttribute('aria-selected')).toBe('true')
    expect(unsavedNotice()).toBeNull()
    await waitFor(() => expect(rowTexts()[0]?.[4]).toBe('Changed'), { timeout: 15_000 })
    const order = /(k1:\d+)/.exec(screen.getByRole('heading', { level: 3, name: /^Order k1:\d+$/ }).textContent ?? '')?.[1] ?? ''
    expect(await plane.db.savedLines(engine.connection, order)).toEqual([
      { no: 1, quantity: 2 },
      { no: 2, quantity: 2 },
    ])

    await done(user, 'React', name)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await save(user, 'React')
    await writesHeld(holding, 1)
    holding.answer()
    await said('React', /^Saved the Order: 1 Order line row changed\.$/)
    expect(await plane.db.savedLines(engine.connection, order)).toEqual([
      { no: 1, quantity: 25 },
      { no: 2, quantity: 2 },
    ])
  })
})
