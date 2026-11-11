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
 * neither its default nor a record's. A starting value an administrator
 * chose over the column's (0150) is what New record starts with instead.
 * Found by role and accessible name.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ unread: true, starting: true })
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
  // renderer, the create carries draft and the record holds it. To be
  // watched failing in CI with the copy for a create dropping the defaults
  // of the fields this person gives: both renderers should draw an empty
  // Status.
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
  // again. To be watched failing in CI with the defaults written over a
  // record's answers: the placed order should be drawn as draft.
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

  // The starting values chosen over the base (0150), published as the
  // studio publishes them and served by the form route: New record draws
  // the group at Online, whose column has no default, and the status,
  // whose default draft was taken away, empty, in both renderers. Saved as
  // it starts, the create sends Online and leaves the status out, and the
  // database fills draft. To be watched failing in CI with
  // applyPresentation leaving a value unset and a removal undone: Group
  // should be drawn empty and Status at draft.
  test('starts New record at the starting values chosen over the base, the one taken away empty, in both renderers', async () => {
    const user = await openForm(plane, engine.starting)
    // Both fields in one comparison, so a value left unset and a removal left undone are each seen.
    await waitFor(() => {
      for (const renderer of RENDERERS) {
        expect({ renderer, group: control(renderer, 'Group').value, status: control(renderer, 'Status').value }).toEqual({
          renderer,
          group: 'Online',
          status: '',
        })
      }
    }, ARRIVES)
    expect(await audit()).toEqual([])
    const renderer = RENDERERS[0]
    const from = plane.sent.length
    await chooseCustomer(user, renderer, 'Muster', 'Muster AG')
    await answer(user, renderer, 'Order date', EDGES.orderDate)
    await answer(user, renderer, 'Amount', '3')
    await save(user, renderer)
    const record = (await said(renderer, /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
    const [sent] = creates(engine.starting, from)
    expect({ group: sent?.['group'], status: sent === undefined ? 'nothing sent' : Object.hasOwn(sent, 'status') }).toEqual({ group: 'Online', status: false })
    const stored = await plane.clerk.read(engine.starting, record)
    expect(stored.ok ? { group: stored.value.answers['group'], status: stored.value.answers['status'] } : stored.message).toEqual({
      group: 'Online',
      status: 'draft',
    })
  })

  // The status this clerk neither reads nor writes is drawn disabled and
  // empty on a new record: the server serves no default for a field their
  // create does not take (data-core's startingDefaults), and the database
  // fills it when the create leaves it out. On a record read it is empty
  // too, the record's answers holding none. To be watched failing in CI
  // with the form route serving every default to whoever may create: the
  // new order's Status should be drawn at draft. The route's decision is
  // runtime-defaults.test.ts's too, over fake ports, and the record read
  // session-work.test.ts's, without a server.
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
