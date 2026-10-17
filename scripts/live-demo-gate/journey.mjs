// The live demo's journey over HTTP (0070), as a visitor's page sends it:
// through the demo's routes on the gate's origin, so every request passes
// the Worker's own code -- its session, cookie, refusals and forwarding --
// on its way to a visitor's own container, and every answer comes back the
// way the page reads it. scripts/live-demo-gate.mjs runs it; the pure parts
// are held by journey.test.mjs.

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { LIST_PAGE_SIZE, WRITE_ID_HEADER } from '../../packages/data-core/dist/index.mjs'
import { COOKIE_NAME, IDLE_MINUTES, KEY_LIFETIME_MS, NOT_RUNNING, PAGE_SAFE_HEADERS, PER_TENANT, PERSONAS, PREFIX, ROLE_GRANTS, SERVER_PORT, WORKER_HEADERS } from '../../apps/live-demo/dist/worker/pure.mjs'

/** How the image publishes its forms' parents: customers' orders, and an order's deliveries and lines (apps/live-demo/src/image/forms.ts). */
const CHILDREN = {
  customer: [{ form: 'order', field: 'customer' }],
  delivery: [],
  order: [
    { form: 'delivery', field: 'order' },
    { form: 'order-line', field: 'order' },
  ],
  'order-line': [],
}
const TITLES = { customer: 'Customer', delivery: 'Delivery', order: 'Order', 'order-line': 'Order line' }

/** The menu `role` is shown, as ROLE_GRANTS decides it: every form it may read, by id, with what it may do and the children under it. */
export function expectedMenu(role) {
  const grants = ROLE_GRANTS[role]
  if (grants === undefined) throw new Error(`there is no role ${String(role)} in ROLE_GRANTS`)
  return Object.keys(CHILDREN)
    .filter((id) => grants.may[id].includes('read'))
    .map((id) => ({ id, title: TITLES[id], operations: grants.may[id], children: CHILDREN[id] }))
}

/**
 * The routes the built server registers that 0037's runtime door does not
 * forward, from deploy/cloudflare/doors.json (scripts/cloudflare/doors.mjs
 * writes it from the server's router): `worker`, every one of them, which
 * the Worker must answer itself; and `server`, the administrator's plane's,
 * which the image, run without administrator roles, must not register at
 * all. Each as `{ method, path, sample }`.
 */
export function closedRoutes(doors = JSON.parse(readFileSync(new URL('../../deploy/cloudflare/doors.json', import.meta.url), 'utf8'))) {
  const shape = ({ method, path, sample }) => ({ method, path, sample })
  const worker = doors.routes.filter((route) => route.runtimeDoor !== 'forwarded').map(shape)
  const server = doors.routes.filter((route) => route.plane === 'administrator').map(shape)
  return { worker, server }
}

/** How many pages `count` rows fill, `size` to a page. */
export const pagesOf = (count, size) => Math.ceil(count / size)

/** A decimal as a whole number of ten-thousandths, the order amount's scale: exact, where floats are not. */
export function units(decimal) {
  const found = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(decimal))
  if (found === null) throw new Error(`${String(decimal)} is not a decimal`)
  const [, sign, whole, fraction = ''] = found
  if (fraction.length > 4) throw new Error(`${String(decimal)} has more than four decimals`)
  const value = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
  return sign === '-' ? -value : value
}

/** What an order's lines add up to, in ten-thousandths. */
export const lineTotal = (lines) => lines.reduce((sum, line) => sum + BigInt(line.quantity) * units(line.unit_price), 0n)

