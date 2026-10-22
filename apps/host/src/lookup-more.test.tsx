import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { createFormText } from '@formancy/core/words'
import { DEFAULT_MAX_PAGE_SIZE } from '@formancy/data-core'
import { focusedName } from './test-accessible.js'
import { answer, chooseForm, chooseRenderer, load, loaded, mount, newRecord, pane, paper, RENDERERS, said, save, shows, signIn, statuses } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { ENGINES, PAGED, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A lookup says when its list goes on, never how long it is (0085): as
 * tenant 3's clerk, whose customers are a lookup page of `First NN` and ten
 * `Later NN` past it, and whose orders a page and one more, on both
 * engines and in both renderers, against the real server, the typeahead
 * driven by the keyboard alone.
 *
 * Found by role and accessible name, with reads the accessibility tree
 * cannot answer, said where they are made: the active option is the element
 * the combobox's `aria-activedescendant` names, whose name is then read;
 * whether a field is disabled is its element's; and which requests the
 * page sent.
 *
 * What the control says is upstream's: `optionsStatus` in
 * `@formancy/core/words` decides it, nothing under a closed list and
 * nothing under a field a rule disables (formancy.ai 0177), and its words
 * are read from there, never typed here. Held here too, because this
 * record's promise rests on them: a page that goes on is said where the
 * person can act on it, and nowhere else. What is said is the live
 * region's text; where it is drawn, and whether the open list covers it,
 * jsdom cannot see, and the browser gate says (scripts/browser/more.mjs).
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ paged: true, children: true })
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

const text = createFormText({ locale: '' })

/** What an open typeahead says over a page that goes on, in the renderer's own words, with the page the source states. */
const MORE = text('options.more', { count: DEFAULT_MAX_PAGE_SIZE })

/** What a plain select says over a page that goes on: nobody can type into one, so it asks nobody to. */
const MORE_LISTED = text('options.moreListed', { count: DEFAULT_MAX_PAGE_SIZE })

/** The paged customers' names on the first page, in order. */
const FIRST = PAGED.customers.slice(0, DEFAULT_MAX_PAGE_SIZE).map((customer) => customer.name)

/** The Customer combobox in a renderer's paper. */
const customer = (renderer: RendererName): HTMLElement => within(paper(renderer)).getByRole('combobox', { name: 'Customer' })

/** What the open list offers, by name; empty when it is closed, since a closed listbox is hidden. */
function offered(renderer: RendererName): string[] {
  const list = within(paper(renderer)).queryByRole('listbox', { name: 'Customer suggestions' })
  return list === null ? [] : within(list).getAllByRole('option').map((option) => computeAccessibleName(option))
}

/** The option the combobox names active, by name. A DOM read: `aria-activedescendant` is an id. */
function active(renderer: RendererName): string | null {
  const id = customer(renderer).getAttribute('aria-activedescendant')
  const option = id === null ? null : document.getElementById(id)
  return option === null ? null : computeAccessibleName(option)
}

/** Whether the pane says that the list goes on. */
const saysMore = (renderer: RendererName): boolean => statuses(renderer).includes(MORE)

/** Every lookup search the page sent for `formId` since request `from`, by what it searched for. */
function searchesOf(formId: string, from = 0): unknown[] {
  return plane.sent
    .slice(from)
    .filter((sent) => sent.path.startsWith(`/v1/forms/${formId}/lookups/`) && sent.path.endsWith('/query'))
    .map((sent) => (JSON.parse(sent.body ?? '{}') as { search?: unknown }).search)
}

/**
 * Wait until the list offers `names` and says `more`, once the search for
 * `query` has been sent. The answer before it is held on screen while it
 * runs, and a page for `""` offers the same rows as a page for `First`, so
 * only what the list says tells them apart: a search that settled saying
 * the wrong thing fails here, naming what the list said instead.
 */
async function listing(renderer: RendererName, formId: string, query: string, from: number, names: readonly string[], more: boolean): Promise<void> {
  await waitFor(() => expect({ renderer, query, sent: searchesOf(formId, from).includes(query), offered: offered(renderer), more: saysMore(renderer) }).toEqual({ renderer, query, sent: true, offered: names, more }), ARRIVES)
}

/** Press Tab until `target` has the keyboard, as a person reaches a field; fails when it never does. */
async function tabTo(user: User, target: () => HTMLElement, name: string): Promise<void> {
  for (let step = 0; step < 80 && document.activeElement !== target(); step += 1) await user.tab()
  expect({ name, reached: document.activeElement === target() }).toEqual({ name, reached: true })
}

/**
 * Both renderers ask a search 250 ms after it is wanted (`DEBOUNCE_MS` in
 * `@formancy/react` and `@formancy/angular` 0.6.0 and 0.7.0), so a field that searched
 * by itself when it was drawn has sent its search within this.
 */
const PAST_THE_DEBOUNCE_MS = 1_000

/** The page as tenant 3's clerk, `formId` chosen under Forms with its records answered, in `renderer` alone. */
async function workspace(formId: string, renderer: RendererName | 'Both'): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.thirdClerk)
  await chooseForm(user, formId)
  await chooseRenderer(user, renderer)
  return user
}

/** Tenant 3's customer called `name`, by its token, asked beside the page. */
async function tokenOf(engine: Engine, name: string): Promise<string> {
  const definition = await plane.thirdClerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.thirdClerk.query(engine.formId, source, { operation: 'create', search: name })
  if (!found.ok || found.value.rows.length !== 1) throw new Error(`no one customer is called ${name}`)
  return found.value.rows[0]?.token ?? ''
}

