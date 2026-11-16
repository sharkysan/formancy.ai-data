import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { notice, RENDERERS, said, showChild, stamp } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { done, openRows, recordSave, rowAnswer, rowCell, rowsLine, rowsSay, rowsTab, rowTexts, savedBeside } from './test-rows.js'
import { MOVED } from './together.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * Two people saving lines of one order (0155): every save moves the
 * order's version, so the second save is stale at the order even where
 * the two changed different lines. Where the second changed only lines,
 * Keep my line changes reads the order again and keeps each line's change
 * at the version it was read at, and Save then stores them -- guarded line
 * by line, so a line the first person changed too is refused at that
 * line, and Load this line takes it as stored.
 *
 * The first person is the clerk beside the page, saving through the
 * client; the second is the page, in each renderer, on both engines.
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

describe.each(ENGINES)('two people saving one order’s lines on $engine', (engine) => {
  // The second save is stale at the order though it changed another line;
  // Keep my line changes reads the order again and keeps the page's line,
  // and lists the other person's; Save then stores it, and both changes
  // are in the database.
  test.each(RENDERERS)('in %s, the second is stale, keeps its line changes, and then saves them', async (renderer) => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('kept'), 2)
    const user = await openRows(plane, engine, record)
    const [first, second] = rowTexts().map((row) => String(row[0]))
    await changeLine(user, renderer, String(second), '8')
    await savedBeside(plane, engine, record, 1, 5)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    const stale = await staleNotice(renderer)
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
    void first
  })

  // A line both people changed: after Keep my line changes the page's line
  // is said to be changed by someone else, and the next Save is refused at
  // that line, its tab shown and its rail open on it, nothing stored; Load
  // this line takes it as stored, the page's change to it discarded.
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
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3. You may not remove them here.')
  })

  // Load the saved record after a stale save of lines drops every line's
  // change with the order's: the lines as stored, the other person's
  // among them, and nothing marked.
  test('Load the saved record drops the lines’ changes with the order’s', async () => {
    const renderer = 'Angular'
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('loaded'), 2)
    const user = await openRows(plane, engine, record)
    const [, second] = rowTexts().map((row) => String(row[0]))
    await changeLine(user, renderer, String(second), '8')
    await savedBeside(plane, engine, record, 1, 6)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    const stale = await staleNotice(renderer)
    await user.click(within(stale).getByRole('button', { name: 'Load the saved record' }))
    await said(renderer, /^Loaded the saved record\. Your changes were discarded\.$/)
    await showChild(user, 'Order line')
    await waitFor(
      () =>
        expect(rowTexts().map((row) => row.slice(1, 5))).toEqual([
          ['1', '6', '', ''],
          ['2', '2', '', ''],
        ]),
      ARRIVES,
    )
  })
})
