// What jsdom cannot see in the studio, measured in Chromium.
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
//     into the step; and where Enter moves or removes the button it was
//     pressed on -- a field moved down, a filter removed, a conflict rebased,
//     a restore refused, a dropped label given -- the keyboard is somewhere
//     deliberate afterwards, not on the page;
//   - the preview's paper is the theme's: no rule of studio.css selects
//     anything on it, so the preview shows what the published form will;
//   - the colours have enough contrast and the targets are big enough -- the
//     two rules jsdom cannot measure -- on every step, including the states
//     that add colour: gaps, a refused policy, a failed preview, a conflict,
//     a blocking drift, a refused restore, a regeneration and what it
//     carried (0030).
//
// Against the page `vite build` produces, served over HTTP from the same
// origin as the real data server -- createDataServer, in this process, with
// the suite's captured snapshots behind a fake connection registry -- because
// the studio speaks only to the server's origin (0024) and every step after
// sign-in needs its answers. Asserted as numbers and computed results, never
// screenshots.
//
// `pnpm test:browser`, which builds first. The browser comes from
// `pnpm exec playwright install chromium`, once per machine.

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'
import { createSnapshot } from '@formancy/data-core'
import { createDataServer, createFileConfigurationStore } from '@formancy/data-server'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(app, 'dist')
const TOKEN = 'browser-gate-administrator'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

const snapshot = (name) => JSON.parse(readFileSync(join(app, 'src', 'fixtures', name), 'utf8'))

/**
 * The real server, as the suite runs it: the captured databases behind a fake
 * registry, a store on a temporary directory, one literal administrator
 * token. `databases` is mutable so a run can drift one.
 */
async function startPlane() {
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-studio-gate-'))
  const databases = new Map([
    ['fixture', snapshot('postgres-owner.json')],
    ['fixture-reader', snapshot('postgres-reader.json')],
    ['fixture-sqlserver', snapshot('sqlserver-owner.json')],
    ['fixture-sqlserver-reader', snapshot('sqlserver-reader.json')],
    ['fixture-writer', snapshot('postgres-writer.json')],
  ])
  const registry = {
    ids: () => [...databases.keys()].sort(),
    scope: (id) => (databases.has(id) ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      const now = databases.get(id)
      if (now === undefined) return undefined
      const adapter = { kind: now.kind, ping: async () => ({ kind: now.kind, version: now.serverVersion }), discover: async () => databases.get(id), close: async () => {} }
      return { adapter, lookups: {}, records: {} }
    },
    close: async () => {},
  }
  const verifyIdentity = async (token) =>
    token === TOKEN ? { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } } : { ok: false, reason: 'ERR_JWS_INVALID' }
  const server = await createDataServer({ verifyIdentity, admin: { registry, store: createFileConfigurationStore(root), adminRoles: ['data-admin'] } })
  return { server, databases, close: async () => { await server.close(); rmSync(root, { recursive: true, force: true }) } }
}

/** The fixture's sales.order with one column renamed: to the catalog, one dropped and one added in its place. */
function renamed(from, to) {
  const { fingerprint: _, ...contents } = snapshot('postgres-owner.json')
  const column = contents.objects.find((object) => object.ref.name === 'order').columns.find((candidate) => candidate.name === from)
  column.name = to
  return createSnapshot(contents)
}

/** The built studio and the plane, on one origin, on a port the system picks. */
function serve(plane) {
  const http = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/v1/')) {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks)
        void plane.server
          .inject({ method: request.method, url: `${url.pathname}${url.search}`, headers: request.headers, ...(body.length > 0 ? { payload: body } : {}) })
          .then((reply) => {
            response.writeHead(reply.statusCode, { 'content-type': String(reply.headers['content-type'] ?? 'application/json') })
            response.end(reply.rawPayload)
          })
      })
      return
    }
    // `normalize` then a prefix check: a path with `..` must not leave dist.
    let file = join(dist, normalize(decodeURIComponent(url.pathname)))
    if (!file.startsWith(dist)) return void response.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return void response.writeHead(404, { 'content-type': 'text/plain' }).end(`no ${url.pathname}`)
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  return new Promise((ready) => http.listen(0, '127.0.0.1', () => ready({ http, port: http.address().port })))
}

