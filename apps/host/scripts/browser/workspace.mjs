// The workspace's states in the browser (0047): signed in, a form's records in
// each layout, a row open with its lines, a line open, the unsaved-changes
// notice and a refused list -- each measured by the gate's `measured` on the
// way -- and what only a real browser shows about the grids: one Tab stop
// each, End reaching the last column, the focused cell's teal border and the
// open row's bar against the row, the columns fitted again when the
// separator is let go, and no host rule reaching into a grid.

import { FORM, TOKENS } from './plane.mjs'
import { contrast, describeFocus, focusedOn, paintedWhere, parseColor, until, WITHIN } from './measure.mjs'
import { rulesReaching } from './styles.mjs'

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page, name) => page.getByRole('grid', { name, exact: true })
const status = (region) => region.getByRole('status').first()

/** Wait until the grid in `region` has answered with rows. */
async function answered(region, pattern) {
  await until(async () => pattern.test((await status(region).textContent()) ?? ''), `the grid never said ${String(pattern)}`)
}

/**
 * Press `button`, and Discard and continue if the page asks first. The guard
 * sets the notice in the click handler, and how soon a browser acknowledges
 * a synthetic click relative to React's commit is measured in none of them:
 * so the notice is read only after two animation frames past the click,
 * by when the click's render has been painted, rather than at once.
 */
export async function carryOn(page, button) {
  await button.click()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const notice = page.getByRole('region', { name: 'Unsaved changes', exact: true })
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: 'Discard and continue' }).click()
}

/** The row of `name`'s grid whose first cell says `first`. */
const row = (page, name, first) => grid(page, name).getByRole('row').filter({ has: page.getByRole('gridcell', { name: first, exact: true }) }).first()

/**
 * The focused cell's 1px border against what the browser painted inside the
 * cell, which is the row's background with its hover or selection: 3:1 or
 * more (WCAG 1.4.11). Read from the computed border colour and the pixels.
 */
async function focusRing(page) {
  const at = await paintedWhere(page, () =>
    page.evaluate(() => {
      const cell = document.activeElement
      if (cell?.getAttribute('role') !== 'gridcell') return null
      const style = getComputedStyle(cell)
      const box = cell.getBoundingClientRect()
      return { border: style.borderTopColor, width: style.borderTopWidth, points: [{ x: box.right - 4, y: box.top + 4 }] }
    }),
  )
  if (at === null) return { problem: `the focus is on ${await describeFocus(page)}, not a cell` }
  const border = parseColor(at.border)
  if (border === null || at.width === '0px') return { problem: `the focused cell has no border the gate reads: ${at.width} ${at.border}` }
  const [inside] = at.colours
  return { ratio: contrast(border.rgb, inside) }
}

