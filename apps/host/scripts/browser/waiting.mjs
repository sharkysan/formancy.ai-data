// The rows on screen while the next are asked for, and what the server did
// said in the room's teal, in the browser (0146), on the workspace the views'
// states left: every record, no sort. A header pressed with the list it asks
// for held: the grid keeps the rows it showed, its well is dimmed and AG
// Grid says it is busy, every text in the dimmed well still at 4.5:1 --
// axe's own audit of the well, which reads its opacity, and a header's
// and a cell's text the well shows, which axe cannot decide behind AG
// Grid's layers, composed at the well's opacity from the pixels painted in
// each before and during the dim -- and once the list is let go the sorted rows are
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
// the grid's nearest `.grid-bench` -- whether the well shows a header or a
// cell, which is where the browser hit-tests a point inside it to it, the
// scroll of what holds the well, which `inView` moves and puts back, and
// the teal's element in the line, the `.server-did` the page draws its
// words in, and its animation.

import { FORM } from './plane.mjs'
import { audit, contrast, dataRows, paintedWhere, parseColor, until } from './measure.mjs'

const LISTS = `**/v1/forms/${FORM}/records/list`
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page) => page.getByRole('grid', { name: 'Records', exact: true })
/** The grid's own line: the section's first status with no name. */
const line = (page) => records(page).getByRole('status', { name: /^$/ }).first()
/** The well the grid is drawn in, which has no role: the grid's nearest `.grid-bench`. */
const well = (page) => grid(page).locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " grid-bench ")][1]')
const opacity = async (page) => Number(await well(page).evaluate((element) => getComputedStyle(element).opacity))
/** The opacity the well is drawn with: its own and every ancestor's, as the browser composites them. */
const drawnOpacity = (page) =>
  well(page).evaluate((element) => {
    let alpha = 1
    for (let at = element; at !== null; at = at.parentElement) alpha *= Number(getComputedStyle(at).opacity)
    return alpha
  })
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

/**
 * The Records grid's headers and data cells with text that its well shows:
 * each with a point inside it, clear of its text, where `decide` reads a
 * grid's background too, its text's colour as the browser computes it, and
 * where it stands -- its row's `aria-rowindex` and its own `aria-colindex`
 * -- for `whereNow`. Not the header the press goes to, which the press
 * focuses and draws its sort in, and no cell with a control in it, whose
 * text is the control's.
 *
 * Shown is where the browser hit-tests the point to the text's element. A
 * header or a cell in the document is not always on screen: the grid
 * scrolls sideways inside its well, and AG Grid keeps a column scrolled past
 * the well's edge in the document. The views' states leave the orders
 * scrolled sideways, and at 1440 by 900 the first header, Id, lay past the
 * well's left edge, its point on the Forms navigation beside it, which no
 * dim reaches (measured 2026-11-17 in Chromium on Windows): the check read
 * the navigation, and failed once the action order's entry in it moved a
 * link's words under the point.
 */
const gridTexts = async (page) =>
  grid(page).evaluate(
    (root, pressed) => {
      const pointIn = (element) => {
        const box = element.getBoundingClientRect()
        return { x: box.left + 4, y: box.top + 4 }
      }
      const shown = (element) => {
        const point = pointIn(element)
        return element.contains(document.elementFromPoint(point.x, point.y))
      }
      const said = (element) => (element.textContent ?? '').trim() !== ''
      const placed = (element) => element.hasAttribute('aria-colindex') && element.closest('[role="row"]')?.hasAttribute('aria-rowindex') === true
      const headers = [...root.querySelectorAll('[role="columnheader"]')].filter((each) => each !== pressed && said(each) && placed(each) && shown(each))
      const cells = [...root.querySelectorAll('[role="gridcell"]')].filter(
        (each) => said(each) && placed(each) && each.querySelector('input, select, textarea, button, a') === null && shown(each),
      )
      return [...headers, ...cells].map((element) => ({
        kind: headers.includes(element) ? 'header' : 'cell',
        name: (element.textContent ?? '').trim().slice(0, 30),
        color: getComputedStyle(element).color,
        point: pointIn(element),
        row: element.closest('[role="row"]').getAttribute('aria-rowindex'),
        column: element.getAttribute('aria-colindex'),
      }))
    },
    await header(page).elementHandle(),
  )

/**
 * Where each of `texts` is now, at the same place inside it, or null where
 * the well no longer shows it there. Found again by where it stands and what
 * it says, since the press moves the well down -- 144 pixels at 1440 by 900,
 * measured 2026-11-17 in Chromium on Windows, so a point read before it lies
 * on something else during the dim -- and AG Grid draws the rows it keeps in
 * cells of new elements.
 */
