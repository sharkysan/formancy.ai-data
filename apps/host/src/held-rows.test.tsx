import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { answer, chooseForm, dataCell, dataRows, gridSection, gridStatus, mount, pane, said, save, shows, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { holdingRequests, holdingWrites } from './test-network.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The page says what the server did (0146), on both engines against the
 * real server: the rows on screen stay while the next page, or a new
 * list's first, is asked for, and a refusal leaves them there, no longer
 * dimmed; what the server answered -- a page, a save -- is said in the
 * room's teal for a moment, and the page's own sentences and a save still
 * out are not. The next page is held before it is sent (test-network.ts),
 * as a slow server holds it.
 *
 * Found by role and accessible name (formancy.ai 0034), with two reads the
 * accessibility tree cannot answer, made where they are: whether the grid's
 * well is marked waiting -- the attribute the room's stylesheet dims it by,
 * on an element with no role -- and the element a line's words are drawn
 * in teal in, which has none either (server-did.test.tsx). What the dim and
 * the teal look like, and their contrast, the browser gate measures
 * (scripts/browser/waiting.mjs).
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }

const records = (): HTMLElement => within(gridSection('Records')).getByRole('grid', { name: 'Records' })
/** Every data row of the Records grid, as its cells' text. */
const shown = (): string[] => dataRows(records()).map((row) => row.textContent ?? '')
/** Whether the grid's well is marked waiting: a DOM read, since the well has no role. */
const waiting = (): boolean => records().closest('.grid-bench')?.hasAttribute('data-waiting') ?? false
/** The words a status line draws in teal, or null: a DOM read, since that element has no role. */
const teal = (line: HTMLElement | undefined): Element | null => line?.querySelector('.server-did') ?? null
const button = (name: string): HTMLElement => within(gridSection('Records')).getByRole('button', { name })
const lineSays = (text: string): Promise<void> => waitFor(() => expect(gridStatus('Records')?.textContent).toBe(text), ARRIVES)

/** The page on `fetch`, signed in, `formId` chosen, and its records searched for `words`. */
async function searched(fetch: typeof globalThis.fetch, formId: string, words: string): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  const search = screen.getByRole('search', { name: 'Search records' })
  await user.type(within(search).getByRole('textbox', { name: 'Search' }), words)
  await user.click(within(search).getByRole('button', { name: 'Search' }))
  return user
}

