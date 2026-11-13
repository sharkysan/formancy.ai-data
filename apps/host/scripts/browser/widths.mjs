// A column's width in the browser (0151), on the workspace Drill down's
// states left: Side by side, every record, the panels closed. A pointer's
// drag on the Records grid's first header's edge widens its column by as
// much as the pointer moved, and a reload -- signed in again, the form the
// address names -- opens it at that width; dragged far to the left it stops
// at its floor, where every word of its header is whole; Wider pressed in
// Columns from the keyboard makes it wider than a phone's window, the line
// saying how wide, and Fit gives it back to its content, the line saying so,
// before the panel is closed again for the states after. Each state is
// measured by the gate's `measured` on the way, at every width: with a
// column wider than the window, nothing passes either edge at 320 px, the
// grid's own scroller taking it.
//
// Two reads the accessibility tree cannot answer, made where they are: a
// header's width, its box, which no role or name carries; and whether its
// label's words are whole, the label's own scroll width against its box --
// AG Grid's `.ag-header-cell-text`, which has neither. The drag itself is
// the pointer's on the header's right edge, where AG Grid draws its resize
// handle, a box found by the header's accessible name.
//
// What jsdom holds instead: the panel's presses and sentences without a
// server (src/column-widths.test.tsx), Alt and an arrow and the widths AG
// Grid draws and tells (src/grid-widths.test.tsx), and the width kept
// through a new page, the separator and a reload against the real server
// (src/grid-keys.test.tsx).

import { policyRefused } from '../../../../scripts/browser-gate.mjs'
import { TOKENS } from './plane.mjs'
import { focusedOn, until } from './measure.mjs'

/** What a press of Wider moves a column by, said again: widths.ts's `WIDTH_STEP`, which the gate cannot import from TypeScript. */
const STEP = 40
/** Wider than every window the gate measures at a phone's width: what the panel makes the column. */
const WIDE = 480

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

/** Null when `got` is within a pixel of `want`, otherwise both. */
const near = (got, want) => (Math.abs(got - want) <= 1 ? null : `it is ${String(got)} px wide, not ${String(want)}`)

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

/** The states, in order. */
export function widthsJourney(_plane, { check }) {
  /** The column the states resize, its width at its content, and the width each state leaves: read as they go. */
  const at = { label: '', content: 0, dragged: 0 }
  return [
    [
      'A column widened by its header’s edge (Records)',
      async (page) => {
        at.label = ((await grid(page).getByRole('columnheader').first().textContent()) ?? '').trim()
        await header(page, at.label).scrollIntoViewIfNeeded()
        at.content = await widthOf(page, at.label)
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
        check('a reload: the column opens at the width its edge was dragged to', near(await widthOf(page, at.label), at.dragged))
      },
    ],
    [
      'A column dragged to its floor (Records)',
      async (page) => {
        // Past its floor, and no further left than the window: the pointer stops four pixels in.
        const box = await header(page, at.label).boundingBox()
        await dragEdge(page, at.label, -Math.max(0, Math.floor((box?.x ?? 0) + (box?.width ?? 0) - 6)))
        await until(async () => (await widthOf(page, at.label)) < at.dragged, 'the column never narrowed').catch(() => null)
        const floor = await widthOf(page, at.label)
        check('a header’s edge dragged far: its column stops at a floor', floor > 0 && floor < at.dragged ? null : `it is ${String(floor)} px wide`)
        const cut = await header(page, at.label).evaluate((element) => {
          const text = element.querySelector('.ag-header-cell-text')
          return text === null
            ? 'no label is drawn'
            : text.scrollWidth > text.clientWidth + 0.5
              ? `its label needs ${String(text.scrollWidth)} px of ${String(text.clientWidth)}`
              : null
        })
        check('at its floor: every word of its header is whole', cut)
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
        const fitted = await widthOf(page, at.label)
        check('Fit pressed: the column is back at its content’s width', near(fitted, at.content))
        check('Fit pressed: the panel says so', (await said(page)) === `${at.label} is sized to its content.` ? null : `it says "${await said(page)}"`)
        check('Fit pressed: the keyboard stays on it', await focusedOn(page, fit))
        // Closed again, as the journeys after this one found the panel.
        await toggle(page).focus()
        await page.keyboard.press('Enter')
      },
    ],
  ]
}
