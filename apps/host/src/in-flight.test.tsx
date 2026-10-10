import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { answer, chooseCustomer, control, load, mount, rendered, RENDERERS, said, save, shows, signIn, statuses } from './test-host.js'
import { EDGES, ENGINES, holdingWrites, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Holding, Plane } from './test-plane.js'

/*
 * A save the server has not answered yet, through the page. Neither renderer
 * holds the form during a submit, at 0.3.0 or at 0.4.0, so in that moment a
 * person goes on typing, presses Save again, or opens another record -- and on
 * `app.inject` the moment is too short to reach, so the writes here are held
 * after the server has made them (`holdingWrites`) and answered when the test
 * says. What the page owes the person then: their newer typing kept and said to
 * be unsaved, a second press that says it sent nothing, every answer heard even
 * when its words repeat, and the answer for a form they have left still said
 * rather than dropped (0029, D7).
 *
 * Both renderers, on both engines: the decisions are the session's, and each
 * pane is where one of them could be lost on the way to the person.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

/** The page, signed in as tenant 1's clerk, with every create and update held until `holding.answer()`. */
async function openHeld(formId: string): Promise<{ user: ReturnType<typeof mount>; holding: Holding }> {
  const holding = holdingWrites(plane.fetch)
  const user = mount(holding.fetch)
  await signIn(user, TOKENS.clerk, formId)
  await rendered()
  return { user, holding }
}

/** Wait until `count` writes are made and held. */
async function writesHeld(holding: Holding, count: number): Promise<void> {
  await waitFor(() => expect(holding.held).toHaveLength(count), { timeout: 15_000 })
}

/** A fresh order of tenant 1's, made beside the page, as the stale suite makes one. */
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

describe.each(ENGINES)('a save in flight on $engine', (engine) => {
  // Typed while the save was out: the answer the server stored for Notes is
  // older than what the field holds, and a pane that set it back would erase
  // the person's words and then say "Saved." over the loss. The second press
  // carried those words and sent nothing; it says so instead of being
  // handed the first press's "Saved.". And every answer is heard: the line
  // reads "Saving…" while a save is out, so "Saved." twice in a row is two
  // changes to the live region, not one change and a silence.
  test.each(RENDERERS)('in %s, typing during a save is kept and said to be unsaved, and every save is heard', async (renderer) => {
    const record = await freshOrder(engine)
    const { user, holding } = await openHeld(engine.formId)
    await load(user, record)
    await shows(renderer, 'Amount', '1.0000')

    await answer(user, renderer, 'Amount', '3')
    await save(user, renderer)
    await writesHeld(holding, 1)
    await said(renderer, /^Saving…$/)
    await answer(user, renderer, 'Notes', 'typed while saving')
    await save(user, renderer)
    await said(renderer, /^The previous save has not been answered yet\. This press sent nothing: press Save again once it has\.$/)
    expect(holding.held).toHaveLength(1)

    holding.answer()
    await said(renderer, /^Saved\. Changes made while it was saving are still in the form, not saved\.$/)
    await shows(renderer, 'Amount', '3.0000')
    expect(control(renderer, 'Notes').value).toBe('typed while saving')

    // The words the next save sends are the newer ones, and while it is out
    // the line no longer says what it said before.
    await save(user, renderer)
    await writesHeld(holding, 1)
    await said(renderer, /^Saving…$/)
    expect(statuses(renderer)).not.toContain('Saved.')
    holding.answer()
    await said(renderer, /^Saved\.$/)
    await save(user, renderer)
    await writesHeld(holding, 1)
    expect(statuses(renderer)).not.toContain('Saved.')
    holding.answer()
    await said(renderer, /^Saved\.$/)
    const stored = await plane.clerk.read(engine.formId, record)
    expect(stored.ok && stored.value.answers['notes']).toBe('typed while saving')
  })

  // New while a create is out: the record is written, and the person needs
  // its token -- without it they may well enter the order again. The answer
  // is said on the pane's line as the replaced form's, and the new, empty
  // form stays empty and stays a new record.
  test.each(RENDERERS)('in %s, a create answered after New is said, and the new form stays empty', async (renderer) => {
    const { user, holding } = await openHeld(engine.formId)
    await chooseCustomer(user, renderer, 'Muster', 'Muster AG')
    await answer(user, renderer, 'Order date', EDGES.orderDate)
    await answer(user, renderer, 'Amount', '6')
    await save(user, renderer)
    await writesHeld(holding, 1)

    await user.click(within(screen.getByRole('region', { name: 'Record' })).getByRole('button', { name: 'New record' }))
    await shows(renderer, 'Amount', '')
    holding.answer()
    const line = await said(renderer, /^The save sent before this form was replaced: Created record k1:\S+\.$/)
    const token = /(k1:\S+)\.$/.exec(line)?.[1] ?? ''
    const stored = await plane.clerk.read(engine.formId, token)
    expect(stored.ok && stored.value.answers['amount']).toBe('6.0000')
    await shows(renderer, 'Amount', '')
    await shows(renderer, 'Customer', '')
  })
})
