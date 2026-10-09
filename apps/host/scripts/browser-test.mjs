// What jsdom cannot see on the host page, measured in Chromium.
//
// The studio's gate (apps/studio/scripts/browser-test.mjs), applied to the
// host page as CLAUDE.md asks of every UI here. The suites in src/ run in
// jsdom, which applies no CSS, resolves no media queries and performs no
// layout, so these claims could only be checked by hand:
//
//   - nothing scrolls sideways and nothing is past either edge, in every
//     state a person reaches, down to a 320px phone;
//   - the keyboard path: the first Tab reaches the skip link, on screen, and
//     the next the host token; once the form is open, Enter on the skip link
//     puts the keyboard on the page's main part and the next Tab on its
//     first control; after a stale save the keyboard is on the notice,
//     after a refused selection in the error summary, after a save whose
//     answer was lost on the "It may have been saved" notice (0031), after
//     "Enter it again anyway" on "Allow saving it again", and after a save
//     that worked still on Save;
//   - a create whose answer the network lost after the server stored it:
//     Chromium sends it again on its own, below the page, when the connection
//     it reused closes before any answer -- measured at the socket, through a
//     TCP hop between the browser and the server -- and the server answers
//     that second sending with the first one's answer, so one order is
//     stored and the page says what was created (0031);
//   - the papers are the theme's: no rule of host.css selects anything on
//     either form, so the host's people see what Blueprint draws;
//   - the colours have enough contrast and the targets are big enough -- the
//     two rules jsdom cannot measure -- signed out, open, with the customer
//     list open, loaded, saved, with the stale notice (Angular pane), with
//     a refused selection (React pane), with the notice of a save whose
//     answer was lost, after its check, and with its confirmation open
//     (React pane).
//
// Against the page `vite build` produces, served over HTTP from the same
// origin as the real data server -- createDataServer, in this process, over
// the shared fixture on a real PostgreSQL 17 through the real driver (0029).
// PostgreSQL only: what is measured here is layout, focus and colour, which
// do not depend on the engine; what the engines answer is the jsdom suites'
// and the client suite's, on both. Asserted as numbers and computed results,
// never screenshots.
//
// `pnpm test:browser`, which builds first. It needs Docker, for the database,
// and Chromium, from `pnpm exec playwright install chromium` once per machine.

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESSIBILITY_TAGS } from '@formancy/conformance'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import { startPostgresFixture, startTcpHop } from '@formancy/data-fixtures'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import postgres from 'postgres'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(app, 'dist')
const FORM = 'pg-order'
const TOKENS = { admin: 'browser-gate-administrator', clerk: 'browser-gate-clerk' }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

/** How long Angular may take to arrive, and the server to answer: generous, for a loaded runner. */
const WITHIN = { timeout: 20_000 }

/**
 * The real server over the fixture on PostgreSQL, with the order form
 * published as the suites publish it: as the generator made it, the version
 * column confirmed, clerks of tenant 1 allowed everything. The page draws
 * the customer lookup as a typeahead itself (src/widgets.ts). The
 * identity verifier takes two literal tokens, as the studio's gate does.
 */
