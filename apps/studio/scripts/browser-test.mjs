// What jsdom cannot see in the studio, measured in the browser it is given.
//
// The examples page's gate (apps/examples/scripts/browser-test.mjs), applied
// to the studio as CLAUDE.md asks of every UI here. The suite in src/ runs in
// jsdom, which applies no CSS, resolves no media queries and performs no
// layout, so these claims the studio makes could only be checked by hand:
//
//   - nothing scrolls sideways and nothing is past either edge, on every
//     step of the journey, down to a 320px phone;
//   - the keyboard path: the first Tab on the sign-in screen reaches the
//     token, and in the workbench the skip link comes on screen and leads
//     into the step, from the top of the page as the harness puts it there
//     (scripts/browser-gate.mjs's fromTheTop); a click on the workbench's
//     corner and then Tab reaches the skip link in the browsers 0058's
//     FACTS.clickThenTab says it does, and not in Firefox, which starts from
//     the caret the click left; and where Enter moves or removes the button
//     it was pressed on -- a field moved down, a filter removed, a list
//     view's condition row removed and the view saved (0105), a conflict
//     rebased, a restore refused, an import refused, a dropped label given,
//     a draft approved, a browse's condition applied or removed -- the
//     keyboard is somewhere deliberate afterwards, not on the page;
//   - the paper is the theme's: no rule of studio.css selects anything on the
//     preview's paper, or on a draft's open for review (0065), so each shows
//     what the published form will;
//   - a version downloaded from the Drift step is saved as the file the
//     store wrote, byte for byte, which in the suite is only a Blob (0062);
//   - the colours have enough contrast and the targets are big enough -- the
//     two rules jsdom cannot measure -- on every step, including the states
//     that add colour: gaps, a server this release was not tested on, said
//     by the connection test and the metadata (0068), a refused policy, a delete refused for what it
//     also does and its reach accepted (0052), a failed preview, a conflict,
//     a blocking drift, a refused restore, a regeneration and what it
//     carried (0030), a version file chosen and its import refused (0062),
//     and under review a draft submitted, a draft open for review and a
//     draft approved (0065); and a browse's grid, a table wider than the
//     window scrolling in its own region, a sort and a view (0099), and its
//     filter, the form open on a range of days, a condition applied, a
//     value refused and the last condition removed (0104);
//   - every web font the built studio declares had loaded by the end of
//     each pass, on each origin the pass signed in to, and in the pass that
//     refuses every font file, none had (0058): a state measured before a
//     late family swapped in is not caught;
//   - on each origin, the page asked no other origin for anything: every
//     such request is refused, so the answer is the same with no network,
//     and named (0072);
//   - the page is sent with the Content-Security-Policy deploy/web/nginx.conf
//     sends it, scripts/web-policies.mjs's, and at every step, and on each
//     origin after the last, the browser refused nothing under it -- no
//     event the document heard, no console line about the policy -- and at
//     the end an inline script put in the page was refused and heard, with
//     nothing heard before it that no check read, so a pass under a policy
//     nobody enforced, or with a listener that hears nothing, fails (0083).
//
// Against the page `vite build` produces, served over HTTP from the same
// origin as the real data server -- createDataServer, in this process, with
// the suite's captured snapshots behind a fake connection registry -- because
// the studio speaks only to the server's origin (0024) and every step after
// sign-in needs its answers. Two servers each pass: one where every
// administrator publishes, which the journey walks, and one under review,
// on an origin of its own, where an author submits and a publisher
// approves. Asserted as numbers and computed results, never screenshots.
//
// One module per reason to change, under scripts/browser/: the planes, the
// server of the built page, the stylesheet's reads, the measurements, the
// journey, the states of review, and a browse.
//
// `pnpm test:browser`, which builds first, runs it once per browser
// scripts/browsers.mjs names through recordedPerBrowser -- Chromium, Firefox
// and WebKit, each in a CI leg of its own; Chromium alone on a machine
// unless FORMANCY_BROWSERS names more -- with every check in every browser.
// A browser comes from installCommand() in scripts/browsers.mjs, once per
// machine.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  afterEveryPass,
  canary,
  canaryProblem,
  declaredFamilies,
  fontProblem,
  foreignProblem,
  fromTheTop,
  guardRequests,
  hearPolicy,
  policyRefused,
  unlikeTheTable,
  webFonts,
} from '../../../scripts/browser-gate.mjs'
import { FACTS } from '../../../scripts/browsers.mjs'
import { recordedPerBrowser } from '../../../scripts/release-report/gate-results.mjs'
import { browse } from './browser/browse.mjs'
import { journey } from './browser/journey.mjs'
import { audit, describeFocus, measured } from './browser/measure.mjs'
import { startPlane, TOKENS } from './browser/plane.mjs'
import { review, signIn } from './browser/review.mjs'
import { DIST, POLICY, serve } from './browser/serve.mjs'
import { widths } from './browser/styles.mjs'

