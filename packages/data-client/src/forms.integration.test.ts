import { EDGE_VALUES } from '@formancy/data-fixtures'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The menu through the client (0045), across real HTTP into the real
 * server, over forms proposed from what discovery reports on both engines:
 * whether an order's lines are its children is decided from those
 * snapshots' own types, and a child the menu names is one a list narrowed
 * by the parent's token serves, which each engine's database answers.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ lines: true })
})

afterAll(async () => {
  await plane?.close()
})

beforeEach(() => {
  plane.sent.length = 0
})

function expectOk<T>(outcome: { ok: true; value: T } | Refusal): T {
  if (!outcome.ok) throw new Error(`expected success, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
  return outcome.value
}

describe('the menu', () => {
  // A clerk is told of both engines' order and line forms, each line form
  // a child of its own engine's order form through `order`, and never of
  // the other's: the two connections hold tables of the same names and
  // types, and a token of one names no row of the other. The menu is a GET
  // with no body, the token in its header. Somebody the policies grant
  // nothing -- the administrator, here -- is told of nothing. Watched
  // failing with the connection left uncompared: pg-order named
  // ms-order-line as a child, and ms-order pg-order-line.
  test("names a clerk's forms, each engine's lines under that engine's orders, and nobody else's", async () => {
    const menu = expectOk(await plane.client().forms())
    const granted = ['read', 'create', 'update']
    expect(menu).toEqual({
      forms: [
        { id: 'ms-order', title: 'Order', operations: granted, children: [{ form: 'ms-order-line', field: 'order' }] },
        { id: 'ms-order-line', title: 'Order line', operations: granted, children: [] },
        { id: 'pg-order', title: 'Order', operations: granted, children: [{ form: 'pg-order-line', field: 'order' }] },
        { id: 'pg-order-line', title: 'Order line', operations: granted, children: [] },
      ],
    })
    expect(plane.sent).toEqual([expect.objectContaining({ method: 'GET', url: `${plane.base}/v1/forms`, body: undefined })])
    expect(plane.sent[0]?.headers['authorization']).toBe(`Bearer ${plane.tokens.clerk}`)
    expect(expectOk(await plane.client(plane.tokens.admin).forms())).toEqual({ forms: [] })
  })

  // What the menu promises of a child: the child's list, narrowed by a
  // parent record's own token -- as the parent form's list hands it out --
  // through the field it names, is served, and holds that record's lines
  // alone, on each engine, by its database. Tenant 1 has one seeded order
  // with a line; a second, made here with none, is what shows the list
  // narrowed rather than merely holding every line. Watched failing with
  // the list's parent dropped by the planner: the new order listed the
  // seeded order's line.
  test.each(ENGINES)('a child it names on $engine lists the lines of each order whose token it is handed', async ({ connection }) => {
    const parentForm = `${connection}-order`
    const menu = expectOk(await plane.client().forms())
    const [child] = menu.forms.find((entry) => entry.id === parentForm)?.children ?? []
    if (child === undefined) throw new Error(`${parentForm} has no child`)
    const definition = expectOk(await plane.client().form(parentForm))
    const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
    const [customer] = expectOk(await plane.client().query(parentForm, source, { operation: 'create', search: 'Muster' })).rows
    if (customer === undefined) throw new Error('no customer to order for')
    const made = expectOk(await plane.client().create(parentForm, { customer: customer.token, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '1', notes: null }))

    const orders = expectOk(await plane.client().list(parentForm))
    // Tenant 1's seeded order, 2^53 + 1, which has a line, as the order form spells its token, and the order just made.
    expect(orders.rows.map((row) => row.record)).toEqual(expect.arrayContaining(['k1:9007199254740993', made.record]))
    const lines = new Map<string, number>()
    for (const { record } of orders.rows) {
      if (record === null) throw new Error(`${parentForm} listed a row with no token`)
      const page = expectOk(await plane.client().list(child.form, { parent: { field: child.field, record } }))
      for (const row of page.rows) expect(row.answers[child.field]).toBe(record)
      lines.set(record, page.rows.length)
    }
    expect(lines.get('k1:9007199254740993')).toBeGreaterThan(0)
    expect(lines.get(made.record ?? '')).toBe(0)
  })
})