/** The open row's bar -- the rect in the first cell's SVG, at its centre -- against the tint around it, as painted. */
async function bar(page) {
  const at = await paintedWhere(page, () =>
    page.evaluate(() => {
      const open = [...document.querySelectorAll('[role="row"][aria-selected="true"]')].find((candidate) => candidate.closest('.grid-bench') !== null)
      const cell = open?.querySelector('[role="gridcell"]')
      const rect = cell?.querySelector('svg rect')
      if (cell === undefined || cell === null || rect === null || rect === undefined) return null
      const mark = rect.getBoundingClientRect()
      const box = cell.getBoundingClientRect()
      return { points: [{ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, { x: box.left + 4, y: box.top + 4 }] }
    }),
  )
  if (at === null) return { problem: 'no open row with its bar is drawn' }
  const [mark, tint] = at.colours
  return { ratio: contrast(mark, tint) }
}

/** The states, in order; `run` holds this width's record and its token. */
export function workspaceJourney(plane, { check }, run) {
  return [
    ['Signed in, no form', async (page) => {
      await page.getByLabel('Host token').fill(TOKENS.clerk)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByRole('heading', { level: 2, name: 'No form open' }).waitFor(WITHIN)
      check('signed in: the keyboard is on Forms', await focusedOn(page, page.getByRole('heading', { name: 'Forms', exact: true })))
    }],
    ['Records, side by side', async (page) => {
      await page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Order ${FORM}` }).click()
      await answered(records(page), /^Rows 1–/)
      check('a form chosen: the keyboard is on its heading', await focusedOn(page, page.getByRole('heading', { level: 2, name: `Order ${FORM}` })))
      // Shift and an arrow on a header is AG Grid's way to move a column. It
      // moves by where the header is drawn, which jsdom does not lay out, so
      // only here does a movable column show (0047): the columns stay the
      // form's order.
      const headers = async () => (await grid(page, 'Records').getByRole('columnheader').allTextContents()).map((text) => text.trim())
      const order = await headers()
      await grid(page, 'Records').getByRole('gridcell').nth(1).focus()
      await page.keyboard.press('ArrowUp')
      const onHeader = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'columnheader')
      await page.keyboard.press('Shift+ArrowRight')
      const moved = await headers()
      check('Shift and an arrow on a header moves no column', !onHeader ? `the keyboard is on ${await describeFocus(page)}, not a header` : moved.join('|') === order.join('|') ? null : `${order.join(', ')} became ${moved.join(', ')}`)
      // AG Grid scrolls the header into view even when it does not move it:
      // Home on the row below scrolls the grid back to its first column,
      // where the open row's bar is measured later.
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Home')
      // A phone arrives in Separate views (UX-SPEC D14); the journey starts side by side, which a narrow window draws stacked.
      await page.getByRole('radio', { name: 'Side by side', exact: true }).check()
      // Where the separator is drawn, a pointer moves it, within its limits, and the share is kept for the viewer.
      const split = page.getByRole('separator', { name: 'Records' })
      if (await split.isVisible()) {
        const before = Number(await split.getAttribute('aria-valuenow'))
        const box = await split.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + 40)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 - 120, box.y + 40, { steps: 6 })
        await page.mouse.up()
        const after = Number(await split.getAttribute('aria-valuenow'))
        const kept = await page.evaluate(() => window.localStorage.getItem('formancy-data-host.split'))
        const min = Number(await split.getAttribute('aria-valuemin'))
        check('dragging the separator moves it, within its limits, and keeps it', after < before && after >= min && kept === String(after) ? null : `from ${String(before)} to ${String(after)}, at least ${String(min)}, kept ${String(kept)}`)
        await split.focus()
        await page.keyboard.press('End')
        await page.keyboard.press('Home')
        await page.keyboard.press('ArrowRight')

        // Letting go of the separator fits the grids' columns again, to the
        // rows shown then (the person's decision of 2026-10-10). Sized to the
        // first page, a column a search filled with a longer value is cut
        // until the separator is let go, and whole after: the run's order is
        // given a group wider than its column, beside the page, found by a
        // search, then put back. A layout measure, so the browser's.
        const wide = `refit ${String(run.customer)} northern loading bay`
        await plane.setGroup(run.record, wide)
        const search = records(page).getByRole('textbox', { name: 'Search' })
        await search.fill(wide)
        await records(page).getByRole('button', { name: 'Search' }).click()
        await answered(records(page), /^Rows 1–1\.$/)
        const cell = grid(page, 'Records').getByRole('gridcell', { name: wide, exact: true })
        const cut = () => cell.evaluate((element) => element.scrollWidth > element.clientWidth)
        const cutBefore = await cut()
        await split.focus()
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowRight')
        const cutAfter = await until(async () => !(await cut()), 'the cell stayed cut').then(
          () => false,
          () => true,
        )
        check('letting go of the separator fits the columns to the rows shown', cutBefore && !cutAfter ? null : `the searched row's group was ${cutBefore ? '' : 'not '}cut before and ${cutAfter ? '' : 'not '}after`)
        await plane.setGroup(run.record, null)
        await search.fill('')
        await records(page).getByRole('button', { name: 'Search' }).click()
        await until(async () => /^Rows 1–(?!1\.)/.test((await status(records(page)).textContent()) ?? ''), 'the cleared search never listed every record')
      }
    }],
    ['A row open with its lines, side by side', async (page) => {
      const opened = row(page, 'Records', run.record.slice(3))
      await opened.getByRole('gridcell').first().focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { level: 3, name: `Order ${run.record}` }).waitFor(WITHIN)
      check('Enter on a row: the keyboard is on the record', await focusedOn(page, page.getByRole('heading', { level: 3, name: `Order ${run.record}` })))
      // Both renderers from here on: the gate walks with Both, so 0029's promise is measured in each.
      await page.getByRole('radio', { name: 'Both', exact: true }).check()
      await answered(page.getByRole('region', { name: 'Order line', exact: true }), /^Order line rows 1–2\./)
      for (const name of ['React', 'Angular']) await page.getByRole('region', { name, exact: true }).getByRole('combobox', { name: 'Customer' }).waitFor(WITHIN)

      // One Tab stop: from Next rows into the grid, on the open row, then out to the separator.
      const next = records(page).getByRole('button', { name: 'Next rows' })
      await next.focus()
      await page.keyboard.press('Tab')
      const into = await page.evaluate(() => document.activeElement?.getAttribute('role'))
      check('Tab into the grid lands on the open row', into === 'gridcell' && (await opened.evaluate((element) => element.contains(document.activeElement))) ? null : `the focus is on ${await describeFocus(page)}`)
      const onOpen = await focusRing(page)
      check('the focused cell on the open row: its teal border at 3:1 or more', onOpen.problem ?? (onOpen.ratio >= 3 ? null : `${String(onOpen.ratio)}:1`))
      const mark = await bar(page)
      check("the open row's bar against its tint at 3:1 or more", mark.problem ?? (mark.ratio >= 3 ? null : `${String(mark.ratio)}:1`))
      await page.keyboard.press('ArrowDown')
      const plain = await focusRing(page)
      check('the focused cell on another row: its teal border at 3:1 or more', plain.problem ?? (plain.ratio >= 3 ? null : `${String(plain.ratio)}:1`))
      // End: the last row's last cell, in view inside the grid's own scroller
      // -- the row's Delete, whose button the cell hands the keyboard to
      // (0053), so the cell is the one that holds the focus.
      await page.keyboard.press('End')
      const last = await page.evaluate(() => {
        const cell = document.activeElement?.closest('[role="gridcell"]')
        const scroller = cell?.closest('[role="grid"]')
        if (cell === null || cell === undefined || scroller === null || scroller === undefined) return { problem: 'the focus left the grid' }
        const row = cell.closest('[role="row"]')
        const cells = [...(row?.querySelectorAll('[role="gridcell"]') ?? [])]
        const box = cell.getBoundingClientRect()
        const well = cell.closest('.grid-bench').getBoundingClientRect()
        return { last: cells.at(-1) === cell, visible: box.right <= well.right + 0.5 && box.left >= well.left - 0.5 }
      })
      check('End reaches the last column, in view', last.problem ?? (last.last && last.visible ? null : `last column: ${String(last.last)}, in view: ${String(last.visible)}`))
      await page.keyboard.press('Tab')
      // The next stop after the grid's well in the page's order: the separator where it is drawn, the detail's first control where it is not.
      const out = await page.evaluate(() => {
        const well = document.activeElement?.closest('.grid-bench')
        if (well !== null && well !== undefined) return 'the focus is still in the grid'
        const tabbable = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0 && element.closest('.grid-bench') === null)
        const records = document.querySelector('[role="grid"]').closest('.grid-bench')
        const next = tabbable.find((element) => records.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
        return next === document.activeElement ? null : 'the focus skipped the next control after the grid'
      })
      check('Tab leaves the grid in one stop', out === null ? null : `${out}: it is on ${await describeFocus(page)}`)
      for (const which of ['Records', 'Order line']) {
        const found = await rulesReaching(grid(page, which).locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " grid-bench ")][1]'))
        check(`the ${which} grid: no rule of host.css selects anything in it`, found.reached.length === 0 ? null : found.reached.slice(0, 6).join('; '))
        check(`which matched host.css against the whole ${which} grid`, found.rules > 0 && found.tags.includes('div') ? null : `${String(found.rules)} rules`)
      }
    }],
    ['A line open', async (page) => {
      const lines = page.getByRole('region', { name: 'Order line', exact: true })
      await lines.getByRole('grid', { name: 'Order line' }).getByRole('gridcell').first().click()
      for (const name of ['React', 'Angular']) await page.getByRole('region', { name: `Order line ${run.record},1 ${name}`, exact: true }).getByLabel(/^Quantity/).waitFor(WITHIN)
    }],
    ['Unsaved changes', async (page) => {
      await page.getByRole('region', { name: `Order line ${run.record},1 React`, exact: true }).getByLabel(/^Quantity/).fill('7')
      await records(page).getByRole('button', { name: 'New record' }).click()
      const notice = page.getByRole('region', { name: 'Unsaved changes', exact: true })
      await notice.waitFor(WITHIN)
      check('the unsaved notice takes the keyboard', await focusedOn(page, notice))
    }],
    ['Stacked, the record kept', async (page) => {
      const notice = page.getByRole('region', { name: 'Unsaved changes', exact: true })
      await notice.getByRole('button', { name: 'Keep editing' }).click()
      check('Keep editing gives the keyboard back to New record', await focusedOn(page, records(page).getByRole('button', { name: 'New record' })))
      await page.getByRole('radio', { name: 'Stacked', exact: true }).check()
    }],
    ['Separate views, the record', async (page) => {
      await page.getByRole('radio', { name: 'Separate views', exact: true }).check()
      check('a layout change leaves the keyboard on its radio', await focusedOn(page, page.getByRole('radio', { name: 'Separate views', exact: true })))
      await row(page, 'Records', run.record.slice(3)).getByRole('gridcell').first().focus()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Back to the records' }).waitFor(WITHIN)
    }],
    ['Separate views, the records', async (page) => {
      await page.getByRole('button', { name: 'Back to the records' }).click()
      await until(async () => (await row(page, 'Records', run.record.slice(3)).evaluate((element) => element.contains(document.activeElement))) === true, 'Back to the records did not put the keyboard on the row')
    }],
    ['A refused list', async (page) => {
      // The next list answered by the real server with its database out of reach.
      let refusing = true
      await page.route('**/v1/forms/*/records/list', async (route) => {
        if (refusing) plane.refuseNext()
        refusing = false
        await route.continue()
      })
      await page.getByRole('radio', { name: 'Side by side', exact: true }).check()
      await records(page).getByRole('textbox', { name: 'Search' }).fill('placed')
      await records(page).getByRole('button', { name: 'Search' }).click()
      await answered(records(page), /^The database cannot be reached/)
      await page.unroute('**/v1/forms/*/records/list')
      const words = (await records(page).textContent()) ?? ''
      check("a refused list says none of AG Grid's own words", /Row data is loading|ERR|No Rows To Show|Loading\.\.\./.test(words) ? `the panel says: ${words.slice(0, 120)}` : null)
      await records(page).getByRole('button', { name: 'Ask again' }).waitFor(WITHIN)
    }],
    ['Asked again', async (page) => {
      await records(page).getByRole('button', { name: 'Ask again' }).click()
      await answered(records(page), /^Rows 1–/)
      await carryOn(page, records(page).getByRole('button', { name: 'New record' }))
      await page.getByRole('heading', { level: 3, name: 'New record' }).waitFor(WITHIN)
    }],
  ]
}
