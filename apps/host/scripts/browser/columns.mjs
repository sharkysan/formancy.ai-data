// A grid's Columns in the browser (0106), on the workspace the views'
// states left: every record, the View picker on "All records", the panels
// closed. Enter on Columns opens its panel and keeps the keyboard there,
// and the next Tab reaches the first column's Show; Space on a Show hides
// its column, the grid drawing no header for it, and asks the server
// nothing; a column shown again is sized to the rows shown then, so a value
// longer than any its column held when the page was sized is whole -- the
// run's order given a group that long, beside the page, found by a search,
// then put back; Enter on a move moves its column, the header following,
// and the keyboard stays on the button pressed though React moved it with
// its line -- at the top too, where the move is aria-disabled and does
// nothing; the row's Delete stays the grid's last header; and Reset
// columns puts the form's order back, the keyboard on it, before the panel
// is closed again for the states after. Each state is measured by the
// gate's `measured` on the way: the panel's colours and target sizes, its
// lines wrapping inside it, and no sideways scroll, down to 320 px.
//
// Where the keyboard is after a move is read from the document, not by a
// locator, which would wait for a button that is gone and stop the run
// rather than say where the keyboard went.

import { FORM } from './plane.mjs'
import { focusedOn, until } from './measure.mjs'

const LISTS = `/v1/forms/${FORM}/records/list`
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const toggle = (page) => records(page).getByRole('button', { name: 'Columns', exact: true })
const list = (page) => records(page).getByRole('list', { name: 'Columns', exact: true })
const show = (page, label) => list(page).getByRole('checkbox', { name: `Show ${label}`, exact: true })
const move = (page, label, way) => list(page).getByRole('button', { name: `Move ${label} ${way}`, exact: true })
/** The grid's own line: the section's first status with no name. */
const lineOf = async (page) => (await records(page).getByRole('status', { name: /^$/ }).first().textContent()) ?? ''

/** The grid's headers, in the order drawn: a hidden column draws none. */
const headers = async (page) => (await page.getByRole('grid', { name: 'Records', exact: true }).getByRole('columnheader').allTextContents()).map((text) => text.trim())

/** What the panel lists, in order: each column's label, from its Show's name. */
const listed = async (page) => Promise.all((await list(page).getByRole('checkbox').all()).map(async (box) => (await box.getAttribute('aria-label')).replace(/^Show /, '')))

/** The name of what has the keyboard, as its aria-label or its text says; the page itself when nothing does. */
const focused = (page) => page.evaluate(() => (document.activeElement === null || document.activeElement === document.body ? 'the page itself' : (document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent?.trim() ?? '')))

/** Null when `got` is `want`, otherwise both. */
const same = (got, want) => (JSON.stringify(got) === JSON.stringify(want) ? null : `it is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)

/** Wait until the grid's headers are `want`. */
const headed = (page, want) => until(async () => JSON.stringify(await headers(page)) === JSON.stringify(want), `the grid's headers never became ${JSON.stringify(want)}`)

/** `labels` with `label` moved to `at`. */
const placed = (labels, label, at) => {
  const rest = labels.filter((each) => each !== label)
  return [...rest.slice(0, at), label, ...rest.slice(at)]
}

/** Search the Records grid for `words`, and wait until its line matches `line`. */
async function search(page, words, line) {
  await records(page).getByRole('textbox', { name: 'Search' }).fill(words)
  await records(page).getByRole('button', { name: 'Search', exact: true }).click()
  await until(async () => line.test(await lineOf(page)), `the grid never said a line like ${String(line)} for "${words}"`)
}

/**
 * How many list requests the page sends while `act` runs and a quarter of
 * a second after, two frames included: viewing.mjs's, for the same
 * reason.
 */
async function listsSentWhile(page, act) {
  let count = 0
  const heard = (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === LISTS) count += 1
  }
  page.on('request', heard)
  try {
    await act()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.waitForTimeout(250)
  } finally {
    page.off('request', heard)
  }
  return count
}