describe.each(ENGINES)('a lookup whose list goes on, on $engine', (engine) => {
  // The empty search answers the first page and says there are more: an
  // open list says so in upstream's words, with the page the source states,
  // and End reaches the page's last row, never one past it. Past the page
  // the person types: `First` is exactly one page and says nothing more;
  // `Later 07`, which no first page offers, is found and chosen by Down and
  // Enter, the keyboard staying on Customer, and saved as its own token.
  // Chosen, the list is closed and says nothing; Down opens the first page
  // again, and the sentence returns. Watched failing on both engines, in
  // both renderers, with the client's source answering a search with a
  // list, as it did before this record, built into its dist: the open list
  // offered the first page and never said there were more.
  test.each(RENDERERS)('says in an open %s typeahead that the list goes on, and a row past it is found by typing', async (renderer) => {
    const user = await workspace(engine.formId, renderer)
    await newRecord(user)
    await waitFor(() => expect(customer(renderer)).toBeTruthy(), ARRIVES)
    await tabTo(user, () => customer(renderer), 'Customer')

    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect({ renderer, offered: offered(renderer), more: saysMore(renderer) }).toEqual({ renderer, offered: FIRST, more: true }), ARRIVES)
    await user.keyboard('{End}')
    expect({ renderer, active: active(renderer), later: offered(renderer).filter((name) => name.startsWith('Later')) }).toEqual({ renderer, active: FIRST.at(-1), later: [] })

    let from = plane.sent.length
    await user.keyboard('First')
    await listing(renderer, engine.formId, 'First', from, FIRST, false)

    from = plane.sent.length
    await user.keyboard('{Backspace>5/}Later 07')
    await listing(renderer, engine.formId, 'Later 07', from, ['Later 07'], false)
    await user.keyboard('{ArrowDown}{Enter}')
    await shows(renderer, 'Customer', 'Later 07')
    expect({ renderer, focused: focusedName(), offered: offered(renderer), more: saysMore(renderer) }).toEqual({ renderer, focused: 'Customer', offered: [], more: false })

    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect({ renderer, more: saysMore(renderer) }).toEqual({ renderer, more: true }), ARRIVES)
    await user.keyboard('{Escape}')

    await answer(user, renderer, 'Order date', '2026-03-02')
    await answer(user, renderer, 'Amount', '7')
    await save(user, renderer)
    const created = (await said(renderer, /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
    const stored = await plane.thirdClerk.read(engine.formId, created)
    expect(stored.ok && stored.value.answers['customer']).toBe(await tokenOf(engine, 'Later 07'))
  })

  // The order line's lookup shows its order's date alone, so it is a plain
  // select of its first page (0066), and tenant 3 has a page of orders and
  // more: under the select each renderer says the list goes on, in the
  // select's own words, which ask nobody to type; the select offers the
  // page. Watched failing on both engines with the client's source
  // answering a search with a list: the select said nothing.
  test('says under a plain select that its list goes on, in words that ask nobody to type', async () => {
    const user = await workspace(engine.lines, 'Both')
    await newRecord(user)
    for (const renderer of RENDERERS) {
      // Its label carries the required mark in one renderer.
      const order = (): HTMLElement => within(within(pane(renderer)).getByRole('form', { name: `Order line, ${renderer}` })).getByRole('combobox', { name: /^Order\*?$/ })
      await waitFor(() => expect({ renderer, more: statuses(renderer).includes(MORE_LISTED) }).toEqual({ renderer, more: true }), ARRIVES)
      expect({ renderer, tag: order().tagName, options: within(order()).getAllByRole('option').filter((option) => computeAccessibleName(option) !== '').length, typeahead: statuses(renderer).includes(MORE) }).toEqual({ renderer, tag: 'SELECT', options: DEFAULT_MAX_PAGE_SIZE, typeahead: false })
    }
  })

  // A record the person may only read draws its Customer disabled, which
  // asks only for the name of what it holds (formancy 0.6.0 and 0.7.0): tenant 3's
  // order shows First 01, the page sends no lookup search for the form once
  // it is open, and neither pane says the list goes on, though it does --
  // nobody can choose from it. Before a record is open the page holds each
  // renderer's empty form, hidden, whose Customer asks for the first page;
  // the case waits those out first, so what it counts is the record's.
  // Watched failing on both engines with the page drawing a record it may
  // not update with the editable form: React's Customer was not disabled,
  // and with that check left out, the renderers searched "" twice once the
  // record was open.
  test('says nothing of the list under a field nobody can change, and searches nothing', async () => {
    const record = PAGED.orders[engine.connection]
    const user = await workspace(engine.read, 'Both')
    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DEBOUNCE_MS))
    const from = plane.sent.length
    await load(user, record)
    await loaded(record)
    for (const renderer of RENDERERS) {
      await shows(renderer, 'Customer', 'First 01')
      expect({ renderer, disabled: (customer(renderer) as HTMLInputElement).disabled }).toEqual({ renderer, disabled: true })
    }
    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DEBOUNCE_MS))
    expect({ searches: searchesOf(engine.read, from), more: RENDERERS.map(saysMore) }).toEqual({ searches: [], more: [false, false] })
  })
})
