import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { PREFIX } from '@formancy/data-live-demo/worker'
import { ROUTE_OPERATIONS } from '@formancy/data-server'
import { demoSession } from './demo.js'
import { demoDoor } from './test-demo.js'
import { answer, answeredOnce, chooseCustomer, chooseForm, chooseRenderer, gridSection, load, loaded, mount, newRecord, rendered, said, save, searchRecords, shows, signIn, signInAs, stamp } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane, Sent } from './test-plane.js'

/*
 * What the page sends, read off the wire after a whole journey through the
 * workspace: the mirror of the studio's rule (0024) -- the host page speaks
 * the runtime plane and nothing else -- and the client's promises about the
 * token and the tenant, held where a host would break them, in the page
 * (0029, 0047).
 *
 * The routes are the server's own table, `ROUTE_OPERATIONS`, read from the
 * package rather than listed here: a route the server adds is one the page
 * may send, and one the page sends that the table does not have fails --
 * the delete route included, which the page sends since 0053, from its
 * confirmation in place.
 *
 * And through both doors the page has: its own origin, as a host serves
 * it, and the live demo's path, behind the demo's Worker (0070), where the
 * page asks the Worker for its people and a sign-in and then speaks the
 * same routes under its base -- the token still in the header alone.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deletes: true, demo: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** `METHOD /v1/forms/:id/lookups/:source/query` as a pattern a sent request's method and path match. */
function pattern(route: string): RegExp {
  const [method, path] = route.split(' ')
  const segments = (path ?? '').split('/').map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  return new RegExp(`^${String(method)} ${segments.join('/')}$`)
}

const ROUTES = Object.entries(ROUTE_OPERATIONS).map(([route, operation]) => ({ route, operation, matches: pattern(route) }))

/**
 * Operations the server has and the page has no control for yet, so the
 * journey cannot send them: the export (0079), whose button is the next pull
 * request's, as the delete route was 0050's until 0053 gave the page one.
 * The journey is held to send none of them, so the exception fails the
 * moment the page sends one and has to go.
 */
const NOT_YET_SENT = new Set(['export'])

/** Every key anywhere in a parsed body, nested ones included. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)])
}

/** The data rows of the Records grid, each as its cells' text. */
function recordRows(): HTMLElement[] {
  const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
  return within(grid)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('gridcell').length > 0)
}

/** The page's doors: its own origin on each engine, and the live demo's path, behind its Worker, signed in as tenant 1's clerk. */
const JOURNEYS = [
  ...ENGINES.map((engine) => ({ ...engine, door: 'its own origin', demo: false })),
  // The demo serves PostgreSQL alone (deploy/demo), and the base is the
  // client's, which knows no engine.
  { ...ENGINES[0], door: "the demo's path", demo: true },
]