/**
 * The studio's stylesheet as one text: src/studio.css with each of its
 * `@import`s replaced by the file it names, which is what Vite builds. Read
 * from the source, so a rule or a file added is checked without anybody
 * listing it here; an import that names no file, or one this does not
 * understand, stops the gate rather than checking less than the page loads.
 */
function stylesheet() {
  const entry = join(app, 'src', 'studio.css')
  const text = readFileSync(entry, 'utf8').replaceAll(/@import\s+'(\.\/[^']+\.css)';/g, (_, path) => readFileSync(join(app, 'src', path), 'utf8'))
  if (/@import/.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('src/studio.css has an @import the gate does not inline')
  return text
}

/**
 * The widths worth measuring. Breakpoints are read from the stylesheet, one
 * pixel past each `max-width`, where the wider layout is at its narrowest; a
 * breakpoint added to studio.css is measured without anybody editing this.
 */
function widths() {
  const css = stylesheet()
  const breakpoints = [...css.matchAll(/@media\s*\(\s*max-width:\s*([\d.]+)rem\s*\)/g)].map((match) => Number(match[1]) * 16)
  if (breakpoints.length === 0) throw new Error('found no max-width breakpoint in src/studio.css, so the widths below measure nothing')
  return [
    // WCAG 2.2 SC 1.4.10, Reflow: 320 CSS pixels with no horizontal scrolling.
    { label: 'reflow, 320', width: 320 },
    // The same with the web fonts refused, whose fallback widths differ.
    { label: 'reflow, 320, web fonts refused', width: 320, refuseFonts: true },
    { label: 'phone, 360', width: 360 },
    ...[...new Set(breakpoints)].sort((a, b) => a - b).map((px) => ({ label: `one past the ${String(px)}px breakpoint`, width: px + 1 })),
    { label: 'laptop, 1440', width: 1440 },
  ]
}

/** Sideways scroll, and every element with a box that is past either edge. */
function measureWidth(page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth
    const past = []
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= edge + 0.5 && box.left >= -0.5) continue
      past.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)} at ${Math.round(box.left)}..${Math.round(box.right)}`)
    }
    return { overflow: document.documentElement.scrollWidth - edge, past: [...new Set(past)].slice(0, 6) }
  })
}

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * axe at WCAG 2.2 AA with nothing switched off, and a guard on the guard: the
 * two measurements must have run over something, and every text's contrast
 * must have been decided.
 */
async function audit(page, target) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE })
  const subject = target ?? (await page.evaluateHandle(() => document))
  return subject.evaluate(async (context, tags) => {
    const results = await window.axe.run(context, { runOnly: { type: 'tag', values: tags } })
    const nodes = (list, id) => list.find((rule) => rule.id === id)?.nodes ?? []
    return {
      violations: results.violations.map((rule) => `${rule.id} (${String(rule.nodes.length)}): ${rule.nodes[0]?.html.slice(0, 90) ?? ''}`),
      measured: ['color-contrast', 'target-size'].filter((id) => nodes(results.passes, id).length > 0),
      undecided: nodes(results.incomplete, 'color-contrast').map((node) => node.html.slice(0, 60)).slice(0, 4),
    }
  }, [...ACCESSIBILITY_TAGS])
}

/** What has the keyboard's focus, said so that a failure names it. */
function describeFocus(page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (element === null || element === document.body) return 'the page itself'
    return `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`} "${(element.textContent ?? '').trim().slice(0, 40)}"`
  })
}

/**
 * Enter on `pressed`, as a keyboard user presses it; then, once `settled`
 * says the studio has answered, whether `expected` has the focus.
 *
 * In Chromium because what happens to the focus of an element React moves
 * or unmounts is the browser's to say, and jsdom has an answer of its own.
 */
async function focusAfterEnter(page, pressed, settled, expected) {
  await pressed.focus()
  await page.keyboard.press('Enter')
  await settled()
  return (await expected.evaluate((element) => element === document.activeElement)) ? null : `the focus is on ${await describeFocus(page)}`
}

