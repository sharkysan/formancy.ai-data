// Stacked's line in the browser (0145): where a window arrives with nothing
// kept, the line drawn across between the records and the record, moved by
// its keys and a pointer, its focus ring drawn over the glass around it,
// and the Records panel as tall as it says of the window's height; and in a
// window too short for the line to move -- a phone on its side -- no line,
// and the Records panel as tall as what it holds. Layout measures, so the
// browser's.

import { FORM, TOKENS } from './plane.mjs'
import { contrast, focusedOn, paintedWhere, parseColor, until, WITHIN } from './measure.mjs'

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
/** The grid's line: the region's first status with no name -- Download CSV's, before it, is named by its button (0080). */
const status = (region) => region.getByRole('status', { name: /^$/ }).first()

/** A phone on its side: wider than 40rem, so it arrives in Stacked, and shorter than the 30.5rem or so Stacked's line needs to move. */
export const SHORT = { label: 'a short window, 844x390', width: 844, height: 390 }

/** The order form chosen under Forms, its grid answered, and the keyboard on its heading. */
async function chooseOrders(page, check) {
  await page
    .getByRole('navigation', { name: 'Forms' })
    .getByRole('link', { name: `Order ${FORM}`, exact: true })
    .click()
  await until(async () => /^Rows 1–/.test((await status(records(page)).textContent()) ?? ''), 'the grid never listed the orders')
  check('a form chosen: the keyboard is on its heading', await focusedOn(page, page.getByRole('heading', { level: 2, name: `Order ${FORM}` })))
}

/**
 * Tab away from `line` and Shift+Tab back: the keyboard moved onto it as a
 * person moves it. A focus moved by script after a pointer's click matches
 * no :focus-visible in Firefox, whatever key follows, where Chromium's
 * matches once a key is pressed: measured on 2026-11-06 in Playwright
 * 1.63.0's Chromium and Firefox on a page of the host's built stylesheet,
 * the first reason the ring checks failed in Firefox on CI. The page never
 * moves the keyboard onto a line by script.
 */
export async function tabbedOnto(page) {
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
}

/**
 * The focus ring of `line`, which has the keyboard, as the browser painted
 * it on the side the record is -- below a line drawn across, right of one
 * drawn down -- where the record's glass is drawn after the line in the
 * document: its colour against the outline's, 1:1 where the ring lies on top
 * of the glass. Read one pixel inside the ring's band, past its offset, in
 * the middle of what the window shows of the line. A line that draws no
 * ring at all is said so, not read: Firefox gives an outline's width though
 * its style is none.
 */
export async function ringPainted(page, line) {
  const at = await paintedWhere(page, () =>
    line.evaluate((element) => {
      if (element !== document.activeElement) return null
      const style = getComputedStyle(element)
      if (!element.matches(':focus-visible') || style.outlineStyle === 'none') return { points: [], none: true }
      const reach = Number.parseFloat(style.outlineOffset) || 0
      const box = element.getBoundingClientRect()
      const middle = (from, to, end) => (Math.max(from, 0) + Math.min(to, end)) / 2
      const point =
        element.getAttribute('aria-orientation') === 'horizontal'
          ? { x: middle(box.left, box.right, window.innerWidth), y: Math.ceil(box.bottom + reach) }
          : { x: Math.ceil(box.right + reach), y: middle(box.top, box.bottom, window.innerHeight) }
      return { ring: style.outlineColor, width: style.outlineWidth, points: [point] }
    }),
  )
  if (at === null) return { problem: 'the line does not have the keyboard' }
  if (at.none === true) return { problem: 'the line has the keyboard and draws no focus ring' }
  const ring = parseColor(at.ring)
  if (ring === null || at.width === '0px') return { problem: `the line draws no focus ring the gate reads: ${at.width} ${at.ring}` }
  return { ratio: contrast(ring.rgb, at.colours[0]) }
}

