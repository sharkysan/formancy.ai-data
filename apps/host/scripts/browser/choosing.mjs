// An action over the records a person chose (0166), in the browser, on the
// action order the plane publishes with close-all over a selection: the
// Records grid with its column of boxes first and the bar above it, one
// record chosen -- each measured by the gate's `measured` on the way --
// and what only a real browser shows: a row's box reached by the arrow
// keys, a real checkbox named for its record; Space on it ticking it and
// opening nothing, the row's own Space still opening the record; Tab from
// it leaving the grid in one stop, as from a row's Delete (0053); and the
// run from the bar, through its dialog and its confirmation, from the
// keyboard, the keyboard then on what the server did and the order closed
// in the database, the other not. Then Delete the chosen… (0174) over two
// more, one changed beside the page: its confirmation in place, the
// keyboard on it and the next Tab on Keep them, and Delete them from the
// keyboard, the keyboard then on what the server answered -- the one
// deleted, the other named and still chosen -- each state measured at
// every width as every state is.
//
// PostgreSQL only, as the gate is. What the engines answer -- a refusal
// naming a record changed since, paging clearing the choice, a second
// press while the run is out -- is the jsdom suites', on both
// (actions.test.tsx, bulk-delete.test.tsx), and the boxes' keyboard path
// without a server is choose-column.test.tsx's.

import { landsOn } from './deleting.mjs'
import { describeFocus, focusedOn, until, WITHIN } from './measure.mjs'
import { ACTION_ORDER, CLOSE_ALL_LABEL, FORM } from './plane.mjs'
import { carryOn } from './workspace.mjs'

