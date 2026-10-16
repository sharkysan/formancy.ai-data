import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { FORM_WORDS } from '@formancy/core/words'
import { audit, unnamed } from './test-accessible.js'
import { chooseCustomer, chooseForm, chooseRenderer, mount, newRecord, pane, paper, RENDERERS, rendered, said, signIn, statuses } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'
import { SECOND_CUSTOMER } from './test-values.js'

/*
 * Which control a lookup reaches the page as (0066): the one the published
 * form names, which the generator writes -- a typeahead where the lookup can
 * be searched, a plain select of its first page where it cannot -- drawn as
 * it is given, on both engines and in both renderers, against the real
 * server as tenant 1's clerk.
 *
 * Found by role and accessible name, with reads the accessibility tree
 * cannot answer, said where they are made: whether a combobox is a box to
 * type into or a native select, which are both role combobox, read as its
 * element, its `aria-autocomplete` and whether it is disabled; and which
 * requests the page sent. A select is chosen with `user.selectOptions`:
 * user-event 14.6.7 moves a select by no key (its keydown behaviour walks
 * radios only), so the keyboard on a plain select is the browser gate's
 * (scripts/browser/workspace.mjs).
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
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }

/** What a renderer says under a control whose list could not be loaded, in its own words: upstream's, never typed here. */
const FAILED = FORM_WORDS['options.failed']

/** The order line form's paper in a pane. */
const linePaper = (renderer: RendererName): HTMLElement => within(pane(renderer)).getByRole('form', { name: `Order line, ${renderer}` })

/** The order line's Order, in a pane: its label carries the required mark in one renderer. */
const orderIn = (renderer: RendererName): HTMLElement => within(linePaper(renderer)).getByRole('combobox', { name: /^Order\*?$/ })

/** Read from the DOM: a box to type into and a native select are both role combobox. */
function shape(renderer: RendererName, element: HTMLElement): { renderer: RendererName; tag: string; autocomplete: string | null; disabled: boolean } {
  return { renderer, tag: element.tagName, autocomplete: element.getAttribute('aria-autocomplete'), disabled: (element as HTMLInputElement | HTMLSelectElement).disabled }
}

/** The names a select offers, its empty first option left out. */
function offered(select: HTMLElement): string[] {
  return within(select)
    .queryAllByRole('option')
    .map((option) => computeAccessibleName(option))
    .filter((name) => name !== '')
}

/** The state's name, and what axe and the name check found in it: both empty, or the state says which failed. */
async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}

const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

/** The page signed in as tenant 1's clerk, `formId` chosen under Forms and its records answered, both renderers on. */
async function workspace(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await chooseRenderer(user)
  return user
}

