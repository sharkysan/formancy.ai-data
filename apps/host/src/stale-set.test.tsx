import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { notice, RENDERERS, said, showChild, stamp, unsavedNotice } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { done, openRows, recordSave, rowAnswer, rowCell, rowsLine, rowsSay, rowsTab, rowTexts, savedBeside } from './test-rows.js'
import { MOVED } from './together.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Two people saving lines of one order (0155): every save moves the
 * order's version, so the second save is stale at the order even where
 * the two changed different lines. Where the second changed only lines,
 * Keep my line changes reads the order again and keeps each line's change
 * at the version it was read at, and Save then stores them -- guarded line
 * by line, so a line the first person changed too is refused at that
 * line, and Load this line takes it as stored. Keep my line changes and
 * Load the saved record ask first where they would drop work: what was
 * typed into the order, or the lines' changes.
 *
 * The first person is the clerk beside the page, saving through the
 * client, or the database's owner; the second is the page, in each
 * renderer, on both engines.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ saves: true })
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

/** Line `key` opened on the rail in the page, its quantity typed, and Done. */
async function changeLine(user: User, renderer: RendererName, key: string, quantity: string): Promise<void> {
  await user.click(rowCell(key))
  await rowAnswer(user, renderer, `Order line k1:${key}`, 'Quantity', quantity)
  await done(user, renderer, `Order line k1:${key}`)
  await waitFor(() => expect(rowTexts().find((row) => row[0] === key)?.[4]).toBe('Changed'), ARRIVES)
}

/** The stale notice a save opens in a pane, once it is there. */
async function staleNotice(renderer: RendererName): Promise<HTMLElement> {
  return waitFor(() => {
    const found = notice(renderer)
    if (found === null) throw new Error(`no notice in ${renderer}`)
    return found
  }, ARRIVES)
}

/** The guard's question, once it is asked. */
async function asking(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = unsavedNotice()
    if (found === null) throw new Error('the page asked nothing')
    return found
  }, ARRIVES)
}

/** A line of the page changed, one changed beside it, and the page's Save stale at the order: its notice. */
async function staleAfter(user: User, renderer: RendererName, engine: Engine, record: string, mine: string): Promise<HTMLElement> {
  await changeLine(user, renderer, mine, '8')
  await savedBeside(plane, engine, record, 1, 5)
  await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
  await user.click(recordSave(renderer))
  return staleNotice(renderer)
}

