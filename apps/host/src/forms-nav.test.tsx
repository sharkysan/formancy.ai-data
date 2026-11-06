import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { answer, chooseForm, mount, openForm, signIn, unsavedNotice } from './test-host.js'
import type { User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The host's list of forms (0144), against the real server: Find a form,
 * then the clerk's forms under their groups (0143) -- the order forms and
 * their children under "Sales", the prices under "Parity", as their
 * schemas are named -- narrowed as the person types, then the forms linked
 * to the one open: where an order line's lookup opens (0140), and the
 * staff's orders whose rows refer to an employee (0045). What the list
 * orders, matches and links is form-list.test.ts's; here, that the page
 * draws it and the keyboard goes through it.
 *
 * Found by role and accessible name. Two reads the accessibility tree
 * cannot answer as a query, each where it is made: a link's
 * `aria-current`, a state testing-library has no query for, and the box's
 * value, which a person sees and the tree holds as no name.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, versions: true })
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

const nav = (): HTMLElement => screen.getByRole('navigation', { name: 'Forms' })
const box = (): HTMLInputElement => within(nav()).getByRole<HTMLInputElement>('textbox', { name: 'Find a form' })
const names = (elements: readonly HTMLElement[]): string[] => elements.map((element) => computeAccessibleName(element))

/** Every form link the list draws, by name: the groups' and the linked forms'. */
const listed = (): string[] => names(within(nav()).getAllByRole('link'))

/** The linked forms' links, by name: each ends in how it is linked, which no group's link says. */
const linked = (): string[] => listed().filter((name) => / (from its fields|its child rows)$/.test(name))

/** What the list's status says: the one status of the list once the menu names a form. */
const saying = (): string => within(nav()).getByRole('status').textContent ?? ''

/** Signed in as the clerk, with the list drawn and the keyboard on its heading, as arrival leaves it. */
async function arrived(): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await screen.findByRole('navigation', { name: 'Forms' }, ARRIVES)
  await waitFor(() => expect(focusedName()).toBe('Forms'), ARRIVES)
  return user
}

describe('the list of forms', () => {
  // A menu of forty forms in the order of their ids is read from the top;
  // under their groups it is a few headings, each a list it names, so a
  // screen reader's list of lists says "Parity" and "Sales". And Find a
  // form is the first stop after the list's heading, before any form
  // (watched failing in CI with the headings left undrawn, every form in
  // one unnamed list).
  test('lists the forms under their groups, each a list its heading names, after Find a form', async () => {
    const user = await arrived()
    expect(names(within(nav()).getAllByRole('heading', { level: 3 }))).toEqual(['Parity', 'Sales'])
    expect(names(within(within(nav()).getByRole('list', { name: 'Parity' })).getAllByRole('link'))).toEqual(['Price ms-price', 'Price pg-price'])
    expect(names(within(within(nav()).getByRole('list', { name: 'Sales' })).getAllByRole('link'))).toEqual([
      'Employee ms-employee',
      'Order ms-order',
      'Order line ms-order-line',
      'Order ms-order-staff',
      'Employee pg-employee',
      'Order pg-order',
      'Order line pg-order-line',
      'Order pg-order-staff',
    ])
    await user.tab()
    expect(focusedName()).toBe('Find a form')
    await user.tab()
    expect(focusedName()).toBe('Price ms-price')
  })

  // A search that only counted would leave the person reading the whole
  // list for the two they asked for (watched failing in CI with the list
  // drawn from every form whatever was typed).
  test('narrows the list as the person types, and says how many forms match', async () => {
    const user = await arrived()
    const total = listed().length
    expect(saying()).toBe('')
    await user.type(box(), 'line')
    await waitFor(() => expect(listed()).toEqual(['Order line ms-order-line', 'Order line pg-order-line']))
    expect(saying()).toBe(`2 of ${String(total)} forms match.`)
  })

  // The one form a search leaves is the one the person wants: Enter opens
  // it, as a click would, with the keyboard on its heading; with three left
  // Enter has nothing to choose between and opens nothing (watched failing
  // in CI with Enter opening the first form that matches, however many
  // do).
  test('opens the one form that matches on Enter, and nothing while several do', async () => {
    const user = await arrived()
    await user.type(box(), 'pg-order{Enter}')
    expect(saying()).toMatch(/^3 of \d+ forms match\.$/)
    expect(screen.getByRole('heading', { level: 2, name: 'No form open' })).toBeTruthy()
    expect(focusedName()).toBe('Find a form')
    await user.keyboard('-line')
    expect(saying()).toMatch(/^1 of \d+ forms matches\. Enter opens it\.$/)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe('Order line pg-order-line'), ARRIVES)
    expect(screen.getByRole('main', { name: 'Order line pg-order-line' })).toBeTruthy()
    expect(within(nav()).getByRole('link', { name: 'Order line pg-order-line' }).getAttribute('aria-current')).toBe('page')
  })

  // Escape is how a person takes back what they typed without reaching for
  // the mouse: the whole list again, the keyboard still in the box (watched
  // failing in CI with Escape in the box unhandled).
  test('empties the box on Escape and keeps the keyboard in it', async () => {
    const user = await arrived()
    const all = listed()
    await user.type(box(), 'price')
    await waitFor(() => expect(saying()).toMatch(/^2 of \d+ forms match\.$/))
    await user.keyboard('{Escape}')
    expect(box().value).toBe('')
    expect(focusedName()).toBe('Find a form')
    expect(listed()).toEqual(all)
    expect(saying()).toBe('')
  })

  // Down from the box is the way into what it found, and Down and Up go on
  // along the list, Up from its first form back to the box: a list only Tab
  // crosses is one stop per form between the box and the form wanted
  // (watched failing in CI with Down and Up on a form unhandled).
  test('moves from the box along the list with Down, and back with Up', async () => {
    const user = await arrived()
    await user.click(box())
    const steps: string[] = []
    for (const key of ['{ArrowDown}', '{ArrowDown}', '{ArrowDown}', '{ArrowUp}', '{ArrowUp}', '{ArrowUp}']) {
      await user.keyboard(key)
      steps.push(focusedName())
    }
    expect(steps).toEqual(['Price ms-price', 'Price pg-price', 'Employee ms-employee', 'Price pg-price', 'Price ms-price', 'Find a form'])
  })

  // A search that finds nothing is a dead end unless the page says so and
  // offers the way back: the line says what was looked for, and Clear the
  // search empties the box with the keyboard in it (watched failing in CI
  // with Clear the search left undrawn).
  test('says when nothing matches, and Clear the search empties the box', async () => {
    const user = await arrived()
    await user.type(box(), 'zzz')
    await waitFor(() => expect(saying()).toBe('No form’s title or id holds “zzz”.'))
    await user.click(within(nav()).getByRole('button', { name: 'Clear the search' }))
    expect(box().value).toBe('')
    expect(focusedName()).toBe('Find a form')
    expect(saying()).toBe('')
    expect(within(nav()).queryByRole('button', { name: 'Clear the search' })).toBeNull()
  })

  // The floor in each state the list reaches: a search, a search that
  // finds nothing, and a form open with its linked forms -- axe and a name
  // on every control (watched failing in CI with the linked forms' items
  // drawn without their list).
  test('passes the floor while searching, finding nothing, and with linked forms', async () => {
    const user = await arrived()
    await user.type(box(), 'line')
    await waitFor(() => expect(saying()).toMatch(/^2 of \d+ forms match\.$/))
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await user.keyboard('zzz')
    await waitFor(() => expect(saying()).toBe('No form’s title or id holds “linezzz”.'))
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await user.clear(box())
    // The staff's orders: linked from their fields (the employees) and by their child rows (the lines).
    await chooseForm(user, 'pg-order-staff')
    await within(nav()).findByRole('heading', { level: 3, name: 'Linked to Order' }, ARRIVES)
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })
})

