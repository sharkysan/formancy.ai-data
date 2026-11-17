import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { checkedText } from './running.js'
import { paragraphs } from './test-accessible.js'
import { askClose, closed, openActionOrder, region, runIt } from './test-acting.js'
import { answer, load, RENDERERS, said, save, shows, unsavedNotice } from './test-host.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * What the page does once an action over the open record has run (0162),
 * on both engines, against the real server and the actions schema every
 * fixture loads: the record read again, so its next Save names the version
 * the run moved; and a run whose answer was lost, checked by a read of the
 * record and run again only from the version it sent -- which, once the
 * first committed after all, is stale, and closes nothing twice. What a
 * run stored is asked of the database's owner.
 *
 * Found by role and accessible name. The one read the accessibility tree
 * cannot answer is the database's.
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

/** What the server answers a run from a version that moved, verbatim (0161). */
const STALE = 'The record changed since it was read. Reload it and review the changes before running this again. Nothing was done.'

describe.each(ENGINES)('an action over the open record on $engine', (engine) => {
  const connection = `${engine.connection}-actions`

  // Close ran and moved the order's version, and the routine changed its
  // status and note: the panes hold what is stored once it has, at the
  // version the run moved, so the next Save of the order is stored. A page
  // that kept its read from before the run would send that version, and
  // the person's own run would make their Save stale (watched failing on
  // postgres:17-alpine and mcr.microsoft.com/mssql/server:2022-latest with
  // the reread taken out: the Save was "Not saved", stale).
  test.each(RENDERERS)('in %s, the order is read again once close ran, and its next Save is stored', async (renderer) => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const user = await openActionOrder(plane.fetch, engine, record, renderer)
    await askClose(user, record, renderer, 'closed from the page')
    await runIt(user, record)
    await closed(record)
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

  // A run lost before it reached the database checks as not run: the
  // order is still at the version it sent, and until it is checked,
  // opening another order asks first, naming the run. If it then commits after all,
  // as a transaction orphaned by a cut can (0031), Run it again sends that
  // same version and is stale -- never a version read since, which would
  // close the order a second time (watched failing on postgres:17-alpine
  // and mcr.microsoft.com/mssql/server:2022-latest with Run it again
  // sending the version the order holds then: no "Not run", the second run
  // done; and with the run not the guard's: no notice asked before
  // another order opened).
  test('a run whose answer was lost checks as not run, and once it commits, Run it again is stale and closes nothing twice', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const user = await openActionOrder(plane.fetch, engine, record)
    plane.runs.lose.set(connection, 'late')
    await askClose(user, record, 'React', 'closed late')
    await runIt(user, record)
    const unknown = await region('It may have run')
    await load(user, await plane.db.insertActionOrder(engine.connection))
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), { timeout: 15_000 })
    expect(within(unsavedNotice() as HTMLElement).getByRole('list').textContent).toBe(
      `Close the order: Order ${record}: an action that may have run, not yet checked.`,
    )
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await user.click(within(unknown).getByRole('button', { name: 'Check whether it ran' }))
    await within(unknown).findByText(checkedText({ kind: 'unchanged' }), {}, { timeout: 15_000 })
    const late = plane.runs.late.shift()
    if (late === undefined) throw new Error('no run was held')
    expect((await late()).ok).toBe(true)
    await user.click(within(unknown).getByRole('button', { name: 'Run it again' }))
    const refused = await region('Not run')
    expect(paragraphs(refused)).toEqual([STALE])
    expect(within(refused).getByRole('button', { name: 'Load the saved record' })).toBeTruthy()
    const stored = await plane.db.actionOrder(engine.connection, record)
    expect({ version: stored.version, closes: stored.closes }).toEqual({ version: 2, closes: 1 })
  })

  // A run that committed and whose answer was lost after checks as changed,
  // and offers the saved record, never Run it again: the order moved on,
  // by this run or by someone else (watched failing on postgres:17-alpine
  // and mcr.microsoft.com/mssql/server:2022-latest with every check read
  // as unchanged: Run it again was offered over a run that had committed).
  test('a run lost after it committed checks as changed, and loads the saved record', async () => {
    const record = await plane.db.insertActionOrder(engine.connection)
    const user = await openActionOrder(plane.fetch, engine, record)
    plane.runs.lose.set(connection, 'after')
    await askClose(user, record, 'React', 'closed unheard')
    await runIt(user, record)
    const unknown = await region('It may have run')
    await user.click(within(unknown).getByRole('button', { name: 'Check whether it ran' }))
    await within(unknown).findByText(checkedText({ kind: 'changed' }), {}, { timeout: 15_000 })
    expect(within(unknown).queryByRole('button', { name: 'Run it again' })).toBeNull()
    await user.click(within(unknown).getByRole('button', { name: 'Load the saved record' }))
    await shows('React', 'Status', 'closed')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'It may have run' })).toBeNull())
    expect((await plane.db.actionOrder(engine.connection, record)).closes).toBe(1)
  })
})
