import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { chooseForm, chooseRenderer, dataRows, gridStatus, load, loaded, mount, newRecord, said, showChild, signIn } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/**
 * How the suites drive a record's rows saved with it (0155): the order of
 * the parity schema and its lines, through the tab beside the order, by
 * role and accessible name, as test-host.ts drives the rest of the page.
 */

const ARRIVES = { timeout: 15_000 }

/** The lines' tab's section, once shown. */
export function rowsTab(): HTMLElement {
  return screen.getByRole('region', { name: 'Order line' })
}

/** What the lines' tab's line says now. */
export function rowsLine(): string {
  return gridStatus('Order line')?.textContent ?? ''
}

/** Wait until the lines' tab's line says `said`. */
export async function rowsSay(said: string | RegExp): Promise<void> {
  await waitFor(() => expect(rowsLine()).toMatch(said), ARRIVES)
}

/** The lines' grid's data rows, each as its cells' text, the row's change last but for its Remove. */
export function rowTexts(): string[][] {
  const grid = within(rowsTab()).getByRole('grid', { name: 'Order line' })
  return dataRows(grid).map((row) =>
    within(row)
      .getAllByRole('gridcell')
      .map((cell) => cell.textContent ?? ''),
  )
}

/** A row's paper on the rail, named for the row and the renderer. */
export function rowPaper(renderer: RendererName, row: string): HTMLElement {
  return within(rowsTab()).getByRole('form', { name: `${row}, ${renderer}` })
}

/** A control of a row's paper by the start of its label: a required field's label says so after it. */
export function rowControl(renderer: RendererName, row: string, label: string): HTMLInputElement {
  return within(rowPaper(renderer, row)).getByLabelText<HTMLInputElement>(new RegExp(`^${label}\\b`))
}

/** Type `value` into a row's control, cleared first. */
export async function rowAnswer(user: User, renderer: RendererName, row: string, label: string, value: string): Promise<void> {
  const element = await waitFor(() => rowControl(renderer, row, label), ARRIVES)
  await user.clear(element)
  await user.type(element, value)
}

/** Done on a row's paper. */
export async function done(user: User, renderer: RendererName, row: string): Promise<void> {
  await user.click(within(rowPaper(renderer, row)).getByRole('button', { name: 'Done' }))
}

/** The record's own Save, in a renderer's paper. */
export function recordSave(renderer: RendererName): HTMLElement {
  return within(screen.getByRole('form', { name: `Order, ${renderer}` })).getByRole('button', { name: 'Save' })
}

/** The page signed in as `token`, the saved order form chosen with both renderers, `record` loaded, and its lines' tab shown and listed. */
export async function openRows(
  plane: Plane,
  engine: Engine,
  record: string,
  token: string = TOKENS.clerk,
  fetch: typeof globalThis.fetch = plane.fetch,
): Promise<User> {
  const user = mount(fetch)
  await signIn(user, token)
  await chooseForm(user, engine.savedOrder)
  await chooseRenderer(user)
  await load(user, record)
  await loaded(record)
  await showChild(user, 'Order line')
  await rowsSay(/^\d+ Order line rows?; /)
  await rowsDrawn()
  return user
}

/** Wait until the grid draws every line the tab's line counts, each with its key: the set is drawn a moment after it is listed. */
export async function rowsDrawn(): Promise<void> {
  await waitFor(() => {
    const held = Number(/^(\d+) /.exec(rowsLine())?.[1] ?? -1)
    const drawn = rowTexts().filter((cells) => (cells[0] ?? '') !== '' || (cells[4] ?? '') === 'New')
    expect(drawn.length).toBeGreaterThanOrEqual(held)
  }, ARRIVES)
}

/**
 * A new order of the saved order form, noted `note`, with one line added,
 * typed and saved in React through the order's own Save: its token. The
 * form is chosen first, with whatever renderers are shown.
 */
export async function createWithLine(user: User, formId: string, note: string): Promise<string> {
  await chooseForm(user, formId)
  await newRecord(user)
  const paper = await waitFor(() => screen.getByRole('form', { name: 'Order, React' }), ARRIVES)
  await user.type(await waitFor(() => within(paper).getByLabelText(/^Note\b/), ARRIVES), note)
  await showChild(user, 'Order line')
  await user.click(within(rowsTab()).getByRole('button', { name: 'Add Order line' }))
  await rowAnswer(user, 'React', 'New Order line 1', 'Line no', '1')
  await rowAnswer(user, 'React', 'New Order line 1', 'Quantity', '1')
  await done(user, 'React', 'New Order line 1')
  await user.click(within(rowsTab()).getByRole('button', { name: 'Go to Save' }))
  await user.click(recordSave('React'))
  const created = await said('React', /^Created record k1:\d+ with 1 Order line row\.$/)
  return /(k1:\d+)/.exec(created)?.[1] ?? ''
}

/** The order's line numbered `no` saved to `quantity` beside the page, through the client, in one save of the order. */
export async function savedBeside(plane: Plane, engine: Engine, record: string, no: number, quantity: number): Promise<void> {
  const order = await plane.clerk.read(engine.savedOrder, record)
  const lines = await plane.clerk.list(engine.savedLines, { parent: { field: 'saved_order', record } })
  if (!order.ok || !lines.ok) throw new Error('the order could not be read beside the page')
  const line = lines.value.rows.find((row) => row.answers['line_no'] === no)
  const saved = await plane.clerk.save(engine.savedOrder, {
    record: { update: { record, version: order.value.version ?? '', answers: {} } },
    rows: [
      {
        form: engine.savedLines,
        field: 'saved_order',
        changes: [{ update: { record: line?.record ?? '', version: line?.version ?? '', answers: { quantity } } }],
      },
    ],
  })
  if (!saved.ok) throw new Error(`the save beside the page was refused: ${JSON.stringify(saved)}`)
}

/** A row of the lines' grid by its cells' text: its first cell, the line's key. */
export function rowCell(key: string): HTMLElement {
  const grid = within(rowsTab()).getByRole('grid', { name: 'Order line' })
  const row = dataRows(grid).find((each) => within(each).getAllByRole('gridcell')[0]?.textContent === key)
  const cell = row === undefined ? undefined : within(row).getAllByRole('gridcell')[1]
  if (cell === undefined) throw new Error(`no line ${key} in the grid`)
  return cell
}
