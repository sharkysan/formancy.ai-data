import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { chooseForm, chooseRenderer, mount, newRecord, pane, RENDERERS, said, showChild, signIn, stamp } from './test-host.js'
import { done, openRows, recordSave, rowAnswer, rowCell, rowControl, rowPaper, rowsLine, rowsSay, rowsTab, rowTexts } from './test-rows.js'
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

/** The first cell of the grid row the keyboard is in: AG Grid's focused cell, or the button it handed the keyboard to. */
const focusedRow = (): string | undefined => document.activeElement?.closest('[role="row"]')?.querySelector('[role="gridcell"]')?.textContent ?? undefined

describe.each(ENGINES)('an order’s lines saved with it on $engine', (engine) => {
  // Each change is held on the page and said in words in a column of its
  // own, nothing sent until the order's Save, which sends them with it: a
  // line changed, and one added, in the renderer pressed. The line's form
  // has no field naming the order, which the save supplies.
  test.each(RENDERERS)('in %s, a line changed and one added are held, said in words, and saved by the order’s own Save', async (renderer) => {
    const record = await plane.db.insertSavedOrder(engine.connection, stamp('held'), 2)
    const user = await openRows(plane, engine, record)
    expect(rowsLine()).toBe('2 Order line rows; each Order holds 1 to 3. You may not remove them here.')
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
    // At three lines Add is gone, and the line says why and what is held.
    expect(within(rowsTab()).queryByRole('button', { name: 'Add Order line' })).toBeNull()
    expect(rowsLine()).toBe(
      '3 Order line rows; each Order holds 1 to 3, so none can be added. You may not remove them here. 1 Order line row added and 1 changed. Saved with the Order.',
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
    await rowsSay('3 Order line rows; each Order holds 1 to 3, so none can be added. You may not remove them here.')
    expect(rowTexts().map((row) => row[4])).toEqual(['', '', ''])
  })

  // Remove is in the line's own last column, absent at the order's least
  // lines, and marks the line to be deleted, saying so, the button becoming
  // Undo remove with the keyboard left on it; nothing is asked, as nothing
  // is deleted until Save. A clerk the policy grants no delete has no
  // Remove at all, and the line says so (the case above).
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
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Undo remove Order line k1:${key}`), ARRIVES)
    await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
    await user.click(recordSave('Angular'))
    await said('Angular', /^Saved the Order: 1 Order line row deleted\.$/)
    expect(await plane.db.savedLines(engine.connection, record)).toEqual([{ no: 1, quantity: 1 }])
    await showChild(user, 'Order line')
    await rowsSay('1 Order line row; each Order holds 1 to 3, so none can be removed.')
  })

  // A new order's lines' tab is there at once, not once it is saved, and
  // drawn with the order's tabs: a Save pressed before it was ever shown,
  // with fewer lines than the order must hold, is refused at the tab, which
  // is shown with the keyboard on its heading and the bound in the page's
  // words; and the order is created with the lines added, in one save.
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
})