describe.each(ENGINES)('what the server did, on $engine', (engine) => {
  const lists = `/v1/forms/${engine.formId}/records/list`

  /** A page and three rows more, all carrying `notes`, and the page holding every list asked for them while `holding.on`. */
  async function pages(notes: string): Promise<{ held: ReturnType<typeof holdingRequests>; holding: { on: boolean } }> {
    await plane.db.insertOrders(engine.connection, LIST_PAGE_SIZE + 3, notes)
    const holding = { on: false }
    const held = holdingRequests(plane.fetch, ({ path, body }) => holding.on && path === lists && body?.includes(notes) === true)
    return { held, holding }
  }

  // Next rows asks for the next page before the grid is shown it: the rows
  // on screen stay, the well marked waiting -- which the stylesheet dims --
  // while the line says what is asked; then the next rows, and nothing
  // waiting. That AG Grid says it is busy meanwhile is the browser gate's
  // (to be watched failing in CI with the grid's rows taken away while the
  // next page is asked for, as AG Grid's empty block did before 0146, and
  // given back once it answers: the grid held no rows while it was asked
  // for).
  test('keeps the rows shown, dimmed, while the next page is asked for', async () => {
    const notes = stamp('held')
    const { held, holding } = await pages(notes)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
    const before = shown()
    expect(before).toHaveLength(LIST_PAGE_SIZE)
    holding.on = true
    await user.click(button('Next rows'))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    expect(gridStatus('Records')?.textContent).toBe(`Loading rows ${String(LIST_PAGE_SIZE + 1)}–${String(2 * LIST_PAGE_SIZE)}.`)
    expect(shown()).toEqual(before)
    expect(waiting()).toBe(true)
    holding.on = false
    await held.pass()
    await lineSays(`Rows ${String(LIST_PAGE_SIZE + 1)}–${String(LIST_PAGE_SIZE + 3)}.`)
    expect(shown()).toHaveLength(3)
    expect(waiting()).toBe(false)
  })

  // A page asked for first and refused leaves the grid where it was, no
  // longer waiting, with the server's sentence and Ask again, which asks for
  // that page and shows it (to be watched failing in CI with Ask again
  // asking AG Grid for its own page again: the first page came back, "Rows
  // 1–50; more follow.").
  test('asks again for the page that was refused, and shows it', async () => {
    const notes = stamp('again')
    const { held, holding } = await pages(notes)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
    holding.on = true
    await user.click(button('Next rows'))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await held.fail()
    await lineSays('The data server could not be reached.')
    expect(waiting()).toBe(false)
    await user.click(button('Ask again'))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    holding.on = false
    await held.pass()
    await lineSays(`Rows ${String(LIST_PAGE_SIZE + 1)}–${String(LIST_PAGE_SIZE + 3)}.`)
  })

  // Next rows pressed again while the next page is asked for sends nothing:
  // the answer coming is the one the person waits for, and a page asked
  // after it would have no row to start from (0108) (to be watched failing
  // in CI with the second press asking again: two requests held).
  test('sends nothing for a second press while the next page is asked for', async () => {
    const notes = stamp('twice')
    const { held, holding } = await pages(notes)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
    holding.on = true
    await user.click(button('Next rows'))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await user.click(button('Next rows'))
    // A few ticks, by when a second request would be on its way.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(held.held).toHaveLength(1)
    holding.on = false
    while (held.held.length > 0) await held.pass()
  })

  // A new search refused leaves the rows of the list before it on screen,
  // no longer waiting, the server's sentence on the line, never an empty
  // grid (to be watched failing in CI with the rows taken away on a new
  // list's refusal: the grid held none).
  test('keeps the rows shown, no longer dimmed, when a new list is refused', async () => {
    const notes = stamp('kept')
    await plane.db.insertOrders(engine.connection, 3, notes)
    const holding = { on: false }
    const held = holdingRequests(plane.fetch, ({ path, body }) => holding.on && path === lists && body?.includes(notes) === true)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays('Rows 1–3.')
    const before = shown()
    holding.on = true
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), ' none')
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    expect(shown()).toEqual(before)
    await held.fail()
    await lineSays('The data server could not be reached.')
    expect(shown()).toEqual(before)
    expect(waiting()).toBe(false)
  })

  // A page the server answered is said in teal, and so is "No records
  // match": both are what it did. A sentence of the page's own -- the open
  // record's row not on this page -- is not, though it is said on the same
  // line (to be watched failing in CI with the page's own sentences counted
  // as the server's: "Record … is not on this page." in teal).
  test("says a page the server answered in its teal, and a sentence of the page's own not", async () => {
    const notes = stamp('teal')
    await plane.db.insertOrders(engine.connection, 2, notes)
    const user = await searched(plane.fetch, engine.formId, notes)
    await lineSays('Rows 1–2.')
    expect(teal(gridStatus('Records'))?.textContent).toBe('Rows 1–2.')
    await user.click(dataCell(records()))
    const heading = await screen.findByRole('heading', { level: 3, name: /^Order k1:/ }, ARRIVES)
    const record = (heading.textContent ?? '').slice('Order '.length)
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), ' none')
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await lineSays(`No records match “${notes} none”.`)
    expect(teal(gridStatus('Records'))?.textContent).toBe(`No records match “${notes} none”.`)
    await user.click(screen.getByRole('button', { name: 'Go to its row' }))
    await lineSays(`Record ${record} is not on this page.`)
    expect(teal(gridStatus('Records'))).toBeNull()
  })

  // A save the server answered is said in teal on the pane's line, and a
  // save still out -- "Saving…" -- is not: the server has done nothing yet
  // (to be watched failing in CI with no save said as the server's: "Saved."
  // in the line's own colour from the start).
  test('says a save the server answered in its teal, and a save still out not', async () => {
    const notes = stamp('saved')
    await plane.db.insertOrders(engine.connection, 1, notes)
    const holding = holdingWrites(plane.fetch)
    const user = await searched(holding.fetch, engine.formId, notes)
    await lineSays('Rows 1–1.')
    await user.click(dataCell(records()))
    await screen.findByRole('heading', { level: 3, name: /^Order k1:/ }, ARRIVES)
    const line = (): HTMLElement | undefined => within(pane('React')).getAllByRole('status')[0]
    await shows('React', 'Notes', `${notes} 1`)
    await answer(user, 'React', 'Notes', `${notes} changed`)
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    expect(line()?.textContent).toBe('Saving…')
    expect(teal(line())).toBeNull()
    holding.answer()
    await said('React', /^Saved\.$/)
    expect(teal(line())?.textContent).toBe('Saved.')
  })
})
