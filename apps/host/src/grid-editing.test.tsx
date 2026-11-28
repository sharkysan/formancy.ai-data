import { encodeKeyToken } from '@formancy/data-core'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { CHECK_IT, SAVE_WAITED, STALE_KEPT } from './grid-edit.js'
import { REPLACED } from './session.js'
import { focusedName, paragraphs } from './test-accessible.js'
import {
  answer,
  chooseCustomer,
  chooseForm,
  chooseRenderer,
  control,
  gridSection,
  gridStatus,
  mount,
  notice,
  paper,
  RENDERERS,
  said,
  save,
  searchRecords,
  signIn,
  stamp,
  statuses,
  unsavedNotice,
} from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { holdingWrites, losingWrites } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'
import { DECLINING, SECOND_CUSTOMER } from './test-values.js'
import { DECLINED_BY } from './words.js'

/*
 * The open record edited in its row of the Records grid (0179), against
 * the real server on both engines, in each renderer the detail draws: F2
 * opening an editor of the page's own in the open row and on another row,
 * Tab, Shift+Tab, Enter and Escape moving and ending the edit; a row saved
 * in place, with no page read again; a stale, an invalid, a declined and a
 * refused save each said on the row and the line; a save out holding F2
 * and another row until its answer, and the form's own Save holding New
 * record until its answer; a row asked for, and the row's mark, going
 * with a form replaced while the save is out -- by New, or by the other
 * renderer shown; and Space on another row saving the row
 * first. The row and the record's form are one draft, so what a cell
 * types is the form's too, and the save is the form's own (pane-reach.ts).
 *
 * Found by role and accessible name. The reads the accessibility tree
 * cannot answer, said where they are made: a cell by the `col-id` AG Grid
 * writes on it, and a row by its Id cell's text, since the tree names a
 * cell by its value alone and a row by nothing (`cellOf`). What jsdom
 * cannot see -- an editor's look, the keyboard in a real browser -- is the
 * browser gate's (scripts/browser/editing.mjs); AG Grid's editing without
 * a server, cell-editors.test.tsx's.
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
})

const ARRIVES = { timeout: 15_000 }
const records = (): HTMLElement => within(gridSection('Records')).getByRole('grid', { name: 'Records' })
const keyOf = (token: string): string => token.slice(token.indexOf(':') + 1)
/** The marks a row's first cell says after its Id (0179). */
const MARKS = /(Saving…|Not saved|May have been saved)?$/

/** The cell of `colId` in `token`'s row: by the `col-id` and the Id cell's text, said above. */
function cellOf(token: string, colId: string): HTMLElement {
  const key = keyOf(token)
  const row = within(records())
    .getAllByRole('row')
    .find((each) =>
      within(each)
        .queryAllByRole('gridcell')
        .some((cell) => cell.getAttribute('col-id') === 'id' && (cell.textContent ?? '').replace(MARKS, '') === key),
    )
  const cell =
    row === undefined
      ? undefined
      : within(row)
          .queryAllByRole('gridcell')
          .find((each) => each.getAttribute('col-id') === colId)
  if (cell === undefined) throw new Error(`no ${colId} cell in the row of ${token}`)
  return cell
}

/** What `token`'s row says after its Id: its mark, or nothing. */
const markOf = (token: string): string => (cellOf(token, 'id').textContent ?? '').slice(keyOf(token).length)
/** What the Records grid's line says. */
const line = (): string => gridStatus('Records')?.textContent ?? ''

/** Fresh orders of tenant 1's, made beside the page and noted `notes`, which the page searches for: their tokens, in key order. */
async function freshOrders(formId: string, notes: string, count = 1): Promise<string[]> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, name, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const made: string[] = []
  for (let n = 0; n < count; n += 1) {
    const created = await plane.clerk.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    made.push(created.value.record)
  }
  return made
}

/** What the database holds for `token`, read by the clerk beside the page. */
async function stored(formId: string, token: string): Promise<Record<string, unknown>> {
  const read = await plane.clerk.read(formId, token)
  if (!read.ok) throw new Error(read.message)
  return read.value.answers
}

/**
 * The page through `fetch`, signed in as tenant 1's clerk, the order form
 * chosen in `renderer` -- or in both -- the Records grid searched for
 * `tokens` by their notes, and the first of them opened by a press on its
 * row.
 */
