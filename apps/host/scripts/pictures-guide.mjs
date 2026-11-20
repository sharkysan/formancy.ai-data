// The host page's guide pictures of what a person does with a list and a
// record (0038, 0169): host-columns, host-views and host-drill-down, the
// acts apps/host/scripts/pictures.mjs runs after the workspace's and before
// host-delete's, as clara, a clerk of tenant 1, over the orders
// pictures-workspace.mjs inserted.
//
// - host-columns: the Records grid's Columns open, Created by and Approved
//   by hidden and Customer a step wider, which the panel's line says in
//   pixels (0106, 0151). The act holds the grid to it: its header without
//   the two, and Customer drawn as wide as the line says, read from the
//   header's box. host-views' Reset columns puts them back.
// - host-views: `status = placed` typed into the filter line over Online
//   orders, the form's view, and kept as clara's own view, which View then
//   names, with Remove your view beside it (0105, 0126, 0131). The server
//   is asked that it keeps the view for her and offers otto none; Online
//   orders is shown again by the next act.
// - host-drill-down: Drill down from an order to its Express delivery and
//   on to that delivery's first parcel, the trail above naming each level
//   (0090). The parcels are invented as the orders are, inserted here
//   through the owner's connection, and their form, `pg-parcel`, published
//   by ada (pictures-forms.mjs): the order form's own account may read
//   sales.parcel, and the form keeps a parcel to the tenant of its delivery
//   (0043). pictures-workspace.mjs's `undo` chooses Stacked again, where
//   its line is, and its delete of the orders takes the parcels with their
//   deliveries.
//
// Two of the guide's features are not pictured (0169): a form shown as a
// tree (0110), since this account may not read sales.employee, the
// model's one table that is its own child; and a state field drawn as its
// moves (0127), since the moves are the options of a native select, which
// a picture draws closed.

import { PARCEL, parcelPolicy, publish } from './pictures-forms.mjs'

/** The parcels of the order's first delivery, Express, their keys given as the deliveries' are. */
const PARCELS = [
  { id: 101, label: 'Carton 1 of 2' },
  { id: 102, label: 'Carton 2 of 2' },
]

/** The delivery the parcels are of: the Express one pictures-workspace.mjs gives order 10422. */
const EXPRESS = '3f1c2a9e-6b4d-4e8a-9c71-5d2e8b0a4f16'

/** The order the scenes open, as the workspace opened it, and its form. */
const ORDER = '10422'
const ORDER_FORM = 'pg-order'

/** The trail at the parcel: each level above a button back to it, the one shown its name. */
const TRAIL = ['Records', `Order k1:${ORDER}`, 'Delivery Express', 'Parcel Carton 1 of 2']

/** The columns host-columns hides, by label: the employees' numbers, which this account may not name (it may not read sales.employee). */
const HIDDEN = ['Created by', 'Approved by']
/** The column it widens, a step. */
const WIDER = 'Customer'
/** The order form's columns left shown, in the grid's order. */
const SHOWN = ['Id', 'Customer', 'Order date', 'Status', 'Amount', 'Notes', 'Group']

/** What clara types into the Records filter line over Online orders, and the name she keeps it under. */
const CONDITION = 'status = placed'
const MINE = 'Placed orders'

/**
 * The three acts, over `plane` and the page helpers pictures.mjs walks
 * with: `records`, `detail`, `carryOn`, `signIn`, `untilSnapshot`, and the
 * tokens and control names.
 */
