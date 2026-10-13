// What every browser gate does to a page in every browser (0058): start the
// keyboard from the top of the page the harness's way, check that the web
// fonts the built page asks for arrived -- or, in the pass that refuses them,
// that none did -- measure the scrollbar, and record once per browser's run
// what the browser said it was and the system it ran on.
//
// Each apps/*/scripts/browser-test.mjs calls these on the page it is given;
// this module holds no package import, so it never loads a second copy of
// Playwright beside the app's (gate-results.mjs's recordedPerBrowser takes
// the app's `load` for the same reason).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserName, FACTS, prose, SYSTEM_PACKAGES } from './browsers.mjs'

/**
 * The harness putting the start of sequential navigation at the top of the
 * page: whatever has the focus blurred, so that a shown skip link is not
 * what the click lands on, a click at (1, 1), then the selection collapsed
 * to the start of `body`. It stands for a person who arrives at the top of
 * the page, which is what a skip link is for; it is not a person who
 * clicked.
 *
 * A click alone is not the top in every browser. Measured by the probe of
 * 2026-10-12, a modified copy of the studio's gate, in its workbench, whose
 * element at (1, 1) is `div.studio` and whose first tab stops are "Skip to
 * the step" and then "Sign out", the first Tab after each start reached:
 *
 *   | Before Tab                                    | Chromium       | Firefox        | WebKit         |
 *   | a click at (1, 1)                             | the skip link  | Sign out       | the skip link  |
 *   | blur, and the caret at the start of body      | "Test fixture" | the skip link  | the skip link  |
 *   | blur only                                     | "Test fixture" | "Test fixture" | the skip link  |
 *   | nothing                                       | "Test fixture" | "Test fixture" | "Test fixture" |
 *   | a click at (1, 1), the caret at body's start  | the skip link  | the skip link  | the skip link  |
 *
 * Chromium starts from the node clicked, Firefox from the caret the click
 * left, which is past a skip link drawn off-screen; WebKit takes either.
 * What a person meets in Firefox after such a click is 0058's
 * FACTS.clickThenTab, which the studio's gate holds. The blur first is no
 * row of the probe's table: it was added so that a skip link a Tab before
 * had shown is not what the click lands on, and the committed gates hold
 * the whole sequence in all three browsers -- the studio's "the first Tab
 * in the workbench reaches the skip link" and the host page's "open: the
 * first Tab reaches the skip link", each failing in Firefox with the click
 * alone.
 */
export async function fromTheTop(page) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.click(1, 1)
  await page.evaluate(() => window.getSelection()?.collapse(document.body, 0))
}

/**
 * The families the built page asks Google Fonts for, from `dist/index.html`:
 * each `family=` of a fonts.googleapis.com stylesheet link, the name before
 * its axes, `+` read as a space. Read from the page the gate measures, so a
 * family added to or dropped from index.html is checked without an edit
 * here; empty when the page asks for none.
 */
export function declaredFamilies(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const families = []
  for (const [, href] of html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2?\?[^"]*)"/g)) {
    const query = href.replaceAll('&amp;', '&').slice(href.indexOf('?') + 1)
    for (const value of new URLSearchParams(query).getAll('family')) families.push(value.split(':')[0])
  }
  return [...new Set(families)]
}

/**
 * Every family of a loaded face in the page, once `document.fonts` has
 * nothing pending -- what the page drew with -- and how many files the page
 * fetched from Google Fonts, its stylesheet and the font files, by the
 * page's own resource timing: what a failure says, so that a pass whose
 * stylesheet never arrived reads as the network's and not the page's.
 */
