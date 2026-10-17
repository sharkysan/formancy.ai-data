// A delete's states in the browser (0053), on the workspace the record's
// journey left open: a row's Delete reached by the arrow keys and its
// confirmation under the grid, the record's confirmation under its header,
// "Not deleted", a record the delete could not find, "It may have been
// deleted" before and after its check, and the grid saying what was
// deleted -- each measured by the gate's `measured` on the way -- and what
// only a real browser shows: Tab from a row's Delete leaving the grid in
// one stop, the confirmation's frame against the glass at 3:1 or more, and
// its two answers one under the other on a phone, Keep it first.
//
// PostgreSQL only, as the gate is: an order line's typed key offers no
// delete there (0050), so a child row's confirmation is drawn in jsdom
// alone, on SQL Server (page.test.tsx).

import { carryOn } from './workspace.mjs'
import { contrast, describeFocus, focusedOn, paintedWhere, parseColor, until, WITHIN } from './measure.mjs'

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page) => page.getByRole('grid', { name: 'Records', exact: true })
/** The Records grid's line: the first status with no name -- Download CSV's, before it, is named by its button (0080). */
const status = (page) => records(page).getByRole('status', { name: /^$/ }).first()
const question = (page, record) => page.getByRole('region', { name: `Delete Order ${record}?`, exact: true })

/** The row of the Records grid whose first cell says `first`. */
const row = (page, first) => grid(page).getByRole('row').filter({ has: page.getByRole('gridcell', { name: first, exact: true }) }).first()

/**
 * The confirmation's frame -- its 1px `--invalid` border -- against the
 * glass the browser painted just outside it: 3:1 or more (WCAG 1.4.11).
 * Read from the computed border colour and the pixels, of a page that held
 * still between finding the point and the screenshot (paintedWhere, 0058).
 */
async function frame(region) {
  const at = await paintedWhere(region.page(), () =>
    region.evaluate((element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      const point = { x: box.left + box.width / 2, y: box.top - 3 }
      // What is painted there is the page around the region, in the window: a screenshot has no pixel outside it.
      const hit = document.elementFromPoint(point.x, point.y)
      return { border: style.borderTopColor, width: style.borderTopWidth, points: [point], around: hit !== null && !element.contains(hit) }
    }),
  )
  const border = parseColor(at.border)
  if (border === null || at.width === '0px') return { problem: `the region has no border the gate reads: ${at.width} ${at.border}` }
  if (!at.around) return { problem: 'the glass just above the region is not in the window, so nothing painted it there' }
  const [outside] = at.colours
  return { ratio: contrast(border.rgb, outside) }
}

/** On a phone the two answers stand one under the other, Keep it first, each the region's width; beside each other elsewhere. */
async function stacked(region) {
  return region.evaluate((element) => {
    const [keep, remove] = ['Keep it', 'Delete it'].map((name) => [...element.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)?.getBoundingClientRect())
    if (keep === undefined || remove === undefined) return { problem: 'the region has no Keep it and Delete it' }
    return { under: remove.top >= keep.bottom - 0.5, wide: Math.abs(keep.width - remove.width) < 1, phone: window.matchMedia('(max-width: 40rem)').matches }
  })
}

