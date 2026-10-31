import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { PREFIX } from '@formancy/data-live-demo/worker'
import { ROUTE_OPERATIONS } from '@formancy/data-server'
import { demoSession } from './demo.js'
import { demoDoor } from './test-demo.js'
import { applyCondition, listsApplied, listsSent } from './test-filter.js'
import {
  answer,
  answeredOnce,
  chooseCustomer,
  chooseForm,
  chooseRenderer,
  exportButton,
  exportLine,
  gridSection,
  gridStatus,
  keeping,
  load,
  loaded,
  mount,
  newRecord,
  rendered,
  said,
  save,
  searchRecords,
  shows,
  signIn,
  signInAs,
  stamp,
  statuses,
} from './test-host.js'
import type { User } from './test-host.js'
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
 * confirmation in place, and the export, since 0080, from Download CSV.
 *
 * And through both doors the page has: its own origin, as a host serves
 * it, and the live demo's path, behind the demo's Worker (0070), where the
 * page asks the Worker for its people and a sign-in and then speaks the
 * same routes under its base -- the token still in the header alone.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deletes: true, demo: true, versions: true })
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

/** The price's React paper, and a control of it by its name: the shared helpers' paper is the order's. */
const pricePaper = (): HTMLElement => within(screen.getByRole('region', { name: 'React' })).getByRole('form', { name: 'Price, React' })
const priceControl = (name: string): HTMLInputElement => within(pricePaper()).getByLabelText<HTMLInputElement>(name, { exact: true })

/**
 * A price through the page, in React: created, its amount changed, and
 * changed from a date (0115) -- a form whose tenant is a column of its own,
 * which a renderer submits with every save (0116).
 */
async function priceJourney(user: User, price: string): Promise<void> {
  await chooseForm(user, price)
  await newRecord(user)
  await waitFor(() => expect(priceControl('Product no')).toBeTruthy(), { timeout: 15_000 })
  await user.type(priceControl('Product no'), String(8000 + Math.floor(Math.random() * 1000)))
  fireEvent.change(priceControl('Valid from'), { target: { value: '2026-01-01' } })
  await user.type(priceControl('Amount'), '9.5')
  await user.click(within(pricePaper()).getByRole('button', { name: 'Save' }))
  const record = (await said('React', /^Created record /)).slice('Created record '.length, -1)
  await load(user, record)
  await loaded(record, 'Price')
  await user.clear(priceControl('Amount'))
  await user.type(priceControl('Amount'), '10')
  await user.click(within(pricePaper()).getByRole('button', { name: 'Save' }))
  await said('React', /^Saved\.$/)
  await user.click(screen.getByRole('button', { name: 'Change from a date' }))
  await screen.findByRole('heading', { level: 3, name: `Next version of ${record}` }, { timeout: 15_000 })
  fireEvent.change(priceControl('Valid from'), { target: { value: '2026-07-01' } })
  await user.click(within(pricePaper()).getByRole('button', { name: 'Save' }))
  // The next version is a record of its own: created, and what the detail shows.
  let next = ''
  await waitFor(
    () => {
      next =
        statuses('React')
          .flatMap((text) => /^Created record (.+)\.$/.exec(text)?.[1] ?? [])
          .find((token) => token !== record) ?? ''
      expect(next).not.toBe('')
    },
    { timeout: 15_000 },
  )
  await screen.findByRole('heading', { level: 3, name: `Price ${next}` }, { timeout: 15_000 })
}

/** The page's doors: its own origin on each engine, and the live demo's path, behind its Worker, signed in as tenant 1's clerk. */
const JOURNEYS = [
  ...ENGINES.map((engine) => ({ ...engine, door: 'its own origin', demo: false })),
  // The demo serves PostgreSQL alone (deploy/demo), and the base is the
  // client's, which knows no engine.
  { ...ENGINES[0], door: "the demo's path", demo: true },
]

