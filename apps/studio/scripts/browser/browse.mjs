// The Browse step in the browser (0099), signed in as a holder of a browse
// role on the plane where every administrator publishes: a table wider than
// a phone, its grid scrolling inside its own region and never the page; a
// sort from a column's header by keyboard; a row's related rows opened, a
// foreign key followed and Back taken, each by keyboard (0103); a view,
// with what ordering it by every column costs; and the table's filter
// (0104, 0147) -- the line reached by `/` and its completion open over the
// grid, a line applied by Enter, one it cannot read and one the server
// refuses, a column's box under its header reached by Tab and applied by
// Enter, a chip removed, and the last one removed and put back by Undo,
// each by keyboard. Each state is measured on the way by the gate.

import { describeFocus, focusAfterEnter } from './measure.mjs'
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

/** Null when `got` is `want`, otherwise both. */
const same = (got, want) => (JSON.stringify(got) === JSON.stringify(want) ? null : `it is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)

/** Null when `target` has the keyboard's focus, otherwise what has. */
async function focusedOn(page, target) {
  return (await target.evaluate((element) => element === document.activeElement)) ? null : `the focus is on ${await describeFocus(page)}`
}

/** The filter line, the order's grid and the step's status line once it says `text`, on the Browse step. */
const line = (page) => step(page, 'Browse').getByRole('combobox', { name: 'Filter', exact: true })
const orders = (page) => step(page, 'Browse').getByRole('region', { name: /^sales\.order, / })
const says = (page, text) => () => step(page, 'Browse').getByRole('status').filter({ hasText: text }).waitFor()

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
    // `/` from the grid puts the keyboard on the filter line (0147), and
    // typing there opens what may come next under it, over the grid: what
    // is measured open, for sideways scroll and the window's edges.
    [
      'Browse, the filter line completing',
      async (page) => {
        await show(page, 'sales.order')
        await orders(page).focus()
        await page.keyboard.press('/')
        check('/ from the grid puts the keyboard on the filter line', await focusedOn(page, line(page)))
        // On the line whether or not `/` put it there, so a `/` that did not is that check's failure, not the pass's.
        await line(page).focus()
        await page.keyboard.type('sta')
        const options = step(page, 'Browse').getByRole('listbox', { name: 'What may come next' })
        await options.waitFor({ state: 'visible' })
        check('the line completing offers the column begun, by its name', same(await options.getByRole('option').allTextContents(), ['status']))
      },
    ],
    // Enter applies the line: the page says what it is filtered by, the
    // condition is a chip, and the keyboard stays in the line.
    [
      'Browse, a condition applied from the line by keyboard',
      async (page) => {
        await line(page).fill('status = shipped')
        check(
          'applying the line by Enter leaves the keyboard in the line',
          await focusAfterEnter(page, line(page), says(page, 'Filtered by status = shipped, showing rows 1 to 1.'), line(page)),
        )
        await step(page, 'Browse').getByRole('list', { name: 'Filtered by' }).waitFor()
      },
    ],
    // A line the page cannot read is said under it, the characters it is
    // about marked, and kept: the marked copy wraps at 320 px.
    [
      'Browse, a line it cannot read',
      async (page) => {
        const typed = "status = shipped and amount > 1'000"
        await line(page).fill(typed)
        await line(page).press('Enter')
        await step(page, 'Browse')
          .getByRole('status', { name: 'Filter', exact: true })
          .filter({ hasText: 'Write numbers with a point and no separators: 1000.' })
          .waitFor()
        check('a line it cannot read keeps what was typed', same(await line(page).inputValue(), typed))
      },
    ],
    // The server's refusal, in the step's alert, with the line still there
    // to correct; Esc then puts back the filter applied, and the keyboard
    // goes to the grid.
    [
      'Browse, a line the server refuses',
      async (page) => {
        const typed = 'status = shipped and amount = 1.23456'
        await line(page).fill(typed)
        await line(page).press('Enter')
        await step(page, 'Browse').getByRole('alert').filter({ hasText: 'A value given for amount is not one it can hold.' }).waitFor()
        check('a line the server refuses keeps what was typed', same(await line(page).inputValue(), typed))
        // In the line wherever Enter left the keyboard, so the checks after Esc are theirs alone.
        await line(page).focus()
        await page.keyboard.press('Escape')
        check('Esc puts back the filter applied', same(await line(page).inputValue(), 'status = shipped'))
        check('and gives the keyboard to the grid', await focusedOn(page, orders(page)))
      },
    ],
    // A column's box is under its header, after the headers that sort: Tab
    // from the last of them reaches the first box. Enter applies what is
    // typed, the keyboard staying in the box and the line saying it; Esc
    // gives an edit up.
    [
      'Browse, a header box applied by keyboard',
      async (page) => {
        await orders(page)
          .getByRole('button', { name: /, sort (ascending|descending)$/ })
          .last()
          .focus()
        await page.keyboard.press('Tab')
        check(
          'Tab from the last header reaches the first column’s box',
          await focusedOn(
            page,
            orders(page)
              .getByRole('textbox', { name: /^Filter / })
              .first(),
          ),
        )
        const box = orders(page).getByRole('textbox', { name: 'Filter approved_by', exact: true })
        await box.focus()
        await page.keyboard.type('is empty')
        const applied = says(page, 'Filtered by status = shipped and approved_by is NULL, showing rows 1 to 1.')
        check('applying a header box by Enter leaves the keyboard in the box', await focusAfterEnter(page, box, applied, box))
        check('the line says the box’s condition', same(await line(page).inputValue(), 'status = shipped and approved_by is empty'))
        // In the box wherever Enter left the keyboard, so the check after Esc is its alone.
        await box.focus()
        await page.keyboard.type(' or not')
        await page.keyboard.press('Escape')
        check('Esc in a header box gives the edit up', same(await box.inputValue(), 'is empty'))
      },
    ],
    // A chip's Remove takes the button pressed with it: the keyboard goes
    // to the Remove that takes its place, not to the page.
    [
      'Browse, a condition removed by keyboard',
      async (page) => {
        const browse = step(page, 'Browse')
        check(
          'removing a condition puts the keyboard on the next one’s Remove',
          await focusAfterEnter(
            page,
            browse.getByRole('button', { name: 'Remove status = shipped', exact: true }),
            says(page, 'Filtered by approved_by is NULL, showing rows 1 to 2.'),
            browse.getByRole('button', { name: 'Remove approved_by is NULL', exact: true }),
          ),
        )
      },
    ],
    // The last condition removed puts the keyboard on Undo, and Undo puts
    // the condition back, the keyboard on its Remove.
    [
      'Browse, the last condition removed and put back by keyboard',
      async (page) => {
        const browse = step(page, 'Browse')
        const remove = browse.getByRole('button', { name: 'Remove approved_by is NULL', exact: true })
        const undo = browse.getByRole('button', { name: 'Undo removing approved_by is NULL', exact: true })
        check('removing the last condition puts the keyboard on Undo', await focusAfterEnter(page, remove, says(page, /^Showing rows 1 to 2\.$/), undo))
        check(
          'Undo puts the keyboard on the Remove of the condition it put back',
          await focusAfterEnter(page, undo, says(page, 'Filtered by approved_by is NULL, showing rows 1 to 2.'), remove),
        )
      },
    ],
  ]
}
