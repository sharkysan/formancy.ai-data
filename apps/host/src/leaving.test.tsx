import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { answer, formLink, gridSection, gridStatus, load, newRecord, openForm, shows, unsavedNotice } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The unsaved-changes guard through the page (0047): every way of leaving a
 * form that holds a draft waits for the person -- New record, Load, another
 * form, Sign out, a child row, and hiding a renderer with the renderer
 * switch -- and each answer does what it says: Keep editing changes nothing
 * and gives the keyboard back to what asked, Discard and continue carries
 * the request out. Another row, Back and Forward are workspace.test.tsx's
 * and address.test.tsx's; what each request drops is leave.test.ts's table.
 *
 * On both engines and both renderers, against the real server.
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

/** The page with a new order typed into the Angular pane: a draft. */
async function drafted(formId: string): Promise<User> {
  const user = await openForm(plane, formId)
  await answer(user, 'Angular', 'Amount', '41')
  return user
}

/** The notice, once it is up, with the keyboard on it. */
async function asking(): Promise<HTMLElement> {
  await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
  const notice = unsavedNotice() as HTMLElement
  await waitFor(() => expect(document.activeElement).toBe(notice))
  return notice
}

const keep = async (user: User, notice: HTMLElement): Promise<void> => user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
const discard = async (user: User, notice: HTMLElement): Promise<void> => user.click(within(notice).getByRole('button', { name: 'Discard and continue' }))