/**
 * Every rule of studio.css that selects an element on the preview's paper.
 *
 * The stylesheet is read from the source and parsed by Chromium, so a rule
 * added to it is checked without anybody listing it here. A rule is matched
 * for every moment, not this one: a state the pointer or the keyboard puts an
 * element in (`:hover`, `:focus-visible`) comes off the selector first, and a
 * pseudo-element is matched as the element it hangs off. What the paper
 * inherits -- the font, the line height -- it would inherit from any host
 * page; that is not a rule selecting it.
 */
function rulesOnThePaper(page) {
  const css = stylesheet()
  return page.locator('form.sheet').evaluate((paper, text) => {
    const stylesheet = new CSSStyleSheet()
    stylesheet.replaceSync(text)
    const selectors = []
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText)
        else if ('cssRules' in rule) walk(rule.cssRules)
      }
    }
    walk(stylesheet.cssRules)
    const elements = [...paper.querySelectorAll('*')]
    const reached = []
    for (const selector of selectors) {
      const always = selector.replace(/::[\w-]+(\([^)]*\))?/g, '').replace(/:(?:focus-visible|focus-within|focus|hover|active)(?![\w-])/g, '')
      const hit = elements.find((element) => element.matches(always.trim() === '' ? '*' : always))
      if (hit !== undefined) reached.push(`${selector} selects ${hit.outerHTML.slice(0, 60)}`)
    }
    return { rules: selectors.length, tags: [...new Set(elements.map((element) => element.tagName.toLowerCase()))], reached }
  }, css)
}

/**
 * The journey, step by step: each entry brings the studio to a state and
 * names it, checking on the way what only that moment can show.
 */