/** A row's Delete, reached by the arrow keys along its row, and its question under the grid. */
async function rowConfirming(page, { plane, check, run, notes }) {
  run.kept = await plane.order(0, notes)
  run.gone = await plane.order(0, notes)
  // What the record's journey left open holds a save that may have been stored: dropped first.
  await carryOn(page, records(page).getByRole('button', { name: 'New record' }))
  await records(page).getByRole('textbox', { name: 'Search' }).fill(notes)
  await records(page).getByRole('button', { name: 'Search' }).click()
  await until(async () => (await status(page).textContent()) === 'Rows 1–2.', 'the search never listed the two orders')
  // The arrow keys along the row, to its last cell: the row's Delete, a real button named for the record.
  await row(page, run.gone.slice(3)).getByRole('gridcell').first().focus()
  const name = `Delete Order ${run.gone}`
  for (let step = 0; step < 20; step += 1) {
    if (await page.evaluate((wanted) => document.activeElement?.getAttribute('aria-label') === wanted, name)) break
    await page.keyboard.press('ArrowRight')
  }
  const onIt = await page.evaluate((wanted) => document.activeElement instanceof HTMLButtonElement && document.activeElement.getAttribute('aria-label') === wanted, name)
  check("the arrow keys reach a row's Delete, a button named for its record", onIt ? null : `the focus is on ${await describeFocus(page)}`)
  // Tab from it leaves the grid in one stop, as from any cell: the button is no stop of its own.
  await page.keyboard.press('Tab')
  const left = await page.evaluate(() => document.activeElement?.closest('.grid-bench') === null)
  check("Tab from a row's Delete leaves the grid", left ? null : `the focus is still in the grid, on ${await describeFocus(page)}`)
  await row(page, run.gone.slice(3)).getByRole('button', { name, exact: true }).focus()
  await page.keyboard.press('Enter')
  await question(page, run.gone).waitFor(WITHIN)
  check("a row's Delete: the keyboard is on its confirmation", await focusedOn(page, question(page, run.gone)))
  const below = await question(page, run.gone).evaluate((region) => region.closest('section[aria-labelledby="records-heading"]') !== null)
  check("which is under the grid that asked", below ? null : 'the confirmation is not in the Records panel')
}

/** The record's Delete and its question under the header: Keep it the next Tab, the frame, the answers on a phone. */
async function recordConfirming(page, { check, run }) {
  // The gate's measure took the keyboard off the page: given back to the question first.
  await question(page, run.gone).focus()
  await page.keyboard.press('Escape')
  check("Escape gives the keyboard back to the row's Delete", await focusedOn(page, row(page, run.gone.slice(3)).getByRole('button', { name: `Delete Order ${run.gone}`, exact: true })))
  await row(page, run.kept.slice(3)).getByRole('gridcell').first().focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { level: 3, name: `Order ${run.kept}` }).waitFor(WITHIN)
  await page.getByRole('button', { name: 'Delete record', exact: true }).click()
  const region = question(page, run.kept)
  await region.waitFor(WITHIN)
  check("the record's Delete: the keyboard is on its confirmation", await focusedOn(page, region))
  await page.keyboard.press('Tab')
  check('the next Tab reaches Keep it, never the button that deletes', await focusedOn(page, region.getByRole('button', { name: 'Keep it', exact: true })))
  const ring = await frame(region)
  check("the confirmation's frame against the glass at 3:1 or more", ring.problem ?? (ring.ratio >= 3 ? null : `${String(ring.ratio)}:1`))
  const answers = await stacked(region)
  check(
    'its answers stand one under the other, Keep it first, on a phone only',
    answers.problem ?? (answers.phone ? (answers.under && answers.wide ? null : 'beside each other, or of different widths, on a phone') : answers.under ? 'one under the other where there is room' : null),
  )
}

/** Changed beside the page since it read it: the server's stale, "Not deleted". */
async function notDeleted(page, { plane, check, run, notes }) {
  await question(page, run.kept).focus()
  await page.keyboard.press('Escape')
  check('Escape gives the keyboard back to Delete record', await focusedOn(page, page.getByRole('button', { name: 'Delete record', exact: true })))
  // Changed beside the page since it read it: the server's stale.
  await plane.change(run.kept, `${notes} changed`)
  await page.getByRole('button', { name: 'Delete record', exact: true }).click()
  await question(page, run.kept).getByRole('button', { name: 'Delete it', exact: true }).click()
  const refused = page.getByRole('region', { name: 'Not deleted', exact: true })
  await refused.waitFor(WITHIN)
  check('a refused delete: the keyboard is on "Not deleted"', await focusedOn(page, refused))
}

