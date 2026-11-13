// A column's width in the browser (0151), on the workspace Drill down's
// states left: Side by side, every record, the panels closed. A click and a
// double click on the Records grid's first header's edge keep nothing; a
// pointer's drag on it widens the column by as much as the pointer moved,
// and a reload -- signed in again, the form the address names -- opens it at
// that width once the first page is sized; a header of several words
// dragged far to the left stops at its floor, where every word of it is
// drawn whole on one line; Wider pressed in Columns from the keyboard makes
// the first column wider than a phone's window, the line saying how wide,
// and Fit gives it back to its content, the line saying so; and Fit on a
// column nobody set, which a search filled with a value longer than any it
// was sized to, sizes it to that value -- before Reset columns gives every
// width back for the states after. Each state is measured by the gate's
// `measured` on the way, at every width: with a column wider than the
// window, nothing passes either edge at 320 px, the grid's own scroller
// taking it.
//
// Reads the accessibility tree cannot answer, made where they are: a
// header's width, its box, which no role or name carries; where each word
// of a header's label is drawn, a Range over the word in AG Grid's
// `.ag-header-cell-text`, which has neither; whether a cell's value is cut,
// its scroll width against its box; and what the browser kept, read from
// `localStorage` under the key the page writes (src/prefs.ts's `gridKey`).
// The drag itself is the pointer's on the header's right edge, where AG
// Grid draws its resize handle, a box found by the header's accessible
// name.
//
// What jsdom holds instead: the panel's presses and sentences without a
// server (src/column-widths.test.tsx), Alt and an arrow, a click on an edge
// and the widths AG Grid draws and tells (src/grid-widths.test.tsx), and the
// width kept through a new page, the separator and a reload against the
// real server (src/grid-keys.test.tsx).

import { policyRefused } from '../../../../scripts/browser-gate.mjs'
import { FORM, TOKENS } from './plane.mjs'
import { focusedOn, until } from './measure.mjs'

/** What a press of Wider moves a column by, said again: widths.ts's `WIDTH_STEP`, which the gate cannot import from TypeScript. */
const STEP = 40
/** Wider than every window the gate measures at a phone's width: what the panel makes the column. */
const WIDE = 480
/** The key the page keeps the Records grid of the form under: src/prefs.ts's `gridKey`, said again for the same reason. */
const KEPT = `formancy-data-host.grid.records.${FORM}`

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page) => page.getByRole('grid', { name: 'Records', exact: true })
const toggle = (page) => records(page).getByRole('button', { name: 'Columns', exact: true })
const list = (page) => records(page).getByRole('list', { name: 'Columns', exact: true })
const said = async (page) => (await records(page).getByRole('status', { name: 'Columns', exact: true }).textContent()) ?? ''
/** The grid's own line: the section's first status with no name. */
const lineOf = async (page) => (await records(page).getByRole('status', { name: /^$/ }).first().textContent()) ?? ''

const escaped = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The header of the column `label`, by the name it starts with: its sort's words follow. */
const header = (page, label) =>
  grid(page)
    .getByRole('columnheader', { name: new RegExp(`^${escaped(label)}`) })
    .first()
/** A header's width as the browser lays it out: a DOM read, said above. */
const widthOf = async (page, label) => Math.round((await header(page, label).boundingBox())?.width ?? 0)
/** The grid's headers' labels, in the order drawn. */
const labels = async (page) => (await grid(page).getByRole('columnheader').allTextContents()).map((text) => text.trim()).filter((text) => text !== '')
/** The widths the browser kept for the form's Records grid: a storage read, said above. */
const keptWidths = (page) =>
  page.evaluate((key) => {
    const text = localStorage.getItem(key)
    return text === null ? [] : (JSON.parse(text).widths ?? [])
  }, KEPT)

/** Null when `got` is within a pixel of `want`, otherwise both. */
const near = (got, want) => (Math.abs(got - want) <= 1 ? null : `it is ${String(got)} px wide, not ${String(want)}`)

/** `label`'s header's width once the grid's sizing has drawn it: the same for a third of a second, as src/test-columns.ts's `steadyWidth`. */
async function steadyWidth(page, label) {
  let last = Number.NaN
  let since = Date.now()
  await until(async () => {
    const now = await widthOf(page, label)
    if (now !== last) {
      last = now
      since = Date.now()
    }
    return Date.now() - since >= 300
  }, `the header ${label} never kept one width`)
  return last
}

