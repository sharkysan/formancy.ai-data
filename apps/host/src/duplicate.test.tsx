import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { answer, chooseForm, control, load, loaded, mount, openForm, RENDERERS, said, save, shows, signIn, stamp, unsavedNotice } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Duplicate record (0107), through the page, against the real server on
 * both engines: the open record read again and copied into a new record --
 * the answers the server names in `copied`, no key, no version -- which a
 * save creates as a second record. The guard asks first, as New does, and
 * a form the person may not create with offers no copy.
 */

let plane: Plane

beforeAll(async () => {
  // `paged` publishes the order form again as one the clerk may only read.
  plane = await startPlane({ paged: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const ARRIVES_WITHIN = { timeout: 15_000 }

/** An order of tenant 1's, made beside the page, with words only it carries in its notes. */
async function freshOrder({ formId }: Engine, notes: string): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, name, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(formId, {
    customer: found.value.rows[0].token,
    order_date: EDGES.orderDate,
    status: 'placed',
    amount: '7.25',
    notes,
  })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

/** The detail's status line, in the detail its heading names. */
function detailLine(heading: string): string {
  return within(screen.getByRole('region', { name: heading })).getAllByRole('status')[0]?.textContent ?? ''
}

describe.each(ENGINES)('Duplicate record on $engine', (engine) => {
  // The whole path. The copy holds what was stored -- the customer's label
  // resolved from its token, the amount in its stored spelling, the notes --
  // and not the key the database numbers; the line names what was left
  // out; the keyboard is on the new record's heading; and a save creates a
  // second order holding the copy, leaving the first as it was. Watched
  // failing with the copy keeping the record's token: the save updated the
  // order copied from, and no second one was made.
  test('copies the open record into a new one, which a save creates as a second record', async () => {
    const notes = stamp('copy')
    const record = await freshOrder(engine, notes)
    const user = await openForm(plane, engine.formId)
    await load(user, record)
    await loaded(record)
    await shows('React', 'Amount', '7.2500')

    await user.click(screen.getByRole('button', { name: 'Duplicate record' }))
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES_WITHIN)
    await waitFor(() => expect(detailLine('New record')).toBe(`Copied ${record} into both forms, for a new record. Not copied: Id.`), ARRIVES_WITHIN)
    for (const renderer of RENDERERS) {
      await shows(renderer, 'Customer', 'Muster AG')
      await shows(renderer, 'Amount', '7.2500')
      await shows(renderer, 'Notes', notes)
      expect({ renderer, id: control(renderer, 'Id').value }).toEqual({ renderer, id: '' })
    }
    await waitFor(() => expect(focusedName()).toBe('New record'))
    expect(screen.queryByRole('button', { name: 'Duplicate record' })).toBeNull()
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await save(user, 'Angular')
    const created = /^Created record (.+)\.$/.exec(await said('Angular', /^Created record /))?.[1] ?? ''
    expect(created).not.toBe(record)
    const copy = await plane.clerk.read(engine.formId, created)
    expect(copy.ok && copy.value.answers).toMatchObject({ amount: '7.2500', notes, status: 'placed', order_date: EDGES.orderDate })
    const first = await plane.clerk.read(engine.formId, record)
    expect(first.ok && first.value.answers).toMatchObject({ amount: '7.2500', notes })
    await screen.findByRole('heading', { level: 3, name: `Order ${created}` }, ARRIVES_WITHIN)
  })

  // A copy replaces the detail's forms, so typed work is asked about first,
  // in words that say what was pressed, before anything is read; Keep
  // editing leaves the draft, sends nothing, and gives the keyboard back to
  // the button. Discarded, the copy is of the record as stored -- read
  // again -- not of the draft on screen. Watched failing with the guard
  // asked only once the read answered: Keep editing had sent a read.
  test('asks before a copy drops typed work, and copies what is stored, not the draft', async () => {
    const notes = stamp('guard')
    const record = await freshOrder(engine, notes)
    const user = await openForm(plane, engine.formId)
    await load(user, record)
    await loaded(record)
    await shows('React', 'Amount', '7.2500')
    await answer(user, 'React', 'Amount', '77')

    const reads = (): number => plane.sent.filter((request) => request.path === `/v1/forms/${engine.formId}/records/read`).length
    const before = reads()
    const duplicate = screen.getByRole('button', { name: 'Duplicate record' })
    await user.click(duplicate)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    const notice = unsavedNotice() as HTMLElement
    expect(within(notice).getByText(/^Copying /).textContent).toBe(`Copying ${record} into a new record closes these forms:`)
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(unsavedNotice()).toBeNull()
    await shows('React', 'Amount', '77')
    await waitFor(() => expect(document.activeElement).toBe(duplicate))
    expect(reads()).toBe(before)

    await user.click(duplicate)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES_WITHIN)
    for (const renderer of RENDERERS) await shows(renderer, 'Amount', '7.2500')
    expect(detailLine('New record')).toBe(`Discarded the unsaved changes. Copied ${record} into both forms, for a new record. Not copied: Id.`)
  })

  // A read the server refuses opens nothing: the record stays in both forms
  // and the line says why, in the server's words, as a refused open does.
  test('says a refused read, and leaves the record open', async () => {
    const record = await freshOrder(engine, stamp('refused'))
    const user = await openForm(plane, engine.formId)
    await load(user, record)
    await loaded(record)
    plane.unreachable.add(engine.connection)
    try {
      await user.click(screen.getByRole('button', { name: 'Duplicate record' }))
      await waitFor(() => expect(detailLine(`Order ${record}`)).toBe('The database cannot be reached. Nothing was saved.'), ARRIVES_WITHIN)
    } finally {
      plane.unreachable.delete(engine.connection)
    }
    for (const renderer of RENDERERS) await shows(renderer, 'Amount', '7.2500')
  })

  // A copy is a create: a new record, which has nothing stored to copy,
  // offers none, and nor does a form this person may only read -- the same
  // orders, through a form whose `copied` the server sends as null.
  test('is offered only for a saved record of a form the person may create with', async () => {
    const record = await freshOrder(engine, stamp('offered'))
    await openForm(plane, engine.formId)
    expect(screen.queryByRole('button', { name: 'Duplicate record' })).toBeNull()
    cleanup()

    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.read)
    await load(user, record)
    await loaded(record)
    expect(screen.queryByRole('button', { name: 'Duplicate record' })).toBeNull()
  })
})