/** What is wrong with the Set-Cookie headers of a sign-in that made a name, against the Worker's one cookie (0070). */
export function cookieProblems(cookies) {
  if (cookies.length === 0) return ['the sign-in set no cookie']
  if (cookies.length > 1) return [`the sign-in set ${String(cookies.length)} cookies, not one`]
  const [pair, ...attributes] = cookies[0].split(';').map((part) => part.trim())
  const problems = []
  const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]
  if (name !== COOKIE_NAME) problems.push(`the cookie is ${name}, not ${COOKIE_NAME}`)
  if (!/^[0-9a-f]{32}$/.test(value)) problems.push('the cookie’s value is not 32 lowercase hex characters')
  const named = new Map(attributes.map((attribute) => [attribute.split('=')[0].toLowerCase(), attribute]))
  const path = named.get('path')?.split('=')[1]
  if (path !== `${PREFIX}/`) problems.push(`the cookie’s Path is ${String(path)}, not ${PREFIX}/`)
  for (const flag of ['secure', 'httponly']) if (!named.has(flag)) problems.push(`the cookie is not ${flag === 'secure' ? 'Secure' : 'HttpOnly'}`)
  if (named.get('samesite')?.toLowerCase() !== 'samesite=strict') problems.push(`the cookie is ${named.get('samesite') ?? 'not SameSite'}, not SameSite=Strict`)
  for (const lifetime of ['max-age', 'expires']) if (named.has(lifetime)) problems.push(`the cookie has a lifetime (${named.get(lifetime)}), so it outlives the browser`)
  return problems
}

/**
 * One visitor, as their browser is to the demo: the cookie the Worker set
 * them, sent back under the demo's path; their requests' Origin and
 * Sec-Fetch-Site as a same-origin fetch sends them; and every answer kept
 * for the header checks.
 */
export function visitor(origin, answers) {
  let cookie
  const call = async (method, path, { token, body, headers = {}, raw = false } = {}) => {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(90_000),
      headers: {
        'sec-fetch-site': 'same-origin',
        ...(method === 'GET' || method === 'HEAD' ? {} : { origin }),
        ...(cookie === undefined ? {} : { cookie }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    })
    const cookies = response.headers.getSetCookie()
    for (const set of cookies) {
      const pair = set.split(';')[0]
      if (pair.startsWith(`${COOKIE_NAME}=`)) cookie = pair
    }
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    const answer = { method, path, status: response.status, headers: response.headers, cookies, text, json }
    answers?.push(answer)
    return answer
  }
  return {
    get cookie() {
      return cookie
    },
    forget: () => {
      cookie = undefined
    },
    call,
    signIn: (persona, options = {}) => call('POST', `${PREFIX}/session`, { body: { persona }, ...options }),
    /** The runtime plane, under the demo's path, as data-client sends it there. */
    api: (method, path, options) => call(method, `${PREFIX}${path}`, options),
    /** A write, with a write id of its own unless one is given (0031). */
    write: (path, token, body, id = randomBytes(16).toString('hex')) => call('POST', `${PREFIX}${path}`, { token, body, headers: { [WRITE_ID_HEADER]: id } }),
  }
}

const said = (answer) => (typeof answer.json?.message === 'string' ? ` (${String(answer.json.code)}: ${answer.json.message})` : '')
const expectStatus = (where, answer, status) => (answer.status === status ? null : `${where} answered ${String(answer.status)}, not ${String(status)}${said(answer)}`)

/** Every page of `form`'s records `token` may read, in the key's order: the rows, and how many pages it took. */
async function allRows(visit, token, form, query = {}) {
  const rows = []
  let pages = 0
  for (let offset = 0; ; ) {
    const page = await visit.api('POST', `/v1/forms/${form}/records/list`, { token, body: { ...query, offset } })
    if (page.status !== 200) throw new Error(`${form}'s records/list at ${String(offset)} answered ${String(page.status)}${said(page)}`)
    pages += 1
    rows.push(...page.json.rows)
    if (!page.json.hasMore) return { rows, pages }
    offset += page.json.rows.length
  }
}

