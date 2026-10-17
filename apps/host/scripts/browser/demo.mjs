// The live demo's page in Chromium (0070): the host page's demo build under
// /data/demo/ with the `_headers` its deploy writes, the session and the
// runtime plane answered by the demo's own Worker in front of a visitor's
// own container of the demo's image -- the origin scripts/live-demo-gate.mjs
// stands up. What a visitor does, by role and accessible name: the first
// Tab on the skip link and the next on the first person, Enter signing in,
// the menu, the orders paged and searched, an order opened with its lines
// and deliveries, a change to it saved, a new order whose customer is found
// with the typeahead, a line added to it, and the new order deleted -- a
// line goes with its order, since the order line form offers no delete of
// its own, as the generator decides (0070). Throughout: the page asks no other origin for
// anything, reports no policy violation and logs no error. axe finds nothing
// on the sign-in, where it also measured contrast and target size and left
// no contrast undecided, and finds no violation with an order open, where
// the host page's own gate decides what axe cannot behind AG Grid's layers.
// The sign-in does not scroll sideways at 320 pixels. And the reason for
// the policy's one allowance: the same page under the examples page's
// policy reports AG Grid's style elements refused.
//
// Every element is found by its role and accessible name -- the open
// record by its region, which its heading names -- and only which element
// holds the keyboard is read from the document, as its active element,
// which the accessibility tree Playwright queries does not say.
//
// Chromium only, here and in CI's live-demo job: the three-browser gate is
// the host page's own (browser-test.mjs), which this build shares every
// component with but the sign-in. Here, where the app declares Playwright.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'
import { contentSecurityPolicy, POLICY } from '../../../../scripts/demo-headers.mjs'
import { foreignProblem, guardRequests } from '../../../../scripts/browser-gate.mjs'
import { LIVE_POLICY } from '../../../../scripts/live-demo-headers.mjs'

/** A visitor's first start is the container's own start, then the menu: 4.8-11.6 s were measured on 2026-10-16 and 2026-10-17 at basic's share. */
const STARTED = { timeout: 60_000 }
const WITHIN = { timeout: 20_000 }

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * axe over the document, through Playwright's evaluate: the page's policy
 * refuses an inline script, as it should, and what Playwright evaluates is
 * not held to it -- apps/examples/scripts/browser-test.mjs says what was
 * measured of that, and why the preload stays off.
 */