async function openedIn(renderer: RendererName | 'Both', formId: string, notes: string, tokens: readonly string[], fetch = plane.fetch): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await chooseRenderer(user, renderer)
  await searchRecords(user, notes, tokens.map(keyOf))
  await user.click(cellOf(tokens[0] as string, 'id'))
  await screen.findByRole('heading', { level: 3, name: `Order ${tokens[0] as string}` }, ARRIVES)
  for (const each of renderer === 'Both' ? RENDERERS : [renderer]) await within(paper(each)).findByRole('combobox', { name: 'Customer' }, ARRIVES)
  return user
}

/** F2 on `token`'s cell of `colId`, and the keyboard in its editor. */
async function edit(user: User, token: string, colId: string, label: string): Promise<void> {
  cellOf(token, colId).focus()
  await user.keyboard('{F2}')
  await waitFor(() => expect(focusedName()).toBe(`${label}, Order ${token}`), ARRIVES)
}

/** What the editor with the keyboard holds, replaced by `text`, typed. */
async function retype(user: User, text: string): Promise<void> {
  await user.keyboard(`{Control>}a{/Control}{Backspace}${text}`)
}

const listed = (from: number): number => plane.sent.slice(from).filter((request) => request.path.endsWith('/records/list')).length
const updates = (from: number): number => plane.sent.slice(from).filter((request) => request.path.endsWith('/records/update')).length