async function startPlane() {
  const fixture = await startPostgresFixture()
  const url = new URL(fixture.admin)
  const registry = createConnectionRegistry(
    [{ id: 'pg', kind: 'postgres', host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } }],
    DRIVER_FACTORIES,
    { env: { PG_PASSWORD: decodeURIComponent(url.password) }, readFile: async () => '' },
  )
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-host-gate-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = async (token) => {
    if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } }
    if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-1', roles: ['clerk'] }, attributes: { tenant: '1' } } }
    return { ok: false, reason: 'ERR_JWS_INVALID' }
  }
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const server = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  const call = async (token, path, payload) => {
    const reply = await server.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${path} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json()
  }
  const proposal = await call(TOKENS.admin, '/v1/form-proposals', {
    connection: 'pg',
    root: { schema: 'sales', name: 'order' },
    formId: FORM,
    title: 'Order',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
    versionColumn: 'row_version',
  })
  // Published as the generator made it (0030 refuses anything but
  // presentation over the generated base); the page draws its lookups as
  // typeaheads itself.
  const form = proposal.form
  const policy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(proposal.bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
  await call(TOKENS.admin, `/v1/forms/${FORM}/versions`, { expectedBase: null, bundle: { format: 2, connection: 'pg', generation: proposal.generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings: proposal.bindings, policy, snapshot: proposal.snapshot } })
  const source = form.model.fields.find((field) => field.key === 'customer').optionsSource
  const sql = postgres(fixture.admin, { onnotice: () => {} })
  return {
    server,
    /** A fresh order of tenant 1's, for one width's run, made the way the page would make it. */
    order: async () => {
      const customer = (await call(TOKENS.clerk, `/v1/forms/${FORM}/lookups/${source}/query`, { operation: 'create', search: 'Muster' })).rows[0].token
      return (await call(TOKENS.clerk, `/v1/forms/${FORM}/records/create`, { answers: { customer, order_date: '2026-10-08', status: 'placed', amount: '1' } })).record
    },
    insertCustomer: (no, name) => sql`insert into sales.customer (tenant_id, customer_no, name) values (1, ${no}, ${name})`,
    /** How many orders have exactly these notes: what the database holds, asked beside the page. */
    ordersWithNotes: async (notes) => (await sql`select count(*)::int as n from sales."order" where notes = ${notes}`)[0].n,
    deleteCustomer: (no) => sql`delete from sales.customer where tenant_id = 1 and customer_no = ${no}`,
    close: async () => {
      await server.close()
      await registry.close()
      await sql.end()
      rmSync(root, { recursive: true, force: true })
      await fixture.stop()
    },
  }
}

/** The built page and the plane, on one origin, on a port the system picks: the page is same-origin, as a host's is. */
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
 * host.css as one text, each `@import` replaced by the file it names, which
 * is what Vite builds. Read from the source, so a rule or a file added is
 * checked without anybody listing it here; an import this does not
 * understand stops the gate rather than checking less than the page loads.
 */
function stylesheet() {
  const text = readFileSync(join(app, 'src', 'host.css'), 'utf8').replaceAll(/@import\s+'(\.\/[^']+\.css)';/g, (_, path) => readFileSync(join(app, 'src', path), 'utf8'))
  if (/@import/.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('src/host.css has an @import the gate does not inline')
  return text
}

/** The widths worth measuring: the studio's list, with the breakpoints read from host.css, one pixel past each. */
function widths() {
  const breakpoints = [...stylesheet().matchAll(/@media\s*\(\s*max-width:\s*([\d.]+)rem\s*\)/g)].map((match) => Number(match[1]) * 16)
  if (breakpoints.length === 0) throw new Error('found no max-width breakpoint in src/host.css, so the widths below measure nothing')
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
      const part = element.getAttribute('data-formancy-part')
      past.push(`${element.tagName.toLowerCase()}${part === null ? '' : `[${part}]`}.${String(element.className).slice(0, 24)} at ${Math.round(box.left)}..${Math.round(box.right)}`)
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

/** Null when `locator`'s element has the focus, otherwise where the focus is. */
async function focusedOn(page, locator) {
  return (await locator.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))) ? null : `the focus is on ${await describeFocus(page)}`
}

/**
 * Every rule of host.css that selects an element on a paper. Parsed by
 * Chromium from the source, so a rule added is checked without anybody
 * listing it. A state the pointer or keyboard puts an element in comes off
 * the selector first, and a pseudo-element is matched as the element it
 * hangs off: a rule is matched for every moment, not this one.
 */
function rulesOnThePaper(paper) {
  return paper.evaluate((sheet, text) => {
    const parsed = new CSSStyleSheet()
    parsed.replaceSync(text)
    const selectors = []
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText)
        else if ('cssRules' in rule) walk(rule.cssRules)
      }
    }
    walk(parsed.cssRules)
    const elements = [...sheet.querySelectorAll('*')]
    const reached = []
    for (const selector of selectors) {
      const always = selector.replace(/::[\w-]+(\([^)]*\))?/g, '').replace(/:(?:focus-visible|focus-within|focus|hover|active)(?![\w-])/g, '')
      const hit = elements.find((element) => element.matches(always.trim() === '' ? '*' : always))
      if (hit !== undefined) reached.push(`${selector} selects ${hit.outerHTML.slice(0, 60)}`)
    }
    return { rules: selectors.length, tags: [...new Set(elements.map((element) => element.tagName.toLowerCase()))], reached }
  }, stylesheet())
}

