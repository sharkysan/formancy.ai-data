// The Browse step in the browser (0099), signed in as a holder of a browse
// role on the plane where every administrator publishes: a table wider than
// a phone, its grid scrolling inside its own region and never the page; a
// sort from a column's header by keyboard; a row's related rows opened, a
// foreign key followed and Back taken, each by keyboard (0103); and a view,
// with what ordering it by every column costs. Each state is measured on the
// way by the gate.

import { focusAfterEnter } from './measure.mjs'
import { nav, step } from './journey.mjs'
import { TOKENS } from './plane.mjs'
import { signIn } from './review.mjs'

/** The object chosen and its rows shown, from the Browse step. */
async function show(page, object) {
  const browse = step(page, 'Browse')
  await browse.getByLabel('Table or view').selectOption(object)
  await browse.getByRole('button', { name: 'Show rows' }).click()
  await browse.getByRole('region', { name: new RegExp(`^${object.replace('.', '\\.')}, `) }).waitFor()
}

/** The states, in order, as `[name, act]`, from wherever the journey left the page. */
export function browse(check) {
  return [
    ['Browse, a table wider than the window', async (page) => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await signIn(page, TOKENS.browser)
      await page.getByRole('button', { name: 'Discover fixture', exact: true }).click()
      await page.getByRole('region', { name: 'What fixture can see' }).waitFor()
      await nav(page, 'Browse').click()
      await show(page, 'sales.order')
    }],
    // A header's button is replaced by one that names the other direction:
    // the keyboard stays on the column it sorted by, not on the page.
    ['Browse, sorted by a column by keyboard', async (page) => {
      const browse = step(page, 'Browse')
      const ascending = browse.getByRole('button', { name: 'notes, sort ascending' })
      const descending = browse.getByRole('button', { name: 'notes, sort descending' })
      check('sorting from a header leaves the keyboard on that header', await focusAfterEnter(page, ascending, () => descending.waitFor(), descending))
    }],
    // The section below the grid takes the keyboard by its heading, so a
    // keyboard user hears what opened rather than staying in the grid.
    ["Browse, a row's related rows", async (page) => {
      const browse = step(page, 'Browse')
      const opened = browse.getByRole('heading', { level: 4, name: 'Related to row 1 of sales.order' })
      check('opening a row’s related rows puts the keyboard on their heading', await focusAfterEnter(page, browse.getByRole('button', { name: 'Related to row 1' }), () => opened.waitFor(), opened))
      // The approver's key is NULL in this row, and said rather than offered.
      await browse.getByText('fk_order_approved_by: approved_by is NULL, so it follows to no row.').waitFor()
    }],
    // A follow removes the button pressed with the section it was in: the
    // keyboard goes to the heading of the page reached, not to the page.
    ['Browse, following a foreign key', async (page) => {
      const browse = step(page, 'Browse')
      const reached = browse.getByRole('heading', { level: 3, name: 'sales.customer table' })
      const follow = browse.getByRole('button', { name: 'sales.customer where tenant_id = 1 and customer_no = 1001' })
      check('following a foreign key puts the keyboard on the page it reached', await focusAfterEnter(page, follow, () => reached.waitFor(), reached))
      await browse.getByRole('button', { name: 'Back to sales.order' }).waitFor()
    }],
    ['Browse, a view ordered by every column', async (page) => {
      const browse = step(page, 'Browse')
      const returned = browse.getByRole('heading', { level: 3, name: 'sales.order table' })
      check('Back puts the keyboard on the page it returned to', await focusAfterEnter(page, browse.getByRole('button', { name: 'Back to sales.order' }), () => returned.waitFor(), returned))
      await show(page, 'sales.customer_summary')
      await step(page, 'Browse').getByText(/has no key this connection may read/).waitFor()
    }],
  ]
}