/** The states, in order. */
export function columnsJourney(plane, { check }, run) {
  /** The form's columns as the grid first drew them: read in the first state. */
  let generated = []
  return [
    ['Columns open (Records)', async (page) => {
      generated = await headers(page)
      check('the row’s Delete is the grid’s last header', same(generated.at(-1), 'Delete'))
      await toggle(page).focus()
      await page.keyboard.press('Enter')
      check('Enter on Columns opens the panel', same(await toggle(page).getAttribute('aria-expanded'), 'true'))
      check('and leaves the keyboard on Columns', await focusedOn(page, toggle(page)))
      check('the panel lists the grid’s columns in its order, and no Delete', same(await listed(page), generated.slice(0, -1)))
      await page.keyboard.press('Tab')
      check('the next Tab reaches the first column’s Show', await focusedOn(page, show(page, generated[0])))
    }],
    ['A column hidden (Records)', async (page) => {
      const sent = await listsSentWhile(page, async () => {
        await show(page, 'Group').focus()
        await page.keyboard.press('Space')
        await headed(page, generated.filter((label) => label !== 'Group'))
      })
      check('a column hidden: its Show is unchecked', (await show(page, 'Group').isChecked()) ? 'it is still checked' : null)
      check('a column hidden: the keyboard stays on its Show', await focusedOn(page, show(page, 'Group')))
      check('a column hidden: nothing is asked of the server', sent === 0 ? null : `${String(sent)} list requests were sent`)
    }],
    ['A column shown again (Records)', async (page) => {
      // Longer than any group the column held when the page was sized: shown again, it is sized to it.
      const wide = `shown ${String(run.customer)} southern loading bay`
      await plane.setGroup(run.record, wide)
      await search(page, wide, /^Rows 1–1\.$/)
      await show(page, 'Group').focus()
      await page.keyboard.press('Space')
      await headed(page, generated)
      const cell = page.getByRole('grid', { name: 'Records', exact: true }).getByRole('gridcell', { name: wide, exact: true })
      const cut = await until(async () => !(await cell.evaluate((element) => element.scrollWidth > element.clientWidth)), 'the cell stayed cut').then(
        () => false,
        () => true,
      )
      check('a column shown again: sized to the rows shown, its value whole', cut ? 'its value is cut' : null)
      await plane.setGroup(run.record, null)
      await search(page, '', /^Rows 1–(?!1\.)/)
    }],
    ['A column moved (Records)', async (page) => {
      const from = generated.indexOf('Amount')
      await move(page, 'Amount', 'up').focus()
      await page.keyboard.press('Enter')
      await headed(page, placed(generated, 'Amount', from - 1))
      check('a column moved: the keyboard stays on the button pressed', same(await focused(page), 'Move Amount up'))
      for (let step = 1; step < from; step += 1) await page.keyboard.press('Enter')
      await headed(page, placed(generated, 'Amount', 0))
      check('a column moved to the top: the keyboard is still on its move up', same(await focused(page), 'Move Amount up'))
      check('a column moved to the top: its move up says it does nothing', same(await page.evaluate(() => document.activeElement?.getAttribute('aria-disabled') ?? null), 'true'))
      await page.keyboard.press('Enter')
      check('a column moved to the top: Enter there keeps the keyboard on it', same(await focused(page), 'Move Amount up'))
      check('a column moved to the top: and the row’s Delete is still last', same((await headers(page)).at(-1), 'Delete'))
    }],
    ['Columns reset (Records)', async (page) => {
      const reset = records(page).getByRole('button', { name: 'Reset columns', exact: true })
      await reset.focus()
      await page.keyboard.press('Enter')
      await headed(page, generated)
      check('columns reset: the keyboard stays on Reset columns', await focusedOn(page, reset))
      // Closed again, as the journeys after this one found the panel.
      await toggle(page).focus()
      await page.keyboard.press('Enter')
      check('columns reset: Enter on Columns closes the panel', same(await toggle(page).getAttribute('aria-expanded'), 'false'))
    }],
  ]
}
