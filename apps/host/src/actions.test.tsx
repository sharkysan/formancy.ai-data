import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { clearedText, NONE_CHOSEN } from './chosen-rows.js'
import { WORK } from './leave.js'
import { checkedText, DONE, NONE_CHANGED, READ_AGAIN, READING_AGAIN, RUNS_ON, RUNS_OVER_CHOSEN } from './running.js'
import { CHOOSE_FIRST } from './selection-bar.js'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { askClose, closed, closeRegion, closing, dialogPaper, openActionOrder, region, runIt, runsSent } from './test-acting.js'
import { actionForm, CLOSE_ALL_LABEL, CLOSE_WORDS, STAMP_LABEL } from './test-actions.js'
import { askCloseAll, barSays, box, choiceBar, choiceSaid, choose, closeAllsSent, closingAll } from './test-choosing.js'
import {
  answer,
  chooseForm,
  chooseRenderer,
  gridSection,
  gridStatus,
  load,
  mount,
  notice,
  RENDERERS,
  said,
  save,
  searchRecords,
  shows,
  signIn,
  stamp,
  unsavedNotice,
} from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { holdingRequests, holdingWrites } from './test-network.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * What the page does once an action over the open record has run (0162),
 * and an action over the records a person chose of the Records grid's
 * page (0166),
 * on both engines, against the real server and the actions schema every
 * fixture loads: the record read again, so its next Save names the version
 * the run moved -- and held until it is, never dropped by a question the
 * guard asks meanwhile; and a run whose answer was lost, checked by a read
 * of the record and run again only from the version it sent -- which, once
 * the first committed after all, is stale, and closes nothing twice. And an
 * action with no dialog and no words of its administrator's. What a run
 * stored is asked of the database's owner.
 *
 * Found by role and accessible name. The reads the accessibility tree
 * cannot answer are the database's, and how many runs the wire carried.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ actions: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ARRIVES = { timeout: 15_000 }

/** What the server answers a run from a version that moved, verbatim (0161). */
const STALE = 'The record changed since it was read. Reload it and review the changes before running this again. Nothing was done.'

/** The unsaved-changes notice, once it asks. */
async function asked(): Promise<HTMLElement> {
  return waitFor(() => {
    const shown = unsavedNotice()
    expect(shown).not.toBeNull()
    return shown as HTMLElement
  }, ARRIVES)
}

