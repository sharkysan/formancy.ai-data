import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import type { ListFilterTerm, PublishedForm } from '@formancy/data-client'
import { REFUSED_FILTER_HELP } from './grid-datasource.js'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { applied, chipRemove, filterLine, listsApplied, listsSent, typeFilter } from './test-filter.js'
import { chooseForm, gridSection, gridStatus, keeping, mount, recordKeys, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A grid's filter typed as a line (`notes contains x and amount > 1`), on
 * both engines, against the real server: that the line becomes exactly the
 * terms the panel would have sent, in the list's body and in no URL; that
 * each condition applied is a chip in plain words, removable on its own and
 * put back by Undo; that a line the page cannot read is said where it
 * fails and sends nothing, and one the server refuses is said on the
 * grid's line, the line kept; that completion, `/` and Esc work from the
 * keyboard; that a list nothing matches offers to drop the last condition;
 * and that a condition on a field the line does not offer is a chip the
 * line keeps. Every state is held to axe at WCAG 2.2 AA and to a name on
 * every control. Found by role and accessible name (formancy.ai 0034).
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

async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}
const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

async function definitionOf(formId: string): Promise<PublishedForm> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  return definition.value
}

/** Fresh orders of tenant 1's, one per amount, each noted `notes`, made beside the page: their ids, as the grid's first column shows them. */
async function freshOrders(engine: Engine, notes: string, amounts: readonly string[]): Promise<string[]> {
  const definition = await definitionOf(engine.formId)
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const ids: string[] = []
  for (const amount of amounts) {
    const created = await plane.clerk.create(engine.formId, {
      customer: found.value.rows[0].token,
      order_date: EDGES.orderDate,
      status: 'placed',
      amount,
      notes,
    })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    ids.push(created.value.record.slice('k1:'.length))
  }
  return ids
}