describe.each(ENGINES)('leaving a draft on $engine', (engine) => {
  // New record over a draft: the lead names the request, Escape is Keep
  // editing and gives the keyboard back to New record, and Discard empties
  // the form for the new record.
  test('New record asks first; Escape keeps the draft, Discard starts again', async () => {
    const user = await drafted(engine.formId)
    await newRecord(user)
    let notice = await asking()
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe('Starting a new record closes these forms:')
    await user.keyboard('{Escape}')
    expect(unsavedNotice()).toBeNull()
    expect(focusedName()).toBe('New record')
    await shows('Angular', 'Amount', '41')
    await newRecord(user)
    notice = await asking()
    await discard(user, notice)
    await shows('Angular', 'Amount', '')
    await waitFor(() => expect(focusedName()).toBe('New record'))
  })

  // Load over a draft: Keep editing gives the keyboard back to Load, and
  // Discard loads the record and says so.
  test('Load asks first; Keep editing returns to Load, Discard loads', async () => {
    const user = await drafted(engine.formId)
    await load(user, EDGES.seededOrder)
    let notice = await asking()
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe(`Loading ${EDGES.seededOrder} closes these forms:`)
    await keep(user, notice)
    expect(focusedName()).toBe('Load')
    await shows('Angular', 'Amount', '41')
    await user.click(screen.getByRole('button', { name: 'Load' }))
    notice = await asking()
    await discard(user, notice)
    await shows('Angular', 'Customer', 'Muster AG')
    await waitFor(
      () =>
        expect(within(screen.getByRole('region', { name: `Order ${EDGES.seededOrder}` })).getAllByRole('status')[0]?.textContent).toBe(
          `Discarded the unsaved changes. Loaded record ${EDGES.seededOrder} into both forms.`,
        ),
      ARRIVES,
    )
  })

  // Another form from the menu: watched failing without the guard, when the
  // link opened the other form over the draft.
  test('another form asks first; Keep editing returns to its link, Discard opens it', async () => {
    const user = await drafted(engine.formId)
    const link = await formLink(engine.employees)
    await user.click(link)
    let notice = await asking()
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe('Opening Employee closes these forms:')
    expect(within(notice).getByRole('list').textContent).toBe('New record, Angular: changes that are not saved.')
    await keep(user, notice)
    expect(document.activeElement).toBe(link)
    await shows('Angular', 'Amount', '41')
    await user.click(link)
    notice = await asking()
    await discard(user, notice)
    await waitFor(() => expect(focusedName()).toBe(`Employee ${engine.employees}`), ARRIVES)
  })

  // Sign out over a draft forgets the draft only once the person says so.
  test('Sign out asks first; Keep editing returns to Sign out, Discard signs out', async () => {
    const user = await drafted(engine.formId)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    let notice = await asking()
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe('Signing out closes these forms:')
    await keep(user, notice)
    expect(focusedName()).toBe('Sign out')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    notice = await asking()
    await discard(user, notice)
    await waitFor(() => expect(focusedName()).toBe('Host token'), ARRIVES)
  })

  // The renderer switch hides a form that is not mounted afterwards: hiding
  // Angular with a draft in it asks, and React alone is drawn once the draft
  // is discarded. Showing a renderer hides nothing and asks nothing.
  test('hiding a renderer with a draft asks first', async () => {
    const user = await drafted(engine.formId)
    await user.click(screen.getByRole('radio', { name: 'React' }))
    let notice = await asking()
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe('Showing React closes these forms:')
    await keep(user, notice)
    expect(focusedName()).toBe('Both')
    expect((screen.getByRole('radio', { name: 'Both' }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'React' }))
    notice = await asking()
    await discard(user, notice)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Angular' })).toBeNull())
    expect(screen.getByRole('region', { name: 'React' })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Both' }))
    expect(unsavedNotice()).toBeNull()
    await shows('Angular', 'Amount', '')
  })

  // A child row's draft is asked about when another child row would replace
  // it, and not when the record's own forms change nothing of it.
  test("a child row's draft is asked about before another line replaces it", async () => {
    const user = await openForm(plane, engine.formId)
    await load(user, EDGES.seededOrder)
    // The lines of the loaded order: the section is drawn again for each parent, so it is found again.
    await waitFor(() => expect(gridStatus('Order line')?.textContent).toMatch(/^Order line rows 1–/), ARRIVES)
    const lines = gridSection('Order line')
    await user.click(within(lines).getByRole('button', { name: 'New Order line' }))
    const pane = await waitFor(() => screen.getByRole('region', { name: 'New Order line React' }), ARRIVES)
    const quantity = await waitFor(() => within(pane).getByLabelText(/^Quantity\b/), ARRIVES)
    await user.type(quantity, '3')
    await user.click(within(lines).getAllByRole('gridcell')[0] as HTMLElement)
    const notice = await asking()
    expect(within(notice).getByRole('list').textContent).toBe('New Order line, React: changes that are not saved.')
    await keep(user, notice)
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell')
    expect((within(pane).getByLabelText(/^Quantity\b/) as HTMLInputElement).value).toBe('3')

    // New Order line over the draft asks too, and Discard empties the line's form.
    await user.click(within(lines).getByRole('button', { name: 'New Order line' }))
    let again = await asking()
    expect(within(again).getAllByRole('paragraph')[0]?.textContent).toBe('Starting a new Order line closes these forms:')
    await discard(user, again)
    await waitFor(
      () => expect((within(screen.getByRole('region', { name: 'New Order line React' })).getByLabelText(/^Quantity\b/) as HTMLInputElement).value).toBe(''),
      ARRIVES,
    )

    // And Discard on another row opens it: the line's own form, its record named.
    await user.type(within(screen.getByRole('region', { name: 'New Order line React' })).getByLabelText(/^Quantity\b/), '5')
    await user.click(within(lines).getAllByRole('gridcell')[0] as HTMLElement)
    again = await asking()
    await discard(user, again)
    await screen.findByRole('heading', { level: 5, name: /^Order line k1:/ }, ARRIVES)
  })

  // Work typed into another form while the notice is up is not dropped
  // unnamed: Discard asks again, naming it, before anything is dropped
  // (watched failing: Discard dropped the React draft the notice never
  // listed).
  test('Discard names work typed while the notice was up before dropping it', async () => {
    const user = await drafted(engine.formId)
    await newRecord(user)
    const notice = await asking()
    expect(within(notice).getByRole('list').textContent).toBe('New record, Angular: changes that are not saved.')
    await answer(user, 'React', 'Amount', '8')
    await discard(user, notice)
    const again = await asking()
    expect(
      within(again)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['New record, React: changes that are not saved.', 'New record, Angular: changes that are not saved.'])
    await shows('React', 'Amount', '8')
    await discard(user, again)
    await shows('React', 'Amount', '')
    await shows('Angular', 'Amount', '')
  })
})