/** An order of tenant 1's for Muster AG dated `date`, made beside the page as another clerk would: its token. */
async function orderDated(engine: Engine, date: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: date, status: 'placed', amount: '1', notes: `dated ${date}` })
  if (!created.ok || created.value.record === null) throw new Error(`the order was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** Every search the page sent for `formId`'s lookups since request `from`, by what it searched for. */
function searchesOf(formId: string, from: number): unknown[] {
  return plane.sent
    .slice(from)
    .filter((sent) => sent.path.startsWith(`/v1/forms/${formId}/lookups/`) && sent.path.endsWith('/query'))
    .map((sent) => (JSON.parse(sent.body ?? '{}') as { search?: unknown }).search)
}

/**
 * Each renderer's own order for the line it creates, dated before every
 * other tenant-1 order a run makes -- the seeded one and every suite's are
 * EDGES.orderDate -- so the lookup's date-then-key order puts it on the first
 * page however many orders other files add while this one runs.
 */
const DATED = [
  ['React', '2026-01-02'],
  ['Angular', '2026-01-03'],
] as const satisfies ReadonlyArray<readonly [RendererName, string]>

describe.each(ENGINES)('the control a lookup is drawn as on $engine', (engine) => {
  // The order's customer shows its name, which a search matches, so the
  // generator writes it as a typeahead and the page draws what it is given:
  // a box to type into in each renderer, through which the person finds
  // Muster AG by typing. A searchable lookup drawn as a plain select offers
  // its first page and nothing past it (watched failing with the widget
  // taken off the form the page is served and the page's rewrite gone: a
  // SELECT in each pane).
  test('draws a lookup a person can search as a box to type into, in both renderers', async () => {
    const user = await workspace(engine.formId)
    await newRecord(user)
    await rendered()
    expect(await floor('the order form, new')).toEqual(CLEAN('the order form, new'))
    for (const renderer of RENDERERS) {
      const box = within(paper(renderer)).getByRole('combobox', { name: 'Customer' })
      expect(shape(renderer, box)).toEqual({ renderer, tag: 'INPUT', autocomplete: 'list', disabled: false })
      await chooseCustomer(user, renderer, 'Muster', 'Muster AG')
    }
    expect(await floor('a customer chosen in each')).toEqual(CLEAN('a customer chosen in each'))
  })

  // The order line's lookup shows its order's date alone, which no search
  // matches, so the server refuses every typed search of it
  // (lookup/query.ts, 400 not-searchable). The generator writes it as a
  // plain select of its first page, which asks only the empty search: every
  // query the page sends for the form searches for '' -- a choice then asks
  // /resolve for its label, with tokens and no search. Chosen there, the line
  // is created under that order. A box over it would answer only the search
  // it asks on mount and refuse every one typed (watched failing with the
  // page's rewrite kept: an INPUT, and one character typed into it was
  // answered 400 not-searchable, the box saying "The options could not be
  // loaded. Type to try again.").
  test.each(DATED)('draws a lookup no search matches as a plain select, through which %s creates a line', async (renderer, date) => {
    const order = await orderDated(engine, date)
    const from = plane.sent.length
    const user = await workspace(engine.lines)
    await newRecord(user)
    await waitFor(() => expect(orderIn(renderer)).toBeTruthy(), ARRIVES)
    expect(shape(renderer, orderIn(renderer))).toEqual({ renderer, tag: 'SELECT', autocomplete: null, disabled: false })
    const option = await within(orderIn(renderer)).findByRole('option', { name: date }, ARRIVES)
    expect(await floor('the order line, its orders listed')).toEqual(CLEAN('the order line, its orders listed'))

    await user.selectOptions(orderIn(renderer), option)
    await waitFor(() => expect(computeAccessibleName(within(orderIn(renderer)).getByRole('option', { selected: true }))).toBe(date), ARRIVES)
    for (const [name, value] of [[/^Line no\b/, '1'], [/^Quantity\b/, '2'], [/^Unit price\b/, '3.50']] as const) {
      const field = within(linePaper(renderer)).getByLabelText(name)
      await user.clear(field)
      await user.type(field, value)
    }
    await user.click(within(linePaper(renderer)).getByRole('button', { name: 'Save' }))
    const created = await said(renderer, /^Created record /)
    const stored = await plane.clerk.read(engine.lines, created.slice('Created record '.length, -1))
    expect(stored.ok && stored.value.answers['order']).toBe(order)
    const searches = searchesOf(engine.lines, from)
    expect({ asked: searches.length > 0, searches: [...new Set(searches)] }).toEqual({ asked: true, searches: [''] })
    expect(await floor('the order line, created')).toEqual(CLEAN('the order line, created'))
  })

  // A plain select asks its source once, with the empty search, and cannot
  // be typed into. When that one search fails -- the database out of reach,
  // which the real server answers 503 -- each renderer says its own words
  // for a list that failed, "Type to try again.", under a control nobody can
  // type into: 0066's cost, held here, so that a change upstream to what a
  // select says when its list fails is seen. It asks again only when the
  // form is drawn again: New record opens a new engine (`session.open`),
  // which React's search depends on and over which the Angular pane starts a
  // new application (angular-mount.tsx), and that search lists the orders
  // (watched failing with the page's rewrite kept: the words were under an
  // INPUT).
  test("says a plain select's failed search in the renderer's words, and asks again when the form is drawn again", async () => {
    const user = await workspace(engine.lines)
    plane.unreachable.add(engine.connection)
    try {
      await newRecord(user)
      for (const renderer of RENDERERS) {
        await waitFor(() => expect({ renderer, statuses: statuses(renderer) }).toEqual({ renderer, statuses: expect.arrayContaining([FAILED]) as unknown }), ARRIVES)
        expect(shape(renderer, orderIn(renderer))).toEqual({ renderer, tag: 'SELECT', autocomplete: null, disabled: false })
        expect(offered(orderIn(renderer))).toEqual([])
      }
      expect(await floor('a plain select whose list failed')).toEqual(CLEAN('a plain select whose list failed'))
    } finally {
      plane.unreachable.delete(engine.connection)
    }

    await newRecord(user)
    for (const renderer of RENDERERS) {
      await waitFor(() => expect({ renderer, offers: offered(orderIn(renderer)).includes(EDGES.orderDate), failed: statuses(renderer).includes(FAILED) }).toEqual({ renderer, offers: true, failed: false }), ARRIVES)
    }
    expect(await floor('the plain select, asked again')).toEqual(CLEAN('the plain select, asked again'))
  })

  // A version as 0.1.0's server wrote it, generated before 0066: its lookup
  // names no widget. Written straight into the store, which this release's
  // publish refuses -- its base is not what this generator makes -- and
  // served, since a read validates and never runs the generator
  // (bundle-format2.ts). The page draws it as published, a plain select of
  // the customers' first page in each renderer (0066: a version published
  // before it is drawn as published):
  // neither a rewrite brought back on the page nor a version rewritten on
  // read. Muster AG and the run's second customer are among the options,
  // not all of them: other files add and remove tenant 1's customers while
  // this one runs. Last of its engine's cases, because it publishes the
  // order form's version 2 (watched failing with the page's rewrite kept:
  // an INPUT).
  test('draws a form published before 0066 as published: its lookup a plain select', async () => {
    const stored = (await plane.store.read(engine.formId, 1)) as { base: { model: { fields: Array<{ key: string; widget?: string }> } }; form: { model: { fields: Array<{ key: string; widget?: string }> } } }
    for (const form of [stored.base, stored.form]) {
      const customer = form.model.fields.find((field) => field.key === 'customer')
      expect(customer?.widget).toBe('typeahead')
      delete customer?.widget
    }
    expect(await plane.store.publish(engine.formId, 1, stored)).toEqual({ ok: true, version: 2 })

    const user = await workspace(engine.formId)
    await newRecord(user)
    await rendered()
    for (const renderer of RENDERERS) {
      const select = within(paper(renderer)).getByRole('combobox', { name: 'Customer' })
      expect(shape(renderer, select)).toEqual({ renderer, tag: 'SELECT', autocomplete: null, disabled: false })
      await waitFor(() => expect({ renderer, offered: offered(select) }).toEqual({ renderer, offered: expect.arrayContaining(['Muster AG', SECOND_CUSTOMER.name]) as unknown }), ARRIVES)
    }
    expect(await floor('a form published before 0066')).toEqual(CLEAN('a form published before 0066'))
  })
})