/** The page, signed in as tenant 1's clerk, with `formId` chosen and its grid answered. */
async function workspace(formId: string): Promise<User> {
  const user = mount(plane.fetch, { save: keeping().save })
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

const filtersSent = (formId: string): ListFilterTerm[][] => listsSent(plane.sent, formId).map(({ body }) => body.filter)

describe.each(ENGINES)("a grid's filter line on $engine", (engine) => {
  // The line is read in the browser into the terms the panel sends: a
  // contains as typed, `>` a range that leaves out its bound (0130). Its
  // words reach the server in the body only, and each condition applied
  // is a chip in plain words (watched failing with no line: no combobox
  // named Filter).
  test('applies a typed line as the terms it reads, in the body and in no URL', async () => {
    const notes = stamp('line')
    const orders = await freshOrders(engine, notes, ['1', '2', '3'])
    const user = await workspace(engine.formId)
    plane.sent.length = 0

    await typeFilter(user, 'Records', `notes contains ${notes} and amount > 1`)
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1)), ARRIVES)
    const filter: ListFilterTerm[] = [
      { field: 'notes', op: 'contains', text: notes },
      { field: 'amount', op: 'range', from: '1', to: null, exclusive: 'from' },
    ]
    expect(filtersSent(engine.formId)).toEqual([filter])
    for (const { url } of listsSent(plane.sent, engine.formId)) expect(url.toLowerCase()).not.toContain(notes)
    await listsApplied('Records', [`Notes contains “${notes}”`, 'Amount is over 1'])
    expect(filterLine('Records').value).toBe(`notes contains ${notes} and amount > 1`)
    expect(await floor('a line applied')).toEqual(CLEAN('a line applied'))
  })

  // A line the page cannot read is said under it, the characters it is
  // about selected in the box, every character typed kept, and nothing
  // sent: the grid stays on its last filter.
  test('says where a line it cannot read fails, keeps it and sends nothing', async () => {
    const user = await workspace(engine.formId)
    plane.sent.length = 0
    await typeFilter(user, 'Records', "amount > 1'000")
    const line = filterLine('Records')
    expect(within(gridSection('Records')).getByRole('status', { name: 'Filter' }).textContent).toContain('Write numbers with a point and no separators: 1000.')
    expect(line.value).toBe("amount > 1'000")
    expect(line.getAttribute('aria-invalid')).toBe('true')
    expect([line.selectionStart, line.selectionEnd]).toEqual([9, 14])
    expect(listsSent(plane.sent, engine.formId)).toEqual([])
    expect(await floor('a line refused')).toEqual(CLEAN('a line refused'))
  })

  // A line the page reads and the server refuses -- a value the column
  // cannot hold -- is said on the grid's line in the server's words, with
  // what to do instead, and the line still shows it to correct.
  test('says a refusal of the server’s on the grid’s line, the line kept', async () => {
    const user = await workspace(engine.formId)
    const refused = await plane.clerk.list(engine.formId, { filter: [{ field: 'id', op: 'equals', value: '12x' }] })
    if (refused.ok) throw new Error('the server took 12x for an id')
    await typeFilter(user, 'Records', 'id = 12x')
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(refused.message), ARRIVES)
    expect(within(gridSection('Records')).getByText(REFUSED_FILTER_HELP)).toBeTruthy()
    expect(filterLine('Records').value).toBe('id = 12x')
    expect(await floor('a line the server refused')).toEqual(CLEAN('a line the server refused'))
  })

  // A chip removed lists what the rest hold for, the keyboard on the next
  // chip's Remove; Undo, there until the filter changes again, puts it
  // back where it was (watched failing with no Undo: the condition was
  // gone for good).
  test('removes a chip on its own, and Undo puts it back', async () => {
    const notes = stamp('chip')
    const orders = await freshOrders(engine, notes, ['1', '2'])
    const user = await workspace(engine.formId)
    await typeFilter(user, 'Records', `amount > 1 and notes contains ${notes}`)
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1)), ARRIVES)

    chipRemove('Records', 'Amount is over 1').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(recordKeys()).toEqual(orders), ARRIVES)
    await listsApplied('Records', [`Notes contains “${notes}”`])
    expect(focusedName()).toBe(`Remove Notes contains “${notes}”`)
    expect(filterLine('Records').value).toBe(`notes contains ${notes}`)
    expect(await floor('a chip removed')).toEqual(CLEAN('a chip removed'))

    plane.sent.length = 0
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Undo removing Amount is over 1' }))
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1)), ARRIVES)
    await listsApplied('Records', ['Amount is over 1', `Notes contains “${notes}”`])
    expect(filtersSent(engine.formId)).toEqual([
      [
        { field: 'amount', op: 'range', from: '1', to: null, exclusive: 'from' },
        { field: 'notes', op: 'contains', text: notes },
      ],
    ])
    expect(within(gridSection('Records')).queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  // Completion offers what may come next: a field by its name, its label
  // beside it, picked by the keyboard and followed by a space; then its
  // operators.
  test('completes the line from the keyboard', async () => {
    const user = await workspace(engine.formId)
    const line = filterLine('Records')
    await user.click(line)
    await user.keyboard('not')
    const options = within(gridSection('Records')).getByRole('listbox')
    expect(
      within(options)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['notesNotes'])
    expect(line.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{ArrowDown}')
    expect(line.getAttribute('aria-activedescendant')).toBe(within(options).getByRole('option').id)
    expect(await floor('completion offered')).toEqual(CLEAN('completion offered'))
    await user.keyboard('{Enter}')
    expect(line.value).toBe('notes ')
    expect(within(within(gridSection('Records')).getByRole('listbox')).getAllByRole('option')[0]?.textContent).toBe('=is')
  })

  // `/` from the grid puts the keyboard on the Records line; Esc closes
  // its completion, and a second Esc puts back what is applied and gives
  // the keyboard back to the grid.
  test('is reached with / and left with Esc', async () => {
    const notes = stamp('slash')
    await freshOrders(engine, notes, ['1'])
    const user = await workspace(engine.formId)
    await typeFilter(user, 'Records', `notes contains ${notes}`)
    await waitFor(() => expect(recordKeys()).toHaveLength(1), ARRIVES)
    within(within(gridSection('Records')).getByRole('grid', { name: 'Records' }))
      .getAllByRole('gridcell')[0]
      ?.focus()
    await user.keyboard('/')
    expect(document.activeElement).toBe(filterLine('Records'))
    await user.keyboard(' and a')
    expect(filterLine('Records').getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    expect(filterLine('Records').getAttribute('aria-expanded')).toBe('false')
    expect(filterLine('Records').value).toBe(`notes contains ${notes} and a`)
    await user.keyboard('{Escape}')
    expect(filterLine('Records').value).toBe(`notes contains ${notes}`)
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell')
  })

  // A list nothing matches is no dead end: the page offers to try it
  // without the last condition, which Undo puts back like any other
  // removal.
  test('offers to try without the last condition when nothing matches', async () => {
    const notes = stamp('dead')
    const orders = await freshOrders(engine, notes, ['1', '2'])
    const user = await workspace(engine.formId)
    await typeFilter(user, 'Records', `notes contains ${notes} and amount > 100`)
    const without = await within(gridSection('Records')).findByRole('button', { name: 'Try without Amount is over 100' }, ARRIVES)
    expect(await floor('nothing matches')).toEqual(CLEAN('nothing matches'))
    await user.click(without)
    await waitFor(() => expect(recordKeys()).toEqual(orders), ARRIVES)
    await listsApplied('Records', [`Notes contains “${notes}”`])
    expect(within(gridSection('Records')).getByRole('button', { name: 'Undo removing Amount is over 100' })).toBeTruthy()
  })

  // A condition on a field the line does not offer -- left out of the
  // panel by the administrator (0123), and asked by a view -- is a chip
  // by its label, not in the line, and kept when an edited line is
  // applied: the line never drops a condition the person did not type.
  // Last of its engine's cases, because it publishes the form's version 2.
  test('keeps a condition on a field it does not offer, as a chip', async () => {
    const notes = stamp('kept')
    const orders = await freshOrders(engine, notes, ['1', '2'])
    const stored = (await plane.store.read(engine.formId, 1)) as { presentation: Record<string, unknown> }
    stored.presentation = { ...stored.presentation, unfiltered: ['notes'] }
    expect(await plane.store.publish(engine.formId, 1, stored)).toEqual({ ok: true, version: 2 })
    const saved = await plane.clerk.saveView(engine.formId, { name: 'Kept', filter: [{ field: 'notes', op: 'contains', text: notes }], sort: [] })
    if (!saved.ok) throw new Error(saved.message)
    const user = await workspace(engine.formId)
    const records = gridSection('Records')
    await user.selectOptions(within(records).getByRole('combobox', { name: 'View' }), 'Kept')
    await user.click(within(records).getByRole('button', { name: 'Show view' }))
    await waitFor(() => expect(recordKeys()).toEqual(orders), ARRIVES)
    expect(applied('Records')).toEqual([`Notes contains “${notes}”`])
    expect(filterLine('Records').value).toBe('')

    plane.sent.length = 0
    await typeFilter(user, 'Records', 'amount > 1')
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1)), ARRIVES)
    expect(filtersSent(engine.formId)).toEqual([
      [
        { field: 'notes', op: 'contains', text: notes },
        { field: 'amount', op: 'range', from: '1', to: null, exclusive: 'from' },
      ],
    ])
    await listsApplied('Records', [`Notes contains “${notes}”`, 'Amount is over 1'])
  })
})
