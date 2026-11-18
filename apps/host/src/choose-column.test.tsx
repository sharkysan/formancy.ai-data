import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AgGridReact } from 'ag-grid-react'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { chooseColumn, CHOOSE_COLUMN } from './choose-column.js'
import { createChosenRows } from './chosen-rows.js'
import type { ChosenRows } from './chosen-rows.js'
import type { ArrangedColumn } from './columns.js'
import type { GridRow } from './grid-datasource.js'
import { columnDefsOf, gridOptionsFor } from './grid-options.js'
import type { OpenHow } from './grid-options.js'
import { audit, focusedName, unnamed } from './test-accessible.js'

/*
 * The column a person chooses a page's records with (0166), without a
 * server: AG Grid as the page configures it, the boxes' column first, and
 * three fake rows -- two records and a row whose key fits no token. What
 * a run over the records chosen sends, and what the page says of it, is
 * actions.test.tsx's against the real server, on both engines.
 *
 * Found by role and accessible name. Two reads the accessibility tree
 * cannot answer, said where they are made: a box's `tabIndex`, which is
 * what keeps it out of the Tab order; and which row is the open one, its
 * `aria-selected`, which AG Grid writes on the row and no name says.
 *
 * That Tab from a box leaves the grid in one stop is the browser gate's
 * (scripts/browser/choosing.mjs): AG Grid leaves the grid by moving the
 * keyboard to a guard element and letting the browser's own Tab carry on,
 * which user-event does not do (grid-keys.test.tsx). What is held here is
 * that it leaves the rows: no cell and no box of the grid has it after.
 */

afterEach(cleanup)

const column = (key: string, label: string): ArrangedColumn => ({ key, label, sortable: false, source: null, shown: true })
const COLUMNS = [column('id', 'Id'), column('status', 'Status')]
const row = (record: string | null, id: number, status: string): GridRow => ({
  id: record ?? `row-${String(id)}`,
  record,
  version: record === null ? null : '1',
  answers: { id, status },
  labels: {},
})
const ROWS = [row('k1:1', 1, 'placed'), row('k1:2', 2, 'shipped'), row(null, 3, 'lost')]

/** Each row asked for, as the page would open it: the token, and how. */
type Asked = Array<{ record: string | null; how: OpenHow; colId: string }>

/** A grid of the three rows, its first record open, every row asked for kept in `asked`, the choice told of the page as record-grid.tsx tells it. */
function Grid({ asked, choice }: { asked: Asked; choice: ChosenRows }): ReactElement {
  const [options] = useState(() =>
    gridOptionsFor({
      labelledBy: 'records',
      firstColumn: () => 'id',
      on: {
        openToken: () => 'k1:1',
        ready: (api) => {
          // Selected as the page selects the open row after each page (record-grid.tsx's applySelection).
          setTimeout(() => api.getRowNode('k1:1')?.setSelected(true), 0)
        },
        resized: () => {},
        asked: (at, how, _rowIndex, colId) => asked.push({ record: at?.record ?? null, how, colId }),
        drilling: () => false,
        sorted: () => {},
        widthsSet: () => {},
        example: () => {},
      },
    }),
  )
  return (
    <main>
      <h3 id="records">Records</h3>
      <div style={{ width: 800, height: 300 }}>
        <AgGridReact<GridRow>
          gridOptions={options}
          columnDefs={columnDefsOf(COLUMNS, undefined, new Set(), [], new Map(), chooseColumn(choice))}
          datasource={{
            getRows: (params) => {
              choice.page(ROWS, 0, ROWS)
              params.successCallback(ROWS, ROWS.length)
            },
          }}
        />
      </div>
      <button type="button">After the grid</button>
    </main>
  )
}

const grid = (): HTMLElement => screen.getByRole('grid', { name: 'Records' })

/** The row whose Id cell says `id`. */
async function rowOf(id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = within(grid())
      .getAllByRole('row')
      .find((each) =>
        within(each)
          .queryAllByRole('gridcell')
          .some((cell) => cell.getAttribute('col-id') === 'id' && cell.textContent === id),
      )
    if (found === undefined) throw new Error(`no row with id ${id}`)
    return found
  })
}

/** The cell of `colId` in the row whose Id says `id`. */
async function cellOf(id: string, colId: string): Promise<HTMLElement> {
  const at = await rowOf(id)
  return within(at)
    .getAllByRole('gridcell')
    .find((cell) => cell.getAttribute('col-id') === colId) as HTMLElement
}

