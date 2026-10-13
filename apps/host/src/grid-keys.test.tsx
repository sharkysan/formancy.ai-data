import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { chooseForm, gridSection, mount, signIn } from './test-host.js'
import type { User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The keys a record grid answers, and the ones it does not (0047, UX-SPEC
 * §7.3), in AG Grid Community as the page configures it, against the real
 * server, on a form that offers delete: Delete and Backspace clear nothing,
 * send nothing and ask nothing, because no cell is editable and no key
 * deletes -- a record is deleted from its detail's Delete record or its
 * row's Delete, behind a confirmation (0053); and no column resizes. And
 * every option the page sets has its module: AG Grid says so on the
 * console otherwise, and does nothing.
 *
 * That no column moves is the browser gate's: AG Grid moves a header by
 * where it is drawn, and jsdom draws nothing, so a movable column moved
 * nowhere here (seen: this suite passed with the columns movable).
 *
 * That a grid is one Tab stop, and that End reaches its last column, are the
 * browser gate's: AG Grid leaves the grid by moving the focus to a guard
 * element and letting the browser's own Tab carry on from there, which
 * jsdom and user-event do not do (seen here: the keyboard was left on the
 * guard); and Home and End are AG Grid's alone, which no option of the
 * page's changed when tried (`navigateToNextCell` returning null).
 *
 * Found by role and name, with one read the accessibility tree cannot
 * answer, said where it is made: a header cell's width, which has no role or
 * name and is the thing a resize would change.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ deletes: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

const records = (): HTMLElement => within(gridSection('Records')).getByRole('grid', { name: 'Records' })
const headers = (): string[] => within(records()).getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '')

/** The page with the form chosen, its grid answered, its first row opened by a click, and the keyboard on that row. */
async function inTheGrid(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await user.click(within(records()).getAllByRole('gridcell')[1] as HTMLElement)
  await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: /^Order k1:/ })).toBeTruthy(), { timeout: 15_000 })
  await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'))
  await settled()
  return user
}

/** Until the page has sent nothing for half a second: the opened record's labels asked for and answered. */
async function settled(): Promise<void> {
  let count = -1
  let since = Date.now()
  await waitFor(
    () => {
      if (plane.sent.length !== count) {
        count = plane.sent.length
        since = Date.now()
      }
      expect(Date.now() - since).toBeGreaterThanOrEqual(500)
    },
    { timeout: 15_000, interval: 100 },
  )
}

describe.each(ENGINES)('the record grid on $engine', ({ formId }) => {
  // No cell is editable, so Delete and Backspace clear nothing and nothing
  // is sent, and no key deletes: not even a confirmation opens, on a form
  // the person may delete with (watched failing with Delete turned into a
  // request, and with it mapped to the row's Delete: the confirmation
  // opened).
  test('clears, sends and asks nothing on Delete or Backspace', async () => {
    const user = await inTheGrid(formId)
    expect(within(records()).getAllByRole('columnheader').map((header) => header.textContent?.trim())).toContain('Delete')
    const before = within(records()).getAllByRole('gridcell').map((cell) => cell.textContent)
    const sent = plane.sent.length
    await user.keyboard('{Delete}{Backspace}')
    expect(within(records()).getAllByRole('gridcell').map((cell) => cell.textContent)).toEqual(before)
    expect(plane.sent.slice(sent).map((request) => `${request.method} ${request.path}`)).toEqual([])
    expect(screen.queryByRole('region', { name: /^Delete / })).toBeNull()
  })

  // AG Grid resizes a header with Alt and an arrow; the columns are at
  // their content's width, and the key does not change it (watched failing
  // with the columns resizable: a header grew from 92 to 96 pixels). The
  // width is read from the DOM.
  test('resizes no column', async () => {
    const user = await inTheGrid(formId)
    const order = headers()
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement?.getAttribute('role')).toBe('columnheader')
    const header = document.activeElement as HTMLElement
    const width = header.style.width
    await user.keyboard('{Alt>}{ArrowRight}{ArrowRight}{/Alt}')
    expect(headers()).toEqual(order)
    expect(header.style.width).toBe(width)
  })
})

// Every option the page sets has the module it needs: AG Grid otherwise
// writes "error #200" or a warning on the console and ignores the option.
test('says nothing on the console, so every option it uses has its module', async () => {
  const said = [vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
  const user = await inTheGrid(ENGINES[0].formId)
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(focusedName()).toMatch(/^Order k1:/), { timeout: 15_000 })
  const grid = said.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))).filter((text) => /AG Grid/.test(text))
  expect(grid).toEqual([])
})
