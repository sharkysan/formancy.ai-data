// What jsdom cannot see on the examples page, measured in the browser it is
// given.
//
// formancy.ai's browser gate (its scripts/browser-test.mjs), brought with this
// repository's first UI as CLAUDE.md asks. The suite in src/ runs in jsdom,
// and **jsdom applies no CSS, resolves no media queries and performs no
// layout**: every box measures zero and every colour has no answer. So three
// claims the page makes could only be checked by hand until this existed, and
// 0021 said so:
//
//   - nothing scrolls sideways, down to a 320px phone, and no element is past
//     the right edge;
//   - the first Tab reaches the skip link, which comes on screen, and after it
//     the next Tab reaches the first control of the first preview;
//   - the colours have enough contrast and the targets are big enough -- the
//     two rules @formancy/conformance switches off in jsdom because they are
//     measurements, run here where they can be measured;
//   - every web font the built page declares had loaded by the end of each
//     pass, and in the pass that refuses every font file, none had (0058):
//     a state measured before a late family swapped in is not caught;
//   - the page asked no other origin for anything: every such request is
//     refused, so the answer is the same with no network, and named (0072).
//     An address the policy below governs -- a stylesheet, a face, a
//     script, a fetch -- the browser refuses before any request exists, so
//     the policy check names it and this one holds what the policy does
//     not govern, such as a navigation;
//   - the page is the demo formancy.ai serves (0069): under the path its
//     Worker is routed at, with the headers its deploy writes, the browser
//     refused nothing under the Content-Security-Policy, the console said
//     nothing went wrong, the page fetched nothing but its own files under
//     the path, and an inline script put in the page was refused and
//     heard -- so a pass under a policy nobody enforced fails; and its
//     THIRD-PARTY-NOTICES.txt was sent as UTF-8 text, over the bare
//     text/plain Cloudflare gives a .txt. At the address itself the
//     console says one thing more on every load, which this gate cannot
//     see: the policy refusing the inline script Cloudflare's bot detection
//     puts into the page as it serves it, read on 2026-10-16 (0069).
//
// Against the page `vite build` produces, served over HTTP as formancy.ai
// serves it -- not the dev server, which is a different program with its
// own transforms. Asserted as numbers and computed results, never
// screenshots: a pixel baseline is a file somebody updates when it goes red.
//
// `pnpm test:browser`, which builds first, runs it once per browser
// scripts/browsers.mjs names through recordedPerBrowser -- Chromium, Firefox
// and WebKit, each in a CI leg of its own; Chromium alone on a machine
// unless FORMANCY_BROWSERS names more -- with every check in every browser.
// A browser comes from installCommand() in scripts/browsers.mjs, once per
// machine.

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'
import { afterEveryPass, canary, canaryProblem, guardRequests, hearViolations, violationsHeard } from '../../../scripts/browser-gate.mjs'
import { contentSecurityPolicy, headerRules, headersFile, headersFor, parseHeadersFile } from '../../../scripts/demo-headers.mjs'
import { serveDemo } from '../../../scripts/demo-serve.mjs'
import { noticesProblem } from '../../../scripts/getting-started/stack.mjs'
import { recordedPerBrowser } from '../../../scripts/release-report/gate-results.mjs'
import { NOTICES_FILE } from '../../../scripts/third-party-notices.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(app, 'dist')

/**
 * The widths worth measuring, and why each is in the list.
 *
 * The breakpoints are read from the stylesheet rather than written here: one
 * pixel past each `max-width`, where the wider layout it gives way to is at its
 * narrowest and so most likely to overflow. A breakpoint added to app.css is
 * measured without anybody remembering this file.
 */
function widths() {
  const css = readFileSync(join(app, 'src', 'app.css'), 'utf8')
  const breakpoints = [...css.matchAll(/@media\s*\(\s*max-width:\s*([\d.]+)rem\s*\)/g)].map((match) => Number(match[1]) * 16)
  if (breakpoints.length === 0) throw new Error('found no max-width breakpoint in src/app.css, so the widths below measure nothing')
  return [
    // WCAG 2.2 SC 1.4.10, Reflow: content at 320 CSS pixels with no
    // horizontal scrolling. The narrowest phone there is.
    { label: 'reflow, 320', width: 320 },
    // The same, with every font file refused: before the faces arrive, and
    // in a browser or behind an extension that refuses web fonts, the page
    // is drawn in the fallback stack, whose widths are not Archivo's, and
    // that page has to fit too.
    { label: 'reflow, 320, web fonts refused', width: 320, refuseFonts: true },
    // The commonest Android width, and the second phone of 0021's hand check.
    { label: 'phone, 360', width: 360 },
    ...[...new Set(breakpoints)]
      .sort((left, right) => left - right)
      .map((px) => ({ label: `one past the ${String(px)}px breakpoint`, width: px + 1 })),
    // An ordinary laptop: notes and both previews side by side.
    { label: 'laptop, 1440', width: 1440 },
  ]
}

