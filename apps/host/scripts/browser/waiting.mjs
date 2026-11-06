// The rows on screen while the next are asked for, and what the server did
// said in the room's teal, in the browser (0146), on the workspace the views'
// states left: every record, no sort. A header pressed with the list it asks
// for held: the grid keeps the rows it showed, its well is dimmed and AG
// Grid says it is busy, and once the list is let go the sorted rows are
// shown, the well no longer dimmed and nothing busy. The line that says so
// is drawn in the room's teal -- the colour room.css gives --server --
// which axe finds at 4.5:1 or more on its glass, and three fifths through
// the colour's moment it has faded from where it began; under reduced
// motion it has not, changing at the moment's end without a transition. The sort
// is then taken off again, as the views' states left it. Each state is
// measured by the gate's `measured` after, which waits for every animation
// to finish: its audit sees the line in its own colour, not the teal.
//
// What the accessibility tree cannot say, read from the document and said
// where it is read: the well's opacity, which no role carries -- the well is
// the grid's nearest `.grid-bench` -- and the teal's element in the line,
// the `.server-did` the page draws its words in, and its animation.

import { FORM } from './plane.mjs'
import { audit, dataRows, until } from './measure.mjs'

const LISTS = `**/v1/forms/${FORM}/records/list`
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page) => page.getByRole('grid', { name: 'Records', exact: true })
/** The grid's own line: the section's first status with no name. */
const line = (page) => records(page).getByRole('status', { name: /^$/ }).first()
/** The well the grid is drawn in, which has no role: the grid's nearest `.grid-bench`. */
const well = (page) => grid(page).locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " grid-bench ")][1]')
const opacity = async (page) => Number(await well(page).evaluate((element) => getComputedStyle(element).opacity))
const header = (page) => grid(page).getByRole('columnheader', { name: /^Order date/ })
/** Every data row's text, in order: what the grid shows. */
const shown = async (page) => dataRows(grid(page), page).allTextContents()
/** The line once it says a page of rows, and not that one is asked for. */
const answered = (page) => until(async () => /^Rows 1–/.test((await line(page).textContent()) ?? ''), 'the grid never said its rows')

/**
 * The next words the page says in the room's teal, held at the start of
 * their colour: the first `server-did` animation to start after this, paused
 * at its start and kept as `window.formancyGateSaid` for the reads below.
 */
function holdTheNextTeal(page) {
  return page.evaluate(() => {
    window.formancyGateSaid = new Promise((resolve) => {
      document.addEventListener('animationstart', function heard(event) {
        if (event.animationName !== 'server-did') return
        document.removeEventListener('animationstart', heard)
        const animation = event.target.getAnimations().find((each) => each.animationName === 'server-did')
        animation?.pause()
        if (animation !== undefined) animation.currentTime = 0
        resolve(animation === undefined ? null : { element: event.target, animation })
      })
    })
  })
}

/** The held words' colour at `share` of their moment, and the room's teal, as the browser computes both. */
function tealAt(page, share) {
  return page.evaluate(async (at) => {
    const held = await Promise.race([window.formancyGateSaid, new Promise((resolve) => setTimeout(() => resolve(undefined), 20_000))])
    if (held === undefined) return { problem: 'no words were said in teal' }
    if (held === null) return { problem: 'the words said in teal have no animation to hold' }
    const duration = Number(held.animation.effect.getComputedTiming().duration)
    held.animation.currentTime = duration * at
    const probe = document.createElement('span')
    probe.style.color = 'var(--server)'
    document.body.append(probe)
    const teal = getComputedStyle(probe).color
    probe.remove()
    return { colour: getComputedStyle(held.element).color, teal, text: held.element.textContent }
  }, share)
}

/** Null once `condition` holds, or the problem `until` gives up with. */
const reached = (condition, problem) =>
  until(condition, problem)
    .then(() => null)
    .catch((error) => error.message)

/** Every animation of the page run to its end: the next state starts from nothing held. */
const finish = (page) => page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))

/**
 * The header pressed, and the words its answer said held at the start of
 * their teal: waited for here, since the line said rows before the press
 * too, and a held animation never finishes, which `measured` waits for.
 */
