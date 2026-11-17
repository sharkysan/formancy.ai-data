import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { WORK } from './leave.js'
import { checkedText, DONE, READ_AGAIN, READING_AGAIN, RUNS_ON } from './running.js'
import { audit, focusedName, paragraphs } from './test-accessible.js'
import { askClose, closed, closeRegion, closing, dialogPaper, openActionOrder, region, runIt, runsSent } from './test-acting.js'
import { CLOSE_ALL_LABEL, CLOSE_WORDS, STAMP_LABEL } from './test-actions.js'
import { answer, load, notice, RENDERERS, said, save, shows, unsavedNotice } from './test-host.js'
import { holdingRequests, holdingWrites } from './test-network.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * What the page does once an action over the open record has run (0162),
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
  // over a selection belongs above the grid, which offers none yet (0165).
  // Drawn in the header, it would run over the open record alone, a
  // selection of one nobody chose, under words that say every order chosen.
  test('the open record’s header offers its actions over the open record, and none over a selection', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    await openActionOrder(plane.fetch, engine, record)
    expect(screen.getByRole('button', { name: CLOSE_WORDS.label })).toBeTruthy()
    expect(screen.getByRole('button', { name: STAMP_LABEL })).toBeTruthy()
    expect(screen.queryByRole('button', { name: CLOSE_ALL_LABEL })).toBeNull()
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