describe.each(JOURNEYS)('what the page sends on $engine, through $door', ({ formId, lines, price, demo }) => {
  test('only runtime routes under its base, each carrying the token in the header and nowhere else, never a tenant, and only for forms the menu named', async () => {
    plane.sent.length = 0
    const words = stamp('plane')
    const door = demo ? demoDoor(plane) : undefined
    const base = door === undefined ? '' : PREFIX
    const { save: keep, saved } = keeping()
    const user = door === undefined ? mount(plane.fetch, { save: keep }) : mount(door.fetch, { base, session: demoSession(door.fetch, base), save: keep })
    // The whole journey: the menu, a form and its list, a create through a
    // lookup's search, an update, a search for what the create typed, a
    // filter on the same words (0104), the file of what they found, and its
    // row opened -- its lines listed, a label resolved -- and deleted.
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
    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: words })
    await listsApplied('Records', [`Notes contains “${words}”`])
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe('Rows 1–1. Filtered by Notes.'), { timeout: 15_000 })
    await user.click(exportButton('Records'))
    await waitFor(() => expect(exportLine('Records').textContent).toBe(`Made ${formId}.csv; your browser saves it.`), { timeout: 15_000 })
    expect(saved.map((file) => file.name)).toEqual([`${formId}.csv`])
    const created = recordRows().find((row) => within(row).getAllByRole('gridcell')[0]?.textContent === record.slice(3)) as HTMLElement
    await user.click(within(created).getAllByRole('gridcell')[1] as HTMLElement)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Order line' })).toBeTruthy(), { timeout: 15_000 })
    await answeredOnce('Order line')
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy(), { timeout: 15_000 })
    // And on its own origin a price, whose tenant is a column of its own:
    // the demo publishes no form over versions.
    if (door === undefined) await priceJourney(user, price)

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
    // delete route removed before the page had a control: delete unused;
    // and with 0079's for the export removed before Download CSV: export
    // unused). A change from a date is sent from a price on the page's own
    // origin, the tenant a column the page sends in no body since 0116
    // (watched failing with 0115's exception removed before then: the
    // tenant in every body of the price's). Through the demo's door it is
    // the one exception: the demo publishes no form over versions.
    const UNSENT: ReadonlySet<string> = new Set(door === undefined ? [] : ['supersede'])
    expect(
      ROUTES.filter(({ matches, operation }) => !UNSENT.has(operation) && !sent.some((request) => matches.test(line(request)))).map(
        ({ operation }) => operation,
      ),
    ).toEqual([])

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
    const tenants = page.flatMap((request) =>
      keys(JSON.parse(request.body ?? '{}'))
        .filter((key) => /tenant/i.test(key))
        .map((key) => `${line(request)}: ${key}`),
    )
    expect(tenants).toEqual([])
    // Nor any field this person writes in no operation, by the server's own
    // answer (0116): each write of the price's names only what one of its
    // writes accepts -- not the end, nor the note the clerk only reads.
    if (door === undefined) {
      const opened = await plane.clerk.form(price)
      const writable = opened.ok ? new Set([...(opened.value.writable.create ?? []), ...(opened.value.writable.update ?? [])]) : new Set<string>()
      const writes = sent.filter(
        (request) =>
          request.path.startsWith(`/v1/forms/${price}/records/`) &&
          request.method === 'POST' &&
          !request.path.endsWith('/read') &&
          !request.path.endsWith('/list'),
      )
      expect(writes.map((request) => request.path.slice(`/v1/forms/${price}/records/`.length))).toEqual(['create', 'update', 'supersede'])
      const unwritten = writes.flatMap((request) =>
        Object.keys((JSON.parse(request.body ?? '{}') as { answers?: object }).answers ?? {})
          .filter((key) => !writable.has(key))
          .map((key) => `${line(request)}: ${key}`),
      )
      expect({ writable: writable.size > 0, unwritten }).toEqual({ writable: true, unwritten: [] })
    }

    // The filter travels as the search does (0104): in the body of the list
    // that answered it and of the file made after it, and its words in no
    // URL (watched failing with the export sent without it: no export body
    // held the condition).
    const condition = { field: 'notes', op: 'contains', text: words }
    expect(listsSent(sent, formId).some(({ body }) => JSON.stringify(body.filter) === JSON.stringify([condition]))).toBe(true)
    const files = sent
      .filter((request) => request.path === `/v1/forms/${formId}/records/export`)
      .map((request) => JSON.parse(request.body ?? '{}') as { filter?: unknown })
    expect(files.map((body) => body.filter)).toEqual([[condition]])
    expect(page.filter((request) => request.url.includes(words)).map(line)).toEqual([])
  })
})
