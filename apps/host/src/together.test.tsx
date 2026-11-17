import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import {
  chooseForm,
  chooseRenderer,
  dataRows,
  gridSection,
  load,
  loaded,
  mount,
  newRecord,
  pane,
  RENDERERS,
  said,
  searchRecords,
  showChild,
  signIn,
  stamp,
} from './test-host.js'
import { done, openRows, recordSave, rowAnswer, rowCell, rowControl, rowPaper, rowsDrawn, rowsLine, rowsSay, rowsTab, rowTexts } from './test-rows.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A record's rows saved with it, through the page (0155): an order's lines
 * in a tab beside it, held there until the order's own Save -- each
 * change said in words, Add and Remove drawn only inside the bounds and
 * where the menu lets this person, the field that names the order left
 * out of a line's form, and the keyboard where each action leaves it.
 *
 * On both engines and both renderers, against the real server, over the
 * parity schema's order and its lines, one to three of them: a clerk may
 * add and change lines, and only a remover may remove one.
 *
 * Found by role and accessible name. What the accessibility tree cannot
 * answer is read off the DOM: which grid row holds the keyboard
 * (`focusedRow`), by the focused element's nearest `role="row"`, since
 * AG Grid focuses a cell of the row, or hands the keyboard to a button in
 * it, and the tree gives the row itself no state that says the keyboard is
 * in it.
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

/** The first cell of the grid row the keyboard is in: AG Grid's focused cell, or the button it handed the keyboard to. Read off the DOM: see the header. */
const focusedRow = (): string | undefined => document.activeElement?.closest('[role="row"]')?.querySelector('[role="gridcell"]')?.textContent ?? undefined

/** The focused element, once it is a renderer's summary of a form's problems, found by its heading. */
async function focusedSummary(): Promise<HTMLElement> {
  return waitFor(() => {
    const focused = document.activeElement as HTMLElement
    within(focused).getByRole('heading', { name: /^There (is|are) \d+ problems? to fix$/ })
    return focused
  }, ARRIVES)
}