/** The state where a window arrives, the order form chosen, and Stacked's line moved; `check` is the gate's. */
export function stackedState({ check }) {
  return [
    // Where a window arrives with nothing kept: Stacked, and on a phone
    // Separate views (UX-SPEC D14), whose pass then chooses Stacked. Its
    // line, at every width the gate measures, 320 pixels among them: drawn
    // across, moved a step by Down and to its limits by Home and End with
    // the keyboard staying on it, its ring over the record's glass, the
    // Records panel as tall as it says of the window's height, dragged by a
    // pointer within its limits, and kept for the viewer.
    'Records, stacked',
    async (page) => {
      await chooseOrders(page, check)
      const arrived = (await page.evaluate(() => window.matchMedia('(max-width: 40rem)').matches)) ? 'Separate views' : 'Stacked'
      check(
        'arriving with no layout kept: Stacked, or Separate views on a phone',
        (await page.getByRole('radio', { name: arrived, exact: true }).isChecked()) ? null : `${arrived} is not checked`,
      )
      await page.getByRole('radio', { name: 'Stacked', exact: true }).check()
      const line = page.getByRole('separator', { name: 'Records' })
      const at = async () => ({
        now: Number(await line.getAttribute('aria-valuenow')),
        min: Number(await line.getAttribute('aria-valuemin')),
        max: Number(await line.getAttribute('aria-valuemax')),
      })
      const across = await line.getAttribute('aria-orientation')
      check(
        'Stacked: its line is drawn across',
        (await line.isVisible()) && across === 'horizontal' ? null : `drawn: ${String(await line.isVisible())}, ${String(across)}`,
      )
      await line.focus()
      const before = await at()
      await page.keyboard.press('ArrowDown')
      const down = await at()
      await page.keyboard.press('Home')
      const home = await at()
      await page.keyboard.press('End')
      const end = await at()
      check(
        'Stacked: Down moves its line a step, Home and End to its limits, the keyboard staying on it',
        down.now === Math.min(before.now + 5, before.max) && home.now === home.min && end.now === end.max && home.min < end.max
          ? await focusedOn(page, line)
          : JSON.stringify({ before, down, home, end }),
      )
      const tall = await records(page).evaluate(
        (panel, share) => ({ height: panel.getBoundingClientRect().height, wanted: (share / 100) * document.documentElement.clientHeight }),
        end.now,
      )
      check(
        'Stacked: the Records panel is as tall as its line says of the window',
        Math.abs(tall.height - tall.wanted) <= 1 ? null : `${String(Math.round(tall.height))} px, not ${String(Math.round(tall.wanted))}`,
      )
      // Where the window shows it, its ring over the glass below, the keyboard brought onto it by Tab.
      await tabbedOnto(page)
      await line.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const ring = await ringPainted(page, line)
      check(
        "Stacked: its line's focus ring is drawn over the record's glass",
        ring.problem ?? (ring.ratio <= 1.1 ? null : `painted ${String(ring.ratio)}:1 against the ring's colour`),
      )
      // Up from its limit by a pointer.
      const box = await line.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 6 })
      await page.mouse.up()
      const dragged = await at()
      const kept = await page.evaluate(() => window.localStorage.getItem('formancy-data-host.stack'))
      check(
        'Stacked: dragging its line moves it, within its limits, and keeps it',
        dragged.now < end.now && dragged.now >= dragged.min && kept === String(dragged.now)
          ? null
          : `from ${String(end.now)} to ${String(dragged.now)}, at least ${String(dragged.min)}, kept ${String(kept)}`,
      )
      // Back near where it arrived, for the states after.
      await line.focus()
      await page.keyboard.press('Home')
      for (let step = 0; step < 20 && (await at()).now < before.now; step += 1) await page.keyboard.press('ArrowDown')
    },
  ]
}

/**
 * The short window's states: signed in, and the order form's records in
 * Stacked, where it arrives. A window about 30.5rem tall or less has no
 * room for the records' least and the record's together, so Stacked draws
 * no line -- none a person could focus whose keys and drag do nothing --
 * and the Records panel is as tall as what it holds, scrolling with the
 * page and not inside itself.
 */
export function shortJourney({ check }) {
  return [
    [
      `${SHORT.label}: signed in`,
      async (page) => {
        await page.getByLabel('Host token').fill(TOKENS.clerk)
        await page.getByRole('button', { name: 'Sign in' }).click()
        await page.getByRole('heading', { level: 2, name: 'No form open' }).waitFor(WITHIN)
      },
    ],
    [
      `${SHORT.label}: Records, stacked`,
      async (page) => {
        await chooseOrders(page, check)
        check(
          'a short window arrives in Stacked, as a wider one does',
          (await page.getByRole('radio', { name: 'Stacked', exact: true }).isChecked()) ? null : 'Stacked is not checked',
        )
        const lines = await page.getByRole('separator').count()
        check('a short window: Stacked draws no line', lines === 0 ? null : `${String(lines)} separators are drawn`)
        const panel = await records(page).evaluate((element) => ({ held: element.scrollHeight, shown: element.clientHeight }))
        check(
          'a short window: the Records panel is as tall as what it holds',
          panel.held - panel.shown <= 1 ? null : `it shows ${String(panel.shown)} px of ${String(panel.held)}, scrolling inside itself`,
        )
      },
    ],
  ]
}
