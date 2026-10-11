import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { ROUTE_OPERATIONS } from '@formancy/data-server'
import { answer, answeredOnce, chooseCustomer, chooseForm, chooseRenderer, gridSection, load, loaded, mount, newRecord, rendered, said, save, searchRecords, shows, signIn, stamp } from './test-host.js'
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
 * may send, and one the page sends that the table does not have fails. No
 * route deletes a record, so neither can the page.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true })
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

describe.each(ENGINES)('what the page sends on $engine', ({ formId, lines }) => {
  test('only runtime routes, each carrying the token in the header and nowhere else, never a tenant, and only for forms the menu named', async () => {
    plane.sent.length = 0
    const words = stamp('plane')
    const user = mount(plane.fetch)
    // The whole journey: the menu, a form and its list, a create through a
    // lookup's search, an update, a search for what the create typed, and
    // its row opened -- its lines listed, a label resolved.
    await signIn(user, TOKENS.clerk)
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

    const sent: Sent[] = [...plane.sent]
    const line = (request: Sent): string => `${request.method} ${request.path}`

    // Nothing but the runtime plane's routes: no whoami, no administrator
    // route. A page that asked anything else would need a role, or know
    // something, a host's person does not have.
    expect(sent.map(line).filter((said) => !ROUTES.some(({ matches }) => matches.test(said)))).toEqual([])
    // And the journey used every one of them, so the table is not satisfied
    // by a page that did less.
    expect(ROUTES.filter(({ matches }) => !sent.some((request) => matches.test(line(request)))).map(({ operation }) => operation)).toEqual([])

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
      expect({ request: line(request), authorization: request.headers['authorization'] }).toEqual({ request: line(request), authorization: `Bearer ${TOKENS.clerk}` })
      expect(request.url).not.toContain(TOKENS.clerk)
      expect(request.body ?? '').not.toContain(TOKENS.clerk)
    }

    // The tenant is the token's, never the form's or the page's: no body
    // names one, at any depth (0011, 0029).
    const tenants = sent.flatMap((request) => keys(JSON.parse(request.body ?? '{}')).filter((key) => /tenant/i.test(key)).map((key) => `${line(request)}: ${key}`))
    expect(tenants).toEqual([])
  })
})