function journey(plane, check) {
  const step = (page, name) => page.getByRole('main', { name })
  const nav = (page, name) => page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: new RegExp(`^\\d+\\. ${name}$`) })
  return [
    ['Connect, a restricted connection discovered', async (page) => {
      await page.getByRole('button', { name: 'Test fixture', exact: true }).click()
      // The SQL Server reader: since 0027 the one whose catalog hides what it may not use behind gaps.
      await page.getByRole('button', { name: 'Discover fixture-sqlserver-reader' }).click()
      // Inside the list of objects: the gaps above it name sales.order too.
      await page
        .getByRole('region', { name: 'What fixture-sqlserver-reader can see' })
        .getByRole('list', { name: 'Tables and views' })
        .getByText('sales.order', { exact: true })
        .click()
    }],
    ['Choose, the order with a lookup, a pin and a version column', async (page) => {
      await page.getByRole('button', { name: 'Discover fixture', exact: true }).click()
      await page.getByRole('button', { name: 'Choose a root' }).click()
      const choose = step(page, 'Choose')
      await choose.getByLabel('Root table or view').selectOption({ label: 'sales.order' })
      await choose.getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }).check()
      await choose.getByRole('checkbox', { name: 'Pin tenant_id' }).check()
      await choose.getByLabel('Version column').selectOption('row_version')
    }],
    ['Generate', async (page) => {
      await step(page, 'Choose').getByRole('button', { name: 'Generate the form' }).click()
      await step(page, 'Generate').waitFor()
    }],
    ['Policy, refused', async (page) => {
      await nav(page, 'Policy').click()
      // The Customer list's only filter: removing it takes its row, and the
      // button pressed, with it.
      const policy = step(page, 'Policy')
      const remove = policy.getByRole('button', { name: 'Remove Customer filter 1' })
      check(
        'removing the last Customer filter leaves the keyboard on Add a filter',
        await focusAfterEnter(page, remove, () => remove.waitFor({ state: 'detached' }), policy.getByRole('button', { name: 'Add a filter to the Customer list' })),
      )
    }],
    ['Policy, fitting', async (page) => {
      const policy = step(page, 'Policy')
      await policy.getByRole('button', { name: 'Add a filter to the Customer list' }).click()
      for (const operation of ['read', 'create', 'update']) await policy.getByLabel(`Roles that may ${operation}`).fill('clerk')
      await policy.getByRole('button', { name: 'Fill every field from the operations' }).click()
      await policy.getByText('The policy fits this form.').waitFor()
    }],
    ['Presentation, a field moved down by keyboard', async (page) => {
      await nav(page, 'Presentation').click()
      // React moves the row that holds the button pressed, and Chromium
      // drops the focus of an element taken out of the document, even to be
      // put back; React then gives it back. Watched failing with the rows
      // keyed by position, which remounts the row instead of moving it.
      const presentation = step(page, 'Presentation')
      const down = presentation.getByRole('button', { name: 'Move down Customer' })
      check('Move down keeps the keyboard on the button pressed', await focusAfterEnter(page, down, () => presentation.getByText('Moved Customer down.').waitFor(), down))
    }],
    ['Presentation, a label refused', async (page) => {
      await step(page, 'Presentation').getByLabel('Label of notes').fill('')
    }],
    ['Preview, after a failed submit', async (page) => {
      await step(page, 'Presentation').getByLabel('Label of notes').fill('Remarks')
      await nav(page, 'Preview').click()
      await step(page, 'Preview').getByRole('button', { name: 'Validate' }).click()
      await page.waitForFunction(() => document.querySelector('form.sheet [aria-invalid="true"]') !== null, undefined, { timeout: 10_000 })
      const paper = await rulesOnThePaper(page)
      check('the preview: no rule of studio.css selects anything on the paper', paper.reached.length === 0 ? null : paper.reached.slice(0, 6).join('; '))
      // A guard on the guard: real rules, matched against a whole form.
      const missing = ['label', 'input', 'button'].filter((tag) => !paper.tags.includes(tag))
      check('which matched studio.css against a whole form', paper.rules > 0 && missing.length === 0 ? null : `${String(paper.rules)} rules, and no ${missing.join(', ')} on the paper`)
    }],
    ['Publish, published', async (page) => {
      await nav(page, 'Publish').click()
      await step(page, 'Publish').getByRole('button', { name: 'Publish version 1' }).click()
      await page.getByText('Published version 1 of sales-order.').waitFor()
    }],
    ['Publish, a conflict', async (page) => {
      // Another administrator publishes version 2 from elsewhere.
      const latest = (await plane.server.inject({ method: 'GET', url: '/v1/forms/sales-order/versions/latest', headers: { authorization: `Bearer ${TOKEN}` } })).json()
      await plane.server.inject({ method: 'POST', url: '/v1/forms/sales-order/versions', headers: { authorization: `Bearer ${TOKEN}` }, payload: { expectedBase: 1, bundle: latest.bundle } })
      await step(page, 'Publish').getByRole('button', { name: 'Publish version 2' }).click()
      await page.getByRole('button', { name: 'Rebase on version 2' }).waitFor()
    }],
    ['Publish, rebased by keyboard', async (page) => {
      // Rebasing closes the conflict the button sits in. What is left to do
      // is publish, on top of the version just rebased onto.
      const publish = step(page, 'Publish')
      const rebase = publish.getByRole('button', { name: 'Rebase on version 2' })
      const again = publish.getByRole('button', { name: 'Publish over version 2' })
      check('rebasing leaves the keyboard on Publish', await focusAfterEnter(page, rebase, () => again.waitFor(), again))
    }],
    ['Drift, blocking', async (page) => {
      const { fingerprint: _, ...contents } = structuredClone(plane.databases.get('fixture'))
      const order = contents.objects.find((object) => object.ref.name === 'order')
      order.columns = order.columns.filter((column) => column.name !== 'notes')
      plane.databases.set('fixture', createSnapshot(contents))
      await nav(page, 'Drift').click()
      await step(page, 'Drift').getByRole('button', { name: 'Check drift' }).click()
      await page.getByRole('region', { name: /^Version \d+ of sales-order, against the database now$/ }).waitFor()
    }],
    // 0030's answers to drift. Version 1 is bound to the dropped notes, so its
    // restore is refused, with what blocks it; the button stays, and keeps
    // the keyboard.
    ['Drift, a restore refused', async (page) => {
      const versions = step(page, 'Drift').getByRole('region', { name: 'Versions of sales-order' })
      const restore = versions.getByRole('button', { name: 'Restore version 1' })
      check('a refused restore leaves the keyboard on its button', await focusAfterEnter(page, restore, () => versions.getByRole('alert').waitFor(), restore))
    }],
    ['Drift, regenerated', async (page) => {
      // notes renamed to memo: the label chosen for notes is dropped, and memo is a field to give it to.
      plane.databases.set('fixture', renamed('notes', 'memo'))
      const drift = step(page, 'Drift')
      await drift.getByRole('button', { name: 'Regenerate, keeping your presentation' }).click()
      await drift.getByRole('region', { name: /^Regenerated from version \d+$/ }).waitFor()
    }],
    ['Presentation, carried', async (page) => {
      await step(page, 'Drift').getByRole('button', { name: 'Continue to presentation' }).click()
      const presentation = step(page, 'Presentation')
      const give = presentation.getByRole('region', { name: /^Carried from version \d+$/ }).getByRole('button', { name: 'Give “Remarks”' })
      check('giving a dropped label to memo leaves the keyboard on the button pressed', await focusAfterEnter(page, give, () => presentation.getByText('Labelled memo “Remarks”.').waitFor(), give))
    }],
    ['Drift, restored', async (page) => {
      // The database put back: version 1 can be served again, and is restored as the next version.
      plane.databases.set('fixture', snapshot('postgres-owner.json'))
      await nav(page, 'Drift').click()
      const drift = step(page, 'Drift')
      await drift.getByRole('button', { name: 'Check drift' }).click()
      const versions = drift.getByRole('region', { name: 'Versions of sales-order' })
      await versions.getByRole('button', { name: 'Restore version 1' }).click()
      await versions.getByText(/^Restored version 1 as version \d+/).waitFor()
    }],
  ]
}