describe.each(ENGINES)('the forms linked to the open one on $engine', (engine) => {
  // An order line's order is where its Order field leads, in either form
  // over the orders (0140): both are named under "Linked to Order line",
  // said in words to lead from its fields, and one opens as the list
  // opens it, the keyboard on its heading and its own entry marked
  // (watched failing in CI with the definition's `opens` left unread).
  test("names the forms an order line's lookups open in, and opens one", async () => {
    const user = await arrived()
    await chooseForm(user, engine.lines)
    await within(nav()).findByRole('heading', { level: 3, name: 'Linked to Order line' }, ARRIVES)
    expect(linked()).toEqual([`Order ${engine.formId} from its fields`, `Order ${engine.staff} from its fields`])
    await user.click(within(nav()).getByRole('link', { name: `Order ${engine.staff} from its fields` }))
    await waitFor(() => expect(focusedName()).toBe(`Order ${engine.staff}`), ARRIVES)
    expect(
      within(nav())
        .getByRole('link', { name: `Order ${engine.staff}` })
        .getAttribute('aria-current'),
    ).toBe('page')
  })

  // The staff's orders refer to an employee twice, through who created and
  // who approved them, and the employee form is its own child through the
  // manager: the list names the orders once, as its child rows, and not the
  // employee form, which is where the person is (watched failing in CI
  // with the menu's children left unread).
  test('names the forms whose rows refer to an employee once, and not the employee form', async () => {
    const user = await arrived()
    await chooseForm(user, engine.employees)
    await within(nav()).findByRole('heading', { level: 3, name: 'Linked to Employee' }, ARRIVES)
    expect(linked()).toEqual([`Order ${engine.staff} its child rows`])
  })

  // Enter in the box over unsaved work asks first, as a click does, and
  // Keep editing gives the keyboard back to the box it was pressed in,
  // with what was typed there (watched failing in CI with the matching
  // form's link handed to the guard in place of the box).
  test('asks before Enter leaves unsaved work, and Keep editing returns to the box', async () => {
    const user = await openForm(plane, engine.formId)
    await answer(user, 'Angular', 'Amount', '41')
    await user.type(box(), `${engine.employees}{Enter}`)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    expect(focusedName()).toBe('Find a form')
    expect(box().value).toBe(engine.employees)
  })
})