describe.each(JOURNEYS)('what the page sends on $engine, through $door', ({ formId, lines, demo }) => {
  test('only runtime routes under its base, each carrying the token in the header and nowhere else, never a tenant, and only for forms the menu named', async () => {
    plane.sent.length = 0
    const words = stamp('plane')
    const door = demo ? demoDoor(plane) : undefined
    const base = door === undefined ? '' : PREFIX
    const user = door === undefined ? mount(plane.fetch) : mount(door.fetch, { base, session: demoSession(door.fetch, base) })
    // The whole journey: the menu, a form and its list, a create through a
    // lookup's search, an update, a search for what the create typed, and
    // its row opened -- its lines listed, a label resolved -- and deleted.
    if (door === undefined) await signIn(user, TOKENS.clerk)
    else await signInAs(user, 'Clara')
    await chooseForm(user, formId)
    await chooseRenderer(user)
    await newRecord(user)
    await rendered()
    await chooseCustomer(user, 'Angular', 'Muster', 'Muster AG')
    await answer(user, 'Angular', 'Order date', EDGES.orderDate)
    await answer(user, 'Angular', 'Amount', '9')
    await answer(user, 'Angular', 'Notes', words)
    await save(user, 'Angular')
    const record = (await said('Angular', /^Created record /)).slice('Created record '.length, -1)
    await load(user, record)
    await loaded(record)
    await shows('React', 'Customer', 'Muster AG')
    await answer(user, 'React', 'Amount', '10')
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    // Its own row, found by the words typed into it -- the grid shows a
    // page, and the database holds every file's orders -- and opened.
    await searchRecords(user, words, [record.slice(3)])
    const created = recordRows().find((row) => within(row).getAllByRole('gridcell')[0]?.textContent === record.slice(3)) as HTMLElement
    await user.click(within(created).getAllByRole('gridcell')[1] as HTMLElement)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Order line' })).toBeTruthy(), { timeout: 15_000 })
    await answeredOnce('Order line')
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy(), { timeout: 15_000 })

    const page: Sent[] = door === undefined ? [...plane.sent] : [...door.sent]
    const token = door === undefined ? TOKENS.clerk : String(door.tokens[0])
    const line = (request: Sent): string => `${request.method} ${request.path}`

    // On the demo's path, the page first asks the Worker for its people and
    // signs in, and nothing else of the Worker's; on its own origin it has
    // no Worker to ask.
    const session = page.filter((request) => request.path === `${PREFIX}/session`)
    expect(session.map(line)).toEqual(door === undefined ? [] : [`GET ${PREFIX}/session`, `POST ${PREFIX}/session`])
    expect(page.slice(0, session.length)).toEqual(session)
    // Every other request is under the base -- `/v1/` on its own origin,
    // `/data/demo/v1/` on the demo's path, where the Worker forwards
    // nothing else -- and is a route of the runtime plane once the base is
    // taken off.
    const api = page.slice(session.length)
    expect(api.filter((request) => !request.path.startsWith(`${base}/v1/`)).map(line)).toEqual([])
    const sent: Sent[] = api.map((request) => ({ ...request, path: request.path.slice(base.length) }))

    // Nothing but the runtime plane's routes: no whoami, no administrator
    // route. A page that asked anything else would need a role, or know
    // something, a host's person does not have.
    expect(sent.map(line).filter((said) => !ROUTES.some(({ matches }) => matches.test(said)))).toEqual([])
    // And the journey used every one of them, so the table is not satisfied
    // by a page that did less (watched failing with 0050's exception for the
    // delete route removed before the page had a control: delete unused).
    expect(ROUTES.filter(({ operation, matches }) => !NOT_YET_SENT.has(operation) && !sent.some((request) => matches.test(line(request)))).map(({ operation }) => operation)).toEqual([])
    expect(ROUTES.filter(({ operation, matches }) => NOT_YET_SENT.has(operation) && sent.some((request) => matches.test(line(request)))).map(({ operation }) => operation)).toEqual([])

    // Only the forms the menu named: a form is asked for by the id the
    // server listed, never one the page made up.
    const menu = sent.find((request) => line(request) === 'GET /v1/forms')
    expect(menu).toBeDefined()
    const named = new Set(((await plane.clerk.forms()) as { ok: true; value: { forms: Array<{ id: string }> } }).value.forms.map((form) => form.id))
    const asked = new Set(sent.flatMap((request) => /^\/v1\/forms\/([^/]+)/.exec(request.path)?.[1] ?? []).map(decodeURIComponent))
    expect([...asked].filter((id) => !named.has(id))).toEqual([])
    expect(asked.has(lines)).toBe(true)

    // The token in the Authorization header of every request, and in no URL
    // and no body: a URL is in every proxy's log, a body in every dump.
    for (const request of sent) {
      expect({ request: line(request), authorization: request.headers['authorization'] }).toEqual({ request: line(request), authorization: `Bearer ${token}` })
    }
    for (const request of page) {
      expect(request.url).not.toContain(token)
      expect(request.body ?? '').not.toContain(token)
    }

    // The tenant is the token's, never the form's or the page's: no body
    // names one, at any depth (0011, 0029).
    const tenants = page.flatMap((request) => keys(JSON.parse(request.body ?? '{}')).filter((key) => /tenant/i.test(key)).map((key) => `${line(request)}: ${key}`))
    expect(tenants).toEqual([])
  })
})