/** Wait until `condition` holds, or fail with `problem`. */
async function until(condition, problem) {
  const deadline = Date.now() + WITHIN.timeout
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(problem)
}

/** The pieces of the page, by role and accessible name. */
const pane = (page, name) => page.getByRole('region', { name, exact: true })
const paper = (page, name) => pane(page, name).getByRole('form', { name: `Order, ${name}` })
const customer = (page, name) => paper(page, name).getByRole('combobox', { name: 'Customer' })
const saveIn = (page, name) => paper(page, name).getByRole('button', { name: 'Save' })
const status = (page, name, text) => pane(page, name).getByRole('status').filter({ hasText: text })
const unknownNotice = (page) => pane(page, 'React').getByRole('region', { name: 'React It may have been saved' })

/** A new order in the React pane, every field a person types, with `notes` as its notes. Not saved. */
async function newOrder(page, notes) {
  await page.getByRole('region', { name: 'Record', exact: true }).getByRole('button', { name: 'New record' }).click()
  await customer(page, 'React').fill('Muster')
  await paper(page, 'React').getByRole('option', { name: 'Muster AG' }).click(WITHIN)
  await paper(page, 'React').getByLabel('Order date', { exact: true }).fill('2026-10-08')
  await paper(page, 'React').getByLabel('Amount', { exact: true }).fill('5')
  await paper(page, 'React').getByLabel('Notes', { exact: true }).fill(notes)
}

/**
 * The journey, state by state: each entry brings the page to a state and
 * names it, checking on the way what only that moment can show. `run` holds
 * what one width's pass needs: its record, its customer number.
 */