async function audit(page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${AXE}\n;undefined`)
  return page.evaluate(async (tags) => {
    const results = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, preload: false })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    return {
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: nodes(results.incomplete, 'color-contrast').map((node) => node.html.slice(0, 60)),
    }
  }, [...ACCESSIBILITY_TAGS])
}

/** Records every policy violation the page reports, from before its first script. */
function hearViolations() {
  window.formancyViolations = []
  document.addEventListener('securitypolicyviolation', (event) => window.formancyViolations.push(`${event.effectiveDirective} refused ${event.blockedURI || 'inline'}`))
}

const violationsOf = (page) => page.evaluate(() => window.formancyViolations.splice(0))
const focusedName = (page) => page.evaluate(() => `${document.activeElement?.tagName.toLowerCase() ?? 'nothing'} "${(document.activeElement?.textContent ?? '').trim().slice(0, 40)}"`)
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (scope, name) => scope.getByRole('grid', { name, exact: true })
/** The open record's region, named by its heading: `Order k1:1`, `New record`, or a pattern for a token not known yet. */
const detail = (page, name) => page.getByRole('region', { name, exact: typeof name === 'string' })
const paper = (scope, form) => scope.getByRole('form', { name: `${form}, React`, exact: true })

/** Waits until the status of `region` matches `pattern`. */
async function says(region, pattern) {
  const status = region.getByRole('status').first()
  await status.filter({ hasText: pattern }).waitFor(WITHIN)
}

/** Signs in as Clara from the sign-in, by the keyboard, and waits for the menu. */
async function signInAsClara(page) {
  await page.getByRole('button', { name: 'Sign in as Clara' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('navigation', { name: 'Forms' }).waitFor(STARTED)
}

/** Opens the orders, waiting for their first page. */
async function openOrders(page) {
  await page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: 'Order order' }).click()
  await says(records(page), /^Rows 1–50; more follow\.$/)
}

/**
 * The pass: `origin` is the gate's, `prefix` the demo's path. Each check's
 * verdict goes to `check(name, problem)`, null when it held; `timed(name,
 * work)` keeps how long a step took.
 */
export async function demoPass({ origin, prefix, check, timed }) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const errors = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))
    // What answered with an error, by path and the answer's own words: a
    // console line says only the status.
    page.on('response', async (response) => {
      if (response.status() < 400) return
      const body = await response.text().catch(() => '')
      errors.push(`${response.request().method()} ${new URL(response.url()).pathname} answered ${String(response.status())} ${body.slice(0, 200)}`)
    })
    await page.addInitScript(hearViolations)
    const guard = await guardRequests(page, { origins: [origin] })
    const address = `${origin}${prefix}/`

    const response = await page.goto(address)
    check('the page is sent with the live policy', response?.headers()['content-security-policy'] === contentSecurityPolicy(LIVE_POLICY) ? null : `it said ${String(response?.headers()['content-security-policy'])}`)
    await page.getByRole('button', { name: 'Sign in as Clara' }).waitFor(WITHIN)

    // The keyboard path a visitor starts on, and the sign-in as everyone reads it.
    await page.keyboard.press('Tab')
    const skip = await focusedName(page)
    await page.keyboard.press('Tab')
    const next = await focusedName(page)
    check('the first Tab is on the skip link and the next on the first person', skip === 'a "Skip to the workspace"' && next === 'button "Sign in as Clara"' ? null : `${skip}, then ${next}`)
    const signIn = await audit(page)
    check('axe finds nothing on the sign-in, and measured contrast and target size there', signIn.violations.length === 0 && signIn.measured.length === 2 && signIn.undecided.length === 0 ? null : JSON.stringify(signIn))
    await page.setViewportSize({ width: 320, height: 800 })
    const sideways = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth)
    check('the sign-in does not scroll sideways at 320 pixels', sideways <= 0 ? null : `it scrolls ${String(sideways)} px`)
    await page.setViewportSize({ width: 1280, height: 900 })

    // Enter on the first person starts the visitor's own server.
    await timed('Browser: Enter on Sign in as Clara, to the menu of forms', () => signInAsClara(page))
    check('signed in, the keyboard is on Forms', (await focusedName(page)) === 'h2 "Forms"' ? null : `it is on ${await focusedName(page)}`)

    // The orders, paged and searched.
    await openOrders(page)
    await records(page).getByRole('button', { name: 'Next rows' }).click()
    await says(records(page), /^Rows 51–100; more follow\.$/)
    const search = page.getByRole('search', { name: 'Search records' })
    await search.getByRole('textbox', { name: 'Search' }).fill('dock')
    await search.getByRole('button', { name: 'Search' }).click()
    await says(records(page), /^Rows 1–\d+\.$/)
    const found = await grid(records(page), 'Records').getByRole('row').count()
    check('a search narrows the orders to one page', found > 1 && found <= 51 ? null : `the grid has ${String(found)} rows`)
    await search.getByRole('textbox', { name: 'Search' }).fill('')
    await search.getByRole('button', { name: 'Search' }).click()
    await says(records(page), /^Rows 1–50; more follow\.$/)

    // An order, its lines and deliveries in the linked grids, and a change saved.
    await grid(records(page), 'Records').getByRole('gridcell', { name: '1', exact: true }).first().click()
    const first = detail(page, 'Order k1:1')
    await first.getByRole('heading', { level: 3, name: 'Order k1:1' }).waitFor(WITHIN)
    const lines = first.getByRole('region', { name: 'Order line', exact: true })
    await says(lines, /^Order line rows 1–\d+\.$/)
    await says(first.getByRole('region', { name: 'Delivery', exact: true }), /^Delivery rows 1–\d+\.$/)
    const lineRows = (await grid(lines, 'Order line').getByRole('row').count()) - 1
    check("an order opens with its lines in the linked grid", lineRows > 0 ? null : 'its lines grid has no row')
    const open = await audit(page)
    check('axe finds no violation with an order open', open.violations.length === 0 ? null : open.violations.join('; '))
    const note = `Changed in the browser at ${new Date().toISOString()}`
    await paper(first, 'Order').getByRole('textbox', { name: 'Notes' }).fill(note)
    await paper(first, 'Order').getByRole('button', { name: 'Save' }).click()
    await grid(records(page), 'Records').getByRole('gridcell', { name: note }).waitFor(WITHIN)
    check('a change to the order is saved, and the records grid shows it', null)

    // A new order: its customer found with the typeahead, a line added, and
    // the order deleted with its line.
    await records(page).getByRole('button', { name: 'New record' }).click()
    const fresh = detail(page, 'New record')
    await fresh.getByRole('heading', { level: 3, name: 'New record' }).waitFor(WITHIN)
    const customer = paper(fresh, 'Order').getByRole('combobox', { name: 'Customer*' })
    await customer.click()
    await customer.pressSequentially('Kunz', { delay: 60 })
    const option = page.getByRole('option').filter({ hasText: 'Kunz' }).first()
    await option.waitFor(WITHIN)
    const offered = await page.getByRole('option').allTextContents()
    check('the customer typeahead offers what the visitor typed', offered.length > 0 && offered.every((text) => text.includes('Kunz')) ? null : `it offered ${JSON.stringify(offered.slice(0, 4))}`)
    await option.click()
    await paper(fresh, 'Order').getByRole('textbox', { name: 'Order date*' }).fill('2026-10-17')
    await paper(fresh, 'Order').getByRole('textbox', { name: 'Status' }).fill('placed')
    await paper(fresh, 'Order').getByRole('textbox', { name: 'Amount*' }).fill('13')
    await paper(fresh, 'Order').getByRole('button', { name: 'Save' }).click()
    const made = detail(page, /^Order k1:\d+$/)
    const created = made.getByRole('heading', { level: 3, name: /^Order k1:\d+$/ })
    await created.waitFor(WITHIN)
    const token = ((await created.textContent()) ?? '').replace(/^Order\s*/, '').trim()
    check('the new order is created', /^k1:\d+$/.test(token) && token !== 'k1:1' ? null : `the detail says ${token}`)
    const madeLines = made.getByRole('region', { name: 'Order line', exact: true })
    await madeLines.getByRole('button', { name: 'New Order line' }).click()
    const linePaper = madeLines.getByRole('form', { name: 'New Order line, React', exact: true })
    await linePaper.waitFor(WITHIN)
    await linePaper.getByRole('spinbutton', { name: 'Line no*' }).fill('1')
    await linePaper.getByRole('spinbutton', { name: 'Quantity*' }).fill('4')
    await linePaper.getByRole('textbox', { name: 'Unit price*' }).fill('3.25')
    await linePaper.getByRole('button', { name: 'Save' }).click()
    await says(madeLines, /^Order line rows 1–1\.$/)
    check('a line is added to the new order, in its linked grid', null)
    await made.getByRole('button', { name: 'Delete record' }).click()
    await page.getByRole('button', { name: 'Delete it' }).click()
    await grid(records(page), 'Records').getByRole('button', { name: `Delete Order ${token}` }).waitFor({ state: 'detached', ...WITHIN })
    // That its line went with it is the API journey's to show, which reads
    // the line after the delete (scripts/live-demo-gate/journey.mjs): a
    // visitor's page has no way to ask for a line it no longer lists.
    check('the new order is deleted, by Delete record and Delete it, and leaves the records', null)

    check('the page asked no other origin for anything', foreignProblem(guard.foreign()))
    check('the page reported no policy violation', (await violationsOf(page)).join('; ') || null)
    check('the page logged no error', errors.splice(0).join('; ') || null)

    // The one allowance, watched being needed: the page under the examples
    // page's policy, signed in again on the same server, its grid drawn.
    await page.route(address, async (route) => {
      const original = await route.fetch()
      await route.fulfill({ response: original, headers: { ...original.headers(), 'content-security-policy': contentSecurityPolicy(POLICY) } })
    })
    await page.goto(address)
    await signInAsClara(page)
    await openOrders(page)
    const refused = await violationsOf(page)
    check("under the examples page's policy, AG Grid's style elements are refused", refused.some((violation) => violation.startsWith('style-src-elem refused inline')) ? null : `the page reported ${JSON.stringify(refused)}`)
    errors.splice(0)
  } finally {
    await browser.close()
  }
}
