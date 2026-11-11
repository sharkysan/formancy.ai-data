import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { audit, unnamed } from './test-accessible.js'
import { control, load, loaded, openForm, paper, RENDERERS, said, save } from './test-host.js'
import type { RendererName } from './test-host.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A state field drawn as the moves its person may make (0127), on both
 * engines, against the real server: the order form whose status the clerk
 * moves from draft to placed to shipped (test-plane.ts's ORDER_MOVES).
 * Status is a choice of where the order is and where the clerk may move
 * it, in both renderers, and is drawn disabled where it may go nowhere; a
 * move chosen there is saved. Found by role and accessible name: Status is
 * a combobox whose options are its states.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ moves: true })
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

/** Status in a renderer's paper. */
const status = (renderer: RendererName): HTMLSelectElement => within(paper(renderer)).getByRole<HTMLSelectElement>('combobox', { name: /^Status/ })

/** The states Status offers in a renderer's paper: every option but the empty one a choice starts with. */
const states = (renderer: RendererName): string[] =>
  within(status(renderer))
    .getAllByRole<HTMLOptionElement>('option')
    .map((option) => option.value)
    .filter((value) => value !== '')

describe.each(ENGINES)('a state field drawn as its moves on $engine', (engine) => {
  // A new order may only start as a draft, and starts there: draft is the
  // column's default, a state a create may start it in, so the choice
  // keeps it (0149). A placed one may stay placed or be shipped, and is
  // shipped by choosing it and pressing Save; a shipped one moves nowhere,
  // so Status is disabled. Every state is held to axe and a name on every
  // control. Watched failing with the session drawing the form as
  // published: Status was a text box; and in CI with the session opening a
  // new record over no answers (B4 of 0149's breaks commit): the choice
  // started empty.
  test('offers the moves from where the order is, saves one, and disables a state with none', async () => {
    const placed = await plane.clerk.create(engine.formId, {
      customer: await customerToken(engine.formId),
      order_date: '2026-11-02',
      status: 'placed',
      amount: '5',
    })
    if (!placed.ok || placed.value.record === null) throw new Error('the placed order was not created')
    const record = placed.value.record

    const user = await openForm(plane, engine.moves)
    for (const renderer of RENDERERS)
      expect({ renderer, states: states(renderer), value: status(renderer).value }).toEqual({ renderer, states: ['draft'], value: 'draft' })
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await load(user, record)
    await loaded(record)
    await waitFor(() => {
      for (const renderer of RENDERERS) expect(states(renderer), renderer).toEqual(['placed', 'shipped'])
    }, ARRIVES)
    expect(status('React').value).toBe('placed')
    await user.selectOptions(status('React'), 'shipped')
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    const read = await plane.clerk.read(engine.formId, record)
    expect(read.ok && read.value.answers['status']).toBe('shipped')

    await load(user, record)
    await loaded(record)
    // Nowhere to go, the field is the published one, disabled: found by its label, as a text box has no combobox role.
    await waitFor(() => {
      for (const renderer of RENDERERS)
        expect({ renderer, disabled: control(renderer, 'Status').disabled, value: control(renderer, 'Status').value }).toEqual({
          renderer,
          disabled: true,
          value: 'shipped',
        })
    }, ARRIVES)
    expect(await audit()).toEqual([])
  })
})

/** A customer of tenant 1's, as the plain order form's lookup offers it to the clerk. */
async function customerToken(formId: string): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  return found.value.rows[0].token
}
