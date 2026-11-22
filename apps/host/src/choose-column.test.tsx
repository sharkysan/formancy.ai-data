import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
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
 * server: AG Grid as the page configures it, the boxes' column first, a
 * row's Delete last, and three fake rows -- two records and a row whose
 * key fits no token. What a run over the records chosen sends, and what
 * the page says of it, is actions.test.tsx's against the real server, on
 * both engines.
 *
 * Found by role and accessible name. The reads the accessibility tree
 * cannot answer, said where they are made: a cell by the `col-id` AG Grid
 * writes on it, and a row by its Id cell's text, since the tree names a
 * cell by its value alone and a row by nothing (`rowOf`, `cellOf`, and
 * the field the keyboard is on); the first header's text, which is the
 * header's name with nothing AG Grid adds; a box's `tabIndex`, which is
 * what keeps it out of the Tab order; which row is the open one, its
 * `aria-selected`, which AG Grid writes on the row and no name says;
 * whether the keyboard is inside a cell, by the cell around it, which no
 * role of the focused element says; and what AG Grid's live region says
 * of a row as the keyboard reaches one of its cells, read from the
 * element AG Grid says it in (`rowSays`), which has no role or name.
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

/** Each `=` the grid handed the page, by the column it was pressed on. */
type Examples = string[]

/** A grid of the three rows, its first record open, every row asked for kept in `asked` and every `=` in `examples`, the choice told of the page as record-grid.tsx tells it. */
function Grid({ asked, examples, choice }: { asked: Asked; examples: Examples; choice: ChosenRows }): ReactElement {
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
        example: (_row, colId) => examples.push(colId),
      },
    }),
  )
  return (
    <main>
      <h3 id="records">Records</h3>
      <div style={{ width: 800, height: 300 }}>
        <AgGridReact<GridRow>
          gridOptions={options}
          columnDefs={columnDefsOf(COLUMNS, { noun: 'Order', press: () => {} }, new Set(), [], new Map(), chooseColumn(choice))}
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

/** What AG Grid's live region last said of a row, without the mark it adds to a sentence said twice: a DOM read, said above. */
const rowSays = (): string => (document.querySelector('.ag-aria-description-container')?.textContent ?? '').replaceAll('\u200b', '')

function mount(): { asked: Asked; examples: Examples; choice: ChosenRows } {
  // What the page around a grid has, which axe asks of any document.
  document.title = 'Records'
  document.documentElement.lang = 'en'
  const asked: Asked = []
  const examples: Examples = []
  const choice = createChosenRows('Order')
  render(<Grid asked={asked} examples={examples} choice={choice} />)
  return { asked, examples, choice }
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
    expect(screen.getAllByRole('checkbox')).not.toContain(at)
  })

  // As the keyboard reaches a row's box, AG Grid's live region says what
  // Space does there -- it ticks or unticks the box -- never that it opens
  // the record, which it does on a field's cell; on the open row, that the
  // record is open. On a row's Delete, whose Space and Enter press it, that
  // they ask to delete it (watched failing with every cell said as a
  // field's: "expected 'Space opens this record. Enter opens …' to be
  // 'Space ticks or unticks this box. Ente…'").
  test('are said as what Space does on them, as a field and Delete are', async () => {
    mount()
    const user = userEvent.setup()
    ;(await cellOf('2', 'status')).focus()
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(rowSays()).toBe('Space opens this record. Enter opens it and moves to it.'))
    await user.keyboard('{ArrowLeft}')
    expect(focusedName()).toBe('Choose Order k1:2')
    await waitFor(() => expect(rowSays()).toBe('Space ticks or unticks this box. Enter opens the record and moves to it.'))
    await user.keyboard('{ArrowUp}')
    expect(focusedName()).toBe('Choose Order k1:1')
    await waitFor(() => expect(rowSays()).toBe('This record is open. Space ticks or unticks this box.'))
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(focusedName()).toBe('Delete Order k1:1')
    await waitFor(() => expect(rowSays()).toBe('This record is open. Space or Enter asks to delete it.'))
    await user.keyboard('{ArrowDown}')
    expect(focusedName()).toBe('Delete Order k1:2')
    await waitFor(() => expect(rowSays()).toBe('Space or Enter asks to delete this record.'))
  })

  // A row with no box -- its key fits no token -- leaves Space to the row,
  // which the page answers by saying it cannot be opened, rather than a
  // key that does nothing (watched failing with Space on the column taken
  // as the box's on every row: "expected [] to deeply equal [ Array(1)
  // ]"). And `=`, which keeps a field's value as its column's condition
  // (0133), asks nothing on a box or a Delete, which hold none: the page
  // would name the column by its id, "~choose" (watched failing with `=`
  // handed on from every column: "expected [ 'status', '~choose',
  // '~delete' ] to deeply equal [ 'status' ]").
  test('leave Space to a row with no box, and `=` to the fields', async () => {
    const { asked, examples } = mount()
    const user = userEvent.setup()
    ;(await cellOf('3', 'status')).focus()
    await user.keyboard('{ArrowLeft}{ArrowLeft} ')
    expect(asked).toEqual([{ record: null, how: 'space', colId: CHOOSE_COLUMN }])

    ;(await cellOf('2', 'status')).focus()
    await user.keyboard('={ArrowLeft}{ArrowLeft}')
    expect(focusedName()).toBe('Choose Order k1:2')
    await user.keyboard('={ArrowRight}{ArrowRight}{ArrowRight}')
    expect(focusedName()).toBe('Delete Order k1:2')
    await user.keyboard('=')
    expect(examples).toEqual(['status'])
  })

  // A record a deletion of the choice did not delete stays chosen, and its
  // box says why: its description, which is read as the keyboard reaches
  // it, and its title for a pointer -- until the choice changes. A box
  // with no mark is described by nothing, and the grid with a mark passes
  // axe (0174; watched failing with the mark left off the box's title:
  // "expected '' to be 'Not deleted. Other records still refe…'").
  test('are described by why a deletion left their record chosen, until the choice changes', async () => {
    const { choice } = mount()
    const user = userEvent.setup()
    const kept = await waitFor(() => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Choose Order k1:2' }))
    const mark = 'Not deleted. Other records still refer to this one, so the database keeps it. Nothing was deleted.'
    act(() => {
      choice.all()
      choice.settle(new Set(['k1:1']), new Map([['k1:2', mark]]), '1 chosen. Still chosen after the deletion: Order k1:2.')
    })
    await waitFor(() => expect(computeAccessibleDescription(kept)).toBe(mark))
    expect([kept.checked, kept.title]).toEqual([true, mark])
    expect(computeAccessibleDescription(screen.getByRole('checkbox', { name: 'Choose Order k1:1' }))).toBe('')
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
    await user.click(kept)
    await waitFor(() => expect(computeAccessibleDescription(kept)).toBe(''))
    expect(kept.title).toBe('')
  })
})
