// The README's hero and its How it works step Run (0168): host-record-tabs
// and host-workspace, the acts apps/host/scripts/pictures.mjs runs after
// host-other-tenant's and before host-delete's, as clara, a clerk of tenant 1.
//
// The orders a buyer would recognise are invented, and inserted here through
// the owner's connection the script already opens, never into the shared
// fixture model, which every parity suite counts: three more customers of
// tenant 1 beside the fixture's Muster AG, six orders of October and
// November 2026, every one taken online, and two deliveries of the one that
// is opened. Their keys are given, so every walk draws the same ones. Then
// ada publishes the order form again with a list view named Online orders,
// its default, and the deliveries' form (pictures-forms.mjs), and clara signs
// in again, so the menu and the list are read anew.
//
// The fixture's edge-case order, 2^53+1, is in group A, and so outside the
// view: the list is the invented orders alone, which the act holds against
// the database. React alone draws the record, one paper as an application's
// page draws one, and the record is pictured in Side by side, where its lane
// is narrow enough for a small picture to be read. The workspace is
// pictured in Stacked with the line between the records and the record
// moved to its end by the keyboard, so the six rows are drawn whole in the
// 900 px window the camera opens.
//
// `undo`, which host-delete's act calls first, takes the rows out again and
// puts the line back where clara found it, so host-delete's grid holds the
// fixture's one order, as its caption says. host-drift puts both renderers
// back.

import { DELIVERY, deliveryPolicy, guidePolicy, orderRequest, publish, VIEWED } from './pictures-forms.mjs'

/** The customers the orders are for: tenant 1's, numbered after the fixture's 1001 and the 1002 host-refused deletes. */
const CUSTOMERS = [
  { no: 1003, name: 'Café Lumière GmbH', country: 'CH', limit: '25000.00' },
  { no: 1004, name: 'Beispiel Logistik KG', country: 'DE', limit: '60000.00' },
  { no: 1005, name: 'Vorlage & Partner GmbH', country: 'DE', limit: '10000.00' },
]

/** The orders, oldest first: each a number, its customer, its day, its status as ck_order_status allows, its amount in numeric(18,4)'s exact digits, its notes and who created and approved it. */
const ORDERS = [
  { id: '10418', customer: 1003, date: '2026-10-14', status: 'shipped', amount: '389.00', notes: null, created: 2, approved: 1 },
  { id: '10419', customer: 1004, date: '2026-10-21', status: 'shipped', amount: '12800.00', notes: 'Two pallets', created: 1, approved: 1 },
  { id: '10420', customer: 1003, date: '2026-11-04', status: 'placed', amount: '640.00', notes: 'Invoice by post', created: 2, approved: null },
  { id: '10421', customer: 1004, date: '2026-11-11', status: 'placed', amount: '4980.20', notes: null, created: 1, approved: null },
  { id: '10422', customer: 1001, date: '2026-11-17', status: 'placed', amount: '1240.50', notes: 'Goods entrance', created: 2, approved: null },
  { id: '10423', customer: 1005, date: '2026-11-19', status: 'draft', amount: '157.35', notes: null, created: 1, approved: null },
]

/** The order the scenes open: Muster AG's, which one delivery has left and another waits for. */
const OPEN = ORDERS.find((order) => order.customer === 1001)
const RECORD = `Order k1:${OPEN.id}`

/** Its deliveries, their keys given: the database's default would draw new ones on every walk. */
const DELIVERIES = [
  { id: '3f1c2a9e-6b4d-4e8a-9c71-5d2e8b0a4f16', carrier: 'Express', shipped: '2026-11-18 09:30:00+00' },
  { id: '8a7d4c3b-2e1f-4a96-b5c8-0f9e6d3a1b27', carrier: 'Freight', shipped: null },
]

/** The rows above, inserted through the database's owner, whom row-level security does not bind. */
async function seed(owner) {
  for (const customer of CUSTOMERS)
    await owner`insert into sales.customer (tenant_id, customer_no, name, country_code, credit_limit) values (1, ${customer.no}, ${customer.name}, ${customer.country}, ${customer.limit})`
  for (const order of ORDERS) {
    await owner`insert into sales."order" (id, tenant_id, customer_no, order_date, status, amount, notes, "group", created_by, approved_by)
      overriding system value
      values (${order.id}, 1, ${order.customer}, ${order.date}, ${order.status}, ${order.amount}, ${order.notes}, 'Online', ${order.created}, ${order.approved})`
  }
  for (const delivery of DELIVERIES)
    await owner`insert into sales.delivery (id, tenant_id, order_id, carrier, shipped_at) values (${delivery.id}, 1, ${OPEN.id}, ${delivery.carrier}, ${delivery.shipped})`
}