describe.each(ENGINES)('an action over the open record on $engine', (engine) => {
  const connection = `${engine.connection}-actions`

  // Close ran and moved the order's version, and the routine changed its
  // status and note: the panes hold what is stored once it has, at the
  // version the run moved, so the next Save of the order is stored. A page
  // that kept its read from before the run would send that version, and
  // the person's own run would make their Save stale (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // the reread taken out: the panes still showed the order "open"). The
  // region the keyboard lands on is described by what the server did, so
  // it is said as it lands (watched failing with the done region described
  // by nothing: "expected '' to be 'The order is closed.'").
  test.each(RENDERERS)('in %s, the order is read again once close ran, and its next Save is stored', async (renderer) => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const user = await openActionOrder(plane.fetch, engine, record, renderer)
    await askClose(user, record, renderer, 'closed from the page')
    await runIt(user, record)
    expect(computeAccessibleDescription(await closed(record))).toBe(CLOSE_WORDS.done)
    await shows(renderer, 'Status', 'closed')
    await shows(renderer, 'Note', 'closed from the page')
    await answer(user, renderer, 'Amount', '20')
    await save(user, renderer)
    await said(renderer, /^Saved\.$/)
    expect(await plane.db.actionOrder(engine.connection, record)).toEqual({
      status: 'closed',
      version: 3,
      note: 'closed from the page',
      amount: '20.00',
      closes: 1,
    })
  })

  // Close answered while the guard asks about something else -- another
  // order loaded while the run was out, which asks first, the run being
  // the record's work -- leaves the keyboard on that question, which the
  // person is answering, and the read after it waits for their answer
  // rather than being dropped: kept editing, the panes hold what the
  // routine stored at the version the run moved, and the next Save is
  // stored (watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with that read dropped
  // while the question waited: the panes still showed the order "open";
  // and with the region taking the keyboard as close answered: "expected
  // 'Close the order: Order k1:3' to be 'Unsaved changes'").
  test.each(RENDERERS)(
    'in %s, close answered while another order is asked about: the read waits for the answer, and kept editing, the next Save is stored',
    async (renderer) => {
      const record = await plane.db.insertActionOrder(engine.connection)
      const other = await plane.db.insertActionOrder(engine.connection)
      const holding = holdingWrites(plane.fetch)
      const user = await openActionOrder(holding.fetch, engine, record, renderer)
      await askClose(user, record, renderer, 'closed while asked')
      await runIt(user, record)
      await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
      await load(user, other)
      const question = await asked()
      await waitFor(() => expect(focusedName()).toBe('Unsaved changes'))
      holding.answer()
      await closed(record)
      // The read after close goes out and is answered on app.inject within a few ticks, while the question waits.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(focusedName()).toBe('Unsaved changes')
      await user.click(within(question).getByRole('button', { name: 'Keep editing' }))
      await shows(renderer, 'Status', 'closed')
      await answer(user, renderer, 'Amount', '22')
      await save(user, renderer)
      // The save's answer is held too: handed over once it is.
      await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
      holding.answer()
      await said(renderer, /^Saved\.$/)
      expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', version: 3, amount: '22.00', closes: 1 })
    },
  )

  // Until the order is read again after close ran, a Save of it sends
  // nothing and says why: it would name the version from before the run,
  // stale against the person's own run. A read refused is said in the
  // region, which is described by it, and offers the saved record, whose
  // next Save is stored (watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with the forms let go as
  // close answered: the pane never said the order was being read again,
  // every status line of it empty).
  test('until the order is read again after close ran, its Save sends nothing; a read refused says so, and offers the saved record', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    let armed = false
    const reads = holdingRequests(
      plane.fetch,
      ({ method, path, body }) => armed && method === 'POST' && path.endsWith('/records/read') && (body?.includes(record) ?? false),
    )
    const user = await openActionOrder(reads.fetch, engine, record)
    await askClose(user, record, 'React', 'closed, read late')
    armed = true
    await runIt(user, record)
    const done = await closed(record)
    await waitFor(() => expect(reads.held).toHaveLength(1), ARRIVES)
    armed = false
    await answer(user, 'React', 'Amount', '23')
    const from = plane.sent.length
    await save(user, 'React')
    await said('React', new RegExp(`^${READING_AGAIN}$`))
    expect(plane.sent.slice(from).filter((request) => /\/records\/(update|save)$/.test(request.path))).toEqual([])
    await reads.fail()
    const unread = await within(done).findByText(/^It ran, and the record could not be read again: /, {}, ARRIVES)
    expect(computeAccessibleDescription(done)).toBe(`${CLOSE_WORDS.done} ${unread.textContent ?? ''}`)
    await user.click(within(done).getByRole('button', { name: 'Load the saved record' }))
    // The amount typed is the React form's work: Load asks first.
    await user.click(within(await asked()).getByRole('button', { name: 'Discard and continue' }))
    await shows('React', 'Status', 'closed')
    await answer(user, 'React', 'Amount', '24')
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', version: 3, amount: '24.00', closes: 1 })
  })

  // Under Both, the dialog is React's alone. Typed into since it asked,
  // the confirmation names that form before anything is sent, focused
  // again, and passes axe; what it listed the person agreed to drop when
  // they ran it, so the read after close asks only about a form typed into
  // while it ran -- and kept editing there, that form's next Save names the
  // version from before the run, and is stale (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // the confirmation not asked again: "expected 'It closes the order, and
  // the database…' to contain 'Order k1:8, React: changes that are n…'";
  // and with what it listed asked about again: "expected 'Order k1:8,
  // React: changes that are n…' to be 'Order k1:8, Angular: changes that
  // are…'").
  test('under Both, the confirmation names what was typed since it asked, and the read after close asks only about what was typed while it ran', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const holding = holdingWrites(plane.fetch)
    const user = await openActionOrder(holding.fetch, engine, record, 'Both')
    await user.click(screen.getByRole('button', { name: CLOSE_WORDS.label }))
    const asking = await region(closing(record))
    const box = await waitFor(() => within(dialogPaper(record, 'React')).getByRole('textbox', { name: /^Note\b/ }), ARRIVES)
    expect(within(asking).queryByRole('form', { name: `${CLOSE_WORDS.label}, Angular` })).toBeNull()
    await user.type(box, 'closed under both')
    await user.click(within(dialogPaper(record, 'React')).getByRole('button', { name: 'Continue' }))
    expect(computeAccessibleDescription(await region(closing(record, true)))).toBe(CLOSE_WORDS.confirm)
    await answer(user, 'React', 'Amount', '30')
    const from = plane.sent.length
    await runIt(user, record)
    const listed = `Order ${record}, React: ${WORK.changed}`
    await waitFor(() => expect(computeAccessibleDescription(closeRegion(record, true))).toContain(listed))
    expect(computeAccessibleDescription(closeRegion(record, true))).toContain(READ_AGAIN)
    expect(runsSent(plane, from)).toBe(0)
    await waitFor(() => expect(focusedName()).toBe(closing(record, true)))
    expect(await audit()).toEqual([])
    await runIt(user, record)
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await answer(user, 'Angular', 'Amount', '31')
    holding.answer()
    await closed(record)
    const question = await asked()
    expect(within(question).getByRole('list').textContent).toBe(`Order ${record}, Angular: ${WORK.changed}`)
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }))
    await save(user, 'Angular')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    holding.answer()
    await waitFor(() => expect(notice('Angular')).not.toBeNull(), ARRIVES)
    expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', version: 2, closes: 1 })
  })

  // The question the read after close asks -- about a form typed into
  // while it ran -- replaced by another request of the person's lets the
  // record's forms go: the order they asked for instead opens, and its
  // Save is stored, never held as though that read were still out
  // (watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with the replaced question
  // letting nothing go: "expected [] to have a length of 1 but got +0", the
  // Save sent nothing).
  test('the read after close, its question replaced by another order loaded, lets the forms go', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const other = await plane.db.insertActionOrder(engine.connection)
    const holding = holdingWrites(plane.fetch)
    const user = await openActionOrder(holding.fetch, engine, record)
    await askClose(user, record, 'React', 'closed, then left')
    await runIt(user, record)
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await answer(user, 'React', 'Amount', '40')
    holding.answer()
    await closed(record)
    expect(within(await asked()).getByRole('list').textContent).toBe(`Order ${record}, React: ${WORK.changed}`)
    await load(user, other)
    await waitFor(() => expect(computeAccessibleDescription(unsavedNotice() as HTMLElement)).toMatch(new RegExp(`^Loading ${other} `)), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: `Order ${other}` }, ARRIVES)
    await answer(user, 'React', 'Amount', '41')
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    holding.answer()
    await said('React', /^Saved\.$/)
    expect(await plane.db.actionOrder(engine.connection, other)).toMatchObject({ status: 'open', version: 2, amount: '41.00', closes: 0 })
  })

  // An action with no dialog starts at its confirmation, which says the
  // page's own sentence where its administrator wrote none, and once it
  // ran says the page's own "Done.", which describes the region the
  // keyboard lands on; every state passes axe (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // the page's sentence left out: "expected '' to be 'It runs in the
  // database, over this re…'").
  test('an action with no dialog and no words of its own asks its confirmation first, in the page\'s words, and says "Done."', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const user = await openActionOrder(plane.fetch, engine, record)
    await user.click(screen.getByRole('button', { name: STAMP_LABEL }))
    const confirming = await region(`${STAMP_LABEL}: Order ${record}?`)
    await waitFor(() => expect(focusedName()).toBe(`${STAMP_LABEL}: Order ${record}?`))
    expect(computeAccessibleDescription(confirming)).toBe(RUNS_ON)
    expect(await audit()).toEqual([])
    await user.click(within(confirming).getByRole('button', { name: 'Run it' }))
    const done = await waitFor(() => {
      const shown = screen.getByRole('region', { name: `${STAMP_LABEL}: Order ${record}` })
      expect(within(shown).getByText(DONE)).toBeTruthy()
      return shown
    }, ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(`${STAMP_LABEL}: Order ${record}`))
    expect(computeAccessibleDescription(done)).toBe(DONE)
    expect(await audit()).toEqual([])
    await shows('React', 'Status', 'closed')
    expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', note: null, version: 2, closes: 1 })
  })

  // The open record's header offers the actions over the open record
  // alone: close-all, close_order bound again over a selection, which the
  // form offers and the clerk may run, is no control of it -- an action
  // over a selection belongs above the grid (0165, 0166). Drawn in the
  // header, it would run over the open record alone, a selection of one
  // nobody chose, under words that say every order chosen.
  test('the open record’s header offers its actions over the open record, and none over a selection', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    await openActionOrder(plane.fetch, engine, record)
    const header = screen.getByRole('region', { name: `Order ${record}` })
    expect(within(header).getByRole('button', { name: CLOSE_WORDS.label })).toBeTruthy()
    expect(within(header).getByRole('button', { name: STAMP_LABEL })).toBeTruthy()
    expect(within(header).queryByRole('button', { name: CLOSE_ALL_LABEL })).toBeNull()
    expect(screen.queryByRole('button', { name: 'close-all' })).toBeNull()
  })

  // A run lost before it reached the database checks as not run: the
  // order is still at the version it sent, and until it is checked,
  // opening another order asks first, naming the run. If it then commits
  // after all, as a transaction orphaned by a cut can (0031), Run it again
  // sends that same version and is stale -- never a version read since,
  // which would close the order a second time -- and while it is out the
  // keyboard is on the region, never left on the page (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // Run it again sending the version the order holds then: no "Not run",
  // the second run done; with the run not the guard's: "expected null not
  // to be null", no notice; and with the run again leaving the keyboard
  // where Run it again was: "expected 'the page itself' to be 'Close the
  // order: Order k1:10?'").
  test('a run whose answer was lost checks as not run, and once it commits, Run it again is stale and closes nothing twice', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const holding = holdingWrites(plane.fetch)
    const user = await openActionOrder(holding.fetch, engine, record)
    plane.runs.lose.set(connection, 'late')
    await askClose(user, record, 'React', 'closed late')
    await runIt(user, record)
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    holding.answer()
    const unknown = await region('It may have run')
    await load(user, await plane.db.insertActionOrder(engine.connection))
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(within(unsavedNotice() as HTMLElement).getByRole('list').textContent).toBe(
      `Close the order: Order ${record}: an action that may have run, not yet checked.`,
    )
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await user.click(within(unknown).getByRole('button', { name: 'Check whether it ran' }))
    await within(unknown).findByText(checkedText({ kind: 'unchanged' }), {}, ARRIVES)
    const late = plane.runs.late.shift()
    if (late === undefined) throw new Error('no run was held')
    expect((await late()).ok).toBe(true)
    await user.click(within(unknown).getByRole('button', { name: 'Run it again' }))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    expect(focusedName()).toBe(closing(record, true))
    holding.answer()
    const refused = await region('Not run')
    expect(paragraphs(refused)).toEqual([STALE])
    expect(within(refused).getByRole('button', { name: 'Load the saved record' })).toBeTruthy()
    const stored = await plane.db.actionOrder(engine.connection, record)
    expect({ version: stored.version, closes: stored.closes }).toEqual({ version: 2, closes: 1 })
  })

  // A run that committed and whose answer was lost after checks as changed,
  // and offers the saved record, never Run it again -- or Close, for a
  // person who wants neither (watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with every check read as
  // unchanged: no "It ran, or the record was changed since you read it.";
  // and with no Close there: "Unable to find an accessible element with
  // the role "button" and name "Close"").
  test('a run lost after it committed checks as changed, and loads the saved record', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const user = await openActionOrder(plane.fetch, engine, record)
    plane.runs.lose.set(connection, 'after')
    await askClose(user, record, 'React', 'closed unheard')
    await runIt(user, record)
    const unknown = await region('It may have run')
    await user.click(within(unknown).getByRole('button', { name: 'Check whether it ran' }))
    await within(unknown).findByText(checkedText({ kind: 'changed' }), {}, ARRIVES)
    expect(within(unknown).queryByRole('button', { name: 'Run it again' })).toBeNull()
    expect(within(unknown).getByRole('button', { name: 'Close' })).toBeTruthy()
    await user.click(within(unknown).getByRole('button', { name: 'Load the saved record' }))
    await shows('React', 'Status', 'closed')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'It may have run' })).toBeNull())
    expect((await plane.db.actionOrder(engine.connection, record)).closes).toBe(1)
  })
})

