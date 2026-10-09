import { encodeKeyToken } from '@formancy/data-core'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { answer, chooseCustomer, control, load, openForm, said, save, shows } from './test-host.js'
import type { RendererName } from './test-host.js'
import { SECOND_CUSTOMER } from './test-values.js'
import { EDGES, ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * Plan section 21, steps 4 and 5, through the page: a host's person creates
 * an order in one renderer, finding its customer through the typeahead, loads
 * it into both, changes its customer and amount in the other, and saves. Every
 * answer is the real server's, from the database, on both engines (0029).
 *
 * Each scenario runs twice, with the renderers swapped, so neither is only
 * ever the one that creates or the one that edits.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

/** The token the server gives a customer's key, made the one way a token is made. */
function token(key: string[]): string {
  const encoded = encodeKeyToken(key)
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

const ORDERS: ReadonlyArray<readonly [RendererName, RendererName]> = [
  ['React', 'Angular'],
  ['Angular', 'React'],
]

describe.each(ENGINES)('the journey on $engine', ({ formId }) => {
  test.each(ORDERS)('created in %s, loaded into both, changed and saved in %s', async (creator, editor) => {
    const user = await openForm(plane, formId)

    // Step 4: a new order, its customer found by typing part of a name -- a
    // search the server answers under tenant 1's filter -- and the largest
    // amount numeric(18,4) holds, which a renderer that went through a number
    // would round.
    await chooseCustomer(user, creator, 'Muster', 'Muster AG')
    await answer(user, creator, 'Order date', EDGES.orderDate)
    await answer(user, creator, 'Status', 'placed')
    await answer(user, creator, 'Amount', EDGES.largestAmount)
    await save(user, creator)
    const created = await said(creator, /^Created record k1:\S+\.$/)
    const record = created.slice('Created record '.length, -1)

    // Loaded into both: every answer as stored, and the customer shown by its
    // label, which only the resolve route can supply -- the record holds a
    // token, and a renderer that showed it would show the token.
    await load(user, record)
    for (const renderer of [creator, editor]) {
      await shows(renderer, 'Customer', 'Muster AG')
      await shows(renderer, 'Amount', EDGES.largestAmount)
      await shows(renderer, 'Status', 'placed')
      await shows(renderer, 'Order date', EDGES.orderDate)
    }

    // Step 5: another of the tenant's customers, and an amount the database
    // stores in its own spelling. The field shows the stored spelling after
    // the save, and the database holds exactly that -- read through a client
    // beside the page, not through the page's own memory of it.
    await chooseCustomer(user, editor, 'Zweite', SECOND_CUSTOMER.name)
    await answer(user, editor, 'Amount', '12.5')
    await save(user, editor)
    await said(editor, /^Saved\.$/)
    await shows(editor, 'Amount', '12.5000')
    await shows(editor, 'Customer', SECOND_CUSTOMER.name)

    const stored = await plane.clerk.read(formId, record)
    if (!stored.ok) throw new Error(stored.message)
    expect(stored.value.answers).toMatchObject({ amount: '12.5000', order_date: EDGES.orderDate, status: 'placed' })
    expect(stored.value.answers['customer']).toBe(token(['1', String(SECOND_CUSTOMER.no)]))
    // The pane that saved still holds the record it saved, the same engine:
    // the date the person did not touch is still there.
    await waitFor(() => expect(control(editor, 'Order date').value).toBe(EDGES.orderDate))
  })
})