async function run() {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('no built studio at apps/studio/dist: run `pnpm build` first')
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error('playwright is not installed: run `pnpm install`')
  }
  let browser
  try {
    browser = await chromium.launch()
  } catch (error) {
    throw new Error(`could not launch Chromium (${String(error)}).\nRun \`pnpm exec playwright install chromium\`.`)
  }

  const failures = []
  const check = (name, problem) => {
    if (problem === null) {
      console.log(`  ok    ${name}`)
      return
    }
    console.log(`  FAIL  ${name}\n          ${problem}`)
    failures.push(`${name}: ${problem}`)
  }
  const measured = async (page, state) => {
    const width = await measureWidth(page)
    check(`${state}: no sideways scroll`, width.overflow > 0 ? `${String(width.overflow)}px of horizontal overflow` : null)
    check(`${state}: nothing past either edge`, width.past.length === 0 ? null : width.past.join('; '))
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
    const result = await audit(page)
    check(`${state}: axe finds nothing at WCAG 2.2 AA`, result.violations.length === 0 ? null : result.violations.join('; '))
    check(`${state}: contrast and target size measured, over something`, result.measured.length === 2 ? null : `only ${result.measured.join(', ') || 'nothing'}`)
    check(`${state}: the contrast of every text decided`, result.undecided.length === 0 ? null : `undecided: ${result.undecided.join('; ')}`)
  }

  const list = widths()
  try {
    for (const { label, width, refuseFonts = false } of list) {
      const plane = await startPlane()
      const { http, port } = await serve(plane)
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      if (refuseFonts) await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
      try {
        await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'load' })
        console.log(`\n${label} -- ${String(width)}x900`)

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
        await measured(page, 'Sign in')
        await token.fill(TOKEN)
        await page.getByRole('button', { name: 'Sign in' }).click()
        await page.getByRole('navigation', { name: 'Steps' }).waitFor()

        // From the top of the workbench: the skip link, on screen, into the step.
        await page.mouse.click(1, 1)
        await page.keyboard.press('Tab')
        const skip = page.getByRole('link', { name: 'Skip to the step' })
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
        await measured(page, 'Connect')

        for (const [state, act] of journey(plane, check)) {
          await act(page)
          await measured(page, state)
        }
      } finally {
        await page.close()
        http.close()
        await plane.close()
      }
    }
  } finally {
    await browser.close()
  }

  console.log('')
  if (failures.length > 0) throw new Error(`${String(failures.length)} browser check(s) failed:\n  ${failures.join('\n  ')}`)
  console.log(
    `browser checks passed: the studio's whole journey at ${String(new Set(list.map(({ width }) => width)).size)} widths, one of them also with the web fonts refused, for the layout, focus and colour facts jsdom cannot represent`,
  )
}

await run()