async function sortedAgain(page) {
  await holdTheNextTeal(page)
  await header(page).click()
  const said = await page.evaluate(() =>
    Promise.race([window.formancyGateSaid.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 20_000))]),
  )
  if (!said) throw new Error('the sort never said its answer in teal')
}

export function waitingJourney(_plane, { check }) {
  /** The answer's colour at the start of its moment and three fifths through, without reduced motion: held for the check under it. */
  let fading = { problem: 'the sort was never answered' }
  return [
    [
      'Rows kept while a sort is asked for (Records)',
      async (page) => {
        await answered(page)
        const before = await shown(page)
        const held = []
        let asked = () => {}
        const askedFor = new Promise((resolve) => {
          asked = resolve
        })
        await page.route(LISTS, (route) => {
          held.push(route)
          asked()
        })
        const whileAsked = await (async () => {
          try {
            await header(page).click()
            await askedFor
            // Past the dim's fifth of a second, and its transition.
            const dimmed = await reached(async () => Math.abs((await opacity(page)) - 0.8) < 0.01, 'the well was never dimmed to 0.8')
            const rows = await shown(page)
            const busy = (await grid(page).getAttribute('aria-busy')) === 'true' ? null : 'aria-busy was not true while it was asked for'
            await holdTheNextTeal(page)
            const [request] = held
            if (request === undefined) throw new Error('no list was held')
            await page.unroute(LISTS)
            await request.continue()
            return { dimmed, rows, busy }
          } finally {
            await page.unroute(LISTS)
          }
        })()
        check(
          'a sort asked for: the rows shown stay, not blank',
          before.length > 0 && JSON.stringify(whileAsked.rows) === JSON.stringify(before)
            ? null
            : `${String(before.length)} rows became ${JSON.stringify(whileAsked.rows.slice(0, 2))}`,
        )
        await answered(page)
        const undimmed = await reached(async () => (await opacity(page)) === 1, 'the well stayed dimmed once it answered')
        check('a sort asked for: the well dimmed to 0.8 while it is, and not once it answers', whileAsked.dimmed ?? undimmed)
        check(
          'a sort asked for: the grid busy while it is, and not once it answers',
          whileAsked.busy ?? ((await grid(page).getAttribute('aria-busy')) === null ? null : 'aria-busy was still set once it answered'),
        )

        // What the server did, in teal at its full strength: the colour room.css gives --server, at 4.5:1 or more by axe.
        const start = await tealAt(page, 0)
        const lineAudit = await audit(page, await line(page).elementHandle())
        check(
          'what the server did: the line says it in the room’s teal, at 4.5:1 or more by axe',
          start.problem ??
            (start.colour !== start.teal
              ? `it is ${start.colour}, not ${start.teal}`
              : lineAudit.violations.length === 0 && lineAudit.measured.includes('color-contrast')
                ? null
                : lineAudit.violations.join('; ') || `axe measured only ${lineAudit.measured.join(', ') || 'nothing'}`),
        )
        const later = await tealAt(page, 0.6)
        fading = start.problem !== undefined ? start : later.problem !== undefined ? later : { start: start.colour, later: later.colour }
        await finish(page)
      },
    ],
    [
      'What the server did, under reduced motion (Records)',
      async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        let still
        try {
          await sortedAgain(page)
          const start = await tealAt(page, 0)
          const later = await tealAt(page, 0.6)
          still = start.problem !== undefined ? start : later.problem !== undefined ? later : { start: start.colour, later: later.colour }
          await finish(page)
        } finally {
          await page.emulateMedia({ reducedMotion: null })
        }
        check(
          'what the server did: three fifths through its moment it has faded from where it began, and under reduced motion not',
          fading.problem ??
            still.problem ??
            (fading.later === fading.start
              ? `it was still ${fading.start}`
              : still.later !== still.start
                ? `under reduced motion it went from ${still.start} to ${still.later}`
                : null),
        )
        // The sort taken off again, as the views' states left the grid: the header's third press.
        await sortedAgain(page)
        await finish(page)
        await until(async () => (await header(page).getAttribute('aria-sort')) === 'none', 'the Order date header never went back to no sort')
      },
    ],
  ]
}
