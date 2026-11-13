import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { focusedName } from './test-accessible.js'
import { columnsSaid, headerWidth, keptFor, openColumns, RECORDS_GRID, steadyWidth, widthButton } from './test-columns.js'
import { chooseForm, dataCell, gridSection, gridStatus, mount, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'
import { WIDTH_STEP } from './widths.js'

/*
 * The keys a record grid answers, and the ones it does not (0047, UX-SPEC
 * §7.3), in AG Grid Community as the page configures it, against the real
 * server, on a form that offers delete: Delete and Backspace clear nothing,
 * send nothing and ask nothing, because no cell is editable and no key
 * deletes -- a record is deleted from its detail's Delete record or its
 * row's Delete, behind a confirmation (0053); Alt and an arrow on a header
 * resize its column, which the page keeps (0151); and a width set in
 * Columns stays through a new page, the separator let go and the page
 * mounted again, the grid's sizing never taking it away. And every option
 * the page sets has its module: AG Grid says so on the console otherwise,
 * and does nothing.
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
 * Found by role and name, with two reads the accessibility tree cannot
 * answer, said where they are made: a header cell's width, which has no role
 * or name and is the thing a resize changes (test-columns.ts's
 * `headerWidth`); and the column a focused header is, its `col-id`, which
 * AG Grid gives the cell and no name says. That a pointer's drag on a
 * header's edge resizes it is the browser gate's (scripts/browser/widths.mjs):
 * AG Grid reads a drag from where things are drawn, and jsdom draws nothing.
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
const headers = (): string[] =>
  within(records())
    .getAllByRole('columnheader')
    .map((header) => header.textContent?.trim() ?? '')

/** The page with the form chosen, its grid answered, its first row opened by a click, and the keyboard on that row. */
async function inTheGrid(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await user.click(dataCell(records(), 1))
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

describe.each(ENGINES)('the record grid on $engine', (engine) => {
  const { formId } = engine
  // No cell is editable, so Delete and Backspace clear nothing and nothing
  // is sent, and no key deletes: not even a confirmation opens, on a form
  // the person may delete with (watched failing with Delete turned into a
  // request, and with it mapped to the row's Delete: the confirmation
  // opened).
  test('clears, sends and asks nothing on Delete or Backspace', async () => {
    const user = await inTheGrid(formId)
    expect(
      within(records())
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim()),
    ).toContain('Delete')
    const before = within(records())
      .getAllByRole('gridcell')
      .map((cell) => cell.textContent)
    const sent = plane.sent.length
    await user.keyboard('{Delete}{Backspace}')
    expect(
      within(records())
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent),
    ).toEqual(before)
    expect(plane.sent.slice(sent).map((request) => `${request.method} ${request.path}`)).toEqual([])
    expect(screen.queryByRole('region', { name: /^Delete / })).toBeNull()
  })

  // AG Grid resizes a header's column with Alt and an arrow, two pixels a
  // press, and the page lets it (0151): AG Grid takes those keys from the
  // browser on a header whether or not a column resizes, so stopping it
  // would give them to nothing, and what it sets is kept as a drag's width
  // is, for that column alone; no column moves (before 0151 this case held
  // the opposite, watched failing with the columns resizable: a header grew
  // from 92 to 96 pixels; to be watched failing in CI with B1, a field's
  // column not resizable, as before 0151: the header left at its width and
  // nothing kept).
  test('resizes and keeps a column by Alt and an arrow on its header', async () => {
    const user = await inTheGrid(formId)
    const order = headers()
    // Up twice: through the row of the header boxes (0132) to the column's header.
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(document.activeElement?.getAttribute('role')).toBe('columnheader')
    const header = document.activeElement as HTMLElement
    const width = Number.parseFloat(header.style.width)
    await user.keyboard('{Alt>}{ArrowRight}{ArrowRight}{/Alt}')
    expect(headers()).toEqual(order)
    expect(Number.parseFloat(header.style.width)).toBe(width + 4)
    expect(keptFor(RECORDS_GRID, formId)?.widths).toEqual([{ field: header.getAttribute('col-id'), width: width + 4 }])
  })

  // A width set in Columns is the person's until they give it back: a new
  // page sizes nothing, the separator let go sizes every column again but
  // that one, and the page mounted again -- a reload -- opens it at the
  // width kept, its first page sized around it. The other columns are at
  // their content's width throughout, which in jsdom is each header's floor
  // (to be watched failing in CI with B2, the grid's sizing given every
  // column, as before 0151: Notes back at its content's width after the
  // separator was let go, and on the page mounted again).
  test('keeps a width set in Columns through a new page, the separator let go and a reload', async () => {
    const notes = stamp('widths')
    await plane.db.insertOrders(engine.connection, LIST_PAGE_SIZE + 3, notes)
    const searched = async (): Promise<User> => {
      const user = mount(plane.fetch)
      await signIn(user, TOKENS.clerk)
      await chooseForm(user, formId)
      const search = screen.getByRole('search', { name: 'Search records' })
      await user.type(within(search).getByRole('textbox', { name: 'Search' }), notes)
      await user.click(within(search).getByRole('button', { name: 'Search' }))
      await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`), { timeout: 15_000 })
      return user
    }
    const user = await searched()
    const content = await steadyWidth('Records', 'Notes')
    await openColumns(user, 'Records')
    widthButton('Records', 'Notes', 'wider').focus()
    await user.keyboard('{Enter}{Enter}')
    const wide = content + 2 * WIDTH_STEP
    await waitFor(() => expect(headerWidth('Records', 'Notes')).toBe(wide))
    expect(columnsSaid('Records')).toBe(`Notes is ${String(wide)} pixels wide.`)
    expect(keptFor(RECORDS_GRID, formId)?.widths).toEqual([{ field: 'notes', width: wide }])

    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Next rows' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows ${String(LIST_PAGE_SIZE + 1)}–${String(LIST_PAGE_SIZE + 3)}.`), {
      timeout: 15_000,
    })
    expect(headerWidth('Records', 'Notes')).toBe(wide)

    // The separator let go from the keyboard sizes every column again, a task later, and AG Grid's own a task after that.
    screen.getByRole('separator', { name: 'Records' }).focus()
    await user.keyboard('{ArrowDown}')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(headerWidth('Records', 'Notes')).toBe(wide)

    cleanup()
    await searched()
    await waitFor(() => expect(headerWidth('Records', 'Notes')).toBe(wide))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(headerWidth('Records', 'Notes')).toBe(wide)
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
