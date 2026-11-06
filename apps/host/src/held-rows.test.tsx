import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { STANDING_HELP } from './grid-datasource.js'
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

/**
 * `fetch` with each answer `holds` picks kept back after the server gave it,
 * until the test hands it over: a list the server answered before a save,
 * delivered after it. A request the page has abandoned meanwhile rejects
 * with its signal's reason, as the browser's does.
 */
function holdingAnswers(
  fetch: typeof globalThis.fetch,
  holds: (request: { path: string; body: string | undefined }) => boolean,
): { fetch: typeof globalThis.fetch; held: string[]; pass: () => Promise<void> } {
  const waiting: Array<() => void> = []
  const held: string[] = []
  return {
    held,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (!holds({ path, body: typeof init?.body === 'string' ? init.body : undefined })) return fetch(input, init)
      const reply = await fetch(input, init)
      held.push(path)
      await new Promise<void>((resolve) => waiting.push(resolve))
      held.splice(held.indexOf(path), 1)
      init?.signal?.throwIfAborted()
      return reply
    },
    pass: async () => {
      waiting.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

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

  // A new search refused stands over the last list's rows: Previous rows
  // and Next rows wait for it, said why by the line and its help, and a press
  // of Next rows sends nothing -- paging the last list would list rows the
  // search box no longer names, as though the search were applied (to be
  // watched failing in CI with the pager left to the last list: Next rows
  // was not aria-disabled).
  test('waits with Previous rows and Next rows while a new search refused stands', async () => {
    const notes = stamp('stands')
    const { held, holding } = await pages(notes)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
    holding.on = true
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), ' 5')
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await held.fail()
    await lineSays('The data server could not be reached.')
    for (const name of ['Previous rows', 'Next rows']) {
      expect(button(name).getAttribute('aria-disabled'), name).toBe('true')
      expect(computeAccessibleDescription(button(name)), name).toBe(`The data server could not be reached. ${STANDING_HELP}`)
    }
    await user.click(button('Next rows'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(held.held).toHaveLength(0)
    expect(button('Ask again')).toBeTruthy()
    holding.on = false
  })

  // Ask again is for what was refused last: a page refused, then the grid
  // answered by a save's reload, then that reload's next one refused -- Ask
  // again asks for the grid's own page, never the page refused before it,
  // which would move the person to rows they did not ask for (to be watched
  // failing in CI with the grid never telling the hook it was asked or
  // answered: "Rows 51–53.").
  test('asks again for what was refused last, not a page refused before an answer', async () => {
    const notes = stamp('last')
    const { held, holding } = await pages(notes)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
    holding.on = true
    await user.click(button('Next rows'))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await held.fail()
    await lineSays('The data server could not be reached.')
    holding.on = false
    await user.click(dataCell(records()))
    await screen.findByRole('heading', { level: 3, name: /^Order k1:/ }, ARRIVES)
    await shows('React', 'Notes', `${notes} 1`)
    await answer(user, 'React', 'Notes', `${notes} changed`)
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
    holding.on = true
    await answer(user, 'React', 'Notes', `${notes} again`)
    await save(user, 'React')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await held.fail()
    await lineSays('The data server could not be reached.')
    holding.on = false
    await user.click(button('Ask again'))
    await lineSays(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`)
  })

  // A save while a new sort is on its way lists that sort again, so what
  // the grid draws once it answers is what was saved -- not the list asked
  // before the save, nor the rows on screen, which answer the last list
  // under the new sort (to be watched failing in CI with a save's reload
  // left to AG Grid: the row showed its notes from before the save).
  test('lists what was saved when a save comes while a new sort is asked for', async () => {
    const notes = stamp('sorted')
    await plane.db.insertOrders(engine.connection, 2, notes)
    const holding = { on: false }
    const held = holdingAnswers(plane.fetch, ({ path, body }) => holding.on && path === lists && body?.includes(notes) === true)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays('Rows 1–2.')
    await user.click(dataCell(records()))
    await screen.findByRole('heading', { level: 3, name: /^Order k1:/ }, ARRIVES)
    await shows('React', 'Notes', `${notes} 1`)
    holding.on = true
    // Id ascending, from the keyboard: from the cell clicked, up through the header boxes' row to its header.
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await answer(user, 'React', 'Notes', `${notes} saved`)
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    holding.on = false
    while (held.held.length > 0) await held.pass()
    await waitFor(() => expect(shown()[0]).toContain(`${notes} saved`), ARRIVES)
  })

  // A press on a row while a new search is on its way opens that row's
  // record, and the search's rows follow once it is let go: given to AG Grid
  // during the press, they would be drawn over the row pressed, and the
  // release would open nothing (to be watched failing in CI with the list
  // given at once, as in run 42203470148: the record never opened).
  test('opens the row pressed while a new search is on its way', async () => {
    const notes = stamp('pressed')
    await plane.db.insertOrders(engine.connection, 2, notes)
    const holding = { on: false }
    const held = holdingRequests(plane.fetch, ({ path, body }) => holding.on && path === lists && body?.includes(notes) === true)
    const user = await searched(held.fetch, engine.formId, notes)
    await lineSays('Rows 1–2.')
    const cell = dataCell(records())
    const key = cell.textContent ?? ''
    holding.on = true
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), ' 2')
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await user.pointer({ keys: '[MouseLeft>]', target: cell })
    holding.on = false
    await held.pass()
    // The search answered while the pointer is down: a few ticks for the page to hold it back.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await user.pointer({ keys: '[/MouseLeft]', target: cell })
    await screen.findByRole('heading', { level: 3, name: `Order k1:${key}` }, ARRIVES)
    await lineSays('Rows 1–1.')
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
