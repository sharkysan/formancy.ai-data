import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { CHANGE_HELD, CLEARS, EACH_CHANGED, FIELDS_LEGEND, movesEach, NONE_CHANGED, READ_AGAIN_CHANGED, TICK_FIELDS } from './chosen-change.js'
import { NONE_CHOSEN } from './chosen-rows.js'
import { WORK } from './leave.js'
import { CHOOSE_FIRST } from './selection-bar.js'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { barSays, box, choiceBar } from './test-choosing.js'
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
import type { RendererName, User } from './test-host.js'
import { holdingRequests, losingWrites } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Changing the records chosen of the Records grid's page together (0175,
 * 0176), on both engines, against the real server: Change the chosen…
 * from the bar above the grid, a box for each field the form serves the
 * clerk such a change in, each ticked drawn on paper by the renderer
 * shown, Continue, then the confirmation in place, each field and its
 * value; and what became of each record -- changed, changed since, a move
 * of its status refused from its own state, or not known until Check
 * them reads it -- the page read again, the records changed gone from the
 * choice and those not changed still chosen, each box saying why; the open
 * record read again into its forms where it was changed, and its Save held
 * while the change is out; a question closed by a change of the choice, a
 * second press sending nothing, and the guard counting a change not known.
 * Over the order form whose status the clerk moves from draft to placed to
 * shipped (`moves` of ENGINES) and the removable records, whose note may be
 * NULL (test-plane.ts's CHANGES). What the database holds is asked beside
 * the page, as tenant 1's clerk.
 *
 * Found by role and accessible name. The reads the accessibility tree
 * cannot answer: what the wire carried, by path; and what the database
 * holds, asked through a client beside the page.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ deletes: true, moves: true, changes: ['removable', 'moves'] })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ARRIVES = { timeout: 15_000 }

/** What the server answers an update whose record moved on since it was read, verbatim (0098), and a move the policy does not grant (0112). */
const STALE = 'The record changed since it was read. Reload it, review the changes, and save again.'
const MOVE = 'status may not move from where it is to where this update puts it, for your roles.'

/** The question's name -- with a question mark while it confirms -- and without it the name of its fields' region and of what the server answered. */
const changing = (count: number, noun: string, asking = false): string =>
  `Change ${String(count)} chosen ${noun} ${count === 1 ? 'record' : 'records'}${asking ? '?' : ''}`

/** A removable record's box in the Records grid. */
const removableBox = (record: string): HTMLInputElement =>
  within(gridSection('Records')).getByRole<HTMLInputElement>('checkbox', { name: `Choose Removable ${record}` })

/** How many changes of chosen records the page sent, of the requests `plane` saw since `from`. */
const changesSent = (from: number): number =>
  plane.sent.slice(from).filter((request) => request.method === 'POST' && request.path.endsWith('/records/update-chosen')).length

/** A record's answers as stored, asked beside the page as tenant 1's clerk. */
async function storedAnswers(formId: string, record: string): Promise<Readonly<Record<string, unknown>>> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok) throw new Error(read.message)
  return read.value.answers
}

