// The Browse step in the browser (0099), signed in as a holder of a browse
// role on the plane where every administrator publishes: a table wider than
// a phone, its grid scrolling inside its own region and never the page; a
// sort from a column's header by keyboard; a row's related rows opened, a
// foreign key followed and Back taken, each by keyboard (0103); a view,
// with what ordering it by every column costs; and the table's filter
// (0104), its form open on a range of days, a condition applied, a value
// refused and a condition removed, each by keyboard. Each state is measured
// on the way by the gate.

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
    [
      'Browse, a table wider than the window',
      async (page) => {
        await page.getByRole('button', { name: 'Sign out' }).click()
        await signIn(page, TOKENS.browser)
        await page.getByRole('button', { name: 'Discover fixture', exact: true }).click()
        await page.getByRole('region', { name: 'What fixture can see' }).waitFor()
        await nav(page, 'Browse').click()
        await show(page, 'sales.order')
      },
    ],
    // A header's button is replaced by one that names the other direction:
    // the keyboard stays on the column it sorted by, not on the page.
    [
      'Browse, sorted by a column by keyboard',
      async (page) => {
        const browse = step(page, 'Browse')
        const ascending = browse.getByRole('button', { name: 'notes, sort ascending' })
        const descending = browse.getByRole('button', { name: 'notes, sort descending' })
        check('sorting from a header leaves the keyboard on that header', await focusAfterEnter(page, ascending, () => descending.waitFor(), descending))
      },
    ],
    // The section below the grid takes the keyboard by its heading, so a
    // keyboard user hears what opened rather than staying in the grid.
    [
      "Browse, a row's related rows",
      async (page) => {
        const browse = step(page, 'Browse')
        const opened = browse.getByRole('heading', { level: 4, name: 'Related to row 1 of sales.order' })
        check(
          'opening a row’s related rows puts the keyboard on their heading',
          await focusAfterEnter(page, browse.getByRole('button', { name: 'Related to row 1' }), () => opened.waitFor(), opened),
        )
        // The approver's key is NULL in this row, and said rather than offered.
        await browse.getByText('fk_order_approved_by: approved_by is NULL, so it follows to no row.').waitFor()
      },
    ],
    // A follow removes the button pressed with the section it was in: the
    // keyboard goes to the heading of the page reached, not to the page.
    [
      'Browse, following a foreign key',
      async (page) => {
        const browse = step(page, 'Browse')
        const reached = browse.getByRole('heading', { level: 3, name: 'sales.customer table' })
        const follow = browse.getByRole('button', { name: 'sales.customer where tenant_id = 1 and customer_no = 1001' })
        check('following a foreign key puts the keyboard on the page it reached', await focusAfterEnter(page, follow, () => reached.waitFor(), reached))
        await browse.getByRole('button', { name: 'Back to sales.order' }).waitFor()
      },
    ],
    [
      'Browse, a view ordered by every column',
      async (page) => {
        const browse = step(page, 'Browse')
        const returned = browse.getByRole('heading', { level: 3, name: 'sales.order table' })
        check(
          'Back puts the keyboard on the page it returned to',
          await focusAfterEnter(page, browse.getByRole('button', { name: 'Back to sales.order' }), () => returned.waitFor(), returned),
        )
        await show(page, 'sales.customer_summary')
        await step(page, 'Browse')
          .getByText(/has no key this connection may read/)
          .waitFor()
      },
    ],
    // A disclosure: the form opens right after its button, which keeps the
    // keyboard. Two date boxes side by side are the widest the form gets,
    // and each browser draws a date box its own way.
    [
      "Browse, the filter's form open on a range of days",
      async (page) => {
        await show(page, 'sales.order')
        const browse = step(page, 'Browse')
        const toggle = browse.getByRole('button', { name: 'Filter rows' })
        const form = browse.getByRole('form', { name: 'Add a condition' })
        check('opening the filter’s form leaves the keyboard on its button', await focusAfterEnter(page, toggle, () => form.waitFor(), toggle))
        await form.getByRole('combobox', { name: 'Column' }).selectOption('order_date')
        await form.getByRole('combobox', { name: 'Condition' }).selectOption('is in a range')
        await form.getByLabel('To').waitFor()
      },
    ],
    // Enter in the value's box applies the condition; the box may go with
    // the form emptied for the next one, so the keyboard goes to Apply.
    [
      'Browse, a condition applied by keyboard',
      async (page) => {
        const browse = step(page, 'Browse')
        const form = browse.getByRole('form', { name: 'Add a condition' })
        await form.getByRole('combobox', { name: 'Column' }).selectOption('status')
        const value = form.getByRole('textbox', { name: 'Value' })
        await value.fill('shipped')
        const applied = () => browse.getByRole('status').filter({ hasText: 'Filtered by status = shipped, showing rows 1 to 1.' }).waitFor()
        check(
          'applying a condition by Enter leaves the keyboard on Apply',
          await focusAfterEnter(page, value, applied, form.getByRole('button', { name: 'Apply' })),
        )
        await browse.getByRole('list', { name: 'Filtered by' }).waitFor()
      },
    ],
    // The server's refusal, in the step's alert, with the value it refused
    // still in its box for the person to correct.
    [
      'Browse, a condition refused',
      async (page) => {
        const browse = step(page, 'Browse')
        const form = browse.getByRole('form', { name: 'Add a condition' })
        await form.getByRole('combobox', { name: 'Column' }).selectOption('amount')
        const value = form.getByRole('textbox', { name: 'Value' })
        await value.fill('1.23456')
        await value.press('Enter')
        await browse.getByRole('alert').filter({ hasText: 'A value given for amount is not one it can hold.' }).waitFor()
        const kept = await value.inputValue()
        check('a refused condition keeps what was typed', kept === '1.23456' ? null : `the box holds "${kept}"`)
      },
    ],
    // Remove takes the button pressed with it: after the last condition the
    // keyboard goes to the button that opens the form, not to the page.
    [
      'Browse, the last condition removed by keyboard',
      async (page) => {
        const browse = step(page, 'Browse')
        const remove = browse.getByRole('button', { name: 'Remove status = shipped' })
        const removed = () => browse.getByRole('status').filter({ hasText: 'Showing rows 1 to 2.' }).waitFor()
        check(
          'removing the last condition puts the keyboard on the button that opens the form',
          await focusAfterEnter(page, remove, removed, browse.getByRole('button', { name: 'Filter rows' })),
        )
      },
    ],
  ]
}