describe.each(ENGINES)('an order’s lines saved with it on $engine', (engine) => {
  // Each change is held on the page and said in words in a column of its
  // own, nothing sent until the order's Save, which sends them with it: a
  // line changed, and one added, in the renderer pressed (watched failing
  // with the session never carrying the rows: "Saved." and the lines as
  // they were). The line's form has no field naming the order, which the
  // save supplies (with it left in: a Saved order control on the rail).
  // Enter on a line puts the keyboard on the rail's heading, Done gives it
  // back to the line's row, Add puts it in the new line's first field, and
  // Go to Save on the order's Save. The line's mark follows its first
  // keystroke, not Done (with the set told of typing only at Done: no mark
  // until then). A clerk may add a line and take it off again before Save,
  // but not remove a saved one, and the line says so in those words (with
  // the line saying "You may not remove them here" while a new line had
  // its Remove: the page contradicted its own button).
  test.each(RENDERERS)('in %s, a line changed and one added are held, said in words, and saved by the order’s own Save', async (renderer) => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('held'), 2)
    const user = await openRows(plane, engine, record)
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3. You may not remove saved rows here.')
    expect(within(rowsTab()).queryAllByRole('button', { name: /^Remove / })).toEqual([])
    const [first, second] = rowTexts()
    expect([first?.slice(1, 5), second?.slice(1, 5)]).toEqual([
      ['1', '1', '', ''],
      ['2', '2', '', ''],
    ])
    const line = `Order line k1:${String(first?.[0])}`

    // Enter on a line opens it on the rail, the keyboard on its heading.
    rowCell(String(first?.[0])).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(line), ARRIVES)
    await waitFor(() => rowControl(renderer, line, 'Quantity'), ARRIVES)
    expect(within(rowPaper(renderer, line)).queryByLabelText(/^Saved order\b/)).toBeNull()
    await rowAnswer(user, renderer, line, 'Quantity', '7')
    // The mark follows the first keystroke, not Done.
    await waitFor(() => expect(rowTexts()[0]?.[4]).toBe('Changed'), ARRIVES)
    await done(user, renderer, line)
    // Done closes the rail and gives the keyboard back to the line's row.
    await waitFor(() => expect(within(rowsTab()).queryByRole('form', { name: `${line}, ${renderer}` })).toBeNull(), ARRIVES)
    await waitFor(() => expect(focusedRow()).toBe(String(first?.[0])), ARRIVES)
    await waitFor(() => expect(rowTexts()[0]?.slice(1, 5)).toEqual(['1', '7', '', 'Changed']), ARRIVES)

    // Add starts a new line on the rail with the keyboard in its first field.
    await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
    await waitFor(() => expect(focusedName()).toMatch(/^Line no\b/), ARRIVES)
    await rowAnswer(user, renderer, 'New Order line 1', 'Line no', '3')
    await rowAnswer(user, renderer, 'New Order line 1', 'Quantity', '4')
    await done(user, renderer, 'New Order line 1')
    await waitFor(() => expect(rowTexts()[2]?.slice(1, 5)).toEqual(['3', '4', '', 'New']), ARRIVES)
    // At three lines Add is gone, and the line says why and what is held; the new line is the clerk's to take off.
    expect(within(rowsTab()).queryByRole('button', { name: 'Add Order line' })).toBeNull()
    expect(within(rowsTab()).getByRole('button', { name: 'Remove New Order line 1' })).toBeTruthy()
    expect(rowsLine()).toBe(
      '3 Order line rows; each Order holds 1 to 3, so none can be added. You may not remove saved rows here. 1 Order line row added and 1 changed. Saved with the Order.',
    )
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 1 },
      { no: 2, quantity: 2 },
    ])

    // Go to Save shows the order's tab and puts the keyboard on its Save; nothing is sent.
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await waitFor(() => expect(document.activeElement).toBe(recordSave('React')), ARRIVES)
    await user.click(recordSave(renderer))
    await said(renderer, /^Saved the Order: 1 Order line row added and 1 changed\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 7 },
      { no: 2, quantity: 2 },
      { no: 3, quantity: 4 },
    ])
    await showChild(user, 'Order line')
    await rowsSay('3 Order line rows; each Order holds 1 to 3, so none can be added. You may not remove saved rows here.')
    expect(rowTexts().map((row) => row[4])).toEqual(['', '', ''])
  })

  // Remove is in the line's own last column, absent at the order's least
  // lines, and marks the line to be deleted, saying so, the button becoming
  // Undo remove with the keyboard left on it; nothing is asked, as nothing
  // is deleted until Save (watched failing with Remove drawn at the bound:
  // a Remove on the last line; and with the menu's flags ignored: the
  // clerk's line said nothing of removing). A clerk the policy grants no
  // delete has no Remove of a saved line at all, and the line says so (the
  // case above). At the most lines Undo remove is gone too, since it would
  // hold one past them, and the line says why (with Undo remove drawn at
  // the bound: four lines held under a bound of three, which only the
  // server refused).
  test('Remove and Undo remove inside the bounds, as the menu lets this person, and the delete saved with the order', async () => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('removed'), 2)
    const user = await openRows(plane, engine, record, TOKENS.remover)
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3.')
    const [, second] = rowTexts()
    const key = String(second?.[0])
    within(rowsTab())
      .getByRole('button', { name: `Remove Order line k1:${key}` })
      .focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Undo remove Order line k1:${key}`), ARRIVES)
    expect(rowTexts()[1]?.slice(1, 5)).toEqual(['2', '2', '', 'To be deleted'])
    // One line left: the other's Remove is gone, and the line says why.
    expect(within(rowsTab()).queryAllByRole('button', { name: /^Remove / })).toEqual([])
    expect(rowsLine()).toBe('1 Order line row; each Order holds 1 to 3, so none can be removed. 1 Order line row to be deleted. Saved with the Order.')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Remove Order line k1:${key}`), ARRIVES)
    expect(rowTexts()[1]?.slice(1, 5)).toEqual(['2', '2', '', ''])
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3.')

    // Removed, then two added up to the most: Undo remove would be a fourth, so it is not there, and the line says why.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Undo remove Order line k1:${key}`), ARRIVES)
    for (const no of ['3', '4']) {
      await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
      const name = `New Order line ${String(Number(no) - 2)}`
      await rowAnswer(user, 'React', name, 'Line no', no)
      await rowAnswer(user, 'React', name, 'Quantity', no)
      await done(user, 'React', name)
    }
    await rowsSay(/^3 Order line rows; each Order holds 1 to 3, so none can be added or restored\. /)
    expect(within(rowsTab()).queryByRole('button', { name: `Undo remove Order line k1:${key}` })).toBeNull()
    await user.click(within(rowsTab()).getByRole('button', { name: 'Remove New Order line 2' }))
    await within(rowsTab()).findByRole('button', { name: `Undo remove Order line k1:${key}` }, ARRIVES)
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3. 1 Order line row added and 1 to be deleted. Saved with the Order.')

    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave('Angular'))
    await said('Angular', /^Saved the Order: 1 Order line row added and 1 deleted\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([
      { no: 1, quantity: 1 },
      { no: 3, quantity: 3 },
    ])
    await showChild(user, 'Order line')
    await rowsSay('2 Order line rows; each Order holds 1 to 3.')
  })

  // A new order's lines' tab is there at once, not once it is saved, and
  // drawn with the order's tabs: a Save pressed before it was ever shown,
  // with fewer lines than the order must hold, is refused at the tab, which
  // is shown with the keyboard on its heading and the bound in the page's
  // words; and the order is created with the lines added, in one save
  // (watched failing with the tab drawn only once shown: the order's pane
  // took the refusal; and with the bound in the server's words: the line
  // named the line form's id).
  test.each(RENDERERS)('in %s, a new order holds its lines on the page and is created with them, or refused at the tab', async (renderer) => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.savedOrder)
    await chooseRenderer(user)
    await newRecord(user)
    const note = stamp('new')
    const paper = await waitFor(() => screen.getByRole('form', { name: `Order, ${renderer}` }), ARRIVES)
    await waitFor(() => within(paper).getByLabelText(/^Note\b/), ARRIVES)
    await user.type(within(paper).getByLabelText(/^Note\b/), note)
    await user.click(recordSave(renderer))
    await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
    expect(rowsLine()).toBe('0 Order line rows; each Order holds 1 to 3. Each Order holds at least 1 Order line row; this save would leave it 0.')
    expect(await plane.db.countSavedOrders(engine.connection, note)).toBe(0)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    expect(within(pane(renderer)).getAllByRole('status')[0]?.textContent).toBe(
      'Not saved. Each Order holds at least 1 Order line row; this save would leave it 0.',
    )
    await showChild(user, 'Order line')

    await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
    await rowAnswer(user, renderer, 'New Order line 1', 'Line no', '1')
    await rowAnswer(user, renderer, 'New Order line 1', 'Quantity', '2')
    await done(user, renderer, 'New Order line 1')
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    const created = await said(renderer, /^Created record k1:\d+ with 1 Order line row\.$/)
    const token = /(k1:\d+)/.exec(created)?.[1] ?? ''
    expect(await plane.db.savedLines(engine.connection, token)).toEqual([{ no: 1, quantity: 2 }])
    expect(await plane.db.countSavedOrders(engine.connection, note)).toBe(1)
  })

  // A line whose own form refuses its answers sends nothing at the order's
  // Save: the lines' tab is shown, the rail open on the line, and the
  // keyboard on its form's summary of what to fix, while the order's line
  // says a row holds it back (watched failing with take() handing on a
  // line its form refused: the save went out, and the server refused it,
  // "line_no cannot be written").
  test.each(RENDERERS)('in %s, a line its form refuses is opened with its problems, and nothing is sent', async (renderer) => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('unfit'), 1)
    const user = await openRows(plane, engine, record)
    plane.sent.length = 0
    await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
    await rowAnswer(user, renderer, 'New Order line 1', 'Quantity', '3')
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave(renderer))
    const summary = await focusedSummary()
    expect(RENDERERS.some((each) => rowPaper(each, 'New Order line 1').contains(summary))).toBe(true)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await said(renderer, /^Not saved\. A row saved with it has answers to fix first: it is open in its tab\.$/)
    expect(plane.sent.filter((request) => request.path.endsWith('/records/save'))).toEqual([])
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([{ no: 1, quantity: 1 }])
  })

  // A line the database refuses -- its quantity below zero, which the
  // line's check holds -- refuses the whole save at that line: nothing is
  // stored, the lines' tab is shown with the rail open on the line, and the
  // keyboard is on the tab's heading, the tab's line saying the server's
  // words, since neither engine names the column of a check (watched
  // failing with a refusal about a row that names no field said on the
  // order's pane alone: the keyboard went to its Not saved notice).
  test('a line the database refuses refuses the save at that line, opened on its tab', async () => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('checked'), 1)
    const user = await openRows(plane, engine, record)
    const [first] = rowTexts().map((row) => String(row[0]))
    const line = `Order line k1:${String(first)}`
    await user.click(rowCell(String(first)))
    await rowAnswer(user, 'React', line, 'Quantity', '-1')
    await done(user, 'React', line)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave('React'))
    await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
    await rowsSay(/ The database does not accept this value\.$/)
    expect(rowPaper('React', line)).toBeTruthy()
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await said('React', /^Not saved\. The database does not accept this value\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([{ no: 1, quantity: 1 }])
  })

  // An order holding more lines than the form allows -- written beside it,
  // as another application may -- shows them read only and says so: no
  // Add, no Remove, to a remover too, no Go to Save, and a line's form
  // opened with nothing to type into (watched failing with mayOf ignoring
  // the count: the line said only that none could be added).
  test('an order holding more lines than the form allows shows them read only', async () => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('over'), 4)
    const user = await openRows(plane, engine, record, TOKENS.remover)
    expect(rowsLine()).toBe('4 Order line rows: more than each Order holds through this form, at most 3, so they are read only here.')
    expect(within(rowsTab()).queryByRole('button', { name: 'Add Order line' })).toBeNull()
    expect(within(rowsTab()).queryAllByRole('button', { name: /^Remove / })).toEqual([])
    expect(within(rowsTab()).queryByRole('button', { name: 'Go to Save' })).toBeNull()
    const [first] = rowTexts().map((row) => String(row[0]))
    await user.click(rowCell(String(first)))
    const quantity = await waitFor(() => rowControl('React', `Order line k1:${String(first)}`, 'Quantity'), ARRIVES)
    expect(quantity.disabled).toBe(true)
  })

  // The line form opened on its own says its lines are added and removed
  // with their order, named by the form it opens in, and offers neither
  // New record nor a Delete, to a remover too, who may delete a line in a
  // save of its order (watched failing with savedWith answering null: no
  // such sentence under the form's heading).
  test('the line form opened on its own says its lines are saved with their order, and offers no New and no Delete', async () => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('alone'), 1)
    const listed = await plane.clerk.list(engine.savedLines, { parent: { field: 'saved_order', record } })
    const token = listed.ok ? (listed.value.rows[0]?.record ?? '') : ''
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.remover)
    await chooseForm(user, engine.savedLines)
    expect(
      await screen.findByText('Order line rows are added and removed with their Order, in its own save; a change to one made here is saved by itself.'),
    ).toBeTruthy()
    expect(within(gridSection('Records')).queryByRole('button', { name: 'New record' })).toBeNull()
    await load(user, token)
    await loaded(token, 'Order line')
    expect(screen.queryByRole('button', { name: 'Delete record' })).toBeNull()
    expect(within(gridSection('Records')).queryAllByRole('button', { name: /^Delete / })).toEqual([])
  })

  // In Drill down the order's lines are its tab as in Side by side, and a
  // line opens on that tab's rail, not a level below, since its change is
  // the order's save's (0090 narrowed); the order's Save stores it
  // (watched failing with the together tab drawn as a child section while
  // drilling: a child section's grid, its line "Order line rows 1–1.").
  test('in Drill down a line opens on the tab’s rail, and the order’s Save stores it', async () => {
    const note = stamp('drill')
    const record = await plane.db.insertSavedOrder(engine.connection, note, 1)
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.savedOrder)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    await searchRecords(user, note, [record.slice(3)])
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    const row = dataRows(grid).find((each) => within(each).queryAllByRole('gridcell')[0]?.textContent === record.slice(3))
    ;(within(row as HTMLElement).getAllByRole('gridcell')[0] as HTMLElement).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${record}`), ARRIVES)
    await showChild(user, 'Order line')
    await rowsSay(/^1 Order line row; /)
    await rowsDrawn()
    const [first] = rowTexts().map((cells) => String(cells[0]))
    const line = `Order line k1:${String(first)}`
    rowCell(String(first)).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(line), ARRIVES)
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(crumbs).toEqual(['Records', `Order ${record}`])
    await rowAnswer(user, 'React', line, 'Quantity', '5')
    await done(user, 'React', line)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave('React'))
    await said('React', /^Saved the Order: 1 Order line row changed\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([{ no: 1, quantity: 5 }])
  })
})