/** An order of tenant 1's in `status`, noted `notes`, through the page's own server as the clerk. */
async function order(engine: Engine, status: 'draft' | 'placed' | 'shipped', notes: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status, amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
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

/** Change the chosen… pressed on the bar: its fields' region, once the keyboard is on it. */
async function askChange(user: User, count: number, noun: string): Promise<HTMLElement> {
  await user.click(within(choiceBar()).getByRole('button', { name: 'Change the chosen…' }))
  const asking = await screen.findByRole('region', { name: changing(count, noun) }, ARRIVES)
  await waitFor(() => expect(focusedName()).toBe(changing(count, noun)))
  return asking
}

/** A field's box in the change's region. */
const fieldBox = (asking: HTMLElement, label: string): HTMLInputElement =>
  within(within(asking).getByRole('group', { name: FIELDS_LEGEND })).getByRole<HTMLInputElement>('checkbox', { name: label })

/** The change's paper, as the renderer `renderer` draws it, once it is there. */
const valuesPaper = (asking: HTMLElement, renderer: RendererName = 'React'): Promise<HTMLElement> =>
  within(asking).findByRole('form', { name: `Values to set, ${renderer}` }, ARRIVES)

/** Continue on the paper: the confirmation, once the keyboard is on it. */
async function continueChange(user: User, asking: HTMLElement, count: number, noun: string, renderer: RendererName = 'React'): Promise<HTMLElement> {
  await user.click(within(await valuesPaper(asking, renderer)).getByRole('button', { name: 'Continue' }))
  const confirming = await screen.findByRole('region', { name: changing(count, noun, true) }, ARRIVES)
  await waitFor(() => expect(focusedName()).toBe(changing(count, noun, true)))
  return confirming
}

/** What the server answered, once the keyboard is on it. */
async function outcome(count: number, noun: string): Promise<HTMLElement> {
  const answered = await waitFor(() => {
    const region = screen.getByRole('region', { name: changing(count, noun) })
    // The fields' region has the name too, and no Close or Check them.
    expect(within(region).queryByRole('group', { name: FIELDS_LEGEND })).toBeNull()
    return region
  }, ARRIVES)
  await waitFor(() => expect(focusedName()).toBe(changing(count, noun)), ARRIVES)
  return answered
}

/** The items a region lists, as their text. */
const items = (region: HTMLElement): string[] =>
  within(region)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')

describe.each(ENGINES)('changing the chosen records on $engine', (engine) => {
  // Three orders chosen together, then, beside the page, one changed: the
  // change's region offers a box for each field granted, none ticked;
  // Status ticked offers placed alone -- a draft moves there, a shipped
  // order nowhere -- and Notes typed into; Continue's confirmation counts
  // them, says each field and its value and that each record moves from
  // its own state; the next Tab is Keep them. Change them changes the
  // untouched draft once, and the region the keyboard lands on, described
  // by all it says, counts it and names the others in the server's words:
  // the one changed beside the page stale, the shipped one's move refused
  // from its own state. The page is read again: the changed order leaves
  // the choice, the others stay chosen, the bar names them and each box
  // says why. Axe and a name on every control at the fields, the paper,
  // the confirmation and once answered (to be watched failing in CI with
  // the state field offered as the record's form draws it: no option
  // "placed" alone).
  test('changes each record on its own, a move checked from its own state, and keeps those not changed chosen with why', async () => {
    const notes = stamp('changed')
    const [draft, moved, shipped] = [await order(engine, 'draft', notes), await order(engine, 'draft', notes), await order(engine, 'shipped', notes)]
    const from = plane.sent.length
    const user = await chosenPage(plane.fetch, engine.moves, notes, [draft, moved, shipped])
    await user.click(within(choiceBar()).getByRole('button', { name: 'Choose every record on this page' }))
    await barSays('3 chosen.')
    const read = await plane.clerk.read(engine.formId, moved)
    if (!read.ok || read.value.version === null) throw new Error('the order did not read')
    if (!(await plane.clerk.update(engine.formId, { record: moved, version: read.value.version, answers: { notes: `${notes} moved` } })).ok)
      throw new Error('it was not changed beside the page')

    const asking = await askChange(user, 3, 'Order')
    expect(within(asking).getByRole('heading', { level: 4 }).textContent).toBe(changing(3, 'Order'))
    const boxes = within(within(asking).getByRole('group', { name: FIELDS_LEGEND })).getAllByRole<HTMLInputElement>('checkbox')
    expect(boxes.map((each) => [computeAccessibleName(each), each.checked])).toEqual([
      ['Customer', false],
      ['Status', false],
      ['Notes', false],
    ])
    expect(computeAccessibleDescription(within(asking).getByRole('group', { name: FIELDS_LEGEND }))).toBe(TICK_FIELDS)
    expect(within(asking).queryByRole('form')).toBeNull()
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await user.click(fieldBox(asking, 'Status'))
    await user.click(fieldBox(asking, 'Notes'))
    const paper = await valuesPaper(asking)
    const status = within(paper).getByRole<HTMLSelectElement>('combobox', { name: /^Status/ })
    expect(
      within(status)
        .getAllByRole<HTMLOptionElement>('option')
        .map((option) => option.value)
        .filter((value) => value !== ''),
    ).toEqual(['placed'])
    await user.selectOptions(status, 'placed')
    await user.type(within(paper).getByLabelText('Notes', { exact: true }), `${notes} together`)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    const confirming = await continueChange(user, asking, 3, 'Order')
    expect(items(confirming)).toEqual(['Status: placed', `Notes: ${notes} together`])
    expect(computeAccessibleDescription(confirming)).toBe(['Status: placed', `Notes: ${notes} together`, EACH_CHANGED, movesEach('Status', 3)].join(' '))
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await user.tab()
    expect(focusedName()).toBe('Keep them')
    await user.tab()
    expect(focusedName()).toBe('Change them')
    await user.keyboard('{Enter}')

    const answered = await outcome(3, 'Order')
    const each = [`Order ${moved}: ${STALE}`, `Order ${shipped}: ${MOVE}`]
    expect(paragraphs(answered)[0]).toBe('Changed 1 of 3 records.')
    expect(items(answered)).toEqual(each)
    expect(computeAccessibleDescription(answered)).toBe(['Changed 1 of 3 records.', ...each].join(' '))
    expect(changesSent(from)).toBe(1)
    expect(await storedAnswers(engine.formId, draft)).toMatchObject({ status: 'placed', notes: `${notes} together` })
    expect(await storedAnswers(engine.formId, moved)).toMatchObject({ status: 'draft', notes: `${notes} moved` })
    expect(await storedAnswers(engine.formId, shipped)).toMatchObject({ status: 'shipped', notes })
    await barSays(`2 chosen. Still chosen after the change: Order ${moved} and Order ${shipped}.`)
    expect([box(draft).checked, box(moved).checked, box(shipped).checked]).toEqual([false, true, true])
    expect(computeAccessibleDescription(box(moved))).toBe(`Not changed. ${STALE}`)
    expect(computeAccessibleDescription(box(shipped))).toBe(`Not changed. ${MOVE}`)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await user.click(within(answered).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(focusedName()).toBe('Change the chosen…'))
  })

  // A field ticked and left empty is cleared: the confirmation says so, by
  // the field and in a sentence of its own, and both removable records'
  // notes are NULL once changed -- never an empty text, nor left as they
  // were; both leave the choice (to be watched failing in CI with the
  // empty field left out of what is sent: both notes kept).
  test('clears a field ticked and left empty, and says so before it is sent', async () => {
    const note = stamp('cleared')
    const records = await removables(engine, note, 2)
    const [first, second] = records as [string, string]
    const user = await chosenPage(plane.fetch, engine.removable, note, records)
    await user.click(removableBox(first))
    await user.click(removableBox(second))
    const asking = await askChange(user, 2, 'Removable')
    await user.click(fieldBox(asking, 'Note'))
    const confirming = await continueChange(user, asking, 2, 'Removable')
    expect(items(confirming)).toEqual(['Note: cleared'])
    expect(paragraphs(confirming)).toEqual([EACH_CHANGED, CLEARS])
    await user.click(within(confirming).getByRole('button', { name: 'Change them' }))
    const answered = await outcome(2, 'Removable')
    expect(computeAccessibleDescription(answered)).toBe('Changed 2 of 2 records.')
    expect([(await storedAnswers(engine.removable, first))['note'], (await storedAnswers(engine.removable, second))['note']]).toEqual([null, null])
    await barSays(NONE_CHOSEN)
  })

  // The paper is drawn by the renderer the person shows -- React alone,
  // Angular alone -- and a lookup on it is the form's typeahead, searched
  // under the update's filter: the customer found by typing and chosen is
  // said by its name in the confirmation, and the order is changed to it
  // (to be watched failing in CI with the paper handed no option source:
  // no option "Muster AG").
  test.each(['React', 'Angular'] as const)('draws the fields on %s’s paper, a lookup with its typeahead', async (renderer) => {
    const notes = stamp(`paper-${renderer}`)
    const chosen = await order(engine, 'draft', notes)
    const user = await chosenPage(plane.fetch, engine.moves, notes, [chosen])
    await chooseRenderer(user, renderer)
    await user.click(box(chosen))
    const asking = await askChange(user, 1, 'Order')
    await user.click(fieldBox(asking, 'Customer'))
    const paper = await valuesPaper(asking, renderer)
    const customer = await within(paper).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    await user.type(customer, 'Muster')
    await user.click(await within(paper).findByRole('option', { name: 'Muster AG' }, ARRIVES))
    expect([...(await audit()), ...unnamed()]).toEqual([])
    const confirming = await continueChange(user, asking, 1, 'Order', renderer)
    expect(items(confirming)).toEqual(['Customer: Muster AG'])
    await user.click(within(confirming).getByRole('button', { name: 'Change them' }))
    expect(computeAccessibleDescription(await outcome(1, 'Order'))).toBe('Changed 1 of 1 record.')
  })

  // The open order chosen, typed into: the confirmation lists its form as
  // discarded by reading it again, and once changed it is read again into
  // its forms -- the change's value shown, at the version the change moved
  // it to, so its next Save is stored rather than refused as changed by
  // the person's own change (to be watched failing in CI with the open
  // record left as it was: its Save answered stale).
  test('reads the open record it changed again into its forms', async () => {
    const notes = stamp('reread')
    const orders = [await order(engine, 'draft', notes), await order(engine, 'draft', notes)]
    const [open, other] = orders as [string, string]
    const user = await chosenPage(plane.fetch, engine.moves, notes, orders)
    await load(user, open)
    await loaded(open)
    await answer(user, 'React', 'Notes', `${notes} typed`)
    await user.click(box(open))
    await user.click(box(other))
    const asking = await askChange(user, 2, 'Order')
    await user.click(fieldBox(asking, 'Notes'))
    await user.type(within(await valuesPaper(asking)).getByLabelText('Notes', { exact: true }), `${notes} together`)
    const confirming = await continueChange(user, asking, 2, 'Order')
    expect(paragraphs(confirming)).toEqual([EACH_CHANGED, READ_AGAIN_CHANGED])
    expect(within(confirming).getAllByRole('listitem').at(-1)?.textContent).toBe(`Order ${open}, React: ${WORK.changed}`)
    await user.click(within(confirming).getByRole('button', { name: 'Change them' }))
    await outcome(2, 'Order')
    await waitFor(() => expect(control('React', 'Notes').value).toBe(`${notes} together`), ARRIVES)
    await answer(user, 'React', 'Notes', `${notes} saved after`)
    await save(user, 'React')
    await said('React', /^Saved\./)
    expect(await storedAnswers(engine.formId, open)).toMatchObject({ notes: `${notes} saved after` })
    expect(await storedAnswers(engine.formId, other)).toMatchObject({ notes: `${notes} together` })
  })

  // An answer lost after the server changed them: every record may have
  // been, said once in the client's words, and the guard counts it --
  // another form asks first, naming it. Check them reads each record, as
  // an update's check reads one: both moved on, which this change or
  // another made, the page cannot tell apart and says; nothing is sent
  // again. Lost before it reached the server, the check finds each at the
  // version read, says none was changed, and keeps them chosen (to be
  // watched failing in CI with Check them sending the change again: two
  // requests on the wire).
  test.each(['after', 'before'] as const)('a lost answer %s the server changed them is checked record by record, nothing sent again', async (when) => {
    const note = stamp(`lost-${when}`)
    const records = await removables(engine, note, 2)
    const [first, second] = records as [string, string]
    const losing = losingWrites(plane.fetch, { when, writes: /\/records\/update-chosen$/ })
    const user = await chosenPage(losing.fetch, engine.removable, note, records)
    await user.click(removableBox(first))
    await user.click(removableBox(second))
    const from = plane.sent.length
    const asking = await askChange(user, 2, 'Removable')
    await user.click(fieldBox(asking, 'Note'))
    await user.type(within(await valuesPaper(asking)).getByLabelText('Note', { exact: true }), 'lost')
    await user.click(within(await continueChange(user, asking, 2, 'Removable')).getByRole('button', { name: 'Change them' }))
    const unknown = await outcome(2, 'Removable')
    expect(paragraphs(unknown)[0]).toMatch(/was lost between this page and the data server\. Any of them may have been changed\.$/)
    expect(within(unknown).queryByRole('button', { name: 'Close' })).toBeNull()
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.click(await formLink(engine.formId))
    const asked = await waitFor(() => {
      const shown = unsavedNotice()
      expect(shown).not.toBeNull()
      return shown as HTMLElement
    }, ARRIVES)
    expect(asked.textContent).toContain(`${changing(2, 'Removable')}: ${WORK['change-unknown']}`)
    await user.click(within(asked).getByRole('button', { name: 'Keep editing' }))

    await user.click(within(screen.getByRole('region', { name: changing(2, 'Removable') })).getByRole('button', { name: 'Check them' }))
    const checked = screen.getByRole('region', { name: changing(2, 'Removable') })
    await waitFor(() => expect(within(checked).getByRole('button', { name: 'Close' })).toBeTruthy(), ARRIVES)
    expect(changesSent(from)).toBe(when === 'after' ? 1 : 0)
    if (when === 'after') {
      expect(paragraphs(checked)[0]).toBe('2 of 2 records have changed since this page read them: this change, or somebody else’s, changed them.')
      await barSays(NONE_CHOSEN)
    } else {
      expect(paragraphs(checked)[0]).toBe(NONE_CHANGED)
      expect(items(checked)).toEqual([`Removable ${first}: It is still at the version you saw.`, `Removable ${second}: It is still at the version you saw.`])
      await barSays(`2 chosen. Still chosen after the change: Removable ${first} and Removable ${second}.`)
    }
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })

  // A question over the choice stands only while the choice holds what it
  // asked over: a box unticked closes the change's fields, and Clear the
  // choice its confirmation, nothing sent, the keyboard back on Change the
  // chosen…; Escape is Keep them. Pressed with nothing chosen it is no
  // dead end: it says what to do first and sends nothing (to be watched
  // failing in CI with the fields kept past their choice: the region
  // still there, 1 chosen).
  test('a question closes when the choice changes, nothing sent; and nothing chosen says what to do first', async () => {
    const note = stamp('closes')
    const records = await removables(engine, note, 2)
    const [first, second] = records as [string, string]
    const from = plane.sent.length
    const user = await chosenPage(plane.fetch, engine.removable, note, records)
    const asks = within(choiceBar()).getByRole('button', { name: 'Change the chosen…' })
    expect([asks.getAttribute('aria-disabled'), computeAccessibleDescription(asks)]).toEqual(['true', CHOOSE_FIRST])
    await user.click(asks)
    await barSays(`${NONE_CHOSEN} ${CHOOSE_FIRST}`)
    expect(screen.queryByRole('region', { name: /^Change \d+ chosen / })).toBeNull()

    await user.click(removableBox(first))
    await user.click(removableBox(second))
    await askChange(user, 2, 'Removable')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: changing(2, 'Removable') })).toBeNull()
    await waitFor(() => expect(focusedName()).toBe('Change the chosen…'))
    const asking = await askChange(user, 2, 'Removable')
    await user.click(fieldBox(asking, 'Note'))
    await user.click(removableBox(second))
    await barSays('1 chosen.')
    expect(screen.queryByRole('region', { name: changing(2, 'Removable') })).toBeNull()
    const one = await askChange(user, 1, 'Removable')
    await user.click(fieldBox(one, 'Note'))
    await continueChange(user, one, 1, 'Removable')
    await user.click(within(choiceBar()).getByRole('button', { name: 'Clear the choice' }))
    await barSays(NONE_CHOSEN)
    expect(screen.queryByRole('region', { name: changing(1, 'Removable', true) })).toBeNull()
    expect(changesSent(from)).toBe(0)
    expect([(await storedAnswers(engine.removable, first))['note'], (await storedAnswers(engine.removable, second))['note']]).toEqual([note, note])
  })

  // While the change is out a second press sends nothing: Change them says
  // it is changing, and the bar's button asks for the change out again,
  // its region focused, never a second one; the open record, one of them,
  // holds its Save, which sends nothing and says why -- an update would
  // race the change. Once answered, both are changed, once, and the open
  // record read again asks first about its form typed into since the
  // confirmation listed nothing of it (to be watched failing in CI with the
  // open record's Save left unheld: an update sent while the change was
  // out).
  test('a second press while it is out sends nothing, and the open record’s Save is held', async () => {
    const notes = stamp('held')
    const orders = [await order(engine, 'draft', notes), await order(engine, 'draft', notes)]
    const [open, other] = orders as [string, string]
    const holding = holdingRequests(plane.fetch, ({ method, path }) => method === 'POST' && path.endsWith('/records/update-chosen'))
    const user = await chosenPage(holding.fetch, engine.moves, notes, orders)
    await load(user, open)
    await loaded(open)
    await user.click(box(open))
    await user.click(box(other))
    const asking = await askChange(user, 2, 'Order')
    await user.click(fieldBox(asking, 'Notes'))
    await user.type(within(await valuesPaper(asking)).getByLabelText('Notes', { exact: true }), `${notes} together`)
    await user.click(within(await continueChange(user, asking, 2, 'Order')).getByRole('button', { name: 'Change them' }))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const out = screen.getByRole('region', { name: changing(2, 'Order', true) })
    expect(within(out).getByRole('button', { name: 'Change them' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(out).getByRole('status').textContent).toBe('Changing…')
    await user.click(within(out).getByRole('button', { name: 'Change them' }))
    await user.click(within(choiceBar()).getByRole('button', { name: 'Change the chosen…' }))
    await waitFor(() => expect(focusedName()).toBe(changing(2, 'Order', true)))
    expect(holding.held).toHaveLength(1)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    const from = plane.sent.length
    await answer(user, 'React', 'Notes', `${notes} typed`)
    await save(user, 'React')
    await said('React', new RegExp(`^${CHANGE_HELD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    expect(plane.sent.slice(from).filter((request) => request.path.endsWith('/records/update'))).toEqual([])
    await holding.pass()
    const asked = await waitFor(() => {
      const shown = unsavedNotice()
      expect(shown).not.toBeNull()
      return shown as HTMLElement
    }, ARRIVES)
    expect(asked.textContent).toContain(`Reading ${open} again, since it was changed with the chosen records, closes these forms:`)
    await user.click(within(asked).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(control('React', 'Notes').value).toBe(`${notes} together`), ARRIVES)
    expect(paragraphs(screen.getByRole('region', { name: changing(2, 'Order') }))[0]).toBe('Changed 2 of 2 records.')
    expect(holding.held).toEqual([])
    expect([(await storedAnswers(engine.formId, open))['notes'], (await storedAnswers(engine.formId, other))['notes']]).toEqual([
      `${notes} together`,
      `${notes} together`,
    ])
  })
})
