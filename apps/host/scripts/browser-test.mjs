// What jsdom cannot see on the host page, measured in the browser it is given.
//
// The studio's gate (apps/studio/scripts/browser-test.mjs), applied to the
// host page as CLAUDE.md asks of every UI here. The suites in src/ run in
// jsdom, which applies no CSS, resolves no media queries and performs no
// layout, so these claims could only be checked by hand:
//
//   - nothing scrolls sideways and nothing is past either edge, in every
//     state a person reaches, down to a 320px phone -- except what is inside
//     a grid's well, whose own scroller shows columns past it, while the
//     well itself stays inside the window (0047);
//   - the keyboard path: the first Tab reaches the skip link, on screen, and
//     the next the host token; signed in, the keyboard is on Forms, and on a
//     form's heading once one is chosen; Enter on a row puts it on the
//     record, Tab into a grid lands on the open row and the next Tab leaves
//     the grid in one stop, End reaches the last column in view; the unsaved
//     notice takes the keyboard and Keep editing gives it back; a layout
//     change leaves it on its radio, and Back to the records puts it on the
//     open row; Enter on the skip link puts it on main and changes neither
//     the address nor the history, and the next Tab reaches main's first
//     control; after a stale save it is on the notice, after a refused
//     selection in the error summary, after a save whose answer was lost on
//     the "It may have been saved" notice (0031), after "Enter it again
//     anyway" on "Allow saving it again", and after a save that worked still
//     on Save; and in an order line opened alone, Tab into the React paper
//     lands on its Order, a native select, which ArrowDown moves from
//     nothing to its first order (0066);
//   - the grids' colours, which axe cannot decide behind AG Grid's painted
//     layers: a header's and a cell's text against what the browser painted
//     there, the focused cell's teal border at 3:1 on the open row and on
//     another, and the open row's bar against its tint (UX-SPEC F1);
//   - a create whose answer the network lost after the server stored it,
//     measured at the socket through a TCP hop between the browser and the
//     server: it went out on the connection 0058's FACTS.postConnection says
//     of this browser -- Chromium and Firefox on an idle kept-alive one where
//     one stood idle, WebKit on a new one -- and was sent again on its own,
//     below the page, as often as FACTS.resendsLostPost says for that
//     connection -- Chromium and Firefox on a connection they reused, WebKit
//     never -- and one order is stored, the server answering a second
//     sending with the first one's answer (0031); the page then says what
//     was created, or, where nothing was sent again, that it may have been
//     saved, with the keyboard on that; and the run fails unless one of its
//     passes reached the row of the connection the browser takes when it
//     can choose, which for Chromium and Firefox is the resend;
//   - the browser names itself and its platform to AG Grid as
//     FACTS.claimsSafari and claimsMacOs say, which decide the code paths
//     the grids take: Playwright's Linux WebKit names itself Safari on a
//     Mac, and its platform Linux;
//   - a delete (0053): a row's Delete reached by the arrow keys as a real
//     button named for its record, from which Tab leaves the grid in one
//     stop; the confirmation under the grid that asked, or under the
//     record's header, taking the keyboard, Keep it the next Tab, Escape
//     giving the keyboard back; its frame against the glass at 3:1 or
//     more, and its two answers one under the other on a phone; "Not
//     deleted", a record the delete could not find, "It may have been
//     deleted" before and after its check, and the keyboard on the Records
//     heading once the record is gone, the grid saying so;
//   - the separator between the records and the record: a pointer drags it
//     within its limits and the share is kept, and letting it go fits the
//     grids' columns to the rows shown then -- a column a search filled
//     with a longer value is cut before and whole after (0047);
//   - the papers are the theme's and the grids their theme's: no rule of
//     host.css selects anything on either form or in either grid;
//   - every `@media` condition is one the gate reads: a `max-width` in rem,
//     from which it takes its widths (0047);
//   - the colours have enough contrast and the targets are big enough -- the
//     two rules jsdom cannot measure -- in every state below;
//   - every web font the built page asks for had loaded by the end of each
//     pass, and in the pass that refuses them, none had (0058): a state
//     measured before a late family swapped in is not caught.
//
// Against the page `vite build` produces, served over HTTP from the same
// origin as the real data server -- createDataServer, in this process, over
// the shared fixture on a real PostgreSQL 17 through the real driver (0029).
// PostgreSQL only: what is measured here is layout, focus and colour, which
// do not depend on the engine; what the engines answer is the jsdom suites'
// and the client suite's, on both. Asserted as numbers and computed results,
// never screenshots -- the colours inside a grid are read from the pixels
// the browser painted, which is a number too.
//
// One module per reason to change, under scripts/browser/: the plane, the
// server of the built page, the stylesheet's reads, the measurements, the
// workspace's states, the record's journey and a delete's states.
//
// `pnpm test:browser`, which builds first, runs it once per browser
// scripts/browsers.mjs names through recordedPerBrowser -- Chromium, Firefox
// and WebKit, each in a CI leg of its own; Chromium alone on a machine
// unless FORMANCY_BROWSERS names more -- with every check in every browser,
// and each browser's run starts its own PostgreSQL and server: the report
// credits a server to the gate whose time window it started in. It needs
// Docker, for the database, and each browser, from installCommand() in
// scripts/browsers.mjs once per machine.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { startTcpHop } from '@formancy/data-fixtures'
import { afterEveryPass, agGridRowProblem, environmentOf, rowUnmeasured } from '../../../scripts/browser-gate.mjs'
import { recordedPerBrowser } from '../../../scripts/release-report/gate-results.mjs'
import { deleteJourney } from './browser/deleting.mjs'
import { recordJourney } from './browser/journey.mjs'
import { audit, decide, describeFocus, focusedOn, measureWidth } from './browser/measure.mjs'
import { startPlane } from './browser/plane.mjs'
import { DIST, serve } from './browser/serve.mjs'
import { widths } from './browser/styles.mjs'
import { workspaceJourney } from './browser/workspace.mjs'