/** Playwright, for recordedPerBrowser to launch each browser with: the one import of playwright, here where the app declares it. */
async function load() {
  try {
    return await import('playwright')
  } catch {
    throw new Error('playwright is not installed: run `pnpm install`')
  }
}

/**
 * The sign-in screen and the workbench's way in, on the first origin: the
 * first Tab on the token, the click on the corner 0058's table holds, and
 * the skip link from the top of the page into the step.
 */
async function wayIn(gate, page) {
  const { check } = gate
  // Sign in: the first Tab reaches the token, which is the whole screen's purpose.
  // Once the screen is there: "load" fires before React has rendered it,
  // and on a slow runner a Tab pressed into the empty page went nowhere.
  const token = page.getByLabel('Host token')
  await token.waitFor()
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => {
    const active = document.activeElement
    return active === null ? 'nothing' : `<${active.tagName.toLowerCase()}${active.id === '' ? '' : ` id="${active.id}"`}>`
  })
  check('the first Tab reaches the host token', (await token.evaluate((input) => input === document.activeElement)) ? null : `focus went to ${focused} first`)
  await measured(gate, page, 'Sign in')
  await signIn(page, TOKENS.admin)

  // A click on the workbench's corner, then Tab, as a person does it: in
  // Firefox the keyboard starts from the caret the click left, past the
  // skip link, which is 0058's FACTS.clickThenTab, held here by name in
  // every browser.
  //
  // Once the workbench has put the keyboard where it puts it. The step's
  // heading takes focus from a React effect, which runs after the paint
  // that shows the step list, so a click the moment the list appears can
  // land first; the effect then moves focus to the heading, and Tab goes
  // on into the step. A person cannot click inside that window. WebKit on
  // CI met it once in six widths on main (run 38629274328), and the gate
  // read it as a browser fact that had changed.
  await page.waitForFunction(() => document.activeElement?.id === 'step-heading', undefined, { timeout: 15_000 })
  const skip = page.getByRole('link', { name: 'Skip to the step' })
  await page.mouse.click(1, 1)
  await page.keyboard.press('Tab')
  const reached = await skip.evaluate((link) => link === document.activeElement)
  const table = FACTS.clickThenTab.values[gate.asked]
  check(
    'a click on the workbench’s corner, then Tab: as 0058’s table says of this browser',
    reached === table
      ? null
      : unlikeTheTable(gate.asked, {
          did: reached ? 'reached the skip link' : `went to ${await describeFocus(page)}, not the skip link`,
          says: table ? 'it reaches it' : 'it does not',
        }),
  )

  // From the top of the workbench, as the harness puts it there: the skip link, on screen, into the step.
  await fromTheTop(page)
  await page.keyboard.press('Tab')
  const shown = await skip.evaluate((link) => {
    const box = link.getBoundingClientRect()
    return { focused: link === document.activeElement, onScreen: box.top >= 0 && box.left >= 0 && box.right <= document.documentElement.clientWidth }
  })
  check('the first Tab in the workbench reaches the skip link', shown.focused ? null : 'focus went somewhere else first')
  check('which is on screen while it has focus', shown.onScreen ? null : 'it stayed off screen')
  const skipAudit = await audit(page, skip)
  check('the skip link, shown: axe finds nothing', skipAudit.violations.length === 0 ? null : skipAudit.violations.join('; '))
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const into = await page.getByRole('main').evaluate((main) => {
    const tabbable = [...main.querySelectorAll('*')].filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0)
    return tabbable[0] === document.activeElement
  })
  check('and through it the next Tab reaches the first control of the step', into ? null : 'focus is elsewhere')
}

