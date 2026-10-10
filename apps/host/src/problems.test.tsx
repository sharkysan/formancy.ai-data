import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { answer, chooseCustomer, control, notice, openForm, paper, said, save } from './test-host.js'
import type { RendererName } from './test-host.js'
import { EDGES, ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A field problem the server finds and the page shows on the field (0029,
 * D7): a customer that was offered and picked, then stopped being one the
 * clerk may reference before the save. The server's membership check refuses
 * it with 422 and names the field, on both engines -- the one field-level
 * refusal both reach deterministically.
 *
 * What a person must then see is the server's sentence where the renderers
 * put a field's problems: beside Customer, as its description, and in the
 * error summary, which takes the focus. Sentences, not codes: the renderers
 * print an entry verbatim. The summary names it by the field's own label,
 * which both renderers read from the document since 0.4.0; at 0.3.0 the page
 * passed its labels itself. A summary handed the keys as labels fails here,
 * watched in each renderer on both engines.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const NOT_AN_OPTION = 'This is not one of the options this form offers.'

/** A customer number of its own per case, so cases on one database never meet. */
const NUMBERS: Readonly<Record<string, number>> = { 'pg React': 8101, 'pg Angular': 8102, 'ms React': 8201, 'ms Angular': 8202 }

describe.each(ENGINES)('a refused selection on $engine', ({ connection, formId }) => {
  test.each(['React', 'Angular'] as RendererName[])('is said on Customer in %s, and the other answers are kept', async (renderer) => {
    const no = NUMBERS[`${connection} ${renderer}`] ?? 0
    const name = `Frisch Kunde ${String(no)}`
    await plane.db.insertCustomer(connection, no, name)
    const user = await openForm(plane, formId)

    await chooseCustomer(user, renderer, 'Frisch', name)
    await answer(user, renderer, 'Order date', EDGES.orderDate)
    await answer(user, renderer, 'Status', 'placed')
    await answer(user, renderer, 'Amount', '42.5')
    // Gone between the choice and the save: deleted by somebody else.
    await plane.db.deleteCustomer(connection, no)
    await save(user, renderer)

    // On the field, as its description: what a screen reader says with it.
    const customer = within(paper(renderer)).getByRole('combobox', { name: 'Customer' })
    await waitFor(() => expect(computeAccessibleDescription(customer)).toBe(NOT_AN_OPTION))
    expect(customer.getAttribute('aria-invalid')).toBe('true')

    // In the error summary, under the field's label, with the focus: the
    // summary focuses itself when errors appear, and the page put nothing
    // else in its way -- no notice, which would take the focus from it.
    const summary = await waitFor(() => {
      const focused = document.activeElement as HTMLElement
      within(focused).getByRole('heading', { name: 'There is 1 problem to fix' })
      return focused
    })
    within(summary).getByRole('link', { name: `Customer: ${NOT_AN_OPTION}` })
    expect(notice(renderer)).toBeNull()
    await said(renderer, /^Not saved\. A selection is not one of the options\.$/)

    // Everything else the person typed is still there.
    expect(control(renderer, 'Amount').value).toBe('42.5')
    expect(control(renderer, 'Status').value).toBe('placed')
    expect(control(renderer, 'Order date').value).toBe(EDGES.orderDate)
    expect(customer).toHaveProperty('value', name)
  })
})