/** How long Angular may take to arrive: the suite's own wait, doubled for a real network stack. */
const MOUNTED_WITHIN_MS = 20_000

/**
 * Wait until every preview has its Validate button: half of them are Angular, which loads on demand.
 *
 * The forms are counted inside the wait, not once before it. Counted once, a
 * count taken before React had drawn the page's navigation was 0, so the
 * wait looked for no previews, never finished on "4 of 0", and the gate
 * failed -- WebKit on CI, once at 360 px (PR #69, run 38643049102).
 */
async function mounted(page) {
  const deadline = Date.now() + MOUNTED_WITHIN_MS
  let expected = 0
  let seen = 0
  while (Date.now() < deadline) {
    expected = (await page.getByRole('navigation', { name: 'Forms on this page' }).getByRole('link').count()) * 2
    seen = await page.getByRole('button', { name: 'Validate' }).count()
    if (seen === expected && expected > 0) break
    await page.waitForTimeout(100)
  }
  // Whatever font files the mounted page has begun to load, waited for
  // before the first state is measured, as before 0058. It waits for no
  // family a later state starts to use, and holds nothing: what a pass
  // measured with is afterEveryPass's check, at its end.
  await page.evaluate(() => document.fonts.ready)
  return { expected, seen, alerts: await page.getByRole('alert').count() }
}

/**
 * Sideways scroll, and anything past either edge.
 *
 * `scrollWidth` is the whole of a too-wide layout in one number. The edges
 * catch what it does not: an element cut off by an `overflow: hidden` parent,
 * which scrolls nothing and still hides content. Every element with a box,
 * because the claim is about the page and not about one part of it.
 */
function measureWidth(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const edge = root.clientWidth
    const past = []
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= edge + 0.5 && box.left >= -0.5) continue
      const part = element.getAttribute('data-formancy-part')
      past.push(`${element.tagName.toLowerCase()}${part === null ? '' : `[${part}]`}.${String(element.className).slice(0, 24)} at ${Math.round(box.left)}..${Math.round(box.right)}`)
    }
    return { overflow: root.scrollWidth - root.clientWidth, past: [...new Set(past)].slice(0, 6) }
  })
}

/**
 * The keyboard path into the forms, from a page nobody has touched.
 *
 * Tab, and the skip link has focus and is on screen; Enter, then Tab, and the
 * focus is on the first control of the first preview -- the first element in
 * the first form that the browser itself says is tabbable. Found by role and
 * name, as everything a person acts on is (formancy.ai 0034).
 */
