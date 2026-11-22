import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { CASCADES_CHOSEN, DISCARDED_WITH_THEM, EACH_ON_ITS_OWN, NONE_DELETED, REMOVED_CHOSEN, RESTRICTED_CHOSEN, STILL_OPEN } from './chosen-deletion.js'
import { NONE_CHOSEN } from './chosen-rows.js'
import { HELD, NOT_FOUND, REMOVED, RESTRICTED, SAVE_OUT } from './deletion.js'
import { WORK } from './leave.js'
import { CHOOSE_FIRST } from './selection-bar.js'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { barSays, box, choiceBar, choiceSaid } from './test-choosing.js'
import {
  answer,
  chooseForm,
  chooseRenderer,
  control,
  formLink,
  gridSection,
  load,
  loaded,
  mount,
  said,
  save,
  searchRecords,
  signIn,
  stamp,
  unsavedNotice,
} from './test-host.js'
import type { User } from './test-host.js'
import { holdingRequests, holdingWrites, losingWrites } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Deleting the records chosen of the Records grid's page together (0173,
 * 0174), on both engines, against the real server: Delete the chosen…
 * from the bar above the grid, its confirmation in place in the form's
 * `deleting` words, and what became of each record -- deleted, changed
 * since, gone, referred to, or not known until Check them reads it --
 * the page read again, the records deleted gone from the choice and those
 * not deleted still chosen, each box saying why; the open record closed
 * where it was deleted or not found, left open where a check found it gone
 * with work in its forms, and its Save held while the deletion is out; a
 * question closed by Escape, Keep them and a change of the choice, a
 * second press sending nothing, and the guard counting a deletion not
 * known. What the database holds is asked beside the page, as tenant 1's
 * clerk.
 *
 * Found by role and accessible name. The reads the accessibility tree
 * cannot answer: what the wire carried, by path; and what the database
 * holds, asked through a client beside the page.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deletes: true, bulk: ['removable', 'order'] })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ARRIVES = { timeout: 15_000 }

/** What the server answers a delete whose record moved on since it was read, and one other rows still refer to, verbatim (0050). */
const STALE = 'The record changed since it was read. Reload it and review the changes before deleting it.'
const REFERENCED = 'Other records still refer to this one, so the database keeps it. Nothing was deleted.'

/** The question's name, and without its question mark the name of what the server answered. */
const deleting = (count: number, noun: string, asking = false): string =>
  `Delete ${String(count)} chosen ${noun} ${count === 1 ? 'record' : 'records'}${asking ? '?' : ''}`

/** A removable record's box in the Records grid. */
const removableBox = (record: string): HTMLInputElement =>
  within(gridSection('Records')).getByRole<HTMLInputElement>('checkbox', { name: `Choose Removable ${record}` })

/** How many deletions of chosen records the page sent, of the requests `plane` saw since `from`. */
const deletesSent = (from: number): number =>
  plane.sent.slice(from).filter((request) => request.method === 'POST' && request.path.endsWith('/records/delete-chosen')).length

/** Whether a record is there, asked beside the page as tenant 1's clerk. */
async function stored(formId: string, record: string): Promise<boolean> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok && read.status !== 404) throw new Error(read.message)
  return read.ok
}

/** `count` removable records of tenant 1's, noted `note`: their tokens, in the order created. */
async function removables(engine: Engine, note: string, count: number): Promise<string[]> {
  const made: string[] = []
  for (let n = 0; n < count; n += 1) {
    const created = await plane.clerk.create(engine.removable, { note })
    if (!created.ok || created.value.record === null) throw new Error('a removable record was not created')
    made.push(created.value.record)
  }
  return made
}

/** An order of tenant 1's noted `notes`, through the page's own server as the clerk. */
async function freshOrder(engine: Engine, notes: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, {
    customer: found.value.rows[0].token,
    order_date: EDGES.orderDate,
    status: 'placed',
    amount: '1',
    notes,
  })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

