// What every browser gate does to a page in every browser (0058): start the
// keyboard from the top of the page the harness's way, refuse and name
// every request to an origin the gate does not serve (0072), check that the
// web fonts the built page declares arrived -- or, in the pass that refuses
// them, that none did -- measure the scrollbar, and record once per
// browser's run what the browser said it was and the system it ran on.
//
// Each apps/*/scripts/browser-test.mjs calls these on the page it is given;
// this module holds no package import, so it never loads a second copy of
// Playwright beside the app's (gate-results.mjs's recordedPerBrowser takes
// the app's `load` for the same reason).

import { execFileSync } from 'node:child_process'
import { browserName, FACTS, prose, SYSTEM_PACKAGES } from './browsers.mjs'
import { declaredFamilies } from './fonts.mjs'

export { declaredFamilies }

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

/** A request for a font file: a `.woff2` or a `.woff`, from whatever origin. */
const FONT_FILE = /\.woff2?$/i

/** Whether `address` asks for a font file, whatever its origin: what the refusing pass refuses. */
export function isFontFile(address) {
  try {
    return FONT_FILE.test(new URL(address).pathname)
  } catch {
    return false
  }
}

/**
 * Whether `address` is a request to an origin not in `origins`: another
 * host, and another port of 127.0.0.1, which is another server. A `data:`
 * or `blob:` address is the page's own bytes, asked of nobody.
 */
export function isForeign(address, origins) {
  const url = new URL(address)
  if (url.protocol === 'data:' || url.protocol === 'blob:') return false
  return !origins.has(url.origin)
}

/**
 * Every request `page` makes, from its first, routed (0072): one to an
 * origin not in `origins` is aborted, so the answer is the same with no
 * network and the runner tells nobody anything, and kept for the pass to
 * name; and where `refuseFonts`, every font file is aborted too, whatever
 * its origin, and kept, so a console line about one is the pass's doing.
 * A route the gate adds later for one request runs first, and this one for
 * everything it leaves. Returns `allow(origin)`, for a pass that signs in
 * on a second origin; `refused`, the font files aborted; and `foreign()`,
 * the addresses aborted since it was last asked.
 */
export async function guardRequests(page, { origins, refuseFonts = false }) {
  const allowed = new Set(origins)
  const asked = []
  const refused = new Set()
  await page.route(/.*/, (route) => {
    const address = route.request().url()
    if (isForeign(address, allowed)) {
      asked.push(address)
      return route.abort()
    }
    if (refuseFonts && isFontFile(address)) {
      refused.add(address)
      return route.abort()
    }
    return route.fallback()
  })
  return { allow: (origin) => allowed.add(origin), refused, foreign: () => asked.splice(0) }
}

/**
 * A console line about a Content-Security-Policy, in each browser's words:
 * Chromium's "violates the following Content Security Policy directive",
 * Firefox's "Content-Security-Policy: The page's settings blocked" and
 * WebKit's "does not appear in the … directive of the Content Security
 * Policy".
 */
const POLICY_LINE = /content[- ]security[- ]policy/i

/**
 * How long a policy's report of the canary's script may take. Measured on
 * 2026-10-16, on Windows 11, by the examples page's gate, which records it
 * in every pass since: it arrived 0.5 to 7.1 ms after the script was put in
 * the page in Chromium 153, over 14 passes, and in 1 ms or less in Firefox
 * 155, whose clock reads whole milliseconds, over 7. Two seconds is more
 * than two hundred times the slowest, and runs out only on a pass that
 * heard nothing, which then fails.
 */
export const CANARY_WAIT_MS = 2_000

/**
 * What the page's documents hear of their policy, from before each one's
 * first script: every `securitypolicyviolation`, kept on the window for the
 * gate to read. A violation is what the browser refused, and so something
 * the page meant to do and could not under the headers it is served with.
 * An init script is the browser's own, not an element of the page, so the
 * policy does not refuse it -- the examples page's gate has run under its
 * policy so in every browser since 0069.
 */