/** The options a lookup field of `form` offers for `search`, as `{ token, label }`. */
async function offered(visit, token, form, field, search) {
  const opened = await visit.api('GET', `/v1/forms/${form}`, { token })
  const source = opened.json.form.model.fields.find((candidate) => candidate.key === field)?.optionsSource
  const answer = await visit.api('POST', `/v1/forms/${form}/lookups/${String(source)}/query`, { token, body: { operation: 'create', search } })
  if (answer.status !== 200) throw new Error(`${form}'s ${field} lookup answered ${String(answer.status)}${said(answer)}`)
  return answer.json.rows
}

/**
 * The journey, step by step, each step's verdict passed to `check(name,
 * problem)` -- null when it held -- and the times it took to `timed`.
 * `stand` is the stand-in's Durable Objects, `objectOf(visit)` a visitor's
 * own. Returns what the gate goes on to need: the visitors and their
 * tokens, and the order the first one created.
 */
export async function apiJourney({ origin, stand, check, timed }) {
  const answers = []
  const objectOf = (visit) => stand.objects.get(visit.cookie?.split('=')[1])
  const a = visitor(origin, answers)

  // The session's list is constants: no Durable Object, no container, no cookie.
  const index = await a.call('GET', `${PREFIX}/session`)
  check('GET session lists the personas and the idle minutes, and starts nothing', expectStatus('GET session', index, 200) ?? (JSON.stringify(index.json) === JSON.stringify({ personas: PERSONAS.map(({ id, name, description }) => ({ id, name, description })), idleMinutes: IDLE_MINUTES }) ? (index.cookies.length > 0 || stand.objects.size > 0 ? 'it set a cookie or made a Durable Object' : null) : `it said ${index.text}`))
  const early = await a.api('GET', '/v1/forms')
  check("a runtime request before any sign-in is the Worker's not-running answer", early.status === 503 && early.json?.code === 'unavailable' && early.json?.message === NOT_RUNNING && stand.objects.size === 0 ? null : `answered ${String(early.status)} ${early.text}`)
  const foreign = await a.signIn('clara', { headers: { origin: 'https://elsewhere.test', 'sec-fetch-site': 'cross-site' } })
  check('a sign-in from another site is refused and starts nothing', foreign.status === 403 && foreign.json?.code === 'cross-origin-refused' && stand.objects.size === 0 ? null : `answered ${String(foreign.status)} ${foreign.text}`)

  // The first sign-in starts the visitor's own container: the cold start.
  const first = await timed('Sign-in, cold: POST session to its answer, through the Worker', () => a.signIn('clara'))
  check('the first sign-in answers a token', expectStatus('POST session as clara', first, 200) ?? (typeof first.json?.token === 'string' ? null : 'it holds no token'))
  check("the first sign-in sets the Worker's one cookie, and nothing else", cookieProblems(first.cookies).join('; ') || null)
  const own = objectOf(a)
  const container = own?.state.container
  const start = container?.starts[0]
  check('the Durable Object started one container, with the key alone in its environment and no internet', container?.starts.length === 1 && JSON.stringify(start.variables) === JSON.stringify(['FORMANCY_DATA_DEMO_IDENTITY_SECRET']) && start.enableInternet === false ? null : `starts ${JSON.stringify(container?.starts)}`)
  check('the Durable Object set the inactivity timeout to the idle minutes', JSON.stringify(container?.inactivityTimeouts) === JSON.stringify([IDLE_MINUTES * 60_000]) ? null : `set ${JSON.stringify(container?.inactivityTimeouts)}`)
  check('the Durable Object stored its key and set an alarm a day on', own?.state.stored().has('key') && Math.abs(own.state.alarm - (start.startedAt + KEY_LIFETIME_MS)) < 60_000 ? null : `stored ${String([...(own?.state.stored().keys() ?? [])])}, alarm ${String(own?.state.alarm)}`)

  const tokens = { clara: first.json?.token }
  for (const persona of ['otto', 'vera']) {
    const signed = await a.signIn(persona)
    tokens[persona] = signed.json?.token
    check(`signing in as ${persona} on the same instance starts nothing`, expectStatus(`POST session as ${persona}`, signed, 200) ?? (container.starts.length === 1 && signed.cookies.length === 0 ? null : `${String(container.starts.length)} starts, ${String(signed.cookies.length)} cookies`))
  }

  // Each persona's sentence, through the product.
  for (const each of PERSONAS) {
    const menu = await a.api('GET', '/v1/forms', { token: tokens[each.id] })
    check(`${each.id}'s menu is what their sentence says`, expectStatus(`GET /v1/forms as ${each.id}`, menu, 200) ?? (JSON.stringify(menu.json?.forms) === JSON.stringify(expectedMenu(each.roles[0])) ? null : `it is ${JSON.stringify(menu.json?.forms)}`))
  }

  // Paging, and each tenant's own.
  const orders = {}
  for (const [who, tenant] of [['clara', 1], ['otto', 2]]) {
    orders[who] = await timed(`Paging ${who}'s orders`, () => allRows(a, tokens[who], 'order'))
    const { rows, pages } = orders[who]
    check(`${who} pages through tenant ${String(tenant)}'s orders`, rows.length === PER_TENANT.orders && pages === pagesOf(PER_TENANT.orders, LIST_PAGE_SIZE) && new Set(rows.map((row) => row.record)).size === rows.length ? null : `${String(rows.length)} rows in ${String(pages)} pages, not ${String(PER_TENANT.orders)} in ${String(pagesOf(PER_TENANT.orders, LIST_PAGE_SIZE))}`)
  }
  const claras = new Set(orders.clara.rows.map((row) => row.record))
  check("neither clerk lists one of the other's orders", orders.otto.rows.some((row) => claras.has(row.record)) ? 'a record is in both lists' : null)

  // A search narrows the list to what it matches.
  const searched = await allRows(a, tokens.clara, 'order', { search: 'dock' })
  check('a search narrows the orders to those it matches', searched.rows.length > 0 && searched.rows.length < PER_TENANT.orders && searched.rows.every((row) => Object.values(row.answers).some((value) => String(value).toLowerCase().includes('dock'))) ? null : `"dock" found ${String(searched.rows.length)} rows`)

  // The customer typeahead keeps to the tenant.
  // A name of tenant 1's that no name of tenant 2's contains: what otto
  // finds for it, he could only have found in tenant 1.
  const customers = new Set((await allRows(a, tokens.clara, 'customer')).rows.map((row) => row.answers.name))
  const ottos = (await allRows(a, tokens.otto, 'customer')).rows.map((row) => String(row.answers.name).toLowerCase())
  const only = [...customers].find((name) => !ottos.some((other) => other.includes(String(name).toLowerCase())))
  const clarasOffer = await offered(a, tokens.clara, 'order', 'customer', '')
  const clarasFind = only === undefined ? [] : await offered(a, tokens.clara, 'order', 'customer', only)
  const ottosFind = only === undefined ? [] : await offered(a, tokens.otto, 'order', 'customer', only)
  check(
    "the customer typeahead offers a clerk their own tenant's customers and none of the other's",
    only === undefined
      ? "every name of tenant 1's is found among tenant 2's: nothing here can show the search keeps to a tenant"
      : clarasOffer.length > 0 && clarasOffer.every((row) => customers.has(row.label)) && clarasFind.some((row) => row.label === only) && ottosFind.length === 0
        ? null
        : `clara was offered ${JSON.stringify(clarasOffer.slice(0, 3))} and found ${String(clarasFind.length)} for "${only}"; otto found ${String(ottosFind.length)}`,
  )

  // The data's invariants, as the product reads them.
  const shipped = orders.clara.rows.find((row) => row.answers.status === 'shipped')
  const draft = orders.clara.rows.find((row) => row.answers.status === 'draft')
  const children = async (form, record) => (await allRows(a, tokens.clara, form, { parent: { field: 'order', record } })).rows
  const lines = await children('order-line', shipped.record)
  check("a shipped order's lines add up to its amount", lines.length > 0 && lineTotal(lines.map((line) => line.answers)) === units(shipped.answers.amount) ? null : `${String(lines.length)} lines for ${String(shipped.answers.amount)}`)
  check('a shipped order has a delivery and a draft none', (await children('delivery', shipped.record)).length > 0 && (await children('delivery', draft.record)).length === 0 ? null : 'it does not')

  // A clerk's writes, each with a write id the Worker passes on (0031).
  const customer = clarasOffer[0].token
  const id = randomBytes(16).toString('hex')
  const body = { answers: { customer, order_date: '2026-10-17', status: 'placed', amount: '12.5' } }
  const created = await a.write('/v1/forms/order/records/create', tokens.clara, body, id)
  const again = await a.write('/v1/forms/order/records/create', tokens.clara, body, id)
  check('clara creates an order, and the same create sent again is answered once', expectStatus('create an order', created, 201) ?? (again.status === 201 && again.json?.record === created.json?.record ? null : `the second sending answered ${String(again.status)} for ${String(again.json?.record)}, the first ${String(created.json?.record)}`))
  const record = created.json?.record
  const line = await a.write('/v1/forms/order-line/records/create', tokens.clara, { answers: { order: record, line_no: 1, quantity: 4, unit_price: '3.25' } })
  check('clara adds a line to it, found as its child', expectStatus('create a line', line, 201) ?? (JSON.stringify((await children('order-line', record)).map((row) => row.record)) === JSON.stringify([line.json?.record]) ? null : 'the order does not list it'))
  check("otto cannot read clara's order", expectStatus("otto's read of clara's order", await a.api('POST', '/v1/forms/order/records/read', { token: tokens.otto, body: { record } }), 404))
  const read = await a.api('POST', '/v1/forms/order/records/read', { token: tokens.vera, body: { record } })
  check('vera reads it and may not change it', expectStatus("vera's read", read, 200) ?? expectStatus("vera's update", await a.write('/v1/forms/order/records/update', tokens.vera, { record, version: read.json?.version, answers: { ...read.json?.answers, status: 'shipped' } }), 403))
  const changed = await a.write('/v1/forms/order/records/update', tokens.clara, { record, version: read.json?.version, answers: { ...read.json?.answers, notes: 'Changed in the gate' } })
  check('clara changes it', expectStatus('update the order', changed, 200))

  // A change to one of the generated orders, which the next visitor must not see.
  const touched = orders.clara.rows[0]
  const before = touched.answers.notes ?? null
  const edited = await a.write('/v1/forms/order/records/update', tokens.clara, { record: touched.record, version: touched.version, answers: { ...touched.answers, notes: 'Seen by one visitor only' } })
  check("clara changes one of the generated orders", expectStatus('update a generated order', edited, 200))

  // A delete takes the order's lines and deliveries with it.
  const doomed = await a.write('/v1/forms/order/records/create', tokens.clara, { answers: { customer, order_date: '2026-10-17', status: 'placed', amount: '1' } })
  const doomedLine = await a.write('/v1/forms/order-line/records/create', tokens.clara, { answers: { order: doomed.json?.record, line_no: 1, quantity: 1, unit_price: '1.00' } })
  const doomedDelivery = await a.write('/v1/forms/delivery/records/create', tokens.clara, { answers: { order: doomed.json?.record, carrier: 'Swiss Post' } })
  const deleted = await a.write('/v1/forms/order/records/delete', tokens.clara, { record: doomed.json?.record, version: doomed.json?.version })
  const gone = await Promise.all([['order', doomed], ['order-line', doomedLine], ['delivery', doomedDelivery]].map(async ([form, made]) => (await a.api('POST', `/v1/forms/${form}/records/read`, { token: tokens.clara, body: { record: made.json?.record } })).status))
  check('deleting an order takes its line and its delivery with it', [doomed, doomedLine, doomedDelivery].some((made) => made.status !== 201) ? 'the order, its line or its delivery was not created' : (expectStatus('delete the order', deleted, 200) ?? (gone.every((status) => status === 404) ? null : `reads after the delete answered ${gone.join(', ')}`)))

  // What only the Worker answers, and what nothing past it may. A segment
  // that a proxy decoding the path would read as climbing out of the form
  // is one segment of GET /v1/forms/:id to the Worker, and the server's.
  const notPlain = await a.api('GET', '/v1/forms/..%2F..%2Fb', { token: tokens.clara })
  check("a path that is not plain reaches the server as written and is its 400 path-not-plain", notPlain.status === 400 && notPlain.json?.code === 'path-not-plain' ? null : `answered ${String(notPlain.status)} ${notPlain.text.slice(0, 120)}`)
  const forwarded = answers.filter((answer) => answer.path.startsWith(`${PREFIX}/v1/forms`) && answer.status !== 503)
  const unsafe = forwarded.filter((answer) => answer.headers.get('cache-control') !== 'no-store' || Object.entries(PAGE_SAFE_HEADERS).some(([name, value]) => answer.headers.get(name) !== value))
  check("every forwarded answer says no-store and carries nginx's three headers", forwarded.length > 20 && unsafe.length === 0 ? null : `${String(unsafe.length)} of ${String(forwarded.length)}: ${unsafe.slice(0, 2).map((answer) => `${answer.method} ${answer.path} ${String(answer.status)}`).join(', ')}`)

  // Every route of the server's that 0037's runtime door does not forward
  // -- the administrator's under /v1/forms/:id among them, POST
  // /v1/forms/order/versions publishing -- is the Worker's own 404 and
  // reaches no container.
  const closed = closedRoutes()
  const sent = (route) => ({ token: tokens.clara, ...(route.method === 'POST' ? { body: {} } : {}) })
  const opened = []
  for (const route of closed.worker) {
    const answer = await a.api(route.method, route.sample, sent(route))
    if (answer.status !== 404 || answer.headers.get('content-security-policy') !== WORKER_HEADERS['Content-Security-Policy']) opened.push(`${route.method} ${route.sample} answered ${String(answer.status)}`)
  }
  check(`each of the ${String(closed.worker.length)} routes 0037's runtime door does not forward is the Worker's own 404 under ${PREFIX}`, closed.worker.some((route) => route.method === 'POST' && route.sample === '/v1/forms/order/versions') && opened.length === 0 ? null : opened.join('; ') || 'POST /v1/forms/order/versions is not among them')

  // And the running image has no administrator's plane: each of its
  // routes, sent straight to the container's port past the Worker, is the
  // server's own 404, so the image's settings -- not the Worker alone --
  // keep publishing, importing and approving out of a visitor's reach.
  const port = container.getTcpPort(SERVER_PORT)
  const registered = []
  for (const route of closed.server) {
    const answer = await port.fetch(`http://container${route.sample}`, { method: route.method, headers: { authorization: `Bearer ${String(tokens.clara)}`, ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(route.method === 'POST' ? { body: '{}' } : {}) })
    const said = await answer.text()
    if (answer.status !== 404) registered.push(`${route.method} ${route.sample} answered ${String(answer.status)} ${said.slice(0, 80)}`)
  }
  check(`the running image registers none of the administrator's ${String(closed.server.length)} routes: each, sent straight to its port, is the server's own 404`, closed.server.length > 0 && registered.length === 0 ? null : registered.join('; ') || 'doors.json names no administrator route')

  const put = await a.api('PUT', '/v1/forms/order', { token: tokens.clara, body: {} })
  check('another method is refused 405', put.status === 405 ? null : `answered ${String(put.status)}`)

  return { a, tokens, record, touched: { record: touched.record, before }, objectOf }
}