/** Drag the right edge of `label`'s header by `by` pixels, as a pointer does, in steps. */
async function dragEdge(page, label, by) {
  const box = await header(page, label).boundingBox()
  if (box === null) throw new Error(`the header ${label} is drawn nowhere`)
  const x = box.x + box.width - 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + by, y, { steps: 8 })
  await page.mouse.up()
}

/** The states, in order; `run` holds this width's record and customer. */
export function widthsJourney(plane, { check }, run) {
  /** The column the states resize, its width at its content, and the width each state leaves: read as they go. */
  const at = { label: '', content: 0, dragged: 0 }
  return [
    [
      'A click on a header’s edge (Records)',
      async (page) => {
        at.label = (await labels(page))[0] ?? ''
        await header(page, at.label).scrollIntoViewIfNeeded()
        at.content = await steadyWidth(page, at.label)
        const box = await header(page, at.label).boundingBox()
        const edge = { x: (box?.x ?? 0) + (box?.width ?? 0) - 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
        await page.mouse.click(edge.x, edge.y)
        await page.mouse.dblclick(edge.x, edge.y)
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
        check('a click and a double click on a header’s edge: the column keeps its width', near(await widthOf(page, at.label), at.content))
        const kept = await keptWidths(page)
        check('a click and a double click on a header’s edge: no width is kept', kept.length === 0 ? null : `kept: ${JSON.stringify(kept)}`)
      },
    ],
    [
      'A column widened by its header’s edge (Records)',
      async (page) => {
        const box = await header(page, at.label).boundingBox()
        // As far as the window lets the pointer go, and no more than a column's few words.
        const by = Math.max(24, Math.min(160, Math.floor(page.viewportSize().width - (box?.x ?? 0) - (box?.width ?? 0) - 8)))
        await dragEdge(page, at.label, by)
        await until(async () => (await widthOf(page, at.label)) > at.content, 'the column never widened').catch(() => null)
        at.dragged = await widthOf(page, at.label)
        check('a header’s edge dragged: its column is as much wider as the pointer moved', near(at.dragged, at.content + by))
      },
    ],
    [
      'A column’s width kept over a reload (Records)',
      async (page) => {
        // What the window was refused before it goes: the next one has heard nothing (0083).
        check('before the reload: the browser refused nothing under the page’s policy', await policyRefused(page))
        await page.reload({ waitUntil: 'load' })
        await page.getByLabel('Host token').fill(TOKENS.clerk)
        await page.getByRole('button', { name: 'Sign in' }).click()
        // Signed in again, the page opens the form its address names, in the layout it names.
        await until(async () => /^Rows 1–/.test(await lineOf(page)), 'the orders were never listed after the reload')
        await header(page, at.label).scrollIntoViewIfNeeded()
        check('a reload: the column opens at the width its edge was dragged to', near(await steadyWidth(page, at.label), at.dragged))
      },
    ],
    [
      'A header of several words dragged to its floor (Records)',
      async (page) => {
        // The header of several words with the longest word: the floor is its longest word.
        const several = (await labels(page)).filter((label) => label.split(/\s+/).length > 1)
        const longest = (label) => Math.max(...label.split(/\s+/).map((word) => word.length))
        const label = several.sort((a, b) => longest(b) - longest(a))[0]
        check('the grid has a header of several words to drag', label === undefined ? 'none of its headers has two words' : null)
        if (label === undefined) return
        await header(page, label).scrollIntoViewIfNeeded()
        const before = await steadyWidth(page, label)
        // Past its floor, and no further left than the window: the pointer stops four pixels in.
        const box = await header(page, label).boundingBox()
        await dragEdge(page, label, -Math.max(0, Math.floor((box?.x ?? 0) + (box?.width ?? 0) - 6)))
        await until(async () => (await widthOf(page, label)) < before, 'the column never narrowed').catch(() => null)
        const floor = await widthOf(page, label)
        check(
          'a header’s edge dragged far: its column stops at a floor',
          floor > 0 && floor < before ? null : `it is ${String(floor)} px wide, from ${String(before)}`,
        )
        const broken = await header(page, label).evaluate((element) => {
          const text = element.querySelector('.ag-header-cell-text')
          const node = text?.firstChild
          if (text === null || node?.nodeType !== Node.TEXT_NODE) return ['no label is drawn']
          const box = text.getBoundingClientRect()
          const words = [...node.textContent.matchAll(/\S+/g)]
          return words.flatMap((match) => {
            const range = document.createRange()
            range.setStart(node, match.index)
            range.setEnd(node, match.index + match[0].length)
            const rects = [...range.getClientRects()]
            const whole = rects.length === 1 && rects[0].left >= box.left - 0.5 && rects[0].right <= box.right + 0.5
            return whole
              ? []
              : [
                  `"${match[0]}" is drawn in ${String(rects.length)} pieces, to ${String(Math.round(rects.at(-1)?.right ?? 0))} of ${String(Math.round(box.right))}`,
                ]
          })
        })
        check('at its floor: every word of its header is drawn whole on one line', broken.length === 0 ? null : broken.join('; '))
      },
    ],
    [
      'A column made wider from the keyboard (Records)',
      async (page) => {
        await toggle(page).focus()
        await page.keyboard.press('Enter')
        const wider = list(page).getByRole('button', { name: `Make ${at.label} wider`, exact: true })
        await wider.focus()
        const from = await widthOf(page, at.label)
        const presses = Math.ceil((WIDE - from) / STEP)
        for (let press = 0; press < presses; press += 1) await page.keyboard.press('Enter')
        const want = from + presses * STEP
        await until(async () => (await widthOf(page, at.label)) >= want - 1, 'the column never grew to what was pressed for').catch(() => null)
        check('Wider pressed: the column grows a step each press', near(await widthOf(page, at.label), want))
        check(
          'Wider pressed: the panel says how wide',
          (await said(page)) === `${at.label} is ${String(want)} pixels wide.` ? null : `it says "${await said(page)}"`,
        )
        check('Wider pressed: the keyboard stays on it', await focusedOn(page, wider))
      },
    ],
    [
      'A column fitted to its content again (Records)',
      async (page) => {
        const fit = list(page).getByRole('button', { name: `Fit ${at.label} to its content`, exact: true })
        const wide = await widthOf(page, at.label)
        await fit.focus()
        await page.keyboard.press('Enter')
        await until(async () => (await widthOf(page, at.label)) < wide, 'the column was never fitted').catch(() => null)
        check('Fit pressed: the column is back at its content’s width', near(await steadyWidth(page, at.label), at.content))
        check('Fit pressed: the panel says so', (await said(page)) === `${at.label} is sized to its content.` ? null : `it says "${await said(page)}"`)
        check('Fit pressed: the keyboard stays on it', await focusedOn(page, fit))
      },
    ],
    [
      'A column nobody set fitted to a longer value (Records)',
      async (page) => {
        // Longer than any group the column was sized to by the reload's first page: a search lists it, and sizes nothing.
        const long = `fitted ${String(run.customer)} far southern loading bay`
        await plane.setGroup(run.record, long)
        await records(page).getByRole('textbox', { name: 'Search' }).fill(long)
        await records(page).getByRole('button', { name: 'Search', exact: true }).click()
        await until(async () => /^Rows 1–1\.$/.test(await lineOf(page)), `the grid never listed "${long}"`)
        const cell = grid(page).getByRole('gridcell', { name: long, exact: true })
        const cut = () => cell.evaluate((element) => element.scrollWidth > element.clientWidth)
        check('a column nobody set: a longer value a search lists is cut before Fit', (await cut()) ? null : 'it is whole already')
        const fit = list(page).getByRole('button', { name: 'Fit Group to its content', exact: true })
        await fit.focus()
        await page.keyboard.press('Enter')
        const whole = await until(async () => !(await cut()), 'the cell stayed cut').then(
          () => null,
          () => 'its value is cut',
        )
        check('Fit on a column nobody set: sized to the rows shown, its value whole', whole)
        await plane.setGroup(run.record, null)
        await records(page).getByRole('textbox', { name: 'Search' }).fill('')
        await records(page).getByRole('button', { name: 'Search', exact: true }).click()
        await until(async () => /^Rows 1–(?!1\.)/.test(await lineOf(page)), 'the grid never listed every record again')
        // Every width given back, and the panel closed again, as the journeys after this one found the grid.
        await records(page).getByRole('button', { name: 'Reset columns', exact: true }).click()
        await toggle(page).focus()
        await page.keyboard.press('Enter')
      },
    ],
  ]
}