const whereNow = (page, texts) =>
  grid(page).evaluate(
    (root, kept) =>
      kept.map(({ kind, name, row, column }) => {
        const role = kind === 'header' ? 'columnheader' : 'gridcell'
        const element = [
          ...root.querySelectorAll(`[role="row"][aria-rowindex="${CSS.escape(row)}"] [role="${role}"][aria-colindex="${CSS.escape(column)}"]`),
        ].find((each) => (each.textContent ?? '').trim().slice(0, 30) === name)
        if (element === undefined) return null
        const box = element.getBoundingClientRect()
        const point = { x: box.left + 4, y: box.top + 4 }
        return element.contains(document.elementFromPoint(point.x, point.y)) ? point : null
      }),
    texts,
  )

/**
 * `read` with the well wholly in view, by the scroll of what holds it -- the
 * Records panel, which scrolls inside itself side by side, and the window --
 * never of the grid's own, whose scroll is part of the state measured, and
 * with the pointer in the window's corner, off the grid, so that no row is
 * drawn hovered: as a person scrolls to the rows to read them. Each
 * scroller is put back after. The press moves the well down, and at 1440 by
 * 900 the panel's foot then showed only the top 9.5 pixels of the first row
 * (measured 2026-11-17 in Chromium on Windows).
 */
async function inView(page, read) {
  await page.mouse.move(0, 0)
  await well(page).evaluate((element) => {
    const held = []
    for (let at = element.parentElement; at !== null; at = at.parentElement) held.push({ at, left: at.scrollLeft, top: at.scrollTop })
    window.formancyGateScrolled = held
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
  try {
    return await read()
  } finally {
    await page.evaluate(() => {
      for (const { at, left, top } of window.formancyGateScrolled ?? []) {
        at.scrollLeft = left
        at.scrollTop = top
      }
      window.formancyGateScrolled = undefined
    })
  }
}

/**
 * Each of `texts` as the dimmed well draws it, against what was painted
 * behind it: the well is composited at `alpha`, its own opacity and its
 * ancestors', over what lies behind them, so what that gives is read from
 * the background painted undimmed, `plain`, and dimmed, `dimmed`, and the
 * text's colour is composited over it as the background was. `decide` compares a text's computed colour with the
 * pixels, which leaves out the well's opacity; this puts it in.
 */
function dimmedRatios(texts, plain, dimmed, alpha) {
  return texts.map((text, at) => {
    const own = parseColor(text.color)?.rgb ?? [0, 0, 0]
    const under = plain[at]
    const shown = dimmed[at]
    const glass = shown.map((channel, index) => (alpha >= 0.999 ? channel : Math.min(255, Math.max(0, (channel - alpha * under[index]) / (1 - alpha)))))
    const drawn = own.map((channel, index) => alpha * channel + (1 - alpha) * glass[index])
    return { name: text.name, ratio: contrast(drawn, shown) }
  })
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
        const { texts, colours: plain } = await inView(page, () =>
          paintedWhere(page, async () => {
            const found = await gridTexts(page)
            return { texts: found, points: found.map((text) => text.point) }
          }),
        )
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
            const dimmed = await reached(async () => (await opacity(page)) < 1, 'the well was never dimmed')
            await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))))
            const rows = await shown(page)
            const busy = (await grid(page).getAttribute('aria-busy')) === 'true' ? null : 'aria-busy was not true while it was asked for'
            // Every text in the dimmed well at 4.5:1: axe's own, which reads the well's opacity, and the grid's texts it cannot decide behind AG Grid's layers, composed here.
            const wellAudit = await audit(page, await well(page).elementHandle())
            // The first header and the first cell the well showed before the press and still shows, each read where it is now.
            const whileDimmed = await inView(page, () =>
              paintedWhere(page, async () => {
                const now = await whereNow(page, texts)
                const at = ['header', 'cell'].map((kind) => texts.findIndex((text, index) => text.kind === kind && now[index] !== null))
                return { at, points: at.filter((index) => index !== -1).map((index) => now[index]) }
              }),
            )
            const missing = ['header', 'cell'].filter((_, index) => whileDimmed.at[index] === -1)
            const measuring = whileDimmed.at.filter((index) => index !== -1)
            const ratios = dimmedRatios(
              measuring.map((index) => texts[index]),
              measuring.map((index) => plain[index]),
              whileDimmed.colours,
              await drawnOpacity(page),
            )
            const low = ratios.filter((entry) => entry.ratio < 4.5)
            const readable =
              wellAudit.violations.length > 0
                ? wellAudit.violations.join('; ')
                : missing.length > 0
                  ? `no ${missing.join(' and no ')} of the grid's was shown in the well both before the press and while dimmed`
                  : low.length > 0
                    ? low.map((entry) => `${entry.name} ${String(entry.ratio)}:1`).join('; ')
                    : null
            await holdTheNextTeal(page)
            const [request] = held
            if (request === undefined) throw new Error('no list was held')
            await page.unroute(LISTS)
            await request.continue()
            return { dimmed, rows, busy, readable }
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
        check('a sort asked for: the well dimmed while it is, and not once it answers', whileAsked.dimmed ?? undimmed)
        check('a sort asked for: every text in the dimmed well at 4.5:1 or more, its header and a cell composed at its opacity', whileAsked.readable)
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
