// What jsdom cannot see in the studio, measured in Chromium.
//
// The examples page's gate (apps/examples/scripts/browser-test.mjs), applied
// to the studio as CLAUDE.md asks of every UI here. The suite in src/ runs in
// jsdom, which applies no CSS, resolves no media queries and performs no
// layout, so three claims the studio makes could only be checked by hand:
//
//   - nothing scrolls sideways and nothing is past either edge, on every
//     step of the journey, down to a 320px phone;
//   - the keyboard path: the first Tab on the sign-in screen reaches the
//     token, and in the workbench the skip link comes on screen and leads
//     into the step;
//   - the colours have enough contrast and the targets are big enough -- the
//     two rules jsdom cannot measure -- on every step, including the states
//     that add colour: gaps, a refused policy, a failed preview, a conflict,
//     a blocking drift.
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
 * The widths worth measuring. Breakpoints are read from the stylesheet, one
 * pixel past each `max-width`, where the wider layout is at its narrowest; a
 * breakpoint added to studio.css is measured without anybody editing this.
 */
function widths() {
  const css = readFileSync(join(app, 'src', 'studio.css'), 'utf8')
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

/** The journey, step by step: each entry brings the studio to a state and names it. */
function journey(plane) {
  const step = (page, name) => page.getByRole('main', { name })
  const nav = (page, name) => page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: new RegExp(`^\\d+\\. ${name}$`) })
  return [
    ['Connect, a restricted connection discovered', async (page) => {
      await page.getByRole('button', { name: 'Test fixture', exact: true }).click()
      await page.getByRole('button', { name: 'Discover fixture-reader' }).click()
      await page.getByRole('region', { name: 'What fixture-reader can see' }).getByText('sales.order', { exact: true }).click()
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
      await step(page, 'Policy').getByRole('button', { name: 'Remove Customer filter 1' }).click()
    }],
    ['Policy, fitting', async (page) => {
      const policy = step(page, 'Policy')
      await policy.getByRole('button', { name: 'Add a filter to the Customer list' }).click()
      for (const operation of ['read', 'create', 'update']) await policy.getByLabel(`Roles that may ${operation}`).fill('clerk')
      await policy.getByRole('button', { name: 'Fill every field from the operations' }).click()
      await policy.getByText('The policy fits this form.').waitFor()
    }],
    ['Presentation, a label refused', async (page) => {
      await nav(page, 'Presentation').click()
      await step(page, 'Presentation').getByLabel('Label of notes').fill('')
    }],
    ['Preview, after a failed submit', async (page) => {
      await step(page, 'Presentation').getByLabel('Label of notes').fill('Remarks')
      await nav(page, 'Preview').click()
      await step(page, 'Preview').getByRole('button', { name: 'Validate' }).click()
      await page.waitForFunction(() => document.querySelector('form.sheet [aria-invalid="true"]') !== null, undefined, { timeout: 10_000 })
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
    ['Drift, blocking', async (page) => {
      const { fingerprint: _, ...contents } = structuredClone(plane.databases.get('fixture'))
      const order = contents.objects.find((object) => object.ref.name === 'order')
      order.columns = order.columns.filter((column) => column.name !== 'notes')
      plane.databases.set('fixture', createSnapshot(contents))
      await nav(page, 'Drift').click()
      await step(page, 'Drift').getByRole('button', { name: 'Check drift' }).click()
      await page.getByRole('region', { name: /^Version \d+ of sales-order, against the database now$/ }).waitFor()
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
        await page.keyboard.press('Tab')
        const token = page.getByLabel('Host token')
        check('the first Tab reaches the host token', (await token.evaluate((input) => input === document.activeElement)) ? null : 'focus went somewhere else first')
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

        for (const [state, act] of journey(plane)) {
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