/** The record changed beside the page by tenant 1's clerk: its version moves on. */
async function moveOn(formId: string, record: string, answers: Record<string, string>): Promise<void> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok || read.value.version === null) throw new Error('the record did not read')
  if (!(await plane.clerk.update(formId, { record, version: read.value.version, answers })).ok) throw new Error('the record did not move on')
}

/** The page signed in as tenant 1's clerk with `fetch`, `formId` chosen and searched for `words` until it lists `records`. */
async function chosenPage(fetch: typeof globalThis.fetch, formId: string, words: string, records: readonly string[]): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await searchRecords(
    user,
    words,
    records.map((record) => record.slice(3)),
  )
  return user
}

/** Delete the chosen… pressed on the bar: its confirmation, once the keyboard is on it. */
async function askDelete(user: User, count: number, noun: string): Promise<HTMLElement> {
  await user.click(within(choiceBar()).getByRole('button', { name: 'Delete the chosen…' }))
  const confirming = await screen.findByRole('region', { name: deleting(count, noun, true) }, ARRIVES)
  await waitFor(() => expect(focusedName()).toBe(deleting(count, noun, true)))
  return confirming
}

/** What the server answered, once the keyboard is on it. */
async function outcome(count: number, noun: string): Promise<HTMLElement> {
  const answered = await screen.findByRole('region', { name: deleting(count, noun) }, ARRIVES)
  await waitFor(() => expect(focusedName()).toBe(deleting(count, noun)), ARRIVES)
  return answered
}

