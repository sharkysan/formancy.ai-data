// The studio's part of an action over the open record (0163), in the
// browser, from wherever a form's rows saved with their record left the
// page, signed in as an administrator: the fixture discovered with
// Include routines, its ship_order offered on the order -- the box ticked
// by keyboard, each parameter given a source, the tenant asked in its
// dialog -- then granted after the notice of what it does that nothing
// binds, and worded. Each state is measured on the way by the gate, the
// notice's warm colour and the routine's long name at 320 pixels among
// them.

import { describeFocus } from './measure.mjs'
import { chooseOrder, fillThePolicy, nav, step } from './journey.mjs'
import { withRoutines } from './plane.mjs'

/** The fixture's routine on PostgreSQL, as the Choose step names it. */
const SHIP_ORDER = 'sales.ship_order(pg_catalog.int8, pg_catalog.int4)'

/** Null when `target` has the keyboard's focus, otherwise what has. */
async function focusedOn(page, target) {
  return (await target.evaluate((element) => element === document.activeElement)) ? null : `the focus is on ${await describeFocus(page)}`
}

/** The states, in order, as `[name, act]`. */
export function actions(plane, check) {
  return [
    // Space ticks the box and leaves the keyboard on it, the mapping drawn
    // after it, so the next Tab reaches the action's name: a box drawn
    // again as it was ticked would drop the keyboard, which only a browser
    // shows.
    [
      'Choose, an action over the order, its parameters given',
      async (page) => {
        // The database as its owner's discovery reads it with its routines, whatever an earlier state left there.
        plane.databases.set('fixture', withRoutines('postgres-owner.json'))
        await nav(page, 'Connect').click()
        await page.getByRole('checkbox', { name: 'Include routines', exact: true }).check()
        await page.getByRole('button', { name: 'Discover fixture', exact: true }).click()
        await page.getByRole('region', { name: 'What fixture can see', exact: true }).getByRole('list', { name: 'Routines', exact: true }).waitFor()
        await chooseOrder(page)
        const choose = step(page, 'Choose')
        const box = choose.getByRole('checkbox', { name: `Offer ${SHIP_ORDER} as an action`, exact: true })
        await box.focus()
        await page.keyboard.press('Space')
        const name = choose.getByRole('textbox', { name: `Action name for ${SHIP_ORDER}`, exact: true })
        await name.waitFor()
        check('Space ticks the routine’s box and keeps the keyboard on it', (await box.isChecked()) ? await focusedOn(page, box) : 'it is not ticked')
        await page.keyboard.press('Tab')
        check('and the next Tab reaches the action’s name', await focusedOn(page, name))
        await choose.getByRole('combobox', { name: `Where order_id (bigint) comes from for ${SHIP_ORDER}`, exact: true }).selectOption({ label: 'Key id' })
        await choose
          .getByRole('combobox', { name: `Where tenant (integer) comes from for ${SHIP_ORDER}`, exact: true })
          .selectOption({ label: 'Asked in its dialog' })
        const refused = await choose.getByText(/^Action ship-order is not offered/).count()
        check('mapped, the generator binds it', refused === 0 ? null : 'the generator’s note still refuses it')
      },
    ],
    [
      'Policy, an action granted after its notice',
      async (page) => {
        await step(page, 'Choose').getByRole('button', { name: 'Generate the form', exact: true }).click()
        await step(page, 'Generate').waitFor()
        await nav(page, 'Policy').click()
        await fillThePolicy(page)
        const policy = step(page, 'Policy')
        await policy.getByRole('note', { name: 'What ship-order does is the deployment’s', exact: true }).waitFor()
        await policy.getByLabel('Roles that may run ship-order', { exact: true }).fill('clerk')
        await policy.getByText('The policy fits this form.').waitFor()
      },
    ],
    [
      'Presentation, an action’s words',
      async (page) => {
        await nav(page, 'Presentation').click()
        const words = step(page, 'Presentation').getByRole('region', { name: 'Actions', exact: true })
        await words.getByRole('textbox', { name: 'Asked before it runs for the ship-order action', exact: true }).fill('Ship this order now?')
        await words.getByRole('textbox', { name: 'Label of tenant in the ship-order dialog', exact: true }).fill('Which tenant ships it')
        await words.getByRole('checkbox', { name: 'This form’s list after ship-order', exact: true }).check()
      },
    ],
  ]
}