/** Playwright, for recordedPerBrowser to launch each browser with: the one import of playwright, here where the app declares it. */
async function load() {
  try {
    return await import('playwright')
  } catch {
    throw new Error('playwright is not installed: run `pnpm install`')
  }
}

/** The gate in one browser, reporting through `gate` (scripts/release-report/gate-results.mjs), which keeps what it found for the release report. */
async function run(gate, browser) {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('no built page at apps/host/dist: run `pnpm build` first')
  // Before the database and the server start: a stylesheet whose widths the
  // gate cannot read stops it.
  const list = widths()

  const { check } = gate
  const measured = async (page, state) => {
    // A notice or a swapped record fades in (UX-SPEC §8): measured once it
    // has. One cancelled on the way -- a button's colour transition, its
    // button drawn again for the record a create opened -- is over too: its
    // `finished` rejects, which is not the page failing.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))))
    const width = await measureWidth(page)
    check(`${state}: no sideways scroll`, width.overflow > 0 ? `${String(width.overflow)}px of horizontal overflow` : null)
    check(`${state}: nothing past either edge`, width.past.length === 0 ? null : width.past.join('; '))
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
    const result = await audit(page)
    gate.axe(result.axe)
    check(`${state}: axe finds nothing at WCAG 2.2 AA`, result.violations.length === 0 ? null : result.violations.join('; '))
    check(`${state}: contrast and target size measured, over something`, result.measured.length === 2 ? null : `only ${result.measured.join(', ') || 'nothing'}`)
    const decided = await decide(page, result.undecided)
    check(`${state}: the contrast of every text decided`, decided.left.length === 0 ? null : `undecided: ${decided.left.slice(0, 4).join('; ')}`)
    check(`${state}: the grids' text, decided on the pixels, at 4.5:1 or more`, decided.failing.length === 0 ? null : decided.failing.map((entry) => `${entry.name} ${String(entry.ratio)}:1`).join('; '))
    // What axe asked about and no screen shows in this state, said rather than counted: its grid has scrolled it out of view, or covers it.
    if (decided.hidden.length > 0) console.log(`  shown nowhere: ${decided.hidden.join('; ')}`)
  }

  const started = Date.now()
  const plane = await startPlane()
  const { http, port } = await serve(plane)
  // Between the browser and the page's origin: every byte the browser sends
  // and receives crosses it, so what the browser itself does is counted there.
  const hop = await startTcpHop({ kind: 'http', host: '127.0.0.1', port })
  console.log(`PostgreSQL and the server started in ${String(Math.round((Date.now() - started) / 1000))} s`)
  // The connections the run's lost creates took, one per pass: held once the
  // run is over, since each pass holds only the row its create reached.
  const reached = new Set()
  try {
    let pass = 0
    for (const { label, width, refuseFonts = false } of list) {
      pass += 1
      gate.pass({ label, width })
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      if (refuseFonts) await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
      try {
        await page.goto(`http://127.0.0.1:${String(hop.port)}/`, { waitUntil: 'load' })
        console.log(`\n${label} -- ${String(width)}x900`)
        // AG Grid's own tests, copied with its release into 0058's rows,
        // against what the page's browser says it is: they decide the code
        // paths the grids take.
        const said = await environmentOf(page)
        check('the browser names itself to AG Grid as 0058’s table says', agGridRowProblem(gate.asked, 'claimsSafari', said))
        check('the browser names its platform to AG Grid as 0058’s table says', agGridRowProblem(gate.asked, 'claimsMacOs', said))

        // Signed out: the skip link first, on screen, and then the token --
        // the whole screen's purpose. Once the screen is there: "load" fires
        // before React has rendered it.
        const token = page.getByLabel('Host token')
        await token.waitFor()
        await page.keyboard.press('Tab')
        const skip = page.getByRole('link', { name: 'Skip to the workspace' })
        const shown = await skip.evaluate((link) => {
          const box = link.getBoundingClientRect()
          return { focused: link === document.activeElement, onScreen: box.top >= 0 && box.left >= 0 && box.right <= document.documentElement.clientWidth }
        })
        check('the first Tab reaches the skip link', shown.focused ? null : `the focus is on ${await describeFocus(page)}`)
        check('which is on screen while it has focus', shown.onScreen ? null : 'it stayed off screen')
        const skipAudit = await audit(page, skip)
        check('the skip link, shown: axe finds nothing', skipAudit.violations.length === 0 ? null : skipAudit.violations.join('; '))
        await page.keyboard.press('Tab')
        check('and the next Tab reaches the host token', await focusedOn(page, token))
        await measured(page, 'Signed out')

        const run = { record: await plane.order(2), customer: 9000 + pass, reached }
        for (const [state, act] of [...workspaceJourney(plane, gate, run), ...recordJourney(plane, hop, gate, run), ...deleteJourney(plane, gate, run)]) {
          await act(page)
          await measured(page, state)
        }
        // Whether every web font had loaded by the end of the pass, or, where it refuses them, none had.
        await afterEveryPass(gate, page, { dist: DIST, refused: refuseFonts })
      } finally {
        await page.close()
      }
    }
    // Every pass held the row its lost create reached; the run, the row the
    // browser takes when it can choose, which for Chromium and Firefox is
    // the resend 0031 rests on.
    check('the run measured 0058’s row for the connection this browser takes when it can choose', rowUnmeasured(gate.asked, reached))
  } finally {
    await hop.close()
    http.close()
    await plane.close()
  }

  console.log('')
  // A failed check fails the run in recordedPerBrowser, which says so.
  if (gate.failures().length > 0) return
  console.log(
    `browser checks passed: the host page's workspace, journey and deletes at ${String(new Set(list.map(({ width }) => width)).size)} widths, one of them also with the web fonts refused, against the real server on PostgreSQL, in ${String(Math.round((Date.now() - started) / 1000))} s`,
  )
}

await recordedPerBrowser('apps/host', { load, run })