describe.each(ENGINES)('deleting the chosen records on $engine', (engine) => {
  // Five removable records chosen together, then, beside the page, one
  // changed, one deleted and one referred to by another row with NO
  // ACTION: the confirmation counts them and says, from the form's
  // `deleting`, that each goes on its own, that a record referred to is
  // kept -- and no cascade, which this form's policy names none of; the
  // next Tab is Keep them. Delete them deletes the two untouched once, and
  // the region the keyboard lands on, described by all it says, counts
  // them and names each other record in the server's words, the one
  // deleted beside the page as not found, never deleted. The page is read
  // again: the two deleted and the one gone leave the choice, the changed
  // and the referred-to stay chosen, the bar names them and each box says
  // why; a box ticked drops that. Axe and a name on every control with
  // the boxes ticked, at the confirmation and once answered (to be watched
  // failing in CI with the records left chosen once deleted: "expected [
  // true, true ] to deeply equal [ false, false ]").
  test('deletes each record on its own, names each not deleted, and keeps those chosen with why', async () => {
    const note = stamp('chosen')
    const [first, moved, gone, referred, last] = (await removables(engine, note, 5)) as [string, string, string, string, string]
    const from = plane.sent.length
    const user = await chosenPage(plane.fetch, engine.removable, note, [first, moved, gone, referred, last])
    await user.click(within(choiceBar()).getByRole('button', { name: 'Choose every record on this page' }))
    await barSays('5 chosen.')
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await moveOn(engine.removable, moved, { note: `${note} moved` })
    const read = await plane.clerk.read(engine.removable, gone)
    if (!read.ok || read.value.version === null) throw new Error('the removable record did not read')
    if (!(await plane.clerk.delete(engine.removable, { record: gone, version: read.value.version })).ok) throw new Error('it was not deleted beside the page')
    await plane.db.referToRemovable(engine.connection, referred)

    const confirming = await askDelete(user, 5, 'Removable')
    // Its heading is the region's own, a level under the bar's grid, as a delete's is (delete.test.tsx).
    expect(within(confirming).getByRole('heading', { level: 4 }).textContent).toBe(deleting(5, 'Removable', true))
    expect(computeAccessibleDescription(confirming)).toBe([EACH_ON_ITS_OWN, REMOVED_CHOSEN, RESTRICTED_CHOSEN].join(' '))
    expect(computeAccessibleDescription(confirming)).not.toContain(CASCADES_CHOSEN)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await user.tab()
    expect(focusedName()).toBe('Keep them')
    await user.tab()
    expect(focusedName()).toBe('Delete them')
    await user.keyboard('{Enter}')

    const answered = await outcome(5, 'Removable')
    expect(within(answered).getByRole('heading', { level: 4 }).textContent).toBe(deleting(5, 'Removable'))
    const each = [`Removable ${moved}: ${STALE}`, `Removable ${gone}: ${NOT_FOUND}`, `Removable ${referred}: ${REFERENCED}`]
    expect(paragraphs(answered)[0]).toBe('Deleted 2 of 5 records.')
    expect(
      within(answered)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(each)
    expect(computeAccessibleDescription(answered)).toBe(['Deleted 2 of 5 records.', ...each].join(' '))
    expect(deletesSent(from)).toBe(1)
    expect([await stored(engine.removable, first), await stored(engine.removable, last)]).toEqual([false, false])
    expect([await stored(engine.removable, moved), await stored(engine.removable, referred)]).toEqual([true, true])
    await barSays(`2 chosen. Still chosen after the deletion: Removable ${moved} and Removable ${referred}.`)
    await waitFor(() => expect(within(gridSection('Records')).queryByRole('checkbox', { name: `Choose Removable ${first}` })).toBeNull(), ARRIVES)
    expect([removableBox(moved).checked, removableBox(referred).checked]).toEqual([true, true])
    expect(computeAccessibleDescription(removableBox(moved))).toBe(`Not deleted. ${STALE}`)
    expect(computeAccessibleDescription(removableBox(referred))).toBe(`Not deleted. ${REFERENCED}`)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.click(within(answered).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(focusedName()).toBe('Delete the chosen…'))
    await user.click(removableBox(moved))
    await barSays('1 chosen.')
    expect(computeAccessibleDescription(removableBox(referred))).toBe('')
  })

  // On the order form, whose policy names the keys a delete of an order
  // deletes its lines through, the confirmation says other records that
  // refer to one go with it, and they do: an order and its line deleted
  // with another order. The open order is one of them, with typing in its
  // form: the confirmation lists that form as discarded with it; Angular's
  // typed into while it asks is named too before anything is sent, as a
  // delete's is; and once it is deleted the detail is closed as a delete
  // closes it, the keyboard staying on what the server answered (to be
  // watched failing in CI with the open record left open: no heading "No
  // record open"; and with the list taken once, at the question:
  // Angular's draft deleted unnamed).
  test('says and does what a cascade the form names does, and closes the open record it deleted', async () => {
    const notes = stamp('cascade')
    const [order, other] = [await freshOrder(engine, notes), await freshOrder(engine, notes)]
    const line = await plane.clerk.create(engine.lines, { order, line_no: '1', quantity: '1', unit_price: '1.00' })
    if (!line.ok || line.value.record === null) throw new Error('the line was not created')
    const user = await chosenPage(plane.fetch, engine.formId, notes, [order, other])
    // Both renderers on, so the Angular form can be typed into while it asks.
    await chooseRenderer(user)
    await load(user, order)
    await loaded(order)
    await answer(user, 'React', 'Notes', `${notes} typed`)
    await user.click(box(order))
    await user.click(box(other))
    const confirming = await askDelete(user, 2, 'Order')
    expect(paragraphs(confirming)).toEqual([EACH_ON_ITS_OWN, REMOVED_CHOSEN, CASCADES_CHOSEN, DISCARDED_WITH_THEM])
    expect(within(confirming).getByRole('listitem').textContent).toBe(`Order ${order}, React: ${WORK.changed}`)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    const from = plane.sent.length
    await answer(user, 'Angular', 'Notes', `${notes} typed while it asked`)
    await user.click(within(confirming).getByRole('button', { name: 'Delete them' }))
    await waitFor(() => expect(within(confirming).getAllByRole('listitem')).toHaveLength(2), ARRIVES)
    expect(
      within(confirming)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([`Order ${order}, React: ${WORK.changed}`, `Order ${order}, Angular: ${WORK.changed}`])
    await waitFor(() => expect(focusedName()).toBe(deleting(2, 'Order', true)))
    expect(deletesSent(from)).toBe(0)
    await user.click(within(confirming).getByRole('button', { name: 'Delete them' }))

    const answered = await outcome(2, 'Order')
    expect(computeAccessibleDescription(answered)).toBe('Deleted 2 of 2 records.')
    expect([await stored(engine.formId, order), await stored(engine.formId, other), await stored(engine.lines, line.value.record)]).toEqual([
      false,
      false,
      false,
    ])
    expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy()
    expect(focusedName()).toBe(deleting(2, 'Order'))
    await barSays(NONE_CHOSEN)
  })

  // An answer lost after the server deleted them: every record may have
  // been, said once in the client's words, and the guard counts it --
  // another form asks first, naming it. Check them reads each record:
  // both gone, which this deletion or another did, the page cannot tell
  // apart and says; nothing is sent again, and once checked the guard
  // lets the grid go. Lost before it reached the server, the check finds
  // each still stored at the version read, says none was deleted, and
  // keeps them chosen (to be watched failing in CI with Check them sending
  // the deletion again: two requests on the wire).
  test.each(['after', 'before'] as const)('a lost answer %s the server deleted them is checked record by record, nothing sent again', async (when) => {
    const note = stamp(`lost-${when}`)
    const records = await removables(engine, note, 2)
    const [first, second] = records as [string, string]
    const losing = losingWrites(plane.fetch, { when, writes: /\/records\/delete-chosen$/ })
    const user = await chosenPage(losing.fetch, engine.removable, note, records)
    await user.click(removableBox(first))
    await user.click(removableBox(second))
    const from = plane.sent.length
    await user.click(within(await askDelete(user, 2, 'Removable')).getByRole('button', { name: 'Delete them' }))
    const unknown = await outcome(2, 'Removable')
    expect(paragraphs(unknown)[0]).toMatch(/was lost between this page and the data server\. Any of them may have been deleted\.$/)
    expect(within(unknown).queryByRole('button', { name: 'Close' })).toBeNull()
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.click(await formLink(engine.formId))
    const asked = await waitFor(() => {
      const shown = unsavedNotice()
      expect(shown).not.toBeNull()
      return shown as HTMLElement
    }, ARRIVES)
    expect(asked.textContent).toContain(`${deleting(2, 'Removable')}: ${WORK['delete-unknown']}`)
    await user.click(within(asked).getByRole('button', { name: 'Keep editing' }))

    await user.click(within(screen.getByRole('region', { name: deleting(2, 'Removable') })).getByRole('button', { name: 'Check them' }))
    const checked = await screen.findByRole('region', { name: deleting(2, 'Removable') })
    await waitFor(() => expect(within(checked).getByRole('button', { name: 'Close' })).toBeTruthy(), ARRIVES)
    expect(deletesSent(from)).toBe(when === 'after' ? 1 : 0)
    if (when === 'after') {
      expect(paragraphs(checked)[0]).toBe('2 of 2 records are not there any more: this deletion, or somebody else’s, deleted them.')
      expect([await stored(engine.removable, first), await stored(engine.removable, second)]).toEqual([false, false])
      await barSays(NONE_CHOSEN)
    } else {
      // Said as none deleted, never as "0 of 2 records are not there any more: … deleted them."
      expect(paragraphs(checked)[0]).toBe(NONE_DELETED)
      expect(
        within(checked)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual([`Removable ${first}: It is still stored, at the version you saw.`, `Removable ${second}: It is still stored, at the version you saw.`])
      await barSays(`2 chosen. Still chosen after the deletion: Removable ${first} and Removable ${second}.`)
    }
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // The open order chosen, its deletion's answer lost after the server
  // deleted it: the lost answer gives its Save back, and what is typed
  // then was never listed. Check them finds it gone and leaves it open,
  // the typing kept, the region naming it and offering Close the record,
  // as after a delete's check (0053); pressed, the detail closes and the
  // region takes the keyboard again (to be watched failing in CI with the
  // record closed by the check, its typing gone: no button "Close the
  // record").
  test('a check leaves the open record it finds gone open while its forms hold work, until Close the record', async () => {
    const notes = stamp('kept-open')
    const orders = [await freshOrder(engine, notes), await freshOrder(engine, notes)]
    const [order, other] = orders as [string, string]
    const losing = losingWrites(plane.fetch, { when: 'after', writes: /\/records\/delete-chosen$/ })
    const user = await chosenPage(losing.fetch, engine.formId, notes, orders)
    await load(user, order)
    await loaded(order)
    await user.click(box(order))
    await user.click(box(other))
    await user.click(within(await askDelete(user, 2, 'Order')).getByRole('button', { name: 'Delete them' }))
    const unknown = await outcome(2, 'Order')
    await answer(user, 'React', 'Notes', `${notes} typed after`)
    await user.click(within(unknown).getByRole('button', { name: 'Check them' }))

    const checked = screen.getByRole('region', { name: deleting(2, 'Order') })
    const closes = await within(checked).findByRole('button', { name: 'Close the record' }, ARRIVES)
    const open = `Order ${order} ${STILL_OPEN}`
    expect(paragraphs(checked)).toEqual(['2 of 2 records are not there any more: this deletion, or somebody else’s, deleted them.', open])
    expect(computeAccessibleDescription(checked)).toBe(paragraphs(checked).join(' '))
    expect(control('React', 'Notes').value).toBe(`${notes} typed after`)
    expect(screen.getByRole('heading', { level: 3, name: `Order ${order}` })).toBeTruthy()
    expect([await stored(engine.formId, order), await stored(engine.formId, other)]).toEqual([false, false])
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.click(closes)
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy(), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(deleting(2, 'Order')))
    expect(within(checked).queryByRole('button', { name: 'Close the record' })).toBeNull()
    expect(paragraphs(checked)).not.toContain(open)
  })

  // The open order chosen, typed into, and deleted beside the page before
  // Delete them: answered not found -- never called deleted -- it leaves
  // the choice and the page, and the detail is closed with the typing its
  // confirmation listed, as when it is deleted; the other order is (to be
  // watched failing in CI with a record not found left open: no heading
  // "No record open").
  test('closes the open record the server cannot find, its typing listed and discarded', async () => {
    const notes = stamp('not-found')
    const orders = [await freshOrder(engine, notes), await freshOrder(engine, notes)]
    const [order, other] = orders as [string, string]
    const user = await chosenPage(plane.fetch, engine.formId, notes, orders)
    await load(user, order)
    await loaded(order)
    await answer(user, 'React', 'Notes', `${notes} typed`)
    await user.click(box(order))
    await user.click(box(other))
    const read = await plane.clerk.read(engine.formId, order)
    if (!read.ok || read.value.version === null) throw new Error('the order did not read')
    if (!(await plane.clerk.delete(engine.formId, { record: order, version: read.value.version })).ok) throw new Error('it was not deleted beside the page')
    const confirming = await askDelete(user, 2, 'Order')
    expect(within(confirming).getByRole('listitem').textContent).toBe(`Order ${order}, React: ${WORK.changed}`)
    await user.click(within(confirming).getByRole('button', { name: 'Delete them' }))

    const answered = await outcome(2, 'Order')
    expect(computeAccessibleDescription(answered)).toBe(['Deleted 1 of 2 records.', `Order ${order}: ${NOT_FOUND}`].join(' '))
    expect(await stored(engine.formId, other)).toBe(false)
    expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy()
    await barSays(NONE_CHOSEN)
  })

  // A question over the choice stands only while the choice holds what it
  // asked over: Escape is Keep them, and either closes it, nothing sent,
  // the keyboard back on Delete the chosen…; a box unticked closes it,
  // nothing sent, and asked again over one record it is that record's
  // delete in 0053's words; Clear the choice closes that. Pressed with
  // nothing chosen, Delete the chosen… is no dead end: it says what to do
  // first and sends nothing. And a form that grants a delete of one record
  // and no deletion of chosen records -- an order's lines on SQL Server,
  // each row with its Delete; on PostgreSQL their typed key offers no
  // delete at all, so there is no such form to ask -- has neither the boxes
  // nor the bar: they follow `bulk.delete`, never a delete alone (to be
  // watched failing in CI with
  // the question kept past its choice: the region still there, 1 chosen;
  // and with Escape left to the page: the keyboard on the region still).
  test('a question closes when the choice changes, nothing sent; and nothing chosen says what to do first', async () => {
    const note = stamp('closes')
    const records = await removables(engine, note, 2)
    const [first, second] = records as [string, string]
    const from = plane.sent.length
    const user = await chosenPage(plane.fetch, engine.removable, note, records)
    const asks = within(choiceBar()).getByRole('button', { name: 'Delete the chosen…' })
    expect(asks.getAttribute('aria-disabled')).toBe('true')
    expect(computeAccessibleDescription(asks)).toBe(CHOOSE_FIRST)
    await user.click(asks)
    await barSays(`${NONE_CHOSEN} ${CHOOSE_FIRST}`)
    expect(screen.queryByRole('region', { name: /^Delete \d+ chosen / })).toBeNull()

    await user.click(removableBox(first))
    await user.click(removableBox(second))
    await askDelete(user, 2, 'Removable')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: deleting(2, 'Removable', true) })).toBeNull()
    await waitFor(() => expect(focusedName()).toBe('Delete the chosen…'))
    const kept = await askDelete(user, 2, 'Removable')
    await user.click(within(kept).getByRole('button', { name: 'Keep them' }))
    expect(screen.queryByRole('region', { name: deleting(2, 'Removable', true) })).toBeNull()
    await waitFor(() => expect(focusedName()).toBe('Delete the chosen…'))
    expect(deletesSent(from)).toBe(0)
    await barSays('2 chosen.')

    await askDelete(user, 2, 'Removable')
    await user.click(removableBox(second))
    await barSays('1 chosen.')
    expect(screen.queryByRole('region', { name: deleting(2, 'Removable', true) })).toBeNull()
    const one = await askDelete(user, 1, 'Removable')
    expect(computeAccessibleDescription(one)).toBe(`${REMOVED} ${RESTRICTED}`)
    await user.click(within(choiceBar()).getByRole('button', { name: 'Clear the choice' }))
    await barSays(NONE_CHOSEN)
    expect(screen.queryByRole('region', { name: deleting(1, 'Removable', true) })).toBeNull()
    expect(deletesSent(from)).toBe(0)
    expect([await stored(engine.removable, first), await stored(engine.removable, second)]).toEqual([true, true])

    if (engine.engine !== 'SQL Server') return
    const order = await freshOrder(engine, note)
    const line = await plane.clerk.create(engine.lines, { order, line_no: '1', quantity: '1', unit_price: '1.00' })
    if (!line.ok) throw new Error(line.message)
    await chooseForm(user, engine.lines)
    await within(gridSection('Records')).findAllByRole('button', { name: /^Delete Order line / }, ARRIVES)
    expect(within(gridSection('Records')).queryAllByRole('checkbox', { name: /^Choose / })).toEqual([])
    expect(within(gridSection('Records')).queryByRole('group', { name: 'Chosen records' })).toBeNull()
  })

  // While the deletion is out a second press sends nothing: Delete them
  // says it is deleting, and the bar's button asks for the deletion out
  // again, its region focused, never a second one; the open record, one of
  // them, holds its Save, which sends nothing and says why -- an update
  // would race the delete -- and so does the Save of another record opened
  // while it is out, as 0174's cost says: the hold is the forms', not the
  // record's. Once answered, both are deleted, once (to be watched failing
  // in CI with the open record's Save left unheld: an update sent while
  // the deletion was out).
  test('a second press while it is out sends nothing, and the open record’s Save is held', async () => {
    const notes = stamp('held')
    const orders = [await freshOrder(engine, notes), await freshOrder(engine, notes), await freshOrder(engine, notes)]
    const [order, other, third] = orders as [string, string, string]
    const holding = holdingRequests(plane.fetch, ({ method, path }) => method === 'POST' && path.endsWith('/records/delete-chosen'))
    const user = await chosenPage(holding.fetch, engine.formId, notes, orders)
    await load(user, order)
    await loaded(order)
    await user.click(box(order))
    await user.click(box(other))
    await user.click(within(await askDelete(user, 2, 'Order')).getByRole('button', { name: 'Delete them' }))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const out = screen.getByRole('region', { name: deleting(2, 'Order', true) })
    expect(within(out).getByRole('button', { name: 'Delete them' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(out).getByRole('status').textContent).toBe('Deleting…')
    await user.click(within(out).getByRole('button', { name: 'Delete them' }))
    await user.click(within(choiceBar()).getByRole('button', { name: 'Delete the chosen…' }))
    await waitFor(() => expect(focusedName()).toBe(deleting(2, 'Order', true)))
    expect(holding.held).toHaveLength(1)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    const from = plane.sent.length
    await answer(user, 'React', 'Notes', `${notes} typed`)
    await save(user, 'React')
    const heldSaid = new RegExp(`^${HELD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    await said('React', heldSaid)
    expect(plane.sent.slice(from).filter((request) => request.path.endsWith('/records/update'))).toEqual([])

    // Another record opened while it is out, the held typing discarded: its Save is held too.
    await load(user, third)
    const asked = await waitFor(() => {
      const shown = unsavedNotice()
      expect(shown).not.toBeNull()
      return shown as HTMLElement
    }, ARRIVES)
    await user.click(within(asked).getByRole('button', { name: 'Discard and continue' }))
    // Loaded after the typing was discarded, which its status line says first.
    await waitFor(
      () =>
        expect(within(screen.getByRole('region', { name: `Order ${third}` })).getAllByRole('status')[0]?.textContent).toMatch(
          new RegExp(`^Discarded the unsaved changes\\. Loaded record ${third.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} into `),
        ),
      ARRIVES,
    )
    await answer(user, 'React', 'Notes', `${notes} typed on another`)
    await save(user, 'React')
    await said('React', heldSaid)
    expect(plane.sent.slice(from).filter((request) => request.path.endsWith('/records/update'))).toEqual([])
    expect(holding.held).toHaveLength(1)

    await holding.pass()
    await outcome(2, 'Order')
    expect(holding.held).toEqual([])
    expect([await stored(engine.formId, order), await stored(engine.formId, other)]).toEqual([false, false])
    expect(choiceSaid()).toBe(NONE_CHOSEN)
  })

  // A save of the open record out, where it is chosen: Delete them waits
  // for the answer, which moves the version it would name -- aria-disabled,
  // described by why, and sending nothing when pressed -- and once the save
  // is answered it sends the version the save moved to, so the record is
  // deleted rather than refused as changed by the person's own save (to be
  // watched failing in CI with Delete them sent while the save was out:
  // the open order answered stale).
  test('Delete them waits for a save of the open record out, then sends the version it moved to', async () => {
    const notes = stamp('waits')
    const orders = [await freshOrder(engine, notes), await freshOrder(engine, notes)]
    const [order, other] = orders as [string, string]
    const holding = holdingWrites(plane.fetch)
    const user = await chosenPage(holding.fetch, engine.formId, notes, orders)
    await load(user, order)
    await loaded(order)
    await user.click(box(order))
    await user.click(box(other))
    const confirming = await askDelete(user, 2, 'Order')
    await answer(user, 'React', 'Notes', `${notes} saved first`)
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const deletes = within(confirming).getByRole('button', { name: 'Delete them' })
    await waitFor(() => expect(deletes.getAttribute('aria-disabled')).toBe('true'))
    expect(computeAccessibleDescription(deletes)).toBe(SAVE_OUT)
    const from = plane.sent.length
    await user.click(deletes)
    expect(deletesSent(from)).toBe(0)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    holding.answer()
    await said('React', /^Saved./)
    await waitFor(() => expect(within(confirming).getByRole('button', { name: 'Delete them' }).getAttribute('aria-disabled')).toBeNull(), ARRIVES)
    await user.click(within(confirming).getByRole('button', { name: 'Delete them' }))
    expect(computeAccessibleDescription(await outcome(2, 'Order'))).toBe('Deleted 2 of 2 records.')
    expect([await stored(engine.formId, order), await stored(engine.formId, other)]).toEqual([false, false])
  })
})
