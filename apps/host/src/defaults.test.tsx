import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { audit, unnamed } from './test-accessible.js'
import { answer, chooseCustomer, control, load, loaded, newRecord, openForm, RENDERERS, said, save, shows } from './test-host.js'
import { EDGES, ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A new record starts with its column's constant default (0149), through
 * the page, against the real server on both engines: sales.order.status
 * defaults to 'draft' in both fixtures, each spelled as its catalog spells
 * it, and the generator gives the field that answer to start with. New
 * record draws it in React and Angular, and a save that leaves it as it
 * is sends it and stores it. A record read and a copy start as handed in
 * (formancy.ai 0197), and a person who may not read the status sees
 * neither its default nor a record's. Found by role and accessible name.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ unread: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

const ARRIVES = { timeout: 15_000 }

/** The answers of every create the page sent for `formId` since the `from`-th request. */
function creates(formId: string, from: number): Array<Record<string, unknown>> {
  return plane.sent
    .slice(from)
    .filter((request) => request.method === 'POST' && request.path === `/v1/forms/${formId}/records/create`)
    .map((request) => (JSON.parse(request.body ?? '{}') as { answers: Record<string, unknown> }).answers)
}

/** An order of tenant 1's placed beside the page, as the plain order form's clerk places one. */
async function placedOrder(formId: string): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const placed = await plane.clerk.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '5' })
  if (!placed.ok || placed.value.record === null) throw new Error('the placed order was not created')
  return placed.value.record
}

describe.each(ENGINES)("a new record on $engine starts with its column's default", (engine) => {
  // New record draws Status at draft in both renderers, the state's box a
  // person reads before Save; saved without touching it, from either
  // renderer, the create carries draft and the record holds it. Watched
  // failing in CI with the session opening a new record over no answers
  // (B4 of the breaks commit): both renderers drew an empty Status.
  test('draws Status at draft in both renderers, and a save that leaves it sends and stores it', async () => {
    const user = await openForm(plane, engine.formId)
    for (const renderer of RENDERERS) {
      if (renderer !== RENDERERS[0]) await newRecord(user)
      for (const drawn of RENDERERS) await shows(drawn, 'Status', 'draft')
      expect(await audit()).toEqual([])
      expect(unnamed()).toEqual([])
      const from = plane.sent.length
      await chooseCustomer(user, renderer, 'Muster', 'Muster AG')
      await answer(user, renderer, 'Order date', EDGES.orderDate)
      await answer(user, renderer, 'Amount', '3')
      await save(user, renderer)
      const record = (await said(renderer, /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
      expect({ renderer, sent: creates(engine.formId, from) }).toEqual({ renderer, sent: [expect.objectContaining({ status: 'draft' })] })
      const stored = await plane.clerk.read(engine.formId, record)
      expect({ renderer, status: stored.ok && stored.value.answers['status'] }).toEqual({ renderer, status: 'draft' })
    }
  })

  // A record read starts as stored, never at the default, and so does a
  // copy of it, Duplicate record's; New record after it starts at draft
  // again. Watched failing in CI with the default written over a record's
  // answers (B5): the placed order was drawn as draft.
  test('draws a record read, and a copy of it, as stored, and New record at draft again', async () => {
    const record = await placedOrder(engine.formId)
    const user = await openForm(plane, engine.formId)
    await load(user, record)
    await loaded(record)
    for (const renderer of RENDERERS) await shows(renderer, 'Status', 'placed')
    await user.click(screen.getByRole('button', { name: 'Duplicate record' }))
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES)
    for (const renderer of RENDERERS) await shows(renderer, 'Status', 'placed')
    await newRecord(user)
    for (const renderer of RENDERERS) await shows(renderer, 'Status', 'draft')
  })

  // The status this clerk neither reads nor writes is drawn disabled and
  // empty on a new record -- its default would be a value of a field they
  // may not see -- and the database fills it when the create leaves it
  // out; on a record read it is empty too, the record's answers holding
  // none. Watched failing in CI with the copy for a create keeping every
  // default (B6): the new order's Status was drawn at draft; and with the
  // default written over a record's answers (B5): the read one's too.
  test('draws neither the default nor a record’s status for a person who may not read it', async () => {
    const record = await placedOrder(engine.formId)
    const user = await openForm(plane, engine.unread)
    await waitFor(() => {
      for (const renderer of RENDERERS) {
        const status = control(renderer, 'Status')
        expect({ renderer, value: status.value, disabled: status.disabled }).toEqual({ renderer, value: '', disabled: true })
      }
    }, ARRIVES)
    await load(user, record)
    await loaded(record)
    for (const renderer of RENDERERS) await shows(renderer, 'Amount', '5.0000')
    for (const renderer of RENDERERS) expect({ renderer, status: control(renderer, 'Status').value }).toEqual({ renderer, status: '' })
  })
})