async function keyboardPath(page) {
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to the forms' })
  const first = await skip.evaluate((link) => {
    const box = link.getBoundingClientRect()
    return {
      focused: link === document.activeElement,
      onScreen: box.top >= 0 && box.left >= 0 && box.right <= document.documentElement.clientWidth && box.bottom <= window.innerHeight,
    }
  })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const next = await page
    .getByRole('form')
    .first()
    .evaluate((form) => {
      const tabbable = [...form.querySelectorAll('*')].filter(
        (element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0,
      )
      const active = document.activeElement
      const describe = (element) => (element === null ? 'nothing' : `${element.tagName.toLowerCase()}#${element.id}`)
      return { reached: tabbable[0] === active, active: describe(active), expected: describe(tabbable[0] ?? null) }
    })
  return { ...first, next }
}

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * axe over `target` -- the whole document unless a locator narrows it -- in
 * the configuration the renderers are held to upstream, with nothing switched
 * off: this is a page, and in a browser the two measurements jsdom cannot make
 * can be made.
 *
 * And a guard on that guard: the measurements must actually have run, over
 * something. A tag list that stopped selecting them would otherwise pass here
 * with nothing measured, which is exactly the state this gate replaces. An
 * element axe could not decide the contrast of is a contrast nobody measured,
 * so it fails too.
 *
 * axe arrives through Playwright's evaluate, not a script element: the
 * page's policy refuses an inline script, as it should (0069). What
 * Playwright evaluates is not held to that policy: measured on 2026-10-16,
 * `new Function` in an evaluation built and ran under it in Chromium 153
 * and Firefox 155. axe-core 4.14.0, loaded and run with the options below,
 * built no function through the global `Function` that day, in jsdom,
 * Chromium 153 or Firefox 155; its bundle's doT compiler, which would, was
 * not reached. So the policy neither sees nor stops what axe does, and the
 * violation check holds what the page does.
 */
async function audit(page, target) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${AXE}\n;undefined`)
  const subject = target ?? (await page.evaluateHandle(() => document))
  // Runs in the page, so it closes over nothing. No preload: by default axe
  // fetches every cross-origin stylesheet to read its rules, which the
  // page's connect-src refuses, so each audit was three violations of axe's
  // own. Measured on 2026-10-16 in Chromium, over the built page: the
  // preload fetched Google Fonts' stylesheet alone, and without it every
  // rule's passes, violations, incompletes and inapplicables were the same.
  // That stylesheet is gone (0072) and the page links none from another
  // origin, so the preload would now fetch nothing; it stays off, so that a
  // stylesheet from elsewhere is the page's failure and not axe's own: the
  // policy check's and the console's, as a link to Google's put in the
  // built page showed on 2026-10-16 (0072). The two rules that ask for it
  // are css-orientation-lock, experimental and outside the tags, and
  // no-autoplay-audio, for media the page has none of.
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags }, preload: false })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    return {
      axe: window.axe.version,
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: nodes(results.incomplete, 'color-contrast').map((node) => node.html.slice(0, 60)).slice(0, 4),
    }
  }, [...ACCESSIBILITY_TAGS])
}

/**
 * Press every preview's Validate, and wait until each form says something is
 * wrong -- read as `aria-invalid`, the state a screen reader announces, since
 * Playwright's role queries take no filter for it.
 */
async function failSubmit(page) {
  const buttons = page.getByRole('button', { name: 'Validate' })
  const count = await buttons.count()
  for (let at = 0; at < count; at += 1) await buttons.nth(at).click()
  await page.waitForFunction(
    (forms) => [...document.forms].filter((form) => form.querySelector('[aria-invalid="true"]') !== null).length >= forms,
    count,
    { timeout: 10_000 },
  )
}

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
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('no built page at apps/examples/dist: run `pnpm build` first')
  }

  // The page as formancy.ai serves it, under the path the Worker is routed
  // at and with the headers its deploy writes (scripts/demo-serve.mjs).
  const { server, port, base: BASE } = await serveDemo(dist)
  const url = `http://127.0.0.1:${String(port)}${BASE}`
  const HEADERS = parseHeadersFile(headersFile(headerRules(BASE)))

  const { check } = gate
  const sideways = (state, measured) => {
    check(`${state}, the page does not scroll sideways`, measured.overflow > 0 ? `${String(measured.overflow)}px of horizontal overflow` : null)
    check(`${state}, no element is past either edge`, measured.past.length === 0 ? null : measured.past.join('; '))
  }
  const audited = (state, result, expected = ['color-contrast', 'target-size']) => {
    gate.axe(result.axe)
    check(`${state}, axe finds nothing at WCAG 2.2 AA`, result.violations.length === 0 ? null : result.violations.join('; '))
    check(
      `${state}, and measured ${expected.join(' and ')}, over something`,
      expected.every((id) => result.measured.includes(id)) ? null : `only ${result.measured.join(', ') || 'nothing'} had anything to measure`,
    )
    check(`${state}, and decided the contrast of every text`, result.undecided.length === 0 ? null : `undecided: ${result.undecided.join('; ')}`)
  }

  try {
    const list = widths()
    for (const { label, width, refuseFonts = false } of list) {
      gate.pass({ label, width })
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      // Every request to another origin refused and named at the end of the
      // pass, and in the refusing pass every font file (0072).
      const origin = new URL(url).origin
      const guard = await guardRequests(page, { origins: [origin], refuseFonts })
      // What the page fetched on its own origin, said and threw, from its
      // first request. A font file this pass refuses fails in the console,
      // and is the pass's doing, not the page's.
      const elsewhere = new Set()
      const said = []
      page.on('request', (request) => {
        const address = request.url()
        if (address.startsWith(`${origin}/`) && !address.startsWith(url)) elsewhere.add(address)
      })
      page.on('console', (message) => {
        const text = message.text()
        const refused = [...guard.refused].some((file) => message.location()?.url === file || text.includes(file))
        if ((message.type() === 'error' && !refused) || /content[- ]security[- ]policy|permissions[- ]policy/i.test(text)) said.push(`${message.type()}: ${text.slice(0, 160)}`)
      })
      page.on('pageerror', (error) => said.push(`uncaught: ${error.message.slice(0, 160)}`))
      await hearViolations(page)
      const response = await page.goto(url, { waitUntil: 'load' })
      console.log(`\n${label} -- ${String(width)}x900`)

      // The page as formancy.ai sends it, or every check of the policy below
      // is a check of a page sent with none.
      const sent = response?.headers() ?? {}
      const unsent = Object.entries(headersFor(HEADERS, BASE)).filter(([name, value]) => sent[name.toLowerCase()] !== value)
      check(`the page at ${BASE} was sent with the demo's headers`, unsent.length === 0 ? null : `not as the deploy writes them: ${unsent.map(([name]) => name).join(', ')}`)

      // The page is what is measured, so first that it is all there: a preview
      // whose renderer did not start would make every number below smaller.
      const previews = await mounted(page)
      check(
        'every form is previewed by both renderers',
        previews.seen === previews.expected && previews.expected > 0 && previews.alerts === 0
          ? null
          : `${String(previews.seen)} of ${String(previews.expected)} previews, ${String(previews.alerts)} alerts`,
      )

      sideways('clean', await measureWidth(page))

      const keys = await keyboardPath(page)
      check('the first Tab reaches the skip link', keys.focused ? null : 'focus went somewhere else first')
      check('which is on screen while it has focus', keys.onScreen ? null : 'it stayed off screen')
      check(
        'and through it the next Tab reaches the first control of the first preview',
        keys.next.reached ? null : `focus is on ${keys.next.active}, expected ${keys.next.expected}`,
      )

      // The page with nothing focused, then the skip link alone while focus
      // puts it on screen. Alone, because shown it sits over the masthead on
      // purpose, and axe rightly cannot decide the contrast of the text under
      // it; what it covers is measured in the first run.
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      audited('clean', await audit(page))
      const skip = page.getByRole('link', { name: 'Skip to the forms' })
      await skip.focus()
      audited('the skip link, shown', await audit(page, skip), ['color-contrast'])
      await skip.blur()

      // After a failed submit every required field shows its error: new text,
      // in the theme's error colour, and new height that can push a layout.
      await failSubmit(page)
      sideways('after a failed submit', await measureWidth(page))
      audited('after a failed submit', await audit(page))

      // Everything the page did in this pass, under the headers it was sent:
      // what the policy refused, what the console said, what it fetched.
      const violations = await violationsHeard(page)
      check('the browser refused nothing under the page’s Content-Security-Policy', violations.length === 0 ? null : violations.slice(0, 4).join('; '))
      check('the console reported no error and the page threw none', said.length === 0 ? null : said.slice(0, 4).join('; '))
      check(`the page fetched nothing of its origin but its own files under ${BASE}`, elsewhere.size === 0 ? null : [...elsewhere].slice(0, 4).join(', '))
      const probe = await canary(page)
      check('and the policy held: an inline script put in the page was refused, and the page heard the refusal', canaryProblem(probe, contentSecurityPolicy()))
      if (probe.after !== null) gate.measure({ name: 'the policy’s report of the inline script, after the script was put in the page', value: probe.after, unit: 'ms' })

      // Whether the page asked another origin for anything, and whether
      // every web font had loaded by the end of the pass, or, where it
      // refuses them, none had.
      await afterEveryPass(gate, page, { dist, refused: refuseFonts, guard })

      // The notices, as the browser is sent them: text that says it is
      // UTF-8 (0046), or a browser guesses the encoding of their curly
      // quotes. Last, because it leaves the page.
      const notices = await page.goto(`${url}${NOTICES_FILE}`)
      check(`${NOTICES_FILE} was sent as UTF-8 text`, noticesProblem(`${BASE}${NOTICES_FILE}`, notices?.status() ?? 0, notices?.headers()['content-type'] ?? '') ?? null)
      await page.close()
    }

    console.log('')
    // A failed check fails the run in recordedPerBrowser, which says so.
    const measured = new Set(list.map(({ width }) => width)).size
    if (gate.failures().length === 0) {
      console.log(
        `browser checks passed: the examples page at ${String(measured)} widths, one of them also with the web fonts refused, for the layout, focus and colour facts jsdom cannot represent`,
      )
    }
  } finally {
    server.close()
  }
}

await recordedPerBrowser('apps/examples', { load, run })