describe.each(ENGINES)('two people saving one order’s lines on $engine', (engine) => {
  // The second save is stale at the order though it changed another line;
  // Keep my line changes reads the order again and keeps the page's line,
  // and lists the other person's; Save then stores it, and both changes
  // are in the database (watched failing with Keep listing the lines
  // afresh: the page's line was gone).
  test.each(RENDERERS)('in %s, the second is stale, keeps its line changes, and then saves them', async (renderer) => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('kept'), 2)
    const user = await openRows(plane, engine, record)
    const [, second] = rowTexts().map((row) => String(row[0]))
    const stale = await staleAfter(user, renderer, engine, record, String(second))
    await waitFor(() => expect(focusedName()).toBe(`${renderer} Not saved`), ARRIVES)
    expect(within(stale).getByText('This record or its rows changed since they were read. Reload them, review the changes, and save again.')).toBeTruthy()
    await user.click(within(stale).getByRole('button', { name: 'Keep my line changes' }))
    await said(renderer, /^Read the record again at its new version\. The changes to its rows are kept/)
    await waitFor(() => expect(focusedName()).toBe(renderer), ARRIVES)
    await showChild(user, 'Order line')
    await waitFor(
      () =>
        expect(rowTexts().map((row) => row.slice(1, 5))).toEqual([
          ['1', '5', '', ''],
          ['2', '8', '', 'Changed'],
        ]),
      ARRIVES,
    )
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    await said(renderer, /^Saved the Order: 1 Order line row changed\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 5 },
      { no: 2, quantity: 8 },
    ])
  })

  // What was typed into the order after the stale answer is not dropped by
  // Keep my line changes without a word: it reads the order again over
  // that typing, so the guard asks first, naming the order in the pane;
  // Keep editing leaves everything, the keyboard back on Keep my line
  // changes; and Discard and continue reads the order as stored and keeps
  // the line, saying the typing was discarded (watched failing with Keep
  // reading the order again unasked: the page asked nothing).
  test('Keep my line changes asks first where the order was typed into since', async () => {
    const renderer = 'React'
    const note = stamp('typed')
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('keep-typed'), 2)
    const user = await openRows(plane, engine, record)
    const [, second] = rowTexts().map((row) => String(row[0]))
    const stale = await staleAfter(user, renderer, engine, record, String(second))
    const paper = screen.getByRole('form', { name: `Order, ${renderer}` })
    const typed = within(paper).getByLabelText<HTMLInputElement>(/^Note\b/)
    await user.clear(typed)
    await user.type(typed, note)
    await user.click(within(stale).getByRole('button', { name: 'Keep my line changes' }))
    let asked = await asking()
    expect(within(asked).getByRole('list').textContent).toBe(`Order ${record}, React: changes that are not saved.`)
    await user.click(within(asked).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(focusedName()).toBe('Keep my line changes'), ARRIVES)
    expect(within(screen.getByRole('form', { name: `Order, ${renderer}` })).getByLabelText<HTMLInputElement>(/^Note\b/).value).toBe(note)

    await user.click(within(stale).getByRole('button', { name: 'Keep my line changes' }))
    asked = await asking()
    await user.click(within(asked).getByRole('button', { name: 'Discard and continue' }))
    await said(renderer, /^Read the record again at its new version, and discarded what you typed into it\. The changes to its rows are kept/)
    expect(within(screen.getByRole('form', { name: `Order, ${renderer}` })).getByLabelText<HTMLInputElement>(/^Note\b/).value).not.toBe(note)
    await showChild(user, 'Order line')
    await waitFor(() => expect(rowTexts()[1]?.slice(1, 5)).toEqual(['2', '8', '', 'Changed']), ARRIVES)
  })

  // A line both people changed: after Keep my line changes the page's line
  // is said to be changed by someone else, and the next Save is refused at
  // that line, its tab shown and its rail open on it, nothing stored; Load
  // this line takes it as stored, the page's change to it discarded
  // (watched failing with the moved line taken at the version it was
  // listed at: marked Changed alone, and, its mark kept, saved over the
  // other person's change with nothing said).
  test('a line both changed is refused at that line, and Load this line takes it as stored', async () => {
    const renderer = 'React'
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('both'), 2)
    const user = await openRows(plane, engine, record)
    const [first] = rowTexts().map((row) => String(row[0]))
    await changeLine(user, renderer, String(first), '9')
    await savedBeside(plane, engine, record, 1, 4)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    const stale = await staleNotice(renderer)
    await user.click(within(stale).getByRole('button', { name: 'Keep my line changes' }))
    await said(renderer, /^Read the record again at its new version\./)
    await showChild(user, 'Order line')
    await waitFor(() => expect(rowTexts()[0]?.slice(1, 5)).toEqual(['1', '9', '', 'Changed by someone else']), ARRIVES)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    await rowsSay(/This record or its rows changed since they were read\./)
    await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
    expect(within(rowsTab()).getByText(MOVED)).toBeTruthy()
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 4 },
      { no: 2, quantity: 2 },
    ])
    await user.click(within(rowsTab()).getByRole('button', { name: 'Load this line' }))
    await waitFor(() => expect(rowTexts()[0]?.slice(1, 5)).toEqual(['1', '4', '', '']), ARRIVES)
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3. You may not remove saved rows here.')
  })

  // A line deleted by someone else after the page changed it: the order's
  // Save is refused at that line, which is said changed by someone else
  // and opened on the rail, and Load this line takes it off the page with
  // its rail, the tab's line saying it was deleted and the page's change to
  // it discarded, and the keyboard on the tab's heading rather than the
  // page (watched failing with a line the save found gone left as it was:
  // marked Changed, with no Load this line; and with Load this line saying
  // it loaded the line as stored: the rail was gone with its line, and the
  // keyboard was on the page itself).
  test('a line deleted beside the page is taken off it by Load this line, and said', async () => {
    const renderer = 'Angular'
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('gone'), 2)
    const user = await openRows(plane, engine, record)
    const [first] = rowTexts().map((row) => String(row[0]))
    await changeLine(user, renderer, String(first), '9')
    await plane.db.deleteSavedLine(engine.connection, record, 1)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
    await waitFor(() => expect(rowTexts().find((row) => row[0] === first)?.[4]).toBe('Changed by someone else'), ARRIVES)
    await user.click(await within(rowsTab()).findByRole('button', { name: 'Load this line' }, ARRIVES))
    await rowsSay(
      `1 Order line row; each Order holds 1 to 3. You may not remove saved rows here. Order line k1:${String(first)} was deleted by someone else: your change to it was discarded.`,
    )
    await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
    expect(within(rowsTab()).queryByRole('button', { name: 'Load this line' })).toBeNull()
    expect(rowTexts().map((row) => row[0])).not.toContain(first)
  })

  // Load the saved record after a stale save of lines drops every line's
  // change with the order's, so the guard asks first, naming the order with
  // what its lines hold, since they sit in another tab: Keep editing keeps
  // them, the keyboard back on the button, and Discard and continue lists
  // the lines as stored, the other person's among them, nothing marked
  // (watched failing with the session loading the record alone: the lines
  // as they were drafted; and with Load the saved record dropping the
  // lines unasked: no question).
  test('Load the saved record asks first, and drops the lines’ changes with the order’s', async () => {
    const renderer = 'Angular'
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('loaded'), 2)
    const user = await openRows(plane, engine, record)
    const [, second] = rowTexts().map((row) => String(row[0]))
    const stale = await staleAfter(user, renderer, engine, record, String(second))
    await user.click(within(stale).getByRole('button', { name: 'Load the saved record' }))
    let asked = await asking()
    expect(within(asked).getByRole('list').textContent).toBe(`Order ${record} with 1 Order line row changed: changes that are not saved.`)
    await user.click(within(asked).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(focusedName()).toBe('Load the saved record'), ARRIVES)
    await user.click(within(stale).getByRole('button', { name: 'Load the saved record' }))
    asked = await asking()
    await user.click(within(asked).getByRole('button', { name: 'Discard and continue' }))
    await said(renderer, /^Loaded the saved record\. Your changes were discarded\.$/)
    await showChild(user, 'Order line')
    await waitFor(
      () =>
        expect(rowTexts().map((row) => row.slice(1, 5))).toEqual([
          ['1', '5', '', ''],
          ['2', '2', '', ''],
        ]),
      ARRIVES,
    )
  })
})