function journey(plane, hop, check, run) {
  return [
    ['Open', async (page) => {
      await page.getByLabel('Host token').fill(TOKENS.clerk)
      await page.getByLabel('Form id').fill(FORM)
      await page.getByRole('button', { name: 'Open the form' }).click()
      for (const name of ['React', 'Angular']) await customer(page, name).waitFor(WITHIN)
      // From the top of the open page: the skip link, then the first control of main.
      await page.mouse.click(1, 1)
      await page.keyboard.press('Tab')
      check('open: the first Tab reaches the skip link', await focusedOn(page, page.getByRole('link', { name: 'Skip to the form' })))
      // Enter must move the focus to main itself: nothing in the header can
      // take it, so the next Tab reaches main's first control whether the link
      // went anywhere or not, and only this tells the two apart.
      await page.keyboard.press('Enter')
      const onMain = await page.getByRole('main').evaluate((main) => main === document.activeElement)
      check('open: Enter on the skip link puts the keyboard on main', onMain ? null : `the focus is on ${await describeFocus(page)}`)
      await page.keyboard.press('Tab')
      const into = await page.getByRole('main').evaluate((main) => {
        const tabbable = [...main.querySelectorAll('*')].filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0)
        return tabbable[0] === document.activeElement
      })
      check('open: through it the next Tab reaches the first control of the page', into ? null : `the focus is on ${await describeFocus(page)}`)
    }],
    ['Customer list open (React)', async (page) => {
      await customer(page, 'React').fill('Muster')
      await paper(page, 'React').getByRole('listbox').waitFor(WITHIN)
    }],
    ['Loaded', async (page) => {
      await customer(page, 'React').press('Escape')
      const record = page.getByRole('region', { name: 'Record', exact: true })
      await record.getByRole('textbox', { name: 'Record token' }).fill(run.record)
      await record.getByRole('button', { name: 'Load' }).click()
      await record.getByRole('status').filter({ hasText: 'Loaded record' }).waitFor(WITHIN)
      // Both panes show the customer by the label the resolve route gives it.
      for (const name of ['React', 'Angular']) await until(async () => (await customer(page, name).inputValue()) === 'Muster AG', `the ${name} customer never showed Muster AG`)
    }],
    ['Saved (React)', async (page) => {
      await paper(page, 'React').getByLabel('Amount', { exact: true }).fill('3')
      const save = saveIn(page, 'React')
      await save.focus()
      await page.keyboard.press('Enter')
      await status(page, 'React', 'Saved.').waitFor(WITHIN)
      check('after a save that worked, the keyboard is still on Save', await focusedOn(page, save))
    }],
    ['Stale notice (Angular)', async (page) => {
      await paper(page, 'Angular').getByLabel('Amount', { exact: true }).fill('4')
      const save = saveIn(page, 'Angular')
      await save.focus()
      await page.keyboard.press('Enter')
      const notice = pane(page, 'Angular').getByRole('region', { name: 'Angular Not saved' })
      await notice.waitFor(WITHIN)
      check('after a stale save, the keyboard is on the notice', await focusedOn(page, notice))
    }],
    ['Refused selection (React)', async (page) => {
      await plane.insertCustomer(run.customer, `Frisch Kunde ${String(run.customer)}`)
      await customer(page, 'React').fill('Frisch')
      await paper(page, 'React').getByRole('option', { name: `Frisch Kunde ${String(run.customer)}` }).click(WITHIN)
      await plane.deleteCustomer(run.customer)
      const save = saveIn(page, 'React')
      await save.focus()
      await page.keyboard.press('Enter')
      const summary = paper(page, 'React').getByRole('heading', { name: 'There is 1 problem to fix' })
      await summary.waitFor(WITHIN)
      // The summary has no role of its own: it is the focused element that holds its heading.
      const inSummary = await summary.evaluate((heading) => document.activeElement !== document.body && document.activeElement?.contains(heading) === true)
      check('after a refused selection, the keyboard is in the error summary', inSummary ? null : `the focus is on ${await describeFocus(page)}`)
      for (const name of ['React', 'Angular']) {
        const found = await rulesOnThePaper(paper(page, name))
        check(`the ${name} paper: no rule of host.css selects anything on it`, found.reached.length === 0 ? null : found.reached.slice(0, 6).join('; '))
        // A guard on the guard: real rules, matched against a whole form.
        const missing = ['label', 'input', 'button'].filter((tag) => !found.tags.includes(tag))
        check(`which matched host.css against the whole ${name} form`, found.rules > 0 && missing.length === 0 ? null : `${String(found.rules)} rules, and no ${missing.join(', ')} on the paper`)
      }
    }],
    ['Unknown notice (React)', async (page) => {
      await customer(page, 'React').fill('Muster')
      await paper(page, 'React').getByRole('option', { name: 'Muster AG' }).click(WITHIN)
      // The update reaches the real server, which stores it and answers; the
      // page is then told the connection was reset, as when a network drops
      // after sending. Chromium's own answer to a lost response, not jsdom's.
      let lost = 0
      await page.route('**/v1/forms/*/records/update', async (route) => {
        lost += 1
        await route.fetch()
        await route.abort('connectionreset')
      })
      try {
        const save = saveIn(page, 'React')
        await save.focus()
        await page.keyboard.press('Enter')
        const notice = pane(page, 'React').getByRole('region', { name: 'React It may have been saved' })
        await notice.waitFor(WITHIN)
        check('after a save whose answer was lost, the keyboard is on the notice', await focusedOn(page, notice))
        check('and the save was sent once', lost === 1 ? null : `it was sent ${String(lost)} times`)
      } finally {
        await page.unroute('**/v1/forms/*/records/update')
      }
    }],
    ['Unknown notice, checked (React)', async (page) => {
      // The check's answer and "Load the saved record", drawn in Chromium:
      // their contrast and target size are measured nowhere else.
      await unknownNotice(page).getByRole('button', { name: 'Check whether it was saved' }).click()
      await unknownNotice(page).getByRole('button', { name: 'Load the saved record' }).waitFor(WITHIN)
    }],
    ['Create resent by Chromium (React)', async (page) => {
      // The page reaches the server through the hop. The hop drops the answer
      // carrying this order's notes, the server having stored it, and once
      // the order is in the database closes the connection that carried it:
      // what an idle reset by a balancer, or a dropped link, does. Chromium
      // then sends the create again on a new connection, on its own.
      const notes = `resent by Chromium ${String(run.customer)} ${String(Date.now())}`
      await newOrder(page, notes)
      const marker = Buffer.from(notes, 'utf8')
      const sent = hop.countSent(marker)
      const lost = hop.swallowAnswersFrom(marker)
      // The answer the page does get: the second sending's, which the server
      // answers from what it kept for the first (0031).
      const answered = page.waitForResponse((response) => response.url().endsWith('/records/create') && response.status() === 201, WITHIN)
      await saveIn(page, 'React').click()
      await Promise.race([lost.matched, new Promise((_, reject) => setTimeout(() => reject(new Error('the create never answered through the hop')), WITHIN.timeout))])
      await until(async () => (await plane.ordersWithNotes(notes)) === 1, 'the create never reached the database')
      const cutAt = performance.now()
      lost.cut()
      // Polled every 5 ms rather than through until(), whose 100 ms step
      // would be the measurement: how soon a resend follows the close is
      // what the server's kept answers have to outlast.
      while (sent() < 2 && performance.now() - cutAt < WITHIN.timeout) await new Promise((resolve) => setTimeout(resolve, 5))
      const resentAfter = performance.now() - cutAt
      await status(page, 'React', 'Created record').waitFor(WITHIN)
      const answerBytes = (await (await answered).body()).length
      console.log(`  measured: Chromium resent the create ${resentAfter.toFixed(0)} ms after its connection closed; the create's answer is ${String(answerBytes)} bytes`)
      check('Chromium sent the create again on its own: the marker crossed the hop twice', sent() === 2 ? null : `it crossed ${String(sent())} time(s): Chromium did not resend, so this measured nothing`)
      check('and one order is stored: the second sending was answered, not applied', (await plane.ordersWithNotes(notes)) === 1 ? null : `${String(await plane.ordersWithNotes(notes))} orders are stored`)
    }],
    ['Unknown create, confirming (React)', async (page) => {
      // A create lost on the way, which nothing can find -- the database
      // numbers orders -- checked, and "Enter it again anyway" pressed: the
      // confirmation, drawn in Chromium, with the keyboard on its answer.
      await newOrder(page, `lost and confirming ${String(run.customer)} ${String(Date.now())}`)
      await page.route('**/v1/forms/*/records/create', async (route) => {
        await route.fetch()
        await route.abort('connectionreset')
      })
      try {
        await saveIn(page, 'React').click()
        await unknownNotice(page).waitFor(WITHIN)
      } finally {
        await page.unroute('**/v1/forms/*/records/create')
      }
      await unknownNotice(page).getByRole('button', { name: 'Check whether it was saved' }).click()
      const again = unknownNotice(page).getByRole('button', { name: 'Enter it again anyway' })
      await again.waitFor(WITHIN)
      await again.focus()
      await page.keyboard.press('Enter')
      const allow = unknownNotice(page).getByRole('button', { name: 'Allow saving it again' })
      await allow.waitFor(WITHIN)
      check('after "Enter it again anyway", the keyboard is on "Allow saving it again"', await focusedOn(page, allow))
    }],
  ]
}