/** Deleted beside the page first, while its row is still listed: the server's 404. */
async function cannotFind(page, { plane, check, run }) {
  await page.getByRole('region', { name: 'Not deleted', exact: true }).getByRole('button', { name: 'Load the saved record', exact: true }).click()
  await page.getByRole('region', { name: `Order ${run.kept}`, exact: true }).getByRole('status').filter({ hasText: 'Loaded record' }).waitFor(WITHIN)
  // Deleted beside the page first, while its row is still listed: the server's 404.
  await plane.remove(run.gone)
  await until(async () => (await row(page, run.gone.slice(3)).count()) === 1, 'the deleted row was no longer listed, so its Delete cannot be pressed')
  await row(page, run.gone.slice(3)).getByRole('button', { name: `Delete Order ${run.gone}`, exact: true }).click()
  await question(page, run.gone).getByRole('button', { name: 'Delete it', exact: true }).click()
  const notFound = page.getByRole('region', { name: `Cannot find Order ${run.gone}`, exact: true })
  await notFound.waitFor(WITHIN)
  check('a delete that finds nothing: the keyboard is on its notice', await focusedOn(page, notFound))
}

/** Lost on the way: "It may have been deleted". */
async function mayHaveBeenDeleted(page, { check, run }) {
  await page.getByRole('button', { name: 'Close the record', exact: true }).click()
  await until(async () => /^Closed Order /.test((await status(page).textContent()) ?? ''), 'the grid never said it closed the record')
  // Lost on the way, before it reached the server: the browser's own answer to a reset connection.
  await page.route('**/v1/forms/*/records/delete', (route) => route.abort('connectionreset'))
  try {
    await page.getByRole('button', { name: 'Delete record', exact: true }).click()
    await question(page, run.kept).getByRole('button', { name: 'Delete it', exact: true }).click()
    const unknown = page.getByRole('region', { name: 'It may have been deleted', exact: true })
    await unknown.waitFor(WITHIN)
    check('a deletion whose answer was lost: the keyboard is on its notice', await focusedOn(page, unknown))
  } finally {
    await page.unroute('**/v1/forms/*/records/delete')
  }
}

/** The check: the keyboard on the notice, and no button under it. */
async function checked(page, { check }) {
  const unknown = page.getByRole('region', { name: 'It may have been deleted', exact: true })
  await unknown.getByRole('button', { name: 'Check whether it was deleted', exact: true }).click()
  await unknown.getByRole('button', { name: 'Delete it again', exact: true }).waitFor(WITHIN)
  check('after the check, the keyboard is on the notice, and no button under it', await until(async () => (await focusedOn(page, unknown)) === null && (await page.evaluate(() => !(document.activeElement instanceof HTMLButtonElement))), 'the keyboard never came to the notice').then(() => null, (error) => String(error.message)))
}

/** Deleted: the grid says so, with the keyboard on Records. */
async function deleted(page, { plane, check, run, notes }) {
  await page.getByRole('button', { name: 'Delete it again', exact: true }).click()
  await question(page, run.kept).getByRole('button', { name: 'Delete it', exact: true }).click()
  await until(async () => (await status(page).textContent()) === `Deleted Order ${run.kept}. No records match “${notes}”.`, 'the grid never said what was deleted')
  check('after a delete, the keyboard is on the Records heading', await focusedOn(page, page.getByRole('heading', { level: 3, name: 'Records', exact: true })))
  check('and the order is gone from the database', (await plane.stored(run.kept)) ? 'the order is still stored' : null)
}

/** The states, in order; `run` holds this width's pass, and gets the orders it deletes. */
export function deleteJourney(plane, { check }, run) {
  const at = { plane, check, run, notes: `deleted at width ${String(run.customer)} ${String(Date.now())}` }
  const states = [
    ["A row's delete, confirming", rowConfirming],
    ["The record's delete, confirming", recordConfirming],
    ['Not deleted', notDeleted],
    ['Cannot find it', cannotFind],
    ['It may have been deleted', mayHaveBeenDeleted],
    ['It may have been deleted, checked', checked],
    ['Deleted', deleted],
  ]
  return states.map(([state, act]) => [state, (page) => act(page, at)])
}