/**
 * The two acts and their undoing, over `plane` and the page helpers
 * pictures.mjs walks with: `records`, `detail`, `pane`, `carryOn`, `signIn`,
 * `renderer`, `untilSnapshot`, and the tokens and control names.
 */
export function workspaceScenes(plane, { records, detail, pane, carryOn, signIn, renderer, untilSnapshot, tokens, HOST, within }) {
  const { owner } = plane
  const record = (page) => detail(page, RECORD)
  const layout = (page, name) => page.getByRole('radio', { name, exact: true }).check()
  /** The line between the records and the record, in Stacked: a separator named for the records it sizes. */
  const line = (page) => page.getByRole('separator', { name: 'Records', exact: true })
  return {
    acts: {
      'host-record-tabs': async (page) => {
        await carryOn(page, page.getByRole('button', { name: HOST.signOut, exact: true }))
        await seed(owner)
        await publish(plane.server, tokens.ada, orderRequest(), { policyOf: guidePolicy, presentation: VIEWED, expectedBase: 1 })
        await publish(plane.server, tokens.ada, DELIVERY, { policyOf: deliveryPolicy })
        // Signed in again, so the menu names the deliveries and the list opens on the view.
        await signIn(page, tokens.clara)
        await layout(page, 'Side by side')
        await renderer(page, 'React')
        // The caption's premise, asked of the owner: the view lists tenant 1's online orders, and they are the invented ones, newest first.
        const online = await owner`select id::text as id from sales."order" where tenant_id = 1 and "group" = 'Online' order by order_date desc`
        const wanted = ORDERS.map((order) => order.id).toReversed()
        if (JSON.stringify(online.map((row) => row.id)) !== JSON.stringify(wanted))
          throw new Error(`tenant 1's online orders are ${JSON.stringify(online.map((row) => row.id))}, not the invented ${JSON.stringify(wanted)}`)
        await records(page)
          .getByRole('status')
          .filter({ hasText: `Rows 1–${String(ORDERS.length)}.` })
          .waitFor()
        const grid = records(page).getByRole('grid', { name: 'Records', exact: true })
        for (const id of wanted) await grid.getByRole('row', { name: new RegExp(`^${id} `) }).waitFor()
        // Opened by its row, as a person opens one.
        await grid.getByRole('row', { name: new RegExp(`^${OPEN.id} `) }).click()
        await record(page).waitFor()
        await untilSnapshot(pane(page, 'React'), /combobox "Customer\*?"(?: \[[a-z]+\])*: Muster AG/, { within, what: "the React pane's customer" })
        return { parts: { Record: record(page) } }
      },

      'host-workspace': async (page) => {
        await layout(page, 'Stacked')
        // The records as tall as the line lets them be: End, from the keyboard, as a person moves it.
        await line(page).focus()
        await line(page).press('End')
        // The order's deliveries, in the tab beside it: listed the first time it is shown.
        await record(page).getByRole('tab', { name: DELIVERY.title, exact: true }).click()
        await record(page)
          .getByRole('tabpanel', { name: DELIVERY.title, exact: true })
          .getByRole('status')
          .filter({ hasText: `Rows 1–${String(DELIVERIES.length)}.` })
          .waitFor()
        return { parts: { Forms: page.getByRole('navigation', { name: HOST.forms, exact: true }), Workspace: page.getByRole('main') } }
      },
    },

    /** The rows taken out again -- a delete of an order takes its deliveries -- and the line put back at its start, three steps of five up from its end. */
    undo: async (page) => {
      await line(page).focus()
      for (let step = 0; step < 3; step += 1) await line(page).press('ArrowUp')
      await owner`delete from sales."order" where id in ${owner(ORDERS.map((order) => order.id))}`
      await owner`delete from sales.customer where tenant_id = 1 and customer_no in ${owner(CUSTOMERS.map((customer) => customer.no))}`
    },
  }
}