function mount(): { asked: Asked; choice: ChosenRows } {
  // What the page around a grid has, which axe asks of any document.
  document.title = 'Records'
  document.documentElement.lang = 'en'
  const asked: Asked = []
  const choice = createChosenRows('Order')
  render(<Grid asked={asked} choice={choice} />)
  return { asked, choice }
}

describe('the boxes a person chooses records with', () => {
  // Each box is a real checkbox named for its record in the words its
  // Delete names it with, first of the row and headed Choose; a row whose
  // key fits no token has none, since no run could address it; no box is
  // in the Tab order; and the grid with them passes axe and names every
  // control (watched failing with the box drawn without its name: "Unable
  // to find role="checkbox" and name "Choose Order k1:1""; and with its
  // tabIndex left to the browser: "expected [ +0, +0 ] to deeply equal [
  // -1, -1 ]").
  test('are named for their records, first, out of the Tab order, and pass axe', async () => {
    mount()
    const first = await waitFor(() => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Choose Order k1:1' }))
    expect(screen.getByRole('checkbox', { name: 'Choose Order k1:2' })).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(within(grid()).getAllByRole('columnheader')[0]?.textContent?.trim()).toBe('Choose')
    expect(within(await rowOf('3')).queryAllByRole('checkbox')).toEqual([])
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((box) => box.tabIndex)).toEqual([-1, -1])
    expect(first.checked).toBe(false)
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
  })

  // The arrow keys reach a row's box from its cells: the cell hands the
  // keyboard to the box. Space there ticks it and asks nothing of the row
  // -- it neither opens the record nor, as AG Grid's own Space would,
  // deselects the open row -- and Space again unticks it; Space on another
  // cell of the row still opens the record, and Enter on the box opens it
  // and moves to it, as on any cell (watched failing with Space on the box
  // given to the row as on any cell: "expected [ { record: 'k1:2', …(2) } ]
  // to deeply equal []").
  test('are reached by the arrow keys, and Space ticks one without opening or deselecting the row', async () => {
    const { asked, choice } = mount()
    const user = userEvent.setup()
    const status = await cellOf('2', 'status')
    status.focus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(focusedName()).toBe('Choose Order k1:2')
    await user.keyboard(' ')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Choose Order k1:2' }).checked).toBe(true)
    expect([...choice.now().chosen]).toEqual(['k1:2'])
    expect(choice.now().said).toBe('1 chosen.')
    expect(asked).toEqual([])
    expect((await rowOf('1')).getAttribute('aria-selected')).toBe('true')

    await user.keyboard(' ')
    expect([...choice.now().chosen]).toEqual([])
    await user.keyboard('{ArrowUp}')
    expect(focusedName()).toBe('Choose Order k1:1')
    await user.keyboard(' ')
    expect((await rowOf('1')).getAttribute('aria-selected')).toBe('true')
    expect(asked).toEqual([])

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement?.getAttribute('col-id')).toBe('id')
    await user.keyboard(' ')
    expect(asked).toEqual([{ record: 'k1:1', how: 'space', colId: 'id' }])
    await user.keyboard('{ArrowLeft}{Enter}')
    expect(asked.at(-1)).toEqual({ record: 'k1:1', how: 'enter', colId: CHOOSE_COLUMN })
    expect([...choice.now().chosen]).toEqual(['k1:1'])
  })

  // A click on a box ticks it and is not a click on the row: the record
  // is not opened (watched failing with a click inside an input heard as
  // the row's: "expected [ { record: 'k1:2', …(2) } ] to deeply equal []").
  test('are ticked by a click that opens nothing', async () => {
    const { asked, choice } = mount()
    const user = userEvent.setup()
    await user.click(await waitFor(() => screen.getByRole('checkbox', { name: 'Choose Order k1:2' })))
    expect([...choice.now().chosen]).toEqual(['k1:2'])
    expect(asked).toEqual([])
  })

  // Tab from a box leaves the rows: the keyboard is on no cell and no box
  // of the grid after it, never on the next cell (watched failing with
  // AG Grid's own Tab between cells, `tabToNextCell` taken out: "expected
  // <div role="gridcell" …(5)>…(1)</div> to be null"). With the box's
  // tabIndex left to the browser this case still passed: AG Grid takes Tab
  // before the browser would, which is why the first case reads it.
  test('are left by Tab, which reaches no other cell or box', async () => {
    mount()
    const user = userEvent.setup()
    ;(await cellOf('1', 'status')).focus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(focusedName()).toBe('Choose Order k1:1')
    await user.tab()
    const at = document.activeElement
    expect(at?.closest('[role="gridcell"]') ?? null).toBeNull()
    expect(at?.getAttribute('type')).not.toBe('checkbox')
  })
})
