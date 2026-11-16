import { EDGE_VALUES } from '@formancy/data-fixtures'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import type { SaveOutcome } from './saves.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'
import type { UnknownWrite } from './writes.js'

/*
 * An order saved with its lines through the client (0155), on both
 * engines, across real HTTP into the real server and its drivers: the
 * order and its lines created in one save, changed in another, a resend
 * stale, and what the menu, the forms and the per-row writes say of a
 * record whose rows are saved with it. What one transaction stores, and
 * what a version that moved refuses, are database answers, so they are
 * asked of the databases.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ saves: true })
})

afterAll(async () => {
  await plane?.close()
})

function expectOk<T>(outcome: { ok: true; value: T } | Refusal | UnknownWrite): T {
  if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome)}`)
  return outcome.value
}

describe.each(ENGINES)('a record saved with its rows on $engine', ({ connection }) => {
  const orders = `${connection}-saved-order`
  const lines = `${connection}-saved-line`

  /** The order's answers, a customer the clerk's tenant holds, marked by `notes`. */
  async function orderAnswers(notes: string): Promise<Record<string, unknown>> {
    const client = plane.client()
    const definition = expectOk(await client.form(orders))
    const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource as string
    const customer = expectOk(await client.query(orders, source, { operation: 'create', search: 'Muster' })).rows[0]?.token
    return { customer, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '1', notes }
  }
  const line = (ref: string, no: number) => ({ create: { ref, answers: { line_no: no, quantity: no, unit_price: '1.50' } } })
  const linesOf = async (record: string) => expectOk(await plane.client().list(lines, { parent: { field: 'order', record } })).rows

  // A new order and its lines are stored by one save and answered as
  // stored, each line by the ref the page sent; a second save over the
  // order changes a line and adds one, with nothing of the order's own
  // changed, and moves the order's version all the same -- so the same save
  // sent again, at the version it was read at, is stale and stores nothing
  // twice; and reconciling a save lost over that version reads the order
  // and says it changed. Watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with the client's save
  // posted to the update route: every save was refused 400.
  test('creates an order with its lines, changes them in one save, and a resend is stale', async () => {
    const client = plane.client()
    const created = expectOk(
      await client.save(orders, {
        record: { create: { answers: await orderAnswers(`saved ${connection}`) } },
        rows: [{ form: lines, field: 'order', changes: [line('a', 1), line('b', 2)] }],
      }),
    )
    const record = created.record.record as string
    expect(created.rows).toEqual([
      {
        form: lines,
        field: 'order',
        changes: [
          { ref: 'a', row: expect.objectContaining({ answers: expect.objectContaining({ order: record, line_no: 1, quantity: 1 }) }) },
          { ref: 'b', row: expect.objectContaining({ answers: expect.objectContaining({ order: record, line_no: 2, quantity: 2 }) }) },
        ],
      },
    ])
    const [first] = await linesOf(record)
    expect((await linesOf(record)).map((row) => row.answers['line_no'])).toEqual([1, 2])

    const version = created.record.version as string
    const change = {
      record: { update: { record, version, answers: {} } },
      rows: [
        {
          form: lines,
          field: 'order',
          changes: [{ update: { record: first?.record as string, version: first?.version as string, answers: { quantity: 9 } } }, line('c', 3)],
        },
      ],
    }
    const changed = expectOk(await client.save(orders, change))
    expect(changed.record.version).not.toBe(version)
    expect((await linesOf(record)).map((row) => [row.answers['line_no'], row.answers['quantity']])).toEqual([
      [1, 9],
      [2, 2],
      [3, 3],
    ])
    const again: SaveOutcome = await client.save(orders, change)
    expect(again).toMatchObject({ ok: false, status: 409, code: 'stale', at: { record: true } })
    expect(await linesOf(record)).toHaveLength(3)
    const lost: UnknownWrite = { ok: false, status: 0, code: 'unknown-outcome', message: 'lost', operation: 'save', record, version, origin: 'transport' }
    expect(await client.reconcile(orders, lost)).toMatchObject({ ok: true, state: 'changed', current: { record, version: changed.record.version } })
  })

  // Past its bound the save is refused before anything is written, with the
  // count, and nothing is stored; the order is never created alone, and a
  // line is never created alone either. Watched failing on the same images
  // with the create route not asking which children require rows: the
  // order was created with no line.
  test('refuses a save past its bound, a plain create of the order and a line created alone', async () => {
    const client = plane.client()
    const answers = await orderAnswers(`too many ${connection}`)
    const many = await client.save(orders, {
      record: { create: { answers } },
      rows: [{ form: lines, field: 'order', changes: [line('a', 1), line('b', 2), line('c', 3), line('d', 4)] }],
    })
    expect(many).toMatchObject({ ok: false, status: 422, code: 'too-many-rows', rows: { form: lines, field: 'order', min: 1, max: 3, held: 4 } })
    expect(await client.create(orders, answers)).toMatchObject({ ok: false, status: 403, code: 'operation-unavailable' })
    expect(await client.create(lines, { line_no: 1, quantity: 1, unit_price: '1.50' })).toMatchObject({ ok: false, status: 403, code: 'operation-unavailable' })
  })

  // The menu names the lines under the order with what this clerk may do
  // with them in a save, and the line form says its rows are saved with
  // their order and offers no create alone. Watched failing on the same
  // images with the menu's child left without its `together`: the line
  // child read as any other.
  test('the menu and the line form say the lines are saved with their order', async () => {
    const client = plane.client()
    const entry = expectOk(await client.forms()).forms.find((form) => form.id === orders)
    expect(entry?.operations).toEqual(['read', 'create', 'update'])
    expect(entry?.children).toContainEqual({
      form: lines,
      field: 'order',
      one: false,
      when: null,
      together: { min: 1, max: 3, created: { create: true }, saved: { create: true, update: true, delete: false } },
    })
    const definition = expectOk(await client.form(lines))
    expect([definition.operations, definition.together]).toEqual([['read', 'update'], { field: 'order', min: 1, max: 3 }])
  })
})