export function hearViolations(page) {
  return page.addInitScript(() => {
    const heard = []
    Object.defineProperty(window, '__formancyGateViolations', { value: heard })
    document.addEventListener(
      'securitypolicyviolation',
      (event) => heard.push(`${event.effectiveDirective} refused ${event.blockedURI || 'something inline'} (${event.sourceFile || 'the page'}:${String(event.lineNumber)})`),
      true,
    )
  })
}

/** The violations the page's document has heard and not yet given, taken. */
export const violationsHeard = (page) => page.evaluate(() => (window.__formancyGateViolations ?? []).splice(0))

/**
 * The guard on the violation check, at the end of a pass: an inline script
 * put in the page, which a policy without `'unsafe-inline'` in script-src
 * refuses. A pass in which it ran measured a page under no policy; one in
 * which the browser refused it and the page heard nothing measured with a
 * listener that hears nothing. Either way the violation checks before it
 * proved nothing, so canaryProblem fails it.
 *
 * The report is queued as a task of its own, after the script is put in
 * the page; `after` is how long after, and the probe waits CANARY_WAIT_MS
 * for it before calling it unheard. What it heard is taken off the window,
 * since the refusal is the gate's doing, not the page's; the console line
 * the refusal writes is not, so the canary is the last thing a gate does
 * in a document.
 *
 * What the window held when it started -- heard after the gate's last read
 * and read by no check -- is taken off too, as `unread`, and fails the
 * canary's check: a gate reads what its document was refused after its
 * last measured state (policyRefused) just before it, which leaves
 * nothing there. That read is the gate's, since the console lines are
 * read there too.
 */
export function canary(page) {
  return page.evaluate(async (wait) => {
    const heard = window.__formancyGateViolations ?? []
    const unread = heard.splice(0)
    const arrived = new Promise((settle) => document.addEventListener('securitypolicyviolation', () => settle(performance.now()), { once: true, capture: true }))
    const started = performance.now()
    const script = document.createElement('script')
    script.textContent = 'window.__formancyGateCanary = true'
    document.head.append(script)
    script.remove()
    const at = await Promise.race([arrived, new Promise((settle) => setTimeout(() => settle(null), wait))])
    return { ran: window.__formancyGateCanary === true, heard: heard.splice(0).length, unread, after: at === null ? null : at - started }
  }, CANARY_WAIT_MS)
}

/** What the canary's check fails with, or null: `policy` is the header's value the page was meant to be sent with. */
export function canaryProblem({ ran, heard, unread = [] }, policy) {
  if (ran) return `it ran, so the page was measured under no policy, not ${policy.slice(0, 32)}…`
  if (heard === 0) return 'refused, and heard by nothing, so the checks before it heard nothing either'
  return unread.length === 0 ? null : `refused and heard, but before it the document had heard what no check read: ${refusedProblem(unread, [])}`
}

/** What a check that the browser refused nothing fails with, or null: what the document heard and the console said, each once, the first four. */
export function refusedProblem(heard, said) {
  const each = [...new Set([...heard, ...said])]
  if (each.length === 0) return null
  return `${each.slice(0, 4).join('; ')}${each.length > 4 ? `; and ${String(each.length - 4)} more` : ''}`
}

const hearers = new WeakMap()

/**
 * Hears `page`'s policy from its first document on: the violations each
 * document reports (hearViolations) and every console line about the policy
 * (POLICY_LINE), which is where a browser says what it refused when a
 * report is not made, until policyRefused takes them. Before the first
 * navigation.
 */
export async function hearPolicy(page) {
  const said = []
  page.on('console', (message) => {
    const text = message.text()
    if (POLICY_LINE.test(text)) said.push(`the console said: ${text.slice(0, 160)}`)
  })
  await hearViolations(page)
  hearers.set(page, said)
}

/**
 * What `page` was refused under its policy since this was last asked, as
 * refusedProblem says it, or null. Read before a navigation, which starts a
 * window that has heard nothing. Throws for a page hearPolicy was not given,
 * which would otherwise pass having heard nothing.
 */
export async function policyRefused(page) {
  const said = hearers.get(page)
  if (said === undefined) throw new Error('policyRefused: hearPolicy was never given this page')
  return refusedProblem(await violationsHeard(page), said.splice(0))
}