/** The page on `engine`'s action orders, signed in as tenant 1's clerk, the renderer switch on `renderer`, the Records grid searched for `note` until it lists exactly `records`. */
async function chosenPage(
  fetch: typeof globalThis.fetch,
  engine: { connection: 'pg' | 'ms' },
  note: string,
  records: readonly string[],
  renderer: RendererName = 'React',
): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, actionForm(engine))
  await chooseRenderer(user, renderer)
  await searchRecords(
    user,
    note,
    records.map((record) => record.slice('k1:'.length)),
  )
  return user
}

/**
 * The texts of `record`'s row in the Records grid. Its row is found from its
 * box, a DOM read: the accessibility tree names a row by nothing, and a cell
 * by its value alone.
 */
function rowTexts(record: string): string[] {
  const row = box(record).closest('[role="row"]') as HTMLElement
  return within(row)
    .getAllByRole('gridcell')
    .map((cell) => cell.textContent ?? '')
}

describe.each(ENGINES)('an action over the records chosen on $engine', (engine) => {
  // Two orders of three chosen by their boxes, and close-all run from the
  // bar above the grid, through its dialog in the renderer shown and a
  // confirmation that counts them: both are closed and the third is not,
  // each once; the region the keyboard lands on says how many it ran over;
  // the page is read again, its rows showing what the routine stored; and
  // the choice is cleared. Every state passes axe and names every control
  // (to be watched failing in CI with the records sent as the open record
  // alone: one order closed, the other open).
  test.each(RENDERERS)('in %s, two orders chosen and closed together are both closed, and the page is read again', async (renderer) => {
    const note = stamp('chosen')
    const [first, second, third] = [
      await plane.db.insertActionOrder(engine.connection, note),
      await plane.db.insertActionOrder(engine.connection, note),
      await plane.db.insertActionOrder(engine.connection, note),
    ] as [string, string, string]
    const user = await chosenPage(plane.fetch, engine, note, [first, second, third], renderer)
    expect(choiceSaid()).toBe(NONE_CHOSEN)
    await choose(user, [second, first])
    await barSays('2 chosen.')
    expect([...(await audit()), ...unnamed()]).toEqual([])
    const confirming = await askCloseAll(user, 2, 'closed together', renderer)
    expect(computeAccessibleDescription(confirming)).toBe(RUNS_OVER_CHOSEN)
    const from = plane.sent.length
    await user.click(within(confirming).getByRole('button', { name: 'Run it' }))
    const done = await waitFor(() => {
      const shown = screen.getByRole('region', { name: closingAll(2) })
      expect(within(shown).getByText(`${DONE} It ran over 2 records.`)).toBeTruthy()
      return shown
    }, ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(closingAll(2)))
    expect(computeAccessibleDescription(done)).toBe(`${DONE} It ran over 2 records.`)
    expect(closeAllsSent(plane, from)).toBe(1)
    expect(plane.sent.slice(from).some((request) => request.path.endsWith('/records/list'))).toBe(true)
    for (const record of [first, second])
      expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', note: 'closed together', version: 2, closes: 1 })
    expect(await plane.db.actionOrder(engine.connection, third)).toMatchObject({ status: 'open', version: 1, closes: 0 })
    await waitFor(() => expect(rowTexts(first)).toContain('closed'), ARRIVES)
    expect(rowTexts(third)).toContain('open')
    await barSays(NONE_CHOSEN)
    expect([box(first).checked, box(second).checked]).toEqual([false, false])
    expect(await audit()).toEqual([])
  })

  // One of two orders chosen changed by somebody else since the page read
  // it: the run is refused naming that order, by the words its row's Delete
  // names it with, says nothing was done to either -- all or nothing (0165)
  // -- and offers to read the page again, never to run it again anyway;
  // neither order is closed. Read again, the choice is kept at the
  // versions the page reads now, and run again it closes both (to be
  // watched failing in CI with the refusal's records left unsaid: no "It
  // is about Order …").
  test('a choice with one order changed since it was read is refused naming it, nothing is closed, and the page read again runs', async () => {
    const note = stamp('stale')
    const kept = await plane.db.insertActionOrder(engine.connection, note)
    const moved = await plane.db.insertActionOrder(engine.connection, note)
    const user = await chosenPage(plane.fetch, engine, note, [kept, moved])
    await choose(user, [kept, moved])
    await plane.db.touchActionOrder(engine.connection, moved)
    const confirming = await askCloseAll(user, 2, 'closed when read')
    await user.click(within(confirming).getByRole('button', { name: 'Run it' }))
    const refused = await region('Not run')
    await waitFor(() => expect(focusedName()).toBe('Not run'))
    const [sentence, about, none] = paragraphs(refused)
    expect(sentence).toMatch(/^The record changed since it was read\./)
    expect([about, none]).toEqual([`It is about Order ${moved}.`, NONE_CHANGED])
    expect(within(refused).queryByRole('button', { name: /^Run it/ })).toBeNull()
    expect(within(refused).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(await audit()).toEqual([])
    for (const record of [kept, moved]) expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'open', closes: 0 })

    const reading = plane.sent.length
    await user.click(within(refused).getByRole('button', { name: 'Read the page again' }))
    await waitFor(() => expect(focusedName()).toBe(CLOSE_ALL_LABEL))
    // The page's rows read again, at the versions the database holds now, before the run that names them.
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    await waitFor(() => expect(plane.sent.slice(reading).some((request) => request.path.endsWith('/records/list'))).toBe(true), ARRIVES)
    await waitFor(() => expect(grid.getAttribute('aria-busy')).toBeNull(), ARRIVES)
    await barSays('2 chosen.')
    await user.click(within(await askCloseAll(user, 2, 'closed once read')).getByRole('button', { name: 'Run it' }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: closingAll(2) })).getByText(`${DONE} It ran over 2 records.`)).toBeTruthy(), ARRIVES)
    expect(await plane.db.actionOrder(engine.connection, moved)).toMatchObject({ status: 'closed', version: 3, closes: 1 })
    expect(await plane.db.actionOrder(engine.connection, kept)).toMatchObject({ status: 'closed', version: 2, closes: 1 })
  })

  // A form with no action over a selection has no box and no bar: the
  // order form of the sales schema, which binds none, draws its grid as it
  // did before 0166 -- while the action order's grid, whose close-all the
  // clerk may run, is headed by its boxes' column. Pressed with nothing
  // chosen, the action is no dead end: it sends nothing and says what to do
  // first, which its button is described by (to be watched failing in CI
  // with the column drawn on every form).
  test('the boxes and the bar are drawn only on a form with an action over a selection, and an action with nothing chosen says what to do first', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.formId)
    const records = within(gridSection('Records'))
    expect(records.queryAllByRole('checkbox', { name: /^Choose / })).toEqual([])
    expect(records.queryByRole('group', { name: 'Chosen records' })).toBeNull()
    expect(records.getAllByRole('columnheader').map((header) => header.textContent?.trim())).not.toContain('Choose')

    await chooseForm(user, actionForm(engine))
    const headers = within(gridSection('Records'))
      .getAllByRole('columnheader')
      .map((header) => header.textContent?.trim())
    expect(headers[0]).toBe('Choose')
    const action = within(choiceBar()).getByRole('button', { name: CLOSE_ALL_LABEL })
    expect(action.getAttribute('aria-disabled')).toBe('true')
    expect(computeAccessibleDescription(action)).toBe(CHOOSE_FIRST)
    const from = plane.sent.length
    await user.click(action)
    await barSays(`${NONE_CHOSEN} ${CHOOSE_FIRST}`)
    expect(screen.queryByRole('region', { name: /^Close the chosen orders/ })).toBeNull()
    expect(closeAllsSent(plane, from)).toBe(0)
  })

  // A choice is of the page shown: Next rows clears it, and the bar says it
  // did and why; back on the first page, nothing is chosen (to be watched
  // failing in CI with a page told to the choice by where it starts
  // alone, a choice kept from one page to the next of another list).
  test('paging clears the choice and says so', async () => {
    const note = stamp('paged')
    const orders: string[] = []
    for (let n = 0; n <= LIST_PAGE_SIZE; n += 1) orders.push(await plane.db.insertActionOrder(engine.connection, note))
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, actionForm(engine))
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), note)
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`), ARRIVES)
    const firstPage = orders.filter((record) => within(gridSection('Records')).queryByRole('checkbox', { name: `Choose Order ${record}` }) !== null)
    await choose(user, firstPage.slice(0, 2))
    await barSays('2 chosen.')
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Next rows' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows ${String(LIST_PAGE_SIZE + 1)}–${String(LIST_PAGE_SIZE + 1)}.`), ARRIVES)
    await barSays(clearedText(2))
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Previous rows' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`), ARRIVES)
    expect(firstPage.slice(0, 2).map((record) => box(record).checked)).toEqual([false, false])
  })

  // While a run over the records chosen is out, a second press sends
  // nothing: Run it says it is running, and the bar's action asks for the
  // run out again, its region focused, never a second run -- as a save out
  // holds (in-flight.test.tsx); and once it is answered, both are closed,
  // once (to be watched failing in CI with the bar's action asking anew
  // while the run is out: two runs of close-all sent).
  test('a second press while a run is out sends nothing', async () => {
    const note = stamp('held')
    const orders = [await plane.db.insertActionOrder(engine.connection, note), await plane.db.insertActionOrder(engine.connection, note)]
    const holding = holdingWrites(plane.fetch)
    const user = await chosenPage(holding.fetch, engine, note, orders)
    await choose(user, orders)
    const confirming = await askCloseAll(user, 2, 'closed once')
    const from = plane.sent.length
    await user.click(within(confirming).getByRole('button', { name: 'Run it' }))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const out = screen.getByRole('region', { name: closingAll(2, true) })
    expect(within(out).getByRole('button', { name: 'Run it' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(within(out).getByRole('button', { name: 'Run it' }))
    await user.click(within(choiceBar()).getByRole('button', { name: CLOSE_ALL_LABEL }))
    await waitFor(() => expect(focusedName()).toBe(closingAll(2, true)))
    expect(closeAllsSent(plane, from)).toBe(1)
    holding.answer()
    await waitFor(() => expect(within(screen.getByRole('region', { name: closingAll(2) })).getByText(`${DONE} It ran over 2 records.`)).toBeTruthy(), ARRIVES)
    expect(closeAllsSent(plane, from)).toBe(1)
    for (const record of orders) expect(await plane.db.actionOrder(engine.connection, record)).toMatchObject({ status: 'closed', closes: 1 })
  })
})
