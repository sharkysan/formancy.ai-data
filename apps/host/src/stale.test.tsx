import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { focusedName, paragraphs } from './test-accessible.js'
import { answer, control, load, notice, openForm, pane, said, save, shows } from './test-host.js'
import type { RendererName } from './test-host.js'
import { EDGES, ENGINES, startPlane } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'
import { DRAFT_KEPT } from './pane.js'

/*
 * Plan section 21, step 7, through the page: the same record loaded in both
 * panes, saved in one, then saved in the other. The second save is stale --
 * an application version column on PostgreSQL, rowversion on SQL Server, and
 * the database says which (0029, D7). What the page owes the person then:
 * their draft kept, the server's sentence, the keyboard on it, and one
 * explicit way to the saved record that says it discards the draft.
 *
 * Both orders, so each renderer is once the pane that loses.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const STALE = 'The record changed since it was read. Reload it, review the changes, and save again.'

/** A fresh order of tenant 1's, made beside the page: the scenario is what happens to it, not how it was made. */
async function freshOrder({ formId }: Engine): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, name, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1' })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

const ORDERS: ReadonlyArray<readonly [RendererName, RendererName]> = [
  ['React', 'Angular'],
  ['Angular', 'React'],
]

describe.each(ENGINES)('a stale save on $engine', (engine) => {
  test.each(ORDERS)('%s saves first; %s keeps its draft and says so', async (first, second) => {
    const record = await freshOrder(engine)
    const user = await openForm(plane, engine.formId)
    await load(user, record)
    for (const renderer of [first, second]) await shows(renderer, 'Amount', '1.0000')

    await answer(user, first, 'Amount', '3')
    await save(user, first)
    await said(first, /^Saved\.$/)

    await answer(user, second, 'Amount', '4')
    await save(user, second)

    // The server's sentence, verbatim, and the one thing the page adds: that
    // nothing typed was lost. In a region the keyboard is taken to -- not an
    // alert, which a screen reader would announce on top of the focus move.
    await waitFor(() => expect(notice(second)).not.toBeNull())
    const refused = notice(second) as HTMLElement
    expect(paragraphs(refused)).toEqual([STALE, DRAFT_KEPT])
    await waitFor(() => expect(focusedName()).toBe(`${second} Not saved`))
    expect(within(pane(second)).queryByRole('alert')).toBeNull()

    // The draft is still the draft: an engine rebuilt on 409 would show the
    // first pane's 3.0000 here, and the person's 4 would be gone. And the
    // database holds the first save -- nothing merged, nothing retried.
    expect(control(second, 'Amount').value).toBe('4')
    const stored = await plane.clerk.read(engine.formId, record)
    expect(stored.ok && stored.value.answers['amount']).toBe('3.0000')
    expect(notice(first)).toBeNull()

    // The one way to the saved record, explicit: the draft is replaced, the
    // notice goes, the pane says what happened, and the keyboard is on the
    // pane's heading rather than lost with the button it pressed.
    const before = new Set(within(pane(second)).queryAllByRole('status'))
    await user.click(within(refused).getByRole('button', { name: 'Load the saved record' }))
    await shows(second, 'Amount', '3.0000')
    const discarded = await said(second, /^Loaded the saved record\. Your changes were discarded\.$/)
    // And it is heard: the line that says it was on the page before it spoke.
    // A live region inserted already holding its words is not announced, and
    // the focus on the heading would say only "Angular" or "React". Which
    // element it is cannot be asked of the accessibility tree, which has no
    // notion of an element's identity; the status is found by role, and then
    // compared as an object with the ones found by role before the click.
    const line = within(pane(second)).getAllByRole('status').find((status) => status.textContent === discarded)
    expect(line !== undefined && before.has(line)).toBe(true)
    expect(notice(second)).toBeNull()
    await waitFor(() => expect(focusedName()).toBe(second))

    // And from the version just read, a save goes through.
    await answer(user, second, 'Amount', '5')
    await save(user, second)
    await said(second, /^Saved\.$/)
  })
})