export function guideScenes(plane, { records, detail, carryOn, signIn, untilSnapshot, tokens, HOST, within }) {
  const { owner } = plane
  const layout = (page, name) => page.getByRole('radio', { name, exact: true }).check()
  const grid = (page) => records(page).getByRole('grid', { name: 'Records', exact: true })
  const rowOf = (within_, id) => within_.getByRole('row', { name: new RegExp(`^${id} `) })
  return {
    'host-columns': async (page) => {
      const toggle = records(page).getByRole('button', { name: 'Columns', exact: true })
      await toggle.click()
      const list = records(page).getByRole('list', { name: 'Columns', exact: true })
      for (const label of HIDDEN) await list.getByRole('checkbox', { name: `Show ${label}`, exact: true }).uncheck()
      await list.getByRole('button', { name: `Make ${WIDER} wider`, exact: true }).click()
      const said = records(page).getByRole('status', { name: 'Columns', exact: true })
      await said.filter({ hasText: new RegExp(`^${WIDER} is \\d+ pixels wide\\.$`) }).waitFor()
      // What the panel says is what the grid draws: its header without the hidden columns, and Customer as wide as the line says.
      await grid(page)
        .getByRole('row', { name: SHOWN.join(' '), exact: true })
        .waitFor()
      const width = Number(/(\d+) pixels/.exec((await said.textContent()) ?? '')?.[1])
      const drawn = Math.round((await grid(page).getByRole('columnheader', { name: WIDER, exact: true }).boundingBox())?.width ?? 0)
      if (drawn !== width) throw new Error(`the panel says ${WIDER} is ${String(width)} pixels wide, and the grid draws it ${String(drawn)} wide`)
      return { parts: { Columns: list, Reset: records(page).getByRole('button', { name: 'Reset columns', exact: true }), Said: said } }
    },

    'host-views': async (page) => {
      // The columns as the form orders them, and the panel closed: host-columns' arrangement is its own.
      await records(page).getByRole('button', { name: 'Reset columns', exact: true }).click()
      await records(page).getByRole('button', { name: 'Columns', exact: true }).click()
      const line = records(page).getByRole('combobox', { name: 'Filter', exact: true })
      await line.fill(CONDITION)
      await line.press('Enter')
      await records(page).getByRole('status').filter({ hasText: 'Rows 1–3.' }).waitFor()
      await records(page).getByRole('textbox', { name: 'Name of your view', exact: true }).fill(MINE)
      await records(page).getByRole('button', { name: 'Save your view', exact: true }).click()
      const said = records(page).getByRole('status', { name: 'Your views', exact: true })
      await said.filter({ hasText: `Saved your view “${MINE}”.` }).waitFor()
      // View names it, under Your views: the chosen option, which the record's text does not say of a select.
      await records(page)
        .getByRole('combobox', { name: 'View', exact: true })
        .getByRole('option', { name: MINE, exact: true, selected: true })
        .waitFor({ state: 'attached' })
      // The caption's premise, asked of the server: it keeps the view for clara, her condition in the view's order, and for nobody else.
      const own = async (token) =>
        (await plane.server.inject({ method: 'GET', url: `/v1/forms/${ORDER_FORM}`, headers: { authorization: `Bearer ${token}` } })).json().list?.own
      const hers = (await own(tokens.clara))?.map(({ name, filter, sort }) => ({ name, filter, sort }))
      const wanted = [{ name: MINE, filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [{ field: 'order_date', direction: 'desc' }] }]
      if (JSON.stringify(hers) !== JSON.stringify(wanted))
        throw new Error(`the server keeps clara's views of ${ORDER_FORM} as ${JSON.stringify(hers)}, not ${JSON.stringify(wanted)}`)
      const his = await own(tokens.otto)
      if (!Array.isArray(his) || his.length !== 0) throw new Error(`otto is offered ${JSON.stringify(his)} as his own views, not none`)
      return { parts: { Records: records(page) } }
    },

    'host-drill-down': async (page) => {
      // Online orders again, the form's view: clara's own is kept on the server, and shown by nothing after.
      await records(page).getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Online orders' })
      await records(page).getByRole('button', { name: 'Show view', exact: true }).click()
      await records(page).getByRole('status').filter({ hasText: 'Rows 1–6.' }).waitFor()
      for (const parcel of PARCELS)
        await owner`insert into sales.parcel (id, delivery_id, label) overriding system value values (${parcel.id}, ${EXPRESS}, ${parcel.label})`
      // The caption's premise, asked of the owner: the Express delivery is order 10422's, and its parcels the invented two.
      const held =
        await owner`select p.label, d.order_id::text as "order" from sales.parcel p join sales.delivery d on d.id = p.delivery_id where d.id = ${EXPRESS} order by p.id`
      if (JSON.stringify(held) !== JSON.stringify(PARCELS.map((parcel) => ({ label: parcel.label, order: ORDER }))))
        throw new Error(`the Express delivery holds ${JSON.stringify(held)}, not the invented parcels of order ${ORDER}`)
      await publish(plane.server, tokens.ada, PARCEL, { policyOf: parcelPolicy })
      // Signed in again, so the menu names the parcels as the deliveries' children.
      await carryOn(page, page.getByRole('button', { name: HOST.signOut, exact: true }))
      await signIn(page, tokens.clara)
      await layout(page, 'Drill down')
      await rowOf(grid(page), ORDER).click()
      const order = detail(page, `Order k1:${ORDER}`)
      await order.getByRole('tab', { name: 'Delivery', exact: true }).click()
      const deliveries = order.getByRole('tabpanel', { name: 'Delivery', exact: true })
      await deliveries.getByRole('status').filter({ hasText: 'Rows 1–2.' }).waitFor()
      await deliveries
        .getByRole('grid', { name: 'Delivery', exact: true })
        .getByRole('row', { name: /^Express / })
        .click()
      const delivery = detail(page, `Delivery k1:${EXPRESS}`)
      await delivery.getByRole('tab', { name: PARCEL.title, exact: true }).click()
      const parcels = delivery.getByRole('tabpanel', { name: PARCEL.title, exact: true })
      await parcels.getByRole('status').filter({ hasText: 'Rows 1–2.' }).waitFor()
      await parcels
        .getByRole('grid', { name: PARCEL.title, exact: true })
        .getByRole('row', { name: `${String(PARCELS[0].id)} ${PARCELS[0].label}`, exact: true })
        .click()
      const parcel = detail(page, `Parcel k1:${String(PARCELS[0].id)}`)
      await untilSnapshot(parcel, /combobox "Delivery\*?"(?: \[[a-z]+\])*: Express/, { within, what: "the parcel's delivery" })
      // The trail names every level, from the records down to the one shown.
      const crumbs = (await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('listitem').allTextContents()).map((text) =>
        text.trim(),
      )
      if (JSON.stringify(crumbs) !== JSON.stringify(TRAIL)) throw new Error(`the trail says ${JSON.stringify(crumbs)}, not ${JSON.stringify(TRAIL)}`)
      return { parts: { Workspace: page.getByRole('main') } }
    },
  }
}
