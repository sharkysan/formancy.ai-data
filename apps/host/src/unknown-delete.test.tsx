import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { NOT_FOUND } from './deletion.js'
import { focusedName, paragraphs } from './test-accessible.js'
import { chooseForm, chooseRenderer, gridSection, gridStatus, mount, newRecord, rendered, searchRecords, shows, signIn, stamp, unsavedNotice } from './test-host.js'
import type { User } from './test-host.js'
import { losingWrites } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A deletion whose answer was lost between the page and the data server
 * (0031, 0053), on both engines, against the real server: "It may have been
 * deleted", never "Not deleted"; a check that reads the record and says
 * what the read showed -- gone, still at the version sent, or changed --
 * with the keyboard then on the notice; and "Delete it again", which asks
 * again before anything is sent. The loss is made up around a real write,
 * between the page and the server; that a dropped connection makes the
 * adapters say `unknown-outcome` is data-server's e2e-lost-answer.
 *
 * Found by role and accessible name, with one read the tree cannot answer,
 * said where it is made: which requests the page sent.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deletes: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ARRIVES = { timeout: 15_000 }

/** The client's own sentence when the answer to a deletion was lost on the way. */
const LOST = 'The answer to this deletion was lost between this page and the data server. It may have been deleted.'

async function freshOrder(engine: Engine, notes: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error(`the order was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

async function stored(formId: string, record: string): Promise<boolean> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok && read.status !== 404) throw new Error(read.message)
  return read.ok
}

/** The page over `fetch`, signed in, the order `notes` names opened, and its Delete record pressed and confirmed: the deletion sent. */
async function deleteThrough(engine: Engine, fetch: typeof globalThis.fetch, notes: string, record: string): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.formId)
  await chooseRenderer(user)
  await searchRecords(user, notes, [record.slice(3)])
  const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
  const row = within(grid).getAllByRole('row').find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === record.slice(3)) as HTMLElement
  await user.click(within(row).getAllByRole('gridcell')[0] as HTMLElement)
  await screen.findByRole('heading', { level: 3, name: `Order ${record}` }, ARRIVES)
  await rendered()
  await user.click(screen.getByRole('button', { name: 'Delete record' }))
  await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
  await waitFor(() => expect(focusedName()).toBe('It may have been deleted'), ARRIVES)
  return user
}

const notice = (): HTMLElement => screen.getByRole('region', { name: 'It may have been deleted' })
const sentTo = (route: string, from: number): number => plane.sent.slice(from).filter((request) => request.path.endsWith(route)).length

describe.each(ENGINES)('a deletion whose answer was lost, on $engine', (engine) => {
  // Lost after the server deleted it: the page cannot know, says so, and
  // leaving asks first -- it may have been done. Enter twice on Check reads
  // once and sends no delete: the second Enter meets the check still out,
  // and then the notice, which the keyboard is moved to with the answer,
  // so no button is under it (watched failing with Check left pressable
  // while it read: two reads). Gone is the not-found wording, never
  // "deleted", and Close the record says "Closed".
  test('lost after it was done: may have been deleted, one check on Enter twice, and closed once found gone', async () => {
    const notes = stamp('lostafter')
    const record = await freshOrder(engine, notes)
    const losing = losingWrites(plane.fetch, { when: 'after', writes: /\/records\/delete$/ })
    const user = await deleteThrough(engine, losing.fetch, notes, record)
    expect(paragraphs(notice())[0]).toBe(LOST)
    expect(screen.queryByRole('region', { name: 'Not deleted' })).toBeNull()
    expect(await stored(engine.formId, record)).toBe(false)

    await newRecord(user)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    expect(within(unsavedNotice() as HTMLElement).getAllByRole('listitem').map((item) => item.textContent)).toContain(`Order ${record}: a deletion that may have been done, not yet checked.`)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))

    const sent = plane.sent.length
    within(notice()).getByRole('button', { name: 'Check whether it was deleted' }).focus()
    await user.keyboard('{Enter}{Enter}')
    await waitFor(() => expect(within(notice()).getByRole('status').textContent).toBe(NOT_FOUND), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe('It may have been deleted'))
    await user.keyboard('{Enter}')
    expect(sentTo('/records/read', sent)).toBe(1)
    expect(sentTo('/records/delete', sent)).toBe(0)
    expect(within(notice()).queryByRole('button', { name: 'Check whether it was deleted' })).toBeNull()

    await user.click(within(notice()).getByRole('button', { name: 'Close the record' }))
    await waitFor(() => expect(focusedName()).toBe('Records'))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Closed Order ${record}. No records match “${notes}”.`), ARRIVES)
  })

  // Lost before it reached the server: still stored at the version sent,
  // so the person may delete it again -- which asks again, Keep it first,
  // and only its Delete it sends, once (watched failing with Delete it
  // again sending at once).
  test('lost before it was sent: still stored, and Delete it again asks before it sends, once', async () => {
    const notes = stamp('lostbefore')
    const record = await freshOrder(engine, notes)
    const losing = losingWrites(plane.fetch, { when: 'before', writes: /\/records\/delete$/ })
    const user = await deleteThrough(engine, losing.fetch, notes, record)
    expect(await stored(engine.formId, record)).toBe(true)
    await user.click(within(notice()).getByRole('button', { name: 'Check whether it was deleted' }))
    await waitFor(() => expect(within(notice()).getByRole('status').textContent).toBe('It is still stored, at the version you saw.'), ARRIVES)
    const sent = plane.sent.length
    await user.click(within(notice()).getByRole('button', { name: 'Delete it again' }))
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${record}?`))
    expect(sentTo('/records/delete', sent)).toBe(0)
    await user.tab()
    expect(focusedName()).toBe('Keep it')
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(sentTo('/records/delete', sent)).toBe(1)
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // Lost before it was sent, and the record changed beside the page since:
  // still stored, and changed -- so the person loads it rather than delete
  // what they have not seen.
  test('lost, and changed since: Load the saved record opens what is stored', async () => {
    const notes = stamp('lostchanged')
    const record = await freshOrder(engine, notes)
    const losing = losingWrites(plane.fetch, { when: 'before', writes: /\/records\/delete$/ })
    const user = await deleteThrough(engine, losing.fetch, notes, record)
    const read = await plane.clerk.read(engine.formId, record)
    if (!read.ok || read.value.version === null) throw new Error('the order did not read')
    if (!(await plane.clerk.update(engine.formId, { record, version: read.value.version, answers: { notes: `${notes} changed` } })).ok) throw new Error('the order did not change')
    await user.click(within(notice()).getByRole('button', { name: 'Check whether it was deleted' }))
    await waitFor(() => expect(within(notice()).getByRole('status').textContent).toBe('It is still stored, and has changed since you saw it.'), ARRIVES)
    await user.click(within(notice()).getByRole('button', { name: 'Load the saved record' }))
    await shows('React', 'Notes', `${notes} changed`)
    expect(screen.queryByRole('region', { name: 'It may have been deleted' })).toBeNull()
    expect(await stored(engine.formId, record)).toBe(true)
  })
})
