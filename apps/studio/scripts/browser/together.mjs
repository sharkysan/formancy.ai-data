// The Choose step's part of a record's rows saved with it (0155), in the
// browser, from wherever a browse left the page, signed in as an
// administrator: a rowversion order's touch column chosen, an order's
// lines saved with it -- the box ticked by keyboard, and its bounds -- and
// a delivery's tenant pinned, which the bundle check refuses, said in the
// warm colour under the box. Each state is measured on the way by the gate.

import { TOGETHER_MAX_ROWS } from '@formancy/data-core'
import { describeFocus } from './measure.mjs'
import { nav, step } from './journey.mjs'

/** Null when `got` is `want`, otherwise both. */
const same = (got, want) => (got === want ? null : `it is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)

/** Null when `target` has the keyboard's focus, otherwise what has. */
async function focusedOn(page, target) {
  return (await target.evaluate((element) => element === document.activeElement)) ? null : `the focus is on ${await describeFocus(page)}`
}

/** The states, in order, as `[name, act]`. */
export function together(check) {
  return [
    [
      'Choose, a rowversion order’s touch column',
      async (page) => {
        await nav(page, 'Connect').click()
        await page.getByRole('button', { name: 'Discover fixture-sqlserver', exact: true }).click()
        await page.getByRole('region', { name: 'What fixture-sqlserver can see', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Choose a root' }).click()
        const choose = step(page, 'Choose')
        await choose.getByLabel('Root table or view').selectOption({ label: 'sales.order' })
        const touch = choose.getByRole('combobox', { name: 'Rows saved with these records move the rowversion through' })
        check('no touch column is chosen for anybody', same(await touch.inputValue(), ''))
        await touch.selectOption('status')
      },
    ],
    // Space ticks the box and leaves the keyboard on it, the bounds drawn
    // after it, so the next Tab reaches At least: a box re-rendered as it
    // was ticked would drop the keyboard, which only a browser shows.
    [
      'Choose, an order’s lines saved with it',
      async (page) => {
        const choose = step(page, 'Choose')
        await choose.getByLabel('Root table or view').selectOption({ label: 'sales.order_line' })
        const box = choose.getByRole('checkbox', { name: 'Rows of this form are saved with their order' })
        await box.focus()
        await page.keyboard.press('Space')
        const least = choose.getByRole('spinbutton', { name: 'At least' })
        await least.waitFor()
        check('Space ticks the box and keeps the keyboard on it', (await box.isChecked()) ? await focusedOn(page, box) : 'it is not ticked')
        await page.keyboard.press('Tab')
        check('and the next Tab reaches At least', await focusedOn(page, least))
        check('At most starts at the cap', same(await choose.getByRole('spinbutton', { name: 'At most' }).inputValue(), String(TOGETHER_MAX_ROWS)))
      },
    ],
    [
      'Choose, a delivery’s pin refused under the box',
      async (page) => {
        const choose = step(page, 'Choose')
        await choose.getByLabel('Root table or view').selectOption({ label: 'sales.delivery' })
        await choose.getByRole('checkbox', { name: 'Rows of this form are saved with their order' }).check()
        await choose.getByRole('checkbox', { name: 'Pin tenant_id' }).check()
        await choose
          .getByRole('list', { name: 'What blocks it' })
          .getByText(/^The server refuses the policy with it: rowFilters: tenant_id is outside/)
          .waitFor()
      },
    ],
  ]
}