const formLink = (page, id) => page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Order ${id}`, exact: true })
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page) => page.getByRole('grid', { name: 'Records', exact: true })
/** The Records grid's line: the first status with no name. */
const status = (page) => records(page).getByRole('status', { name: /^$/ }).first()
const bar = (page) => records(page).getByRole('group', { name: 'Chosen records', exact: true })
const box = (page, record) => grid(page).getByRole('checkbox', { name: `Choose Order ${record}`, exact: true })
const chosenRegion = (page, confirming = false) => page.getByRole('region', { name: `${CLOSE_ALL_LABEL}: 1 record${confirming ? '?' : ''}`, exact: true })
/** The deletion of two chosen orders: its confirmation, and without the question mark what the server answered (0174). */
const deletingTwo = (page, confirming = false) => page.getByRole('region', { name: `Delete 2 chosen Order records${confirming ? '?' : ''}`, exact: true })

/** The row of the Records grid whose cells include one that says `id`. */
const row = (page, id) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: id, exact: true }) })
    .first()

/** Whether the keyboard is on the checkbox named `name`. */
const onBox = (page, name) =>
  page.evaluate(
    (wanted) =>
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === 'checkbox' &&
      document.activeElement.getAttribute('aria-label') === wanted,
    name,
  )

/** The states, in order; `run` holds this width's pass. */
export function choosingJourney(plane, { check }, run) {
  const at = {
    chosen: '',
    other: '',
    note: `chosen at width ${String(run.customer)}`,
    gone: '',
    kept: '',
    deleting: `deleted together at width ${String(run.customer)}`,
  }
  return [
    [
      'Records chosen, above the grid',
      async (page) => {
        at.chosen = await plane.actionOrder(at.note)
        at.other = await plane.actionOrder(at.note)
        await carryOn(page, formLink(page, ACTION_ORDER))
        await records(page).getByRole('textbox', { name: 'Search' }).fill(at.note)
        await records(page).getByRole('button', { name: 'Search' }).click()
        await until(async () => (await status(page).textContent()) === 'Rows 1–2.', 'the search never listed the two orders')
        const first = await grid(page).getByRole('columnheader').first().textContent()
        check('the boxes are the grid’s first column, headed Choose', first?.trim() === 'Choose' ? null : `the first header says "${String(first)}"`)
        // From a field's cell of the row, Left: its box, a real checkbox named for the record.
        await row(page, at.chosen.slice(3))
          .getByRole('gridcell', { name: at.chosen.slice(3), exact: true })
          .focus()
        await page.keyboard.press('ArrowLeft')
        const name = `Choose Order ${at.chosen}`
        check(
          "the arrow keys reach a row's box, a checkbox named for its record",
          (await onBox(page, name)) ? null : `the focus is on ${await describeFocus(page)}`,
        )
        await page.keyboard.press('Space')
        const ticked = await box(page, at.chosen).isChecked()
        const said = await bar(page).getByRole('status').textContent()
        check(
          'Space on it ticks it, and the bar says one is chosen',
          ticked && said === '1 chosen.' ? null : `ticked ${String(ticked)}, the bar says "${String(said)}"`,
        )
        const opened = await page.getByRole('heading', { level: 3, name: `Order ${at.chosen}`, exact: true }).count()
        check('and opens nothing: its Space is the box’s, never the row’s', opened === 0 ? null : 'the record was opened')
        // Tab from it leaves the grid in one stop, as from any cell: the box is no stop of its own.
        await page.keyboard.press('Tab')
        const left = await page.evaluate(() => document.activeElement?.closest('.grid-bench') === null)
        check("Tab from a row's box leaves the grid", left ? null : `the focus is still in the grid, on ${await describeFocus(page)}`)
        // The row's own Space, on a field's cell, still opens the record.
        await row(page, at.other.slice(3))
          .getByRole('gridcell', { name: at.other.slice(3), exact: true })
          .focus()
        await page.keyboard.press('Space')
        await page.getByRole('heading', { level: 3, name: `Order ${at.other}`, exact: true }).waitFor(WITHIN)
        check('Space on a field’s cell still opens its record, the box left as it was', (await box(page, at.other).isChecked()) ? 'its box was ticked' : null)
      },
    ],
    [
      'An action over the records chosen, done',
      async (page) => {
        await bar(page).getByRole('button', { name: CLOSE_ALL_LABEL, exact: true }).click()
        const asking = chosenRegion(page)
        await asking.waitFor(WITHIN)
        check("the action over the records chosen: the keyboard is on its dialog's region", await landsOn(page, asking))
        const paper = asking.getByRole('form', { name: new RegExp(`^${CLOSE_ALL_LABEL}, (React|Angular)$`) })
        await paper.getByLabel(/^Note\b/).fill(at.note)
        await paper.getByRole('button', { name: 'Continue', exact: true }).click()
        const confirming = chosenRegion(page, true)
        await confirming.waitFor(WITHIN)
        check('its confirmation: the keyboard is on it', await landsOn(page, confirming))
        await page.keyboard.press('Tab')
        check(
          'the next Tab reaches Keep it, never the button that runs',
          await focusedOn(page, confirming.getByRole('button', { name: 'Keep it', exact: true })),
        )
        // From the keyboard: Run it, the Tab after Keep it, and Enter.
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')
        const done = chosenRegion(page)
        await done.getByText('Done. It ran over 1 record.', { exact: true }).waitFor(WITHIN)
        check('a run over the records chosen that is done: the keyboard is on what the server did', await landsOn(page, done))
        const [chosen, other] = [await plane.actionOrderOf(at.chosen), await plane.actionOrderOf(at.other)]
        check(
          'and the order chosen is closed in the database, the other not',
          chosen.status === 'closed' && other.status === 'open' ? null : JSON.stringify({ chosen, other }),
        )
      },
    ],
    [
      'Delete the chosen…, confirming',
      async (page) => {
        at.gone = await plane.actionOrder(at.deleting)
        at.kept = await plane.actionOrder(at.deleting)
        await records(page).getByRole('textbox', { name: 'Search' }).fill(at.deleting)
        await records(page).getByRole('button', { name: 'Search' }).click()
        await until(async () => (await status(page).textContent()) === 'Rows 1–2.', 'the search never listed the two orders to delete')
        await box(page, at.gone).click()
        await box(page, at.kept).click()
        // Changed beside the page once it was read: this one is refused, by name, and the other deleted.
        await plane.touchActionOrder(at.kept)
        await bar(page).getByRole('button', { name: 'Delete the chosen…', exact: true }).click()
        const confirming = deletingTwo(page, true)
        await confirming.waitFor(WITHIN)
        check('Delete the chosen…: the keyboard is on its confirmation', await landsOn(page, confirming))
        await page.keyboard.press('Tab')
        check(
          'the next Tab reaches Keep them, never the button that deletes',
          await focusedOn(page, confirming.getByRole('button', { name: 'Keep them', exact: true })),
        )
      },
    ],
    [
      'Delete the chosen…, answered',
      async (page) => {
        // From the keyboard: Delete them, the Tab after Keep them, and Enter.
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')
        const answered = deletingTwo(page)
        await answered.getByText('Deleted 1 of 2 records.', { exact: true }).waitFor(WITHIN)
        check('chosen records deleted: the keyboard is on what the server answered', await landsOn(page, answered))
        const [gone, kept] = [await plane.actionOrderOf(at.gone), await plane.actionOrderOf(at.kept)]
        check(
          'and the one read at its version is deleted in the database, the other not',
          gone === undefined && kept !== undefined ? null : JSON.stringify({ gone, kept }),
        )
        await until(async () => (await bar(page).getByRole('status').textContent())?.startsWith('1 chosen.') === true, 'the bar never said one is still chosen')
        check('the order not deleted is still chosen', (await box(page, at.kept).isChecked()) ? null : 'its box was unticked')
      },
    ],
    [
      'Back to the orders, after a choice',
      async (page) => {
        // The orders the journeys after this one use.
        await carryOn(page, formLink(page, FORM))
        await records(page).getByRole('grid', { name: 'Records', exact: true }).waitFor(WITHIN)
      },
    ],
  ]
}