/** What the check that a pass asked no other origin for anything fails with, or null: each address once, the first four. */
export function foreignProblem(asked) {
  if (asked.length === 0) return null
  const each = [...new Set(asked)]
  return `${String(each.length)} address${each.length === 1 ? '' : 'es'} on another origin, each refused: ${each.slice(0, 4).join(', ')}${each.length > 4 ? ', …' : ''}`
}

/**
 * Every family of a loaded face in the page, once `document.fonts` has
 * nothing pending -- what the page drew with -- and how many font files the
 * page fetched, by its own resource timing: what a failure says, so that a
 * pass whose faces never arrived can be told from a page that stopped
 * declaring them.
 */
export function webFonts(page) {
  return page.evaluate(async (pattern) => {
    await document.fonts.ready
    const fontFile = new RegExp(pattern, 'i')
    return {
      loaded: [...new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll(/["']/g, '')))].sort(),
      fetched: performance.getEntriesByType('resource').filter((entry) => fontFile.test(new URL(entry.name).pathname)).length,
    }
  }, FONT_FILE.source)
}

/**
 * What a pass's fonts check fails with, or null: in a pass that does not
 * refuse the web fonts, every family the built stylesheets declare loaded;
 * in the pass that refuses them, none did; and a page whose stylesheets
 * declare none fails both.
 */
export function fontProblem({ families, loaded, fetched, refused }) {
  if (families.length === 0) return "the built page's stylesheets declare no font face; the gate reads its families from the stylesheets dist/index.html links"
  const files = fetched === undefined ? '' : ` (the page fetched ${String(fetched)} font file${fetched === 1 ? '' : 's'})`
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
 * Null when `browser`, in `counts` -- the host gate's focusScroll: for the
 * window and for a scroller, the trials in which a focus scrolled it, and in
 * how many of them the page went on saying the scroll from before, in the
 * task that focused -- answered as 0058's reportsFocusScroll says, for each:
 * in none where the row says it says so at once, in some where it says it
 * does not. A kind of scroll no focus of the probe made was measured by
 * nothing.
 */
export function focusScrollProblem(browser, counts) {
  const says = FACTS.reportsFocusScroll.values[browser]
  for (const [kind, { trials, late }] of Object.entries(counts)) {
    const what = kind === 'window' ? 'the window' : 'a scroller'
    if (trials === 0) return `no focus of the probe scrolled ${what}, so 0058’s reportsFocusScroll was measured by nothing there`
    if ((late === 0) === says) continue
    const did =
      late === 0
        ? `said where every one of ${String(trials)} focuses scrolled ${what}, in the task that focused`
        : `went on saying where ${what} was before ${String(late)} of ${String(trials)} focuses scrolled it, in the task that focused`
    return unlikeTheTable(browser, { did, says: says ? 'it says so at once' : 'it says so only after a rendering update' })
  }
  return null
}

/**
 * What every gate does at the end of every pass, on the page the pass drew,
 * in every browser: records once per run what the browser said it was and
 * the system it ran on; checks that the page asked no other origin for
 * anything, from what `guard` (guardRequests) refused; checks the web fonts
 * against what `dist` declares -- at the end, once every state of the pass
 * has drawn the text that uses each family; and measures the scrollbar's
 * width, `innerWidth` less the root's `clientWidth`, which is zero in
 * headless Chromium because Playwright launches it with --hide-scrollbars.
 */
export async function afterEveryPass(gate, page, { dist, refused, guard }) {
  if (!gate.hasEnvironment()) gate.environment({ ...(await environmentOf(page)), system: systemOf(gate.asked) })
  gate.check('the page asked no other origin for anything', foreignProblem(guard.foreign()))
  const problem = fontProblem({ families: declaredFamilies(dist), ...(await webFonts(page)), refused })
  gate.check(refused ? 'with the web fonts refused, none loaded' : 'every web font the page asks for loaded', problem)
  gate.measure({ name: 'the scrollbar’s width, innerWidth less the root’s clientWidth', value: await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth), unit: 'px' })
}