async function run() {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('no built page at apps/host/dist: run `pnpm build` first')
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
    if (problem === null) return void console.log(`  ok    ${name}`)
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

  const started = Date.now()
  const plane = await startPlane()
  const { http, port } = await serve(plane)
  // Between Chromium and the page's origin: every byte the browser sends and
  // receives crosses it, so what the browser itself does is counted there.
  const hop = await startTcpHop({ host: '127.0.0.1', port })
  console.log(`PostgreSQL and the server started in ${String(Math.round((Date.now() - started) / 1000))} s`)
  const list = widths()
  try {
    let pass = 0
    for (const { label, width, refuseFonts = false } of list) {
      pass += 1
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      if (refuseFonts) await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
      try {
        await page.goto(`http://127.0.0.1:${String(hop.port)}/`, { waitUntil: 'load' })
        console.log(`\n${label} -- ${String(width)}x900`)

        // Signed out: the skip link first, on screen, and then the token --
        // the whole screen's purpose. Once the screen is there: "load" fires
        // before React has rendered it.
        const token = page.getByLabel('Host token')
        await token.waitFor()
        await page.keyboard.press('Tab')
        const skip = page.getByRole('link', { name: 'Skip to the form' })
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

        const run = { record: await plane.order(), customer: 9000 + pass }
        for (const [state, act] of journey(plane, hop, check, run)) {
          await act(page)
          await measured(page, state)
        }
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    await hop.close()
    http.close()
    await plane.close()
  }

  console.log('')
  if (failures.length > 0) throw new Error(`${String(failures.length)} browser check(s) failed:\n  ${failures.join('\n  ')}`)
  console.log(
    `browser checks passed: the host page's journey at ${String(new Set(list.map(({ width }) => width)).size)} widths, one of them also with the web fonts refused, against the real server on PostgreSQL, in ${String(Math.round((Date.now() - started) / 1000))} s`,
  )
}

await run()