describe.each(ENGINES)('the open record edited in its row on $engine', (engine: Engine) => {
  const { formId, connection } = engine

  // F2 opens an editor of the page's own, named for its field and record;
  // Shift+Tab and Tab move among the row's editable cells -- past Notes,
  // which the record's form edits; Escape gives a cell's typing up and
  // ends the edit on its cell; Enter saves the row and ends the edit. The
  // save is the form's own, so the form says it too, and no page is read
  // again for it: no row moves under the keyboard. Without readOnlyEdit the
  // grid would hold a second draft; without the form's save, the row would
  // be stored by a path no other save takes.
  test.each(['React', 'Angular'] as const)('in %s, F2, Tab, Shift+Tab, Escape and Enter edit the row, which is saved in place', async (renderer) => {
    const notes = stamp('cells')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn(renderer, formId, notes, [token])

    await edit(user, token, 'group', 'Group')
    await retype(user, 'Shop')
    // The draft is the form's too: what the cell typed is in the record's form.
    await waitFor(() => expect(control(renderer, 'Group').value).toBe('Shop'), ARRIVES)
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(focusedName()).toBe(`Amount, Order ${token}`), ARRIVES)
    await retype(user, '7')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(cellOf(token, 'amount')), ARRIVES)
    expect(cellOf(token, 'amount').textContent).toBe('1.0000')
    await user.keyboard('{F2}')
    await waitFor(() => expect(focusedName()).toBe(`Amount, Order ${token}`), ARRIVES)
    await user.keyboard('{Tab}')
    await waitFor(() => expect(focusedName()).toBe(`Group, Order ${token}`), ARRIVES)

    const before = plane.sent.length
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe(`Saved Order ${token}.`), ARRIVES)
    expect(document.activeElement).toBe(cellOf(token, 'group'))
    expect(markOf(token)).toBe('')
    expect((await stored(formId, token))['group']).toBe('Shop')
    expect(listed(before)).toBe(0)
    expect(cellOf(token, 'group').textContent).toBe('Shop')
  })

  // F2 on another row's cell leaves the open one and opens that record as
  // Space does, the editor taking the keyboard once it is read; and Tab
  // past a row's last editable cell saves it and edits the next row in its
  // first. A Tab that only left the cell would leave the row unsaved.
  test('F2 on another row opens it to edit, and Tab past the last cell saves the row and edits the next', async () => {
    const notes = stamp('rows')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const user = await openedIn('React', formId, notes, [first, second])
    await edit(user, second, 'group', 'Group')
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)

    await edit(user, first, 'group', 'Group')
    await retype(user, 'North')
    // Tab on from Group, editor by editor, to the row's last editable cell and past it: a cell's name is its value, an editor's ends with its record.
    for (let step = 0; step < 6 && focusedName().endsWith(`, Order ${first}`); step += 1) {
      const at = focusedName()
      await user.keyboard('{Tab}')
      await waitFor(() => expect(focusedName()).not.toBe(at), ARRIVES)
    }
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    await waitFor(() => expect(focusedName()).toMatch(new RegExp(`, Order ${second}$`)), ARRIVES)
    expect((await stored(formId, first))['group']).toBe('North')
  })

  // A record changed by somebody else since the row was opened: nothing is
  // stored, the row says Not saved, the line the server's sentence and that
  // the changes are kept, and the record's notice offers Load the saved
  // record -- without taking the keyboard from the grid.
  test.each(['React', 'Angular'] as const)('in %s, a stale save is said on its row and the line, and its changes kept', async (renderer) => {
    const notes = stamp('stale')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn(renderer, formId, notes, [token])
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Stale')
    await waitFor(() => expect(control(renderer, 'Group').value).toBe('Stale'), ARRIVES)
    const read = await plane.clerk.read(formId, token)
    if (!read.ok) throw new Error(read.message)
    await plane.clerk.update(formId, { record: token, version: read.value.version ?? '', answers: { notes: `${notes} changed` } })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(markOf(token)).toBe('Not saved'), ARRIVES)
    expect(line().endsWith(STALE_KEPT)).toBe(true)
    expect(notice(renderer)).not.toBeNull()
    expect(document.activeElement).toBe(cellOf(token, 'group'))
    expect(control(renderer, 'Group').value).toBe('Stale')
    expect(cellOf(token, 'group').textContent).toBe('Stale')
    expect((await stored(formId, token))['group']).not.toBe('Stale')
  })

  // An answer the engine refuses sends nothing: the first invalid cell
  // shown takes the keyboard in its editor, invalid and described by the
  // form's sentence, and the line names it. A grid that sent it would have
  // the server say what the form already knew.
  test('an invalid answer puts the keyboard on its cell, described, and sends nothing', async () => {
    const notes = stamp('invalid')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn('React', formId, notes, [token])
    await edit(user, token, 'amount', 'Amount')
    await retype(user, 'abc')
    const before = plane.sent.length
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe('Not saved: Amount is to fix.'), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(`Amount, Order ${token}`), ARRIVES)
    const editor = document.activeElement as HTMLElement
    expect(editor.getAttribute('aria-invalid')).toBe('true')
    expect(computeAccessibleDescription(editor)).not.toBe('')
    expect(markOf(token)).toBe('Not saved')
    expect(plane.sent.slice(before).filter((request) => request.path.endsWith('/records/update'))).toEqual([])
  })

  // A save the deployment's trigger declined (0156): its reason on the line
  // as its own words, the row Not saved; and on a field the form edits --
  // Notes -- the line names it as the form's to fix.
  test('a declined save is said in the deployment’s words on the line, the row Not saved', async () => {
    const notes = stamp('declined')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn('React', formId, notes, [token])
    await answer(user, 'React', 'Notes', DECLINING.saved.notes)
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Closed')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe(`${DECLINING.saved.reason} ${DECLINED_BY}`), ARRIVES)
    expect(markOf(token)).toBe('Not saved')

    await answer(user, 'React', 'Notes', DECLINING.field.notes)
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Closed again')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe(`Not saved: Notes is to fix in the record's form. ${DECLINED_BY}`), ARRIVES)
    expect(markOf(token)).toBe('Not saved')
  })

  // A save the server refused -- its database out of reach -- is its
  // sentence on the line, the same the record's notice says, and the row
  // Not saved; nothing is sent again (0015).
  test('a refused save is the server’s sentence on the line, and the row Not saved', async () => {
    const notes = stamp('refused')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn('React', formId, notes, [token])
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Away')
    plane.unreachable.add(connection)
    try {
      await user.keyboard('{Enter}')
      await waitFor(() => expect(markOf(token)).toBe('Not saved'), ARRIVES)
    } finally {
      plane.unreachable.delete(connection)
    }
    const said = paragraphs(notice('React') as HTMLElement)[0]
    expect(line()).toBe(said)
  })

  // A save whose answer was lost may have been stored (0031): the row says
  // so and the line how to check, in the record's notice.
  test('a save whose answer was lost says on its row that it may have been saved', async () => {
    const notes = stamp('lost')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const losing = losingWrites(plane.fetch, { when: 'after' })
    const user = await openedIn('React', formId, notes, [token], losing.fetch)
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Lost')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(markOf(token)).toBe('May have been saved'), ARRIVES)
    expect(line().endsWith(CHECK_IT)).toBe(true)
  })

  // While the row's save is out it says Saving…, F2 on it says the save is
  // waited for and opens no editor, and Space on another row opens nothing
  // until the answer -- then opens it, the row saved. A second draft, or a
  // draft lost to a replaced form, is what this prevents.
  test('a save out holds F2 and another row until its answer', async () => {
    const notes = stamp('held')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const holding = holdingWrites(plane.fetch)
    const user = await openedIn('React', formId, notes, [first, second], holding.fetch)
    await edit(user, first, 'group', 'Group')
    await retype(user, 'Held')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await waitFor(() => expect(markOf(first)).toBe('Saving…'), ARRIVES)
    cellOf(first, 'amount').focus()
    await user.keyboard('{F2}')
    await waitFor(() => expect(line()).toBe(SAVE_WAITED), ARRIVES)
    expect(screen.queryByRole('textbox', { name: `Amount, Order ${first}` })).toBeNull()
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    expect(screen.queryByRole('heading', { level: 3, name: `Order ${second}` })).toBeNull()
    holding.answer()
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    expect((await stored(formId, first))['group']).toBe('Held')
  })

  // Space on another row leaves the open one, which the grid edited: it is
  // saved first, and the other record opened once it stored -- never
  // opened over the draft, which the guard would then have to ask about.
  test('Space on another row saves the edited row first', async () => {
    const notes = stamp('space')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const user = await openedIn('React', formId, notes, [first, second])
    await edit(user, first, 'group', 'Group')
    await retype(user, 'Spaced')
    // Back to Amount, whose edit is given up: the row holds the grid's change to Group, not saved.
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(focusedName()).toBe(`Amount, Order ${first}`), ARRIVES)
    await user.keyboard('{Escape}')
    expect(markOf(first)).toBe('')
    const before = plane.sent.length
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
    const sent = plane.sent.slice(before)
    const update = sent.findIndex((request) => request.path.endsWith('/records/update'))
    const read = sent.findIndex((request) => request.path.endsWith('/records/read') && (request.body ?? '').includes(second))
    expect(update).toBeGreaterThanOrEqual(0)
    expect(read).toBeGreaterThan(update)
    expect((await stored(formId, first))['group']).toBe('Spaced')
  })

  // A save touches every field, and each renderer's error summary focuses
  // itself when its first problem appears: Amount cleared after the row
  // was saved -- required, then not a number -- would hand the keyboard to
  // the summary and end the edit under the person typing, the rest of what
  // they typed lost. The keyboard stays in the editor, which says the
  // problem.
  test.each(RENDERERS)('in %s, a cell retyped after the row was saved keeps the keyboard in its editor, its problem said there', async (renderer) => {
    const notes = stamp('cleared')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn(renderer, formId, notes, [token])
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Saved once')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe(`Saved Order ${token}.`), ARRIVES)
    await edit(user, token, 'amount', 'Amount')
    await retype(user, 'abc')
    await within(paper(renderer)).findByRole('heading', { name: 'There is 1 problem to fix' }, ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(`Amount, Order ${token}`), ARRIVES)
    const editor = document.activeElement as HTMLInputElement
    expect(editor.value).toBe('abc')
    expect(editor.getAttribute('aria-invalid')).toBe('true')
    expect(computeAccessibleDescription(editor)).not.toBe('')
  })

  // The form's Save of a row the grid edited is the row's save: Space on
  // another row while it is out waits for its answer -- a save sent beside
  // it would be refused as busy, the row said Not saved while the first
  // stores, and the press lost -- and opens that row once it stored.
  test('the form’s Save of a row the grid edited holds another row until its answer', async () => {
    const notes = stamp('form-held')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const holding = holdingWrites(plane.fetch)
    const user = await openedIn('React', formId, notes, [first, second], holding.fetch)
    await edit(user, first, 'group', 'Group')
    await retype(user, 'Held by the form')
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    expect(screen.queryByRole('heading', { level: 3, name: `Order ${second}` })).toBeNull()
    expect(markOf(first)).not.toBe('Not saved')
    expect(holding.held).toHaveLength(1)
    holding.answer()
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    expect((await stored(formId, first))['group']).toBe('Held by the form')
  })

  // A row asked for while the row's save is out waits for that save and no
  // other: New record, with Discard and continue, replaces the form, so the
  // save answers as a replaced form's and the row asked for goes with the
  // draft. Kept waiting, it opened at the next Save another record's form
  // stored -- a row the person had chosen to leave, asked for by nobody.
  test('a row asked for while a save is out goes with the form New record replaces', async () => {
    const notes = stamp('replaced')
    const [first, second, third] = (await freshOrders(formId, notes, 3)) as [string, string, string]
    const holding = holdingWrites(plane.fetch)
    const user = await openedIn('React', formId, notes, [first, second, third], holding.fetch)
    await edit(user, first, 'group', 'Group')
    await retype(user, 'Replaced')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES)
    holding.answer()
    await said('React', new RegExp(`^${REPLACED}`))

    await user.click(cellOf(third, 'id'))
    await screen.findByRole('heading', { level: 3, name: `Order ${third}` }, ARRIVES)
    await answer(user, 'React', 'Notes', `${notes} saved in the form`)
    const before = plane.sent.length
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    holding.answer()
    await waitFor(() => expect(statuses('React')).toContain('Saved.'), ARRIVES)
    // The form's Save reads the page again once it stored; a row opened by its answer is read before that page is.
    await waitFor(() => expect(listed(before)).toBeGreaterThan(0), ARRIVES)
    const reads = plane.sent.slice(before).filter((request) => request.path.endsWith('/records/read') && (request.body ?? '').includes(second))
    expect(reads).toEqual([])
    expect(screen.getByRole('heading', { level: 3, name: `Order ${third}` })).toBeTruthy()
  })

  // The row is the draft of the form the detail shows. React's save out,
  // Angular shown with Discard and continue: the row is Angular's form of
  // the same record, which holds no save, so the row has no mark and
  // another row opens on a press. A state kept by record and form
  // generation alone carried React's Saving… across to Angular's form,
  // whose generation is the same number, and held every row behind an
  // answer the grid no longer hears.
  test('a save out in React holds nothing once Angular is shown, React’s draft discarded', async () => {
    const notes = stamp('renderer')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const holding = holdingWrites(plane.fetch)
    const user = await openedIn('React', formId, notes, [first, second], holding.fetch)
    await edit(user, first, 'group', 'Group')
    await retype(user, 'Switched')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await waitFor(() => expect(markOf(first)).toBe('Saving…'), ARRIVES)
    await chooseRenderer(user, 'Angular')
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await within(paper('Angular')).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    holding.answer()
    await waitFor(() => expect(holding.held).toHaveLength(0), ARRIVES)
    await waitFor(() => expect(markOf(first)).toBe(''), ARRIVES)
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
  })

  // The live demo's journey: Notes typed in the record's form, its Save
  // pressed, and New record. The open row draws the draft, so it shows the
  // note before Save is pressed and is no sign the save stored: New record
  // pressed while the save is out is asked about, as a save out always is
  // (0047) -- the gate that waited for the grid pressed it there and met
  // the question. Once the form says Saved., nothing holds New: it empties
  // the form at once. That is the page the gate's wait rests on -- one
  // status of the record's region reading Saved., which its strict wait
  // needs -- and not the gate's wait itself, which only the live demo's
  // job runs (the case written in the gate's old order fails here, New
  // record never drawn; the region's count fails with a second Saved.).
  test('the form’s own Save holds New record only until its answer, whatever the row shows', async () => {
    const notes = stamp('form-saved')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const holding = holdingWrites(plane.fetch)
    const user = await openedIn('React', formId, notes, [token], holding.fetch)
    const changed = `${notes} changed in the form`
    await answer(user, 'React', 'Notes', changed)
    await waitFor(() => expect(cellOf(token, 'notes').textContent).toBe(changed), ARRIVES)
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const newRecord = (): HTMLElement => within(gridSection('Records')).getByRole('button', { name: 'New record' })
    await user.click(newRecord())
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    holding.answer()
    await waitFor(() => expect(statuses('React')).toContain('Saved.'), ARRIVES)
    const region = screen.getByRole('region', { name: `Order ${token}` })
    expect(
      within(region)
        .getAllByRole('status')
        .filter((status) => status.textContent === 'Saved.'),
    ).toHaveLength(1)
    await user.click(newRecord())
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES)
    expect(unsavedNotice()).toBeNull()
    expect((await stored(formId, token))['notes']).toBe(changed)
  })

  // A cell typed in and given up with Escape leaves the row as the grid
  // had it: not edited, so leaving it sends nothing, and what was typed in
  // the record's form alone is asked about by the guard, as it always is.
  test('a cell given up with Escape leaves the form’s own typing to the guard, nothing sent', async () => {
    const notes = stamp('escaped')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const user = await openedIn('React', formId, notes, [first, second])
    await answer(user, 'React', 'Notes', `${notes} typed in the form`)
    await edit(user, first, 'group', 'Group')
    await user.keyboard('x{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(cellOf(first, 'group')), ARRIVES)
    const before = plane.sent.length
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(updates(before)).toBe(0)
    expect(screen.queryByRole('heading', { level: 3, name: `Order ${second}` })).toBeNull()
  })

  // Only the open row holds a draft: a row whose save did not store is
  // never left by sending it again, nor silently -- leaving it asks the
  // unsaved-changes question, whose discard opens the other record.
  test('a row whose save did not store is left through the unsaved-changes question, nothing sent again', async () => {
    const notes = stamp('not-stored')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const user = await openedIn('React', formId, notes, [first, second])
    await edit(user, first, 'group', 'Group')
    await retype(user, 'Kept')
    const read = await plane.clerk.read(formId, first)
    if (!read.ok) throw new Error(read.message)
    await plane.clerk.update(formId, { record: first, version: read.value.version ?? '', answers: { notes: `${notes} changed` } })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(markOf(first)).toBe('Not saved'), ARRIVES)
    const before = plane.sent.length
    cellOf(second, 'group').focus()
    await user.keyboard(' ')
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(updates(before)).toBe(0)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    expect(updates(before)).toBe(0)
    expect((await stored(formId, first))['group']).not.toBe('Kept')
  })

  // A double click is F2's: on another row's cell it opens that record --
  // its two clicks asking for the row as a press does -- and edits the cell
  // once it is read; on the open row it edits at once.
  test('a double click edits a cell as F2 does, on another row once it is open and on the open row', async () => {
    const notes = stamp('double')
    const [first, second] = (await freshOrders(formId, notes, 2)) as [string, string]
    const user = await openedIn('React', formId, notes, [first, second])
    await user.dblClick(cellOf(second, 'group'))
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(`Group, Order ${second}`), ARRIVES)
    await user.keyboard('{Escape}')
    await user.dblClick(cellOf(second, 'amount'))
    await waitFor(() => expect(focusedName()).toBe(`Amount, Order ${second}`), ARRIVES)
  })

  // Under Both the row is the React form's draft: what a cell types is in
  // the React pane, and the Angular pane stays a draft of its own, as two
  // panes always are (0029); the save is the React pane's.
  test('under Both, the row is the React form’s draft, and the Angular form keeps its own', async () => {
    const notes = stamp('both')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn('Both', formId, notes, [token])
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Both')
    await waitFor(() => expect(control('React', 'Group').value).toBe('Both'), ARRIVES)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe(`Saved Order ${token}.`), ARRIVES)
    expect((await stored(formId, token))['group']).toBe('Both')
    expect(control('Angular', 'Group').value).toBe('')
  })

  // A lookup changed in the record's form is the row's answer at once,
  // shown by its token: its label is the page's, of the answer listed.
  // Once the row's save stored, the label is asked for and drawn.
  test('a lookup changed in the form shows its token in the row, and its label once the row’s save stored', async () => {
    const notes = stamp('label')
    const [token] = (await freshOrders(formId, notes)) as [string]
    const user = await openedIn('React', formId, notes, [token])
    expect(cellOf(token, 'customer').textContent).toBe('Muster AG')
    await chooseCustomer(user, 'React', 'Zweite', SECOND_CUSTOMER.name)
    const chosen = encodeKeyToken(['1', String(SECOND_CUSTOMER.no)])
    if (!chosen.ok) throw new Error(chosen.message)
    await waitFor(() => expect(cellOf(token, 'customer').textContent).toBe(chosen.token), ARRIVES)
    await edit(user, token, 'group', 'Group')
    await retype(user, 'Relabelled')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(line()).toBe(`Saved Order ${token}.`), ARRIVES)
    await waitFor(() => expect(cellOf(token, 'customer').textContent).toBe(SECOND_CUSTOMER.name), ARRIVES)
  })
})