/**
 * The states of review, on a plane under review served from an origin of
 * its own, in the same page, which `guard` is told: signed in there as the
 * author, each state measured as the journey's are, then what that document
 * asked of other origins and its web fonts.
 */
async function underReview(gate, page, { refuseFonts, guard }) {
  const plane = await startPlane({ review: true })
  const { http, port } = await serve(plane)
  try {
    const origin = `http://127.0.0.1:${String(port)}`
    guard.allow(origin)
    const response = await page.goto(`${origin}/`, { waitUntil: 'load' })
    gate.check('under review, the studio is sent with the policy nginx.conf sends it', sentWith(response))
    await signIn(page, TOKENS.admin)
    for (const [state, act] of review(gate.check)) {
      await act(page)
      await measured(gate, page, state)
    }
    gate.check('under review, the page asked no other origin for anything', foreignProblem(guard.foreign()))
    const problem = fontProblem({ families: declaredFamilies(DIST), ...(await webFonts(page)), refused: refuseFonts })
    gate.check(refuseFonts ? 'under review, with the web fonts refused, none loaded' : 'under review, every web font the page asks for loaded', problem)
    // What the document was refused after the last state measured, which
    // no state's check reads: an inline style put in the page here failed
    // nothing before this check (0083).
    gate.check('under review, after its last state, the browser refused nothing under the page’s policy', await policyRefused(page))
    // Last in the pass, since the console line of its refusal is the gate's
    // own: every check of what the policy refused heard something.
    gate.check('and the policy held: an inline script put in the page was refused, and the page heard the refusal', canaryProblem(await canary(page), POLICY))
  } finally {
    http.close()
    await plane.close()
  }
}

/** What a check that the page was sent with its policy fails with, or null. */
function sentWith(response) {
  const sent = response?.headers()['content-security-policy']
  return sent === POLICY ? null : `it was sent with ${sent === undefined ? 'no policy' : `"${sent}"`}`
}

/** The gate in one browser, reporting through `gate` (scripts/release-report/gate-results.mjs), which keeps what it found for the release report. */
async function run(gate, browser) {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('no built studio at apps/studio/dist: run `pnpm build` first')

  const list = widths()
  for (const { label, width, refuseFonts = false } of list) {
    gate.pass({ label, width })
    const plane = await startPlane()
    const { http, port } = await serve(plane)
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const origin = `http://127.0.0.1:${String(port)}`
    // Every request to another origin refused and named at the end of the
    // pass, and in the refusing pass every font file (0072); and what the
    // page's policy refused, from before its first script, which each
    // measured state reads (0083).
    const guard = await guardRequests(page, { origins: [origin], refuseFonts })
    await hearPolicy(page)
    try {
      const response = await page.goto(`${origin}/`, { waitUntil: 'load' })
      console.log(`\n${label} -- ${String(width)}x900`)
      gate.check('the studio is sent with the policy nginx.conf sends it', sentWith(response))
      await wayIn(gate, page)
      await measured(gate, page, 'Connect')
      for (const [state, act] of [...journey(plane, gate.check), ...browse(gate.check)]) {
        await act(page)
        await measured(gate, page, state)
      }
      // Whether the page asked another origin for anything, and whether every
      // web font had loaded by the end of the journey, or, where the pass
      // refuses them, none had.
      await afterEveryPass(gate, page, { dist: DIST, refused: refuseFonts, guard })
      // What the document was refused after the journey's last state, read
      // before the review's origin starts a document whose window has heard
      // none of it: an inline style put in the page here was otherwise
      // blamed, by its console line alone, on the first state under review
      // (0083).
      gate.check('after the journey’s last state, the browser refused nothing under the page’s policy', await policyRefused(page))
      await underReview(gate, page, { refuseFonts, guard })
    } finally {
      await page.close()
      http.close()
      await plane.close()
    }
  }

  console.log('')
  // A failed check fails the run in recordedPerBrowser, which says so.
  if (gate.failures().length > 0) return
  console.log(
    `browser checks passed: the studio's whole journey and a browse, and its states under review, at ${String(new Set(list.map(({ width }) => width)).size)} widths, one of them also with the web fonts refused, for the layout, focus and colour facts jsdom cannot represent`,
  )
}

await recordedPerBrowser('apps/studio', { load, run })