export function webFonts(page) {
  return page.evaluate(async () => {
    await document.fonts.ready
    return {
      loaded: [...new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll(/["']/g, '')))].sort(),
      fetched: performance.getEntriesByType('resource').filter((entry) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(entry.name)).length,
    }
  })
}

/**
 * What a pass's fonts check fails with, or null: in a pass that does not
 * refuse the web fonts, every family the page asks for loaded; in the pass
 * that refuses them, none did; and a page that asks for none fails both.
 */
export function fontProblem({ families, loaded, fetched, refused }) {
  if (families.length === 0) return 'the built page asks Google Fonts for nothing; the gate reads its families from dist/index.html'
  const files = fetched === undefined ? '' : ` (the page fetched ${String(fetched)} file${fetched === 1 ? '' : 's'} from Google Fonts)`
  if (refused) {
    const arrived = families.filter((family) => loaded.includes(family))
    return arrived.length === 0 ? null : `${prose(arrived)} loaded anyway, so this pass measured the web fonts, not the fallback stack${files}`
  }
  const missing = families.filter((family) => !loaded.includes(family))
  return missing.length === 0 ? null : `${prose(missing)} did not load, so this pass measured the fallback stack in their place${files}`
}

/**
 * What the browser says it is to the page: the user agent and platform AG
 * Grid reads (0058's FACTS.claimsSafari), its touch points, and whether
 * `(pointer: fine)` and `(hover: hover)` match, which Playwright forces for
 * headless Chromium and which decide the rules of those queries that apply.
 */
export function environmentOf(page) {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    pointerFine: matchMedia('(pointer: fine)').matches,
    hover: matchMedia('(hover: hover)').matches,
  }))
}

const firstLine = (error) => String(error instanceof Error ? error.message : error).split('\n')[0]

const answer = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * The system `browser` ran on, as far as it decides what was measured: the
 * family fontconfig gives `sans-serif`, which a page whose web fonts did not
 * arrive falls back to, and the version dpkg-query gives of every package
 * the browser takes from the runner (SYSTEM_PACKAGES). What the machine
 * cannot answer is null, with why.
 */
export function systemOf(browser, { run = answer } = {}) {
  let fallback
  try {
    fallback = { family: run('fc-match', ['-f', '%{family}', 'sans-serif']).trim().split(',')[0] }
  } catch (error) {
    fallback = { family: null, why: `fc-match gave no answer: ${firstLine(error)}` }
  }
  const packages = (SYSTEM_PACKAGES[browser] ?? []).map(({ name, gives }) => {
    try {
      const version = run('dpkg-query', ['-W', '-f', '${Version}', name]).trim()
      return version === '' ? { name, gives, version: null, why: 'dpkg-query names no version of it' } : { name, gives, version }
    } catch (error) {
      return { name, gives, version: null, why: `dpkg-query gave no version: ${firstLine(error)}` }
    }
  })
  return { fallback, packages }
}

/** The sentence a check of one of 0058's facts fails with: what the browser did, what the table says, and what changed it. */
export const unlikeTheTable = (browser, { did, says, changedBy = browserName(browser) }) => `${browserName(browser)} ${did}; 0058’s table says ${says}: a ${changedBy} release changed this, measure it again`

/** What may have changed a lost create's row in `browser`: the browser, and libsoup where the row rests on it. */
const changedByOf = (browser) => (FACTS.resendsLostPost.restsOn?.[browser] === undefined ? undefined : `${browserName(browser)} or libsoup`)

/**
 * A lost create in `browser` against 0058's postConnection and
 * resendsLostPost, from `sendings`, the TCP hop's sentOn for its marker:
 * the connection the first sending took -- `fresh` when it had carried
 * nothing before, `reused` otherwise -- and, as each check's problem or
 * null, whether it took the connection the table says (`took`) and was sent
 * as often as the table says for that connection (`often`). A browser that
 * takes an idle connection fails when it opened a new one while a kept-alive
 * one stood idle from before it opened (the hop's `passedOver`): with none
 * idle, the new connection is the other row, held as it says. One that
 * takes a new connection for every POST fails on one that carried anything.
 */
export function lostCreate(browser, sendings) {
  const [first] = sendings
  if (first === undefined) return { connection: null, took: 'the marker never crossed the hop', often: 'the marker never crossed the hop' }
  const connection = first.earlier === 0 ? 'fresh' : 'reused'
  const changedBy = changedByOf(browser)
  const takes = FACTS.postConnection.values[browser]
  let took = null
  if (takes === 'fresh' && connection === 'reused') took = unlikeTheTable(browser, { did: `sent it on a connection that had carried ${String(first.earlier)} request(s)`, says: 'it takes a new one for every POST', changedBy })
  if (takes === 'idle' && connection === 'fresh' && first.passedOver > 0) {
    took = unlikeTheTable(browser, { did: `sent it on a new connection while ${String(first.passedOver)} kept-alive connection(s) stood idle`, says: 'it takes an idle one where there is one', changedBy })
  }
  const twice = FACTS.resendsLostPost.values[browser][connection]
  const often =
    sendings.length === (twice ? 2 : 1)
      ? null
      : unlikeTheTable(browser, { did: `sent the lost create ${sendings.length === 1 ? 'once' : `${String(sendings.length)} times`} on a ${connection} connection`, says: twice ? 'twice' : 'once', changedBy })
  return { connection, took, often }
}

