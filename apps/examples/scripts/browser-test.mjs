// What jsdom cannot see on the examples page, measured in Chromium.
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
//     measurements, run here where they can be measured.
//
// Against the page `vite build` produces, served over HTTP -- not the dev
// server, which is a different program with its own transforms. Asserted as
// numbers and computed results, never screenshots: a pixel baseline is a file
// somebody updates when it goes red.
//
// `pnpm test:browser`, which builds first. The browser comes from
// `pnpm exec playwright install chromium`, once per machine.

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'
import { recorded } from '../../../scripts/release-report/gate-results.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(app, 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/**
 * The built page over HTTP, on a port the operating system picks.
 *
 * Hand-rolled rather than `vite preview`, as upstream's is: what is checked is
 * what a host serves.
 */
function serve(directory) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    // `normalize` then a prefix check: a path with `..` in it must not leave
    // the directory, even on a server only this script talks to.
    let file = join(directory, normalize(decodeURIComponent(url.pathname)))
    if (!file.startsWith(directory)) {
      response.writeHead(403).end()
      return
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`no ${url.pathname}`)
      return
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port }))
  })
}

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
    // The same, with the web fonts refused: a network that blocks Google Fonts
    // gets the fallback stack, whose widths are not Archivo's, and that page
    // has to fit too. Refused here rather than left to whether this machine is
    // online, so the run measures it either way.
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

/** Wait until every preview has its Validate button: half of them are Angular, which loads on demand. */
async function mounted(page) {
  const forms = await page.getByRole('navigation', { name: 'Forms on this page' }).getByRole('link').count()
  const expected = forms * 2
  const deadline = Date.now() + MOUNTED_WITHIN_MS
  let seen = 0
  while (Date.now() < deadline) {
    seen = await page.getByRole('button', { name: 'Validate' }).count()
    if (seen === expected && expected > 0) break
    await page.waitForTimeout(100)
  }
  // The page asks Google Fonts for its families. Measured either way -- a
  // visitor whose network refuses them gets the fallback stack, and that page
  // must fit too -- but said, so a run knows which page it measured.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    return [...new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll('"', '')))].sort()
  })
  return { expected, seen, alerts: await page.getByRole('alert').count(), fonts }
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
 */
async function audit(page, target) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE })
  const subject = target ?? (await page.evaluateHandle(() => document))
  // Runs in the page, so it closes over nothing.
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags } })
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

/** The gate, reporting through `gate` (scripts/release-report/gate-results.mjs), which keeps what it found for the release report. */
async function run(gate) {
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('no built page at apps/examples/dist: run `pnpm build` first')
  }

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error('playwright is not installed: run `pnpm install`')
  }

  const { server, port } = await serve(dist)
  const url = `http://127.0.0.1:${String(port)}/`

  let browser
  try {
    browser = await chromium.launch()
  } catch (error) {
    server.close()
    throw new Error(`could not launch Chromium (${String(error)}).\nRun \`pnpm exec playwright install chromium\`.`)
  }
  gate.launched(chromium, browser)

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
      gate.width(width)
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      if (refuseFonts) await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
      await page.goto(url, { waitUntil: 'load' })
      console.log(`\n${label} -- ${String(width)}x900`)

      // The page is what is measured, so first that it is all there: a preview
      // whose renderer did not start would make every number below smaller.
      const previews = await mounted(page)
      console.log(`  web fonts: ${previews.fonts.length === 0 ? 'none loaded, so the fallback stack is measured' : previews.fonts.join(', ')}`)
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

      await page.close()
    }

    console.log('')
    const failures = gate.failures()
    if (failures.length > 0) {
      throw new Error(`${String(failures.length)} browser check(s) failed:\n  ${failures.join('\n  ')}`)
    }
    const measured = new Set(list.map(({ width }) => width)).size
    console.log(
      `browser checks passed: the examples page at ${String(measured)} widths, one of them also with the web fonts refused, for the layout, focus and colour facts jsdom cannot represent`,
    )
  } finally {
    await browser.close()
    server.close()
  }
}

await recorded('apps/examples', run)