/**
 * Null when a run's lost creates, which took the connections in `reached`,
 * reached the row of resendsLostPost for the connection `browser` takes when
 * it can choose (postConnection): a reused one where it takes an idle one, a
 * fresh one where it opens one for every POST. Each pass holds the row of
 * the connection its create took, so a run whose creates all took the
 * other -- the server's keep-alive timeout, a pool that changed, a page
 * that left nothing idle at Save -- passes every pass and measures nothing
 * of that row: for Chromium and Firefox, the resend 0031 rests on.
 */
export function rowUnmeasured(browser, reached) {
  const expected = FACTS.postConnection.values[browser] === 'idle' ? 'reused' : 'fresh'
  if (reached.has(expected)) return null
  const row = `-- ${FACTS.resendsLostPost.values[browser][expected] ? 'sent again, which 0031 rests on' : 'sent once'} -- was measured by nothing`
  if (reached.size === 0) return `no lost create of this run crossed the hop, so 0058’s row for ${browserName(browser)} on a ${expected} connection ${row}`
  return `${browserName(browser)} sent every lost create of this run on ${expected === 'reused' ? 'a new connection' : 'a reused connection'}, so 0058’s row for a ${expected} one ${row}`
}

/**
 * What AG Grid's own tests, copied with their release into 0058's
 * claimsSafari and claimsMacOs, answer for what a page's browser says it is
 * (environmentOf): Safari by the user agent; macOS and iOS by the platform,
 * and an iPad asking for the desktop site by MacIntel with touch points.
 */
function agGridAnswers({ userAgent, platform, maxTouchPoints }) {
  const matches = ({ source, flags }, value) => new RegExp(source, flags).test(value)
  const { macOs, iOS, iPadAsMac } = FACTS.claimsMacOs.tests
  return {
    claimsSafari: matches(FACTS.claimsSafari.pattern, userAgent),
    claimsMacOs: matches(macOs, platform) || matches(iOS, platform) || (platform === iPadAsMac.platform && maxTouchPoints > iPadAsMac.moreTouchPointsThan),
  }
}

/**
 * Null when `browser`, saying it is `said` -- its user agent, platform and
 * touch points -- is answered by AG Grid as row `id` (claimsSafari or
 * claimsMacOs) says; the sentence its check fails with otherwise. A
 * Playwright release that changed what a browser says would move the grids
 * onto other code paths with nothing else to show it.
 */
export function agGridRowProblem(browser, id, said) {
  const fact = FACTS[id]
  const claims = agGridAnswers(said)[id]
  if (claims === fact.values[browser]) return null
  const did =
    id === 'claimsSafari'
      ? `${claims ? 'names itself Safari' : 'does not name itself Safari'} to AG Grid ${fact.agGrid} (${said.userAgent})`
      : `names its platform as ${claims ? 'a Mac or an iOS device' : 'neither a Mac nor an iOS device'} to AG Grid ${fact.agGrid} (${said.platform}, ${String(said.maxTouchPoints)} touch points)`
  return unlikeTheTable(browser, { did, says: fact.values[browser] ? 'it does' : 'it does not', changedBy: 'Playwright' })
}

/**
 * What every gate does at the end of every pass, on the page the pass drew,
 * in every browser: records once per run what the browser said it was and
 * the system it ran on; checks the web fonts against what `dist` asks for --
 * at the end, once every state of the pass has drawn the text that uses
 * each family; and measures the scrollbar's width, `innerWidth` less the
 * root's `clientWidth`, which is zero in headless Chromium because
 * Playwright launches it with --hide-scrollbars.
 */
export async function afterEveryPass(gate, page, { dist, refused }) {
  if (!gate.hasEnvironment()) gate.environment({ ...(await environmentOf(page)), system: systemOf(gate.asked) })
  const problem = fontProblem({ families: declaredFamilies(dist), ...(await webFonts(page)), refused })
  gate.check(refused ? 'with the web fonts refused, none loaded' : 'every web font the page asks for loaded', problem)
  gate.measure({ name: 'the scrollbar’s width, innerWidth less the root’s clientWidth', value: await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth), unit: 'px' })
}
