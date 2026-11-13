import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AgGridReact } from 'ag-grid-react'
import type { GridApi } from 'ag-grid-community'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { ArrangedColumn } from './columns.js'
import type { GridRow } from './grid-datasource.js'
import { columnDefsOf, DELETE_COLUMN, drawWidths, gridOptionsFor } from './grid-options.js'
import { withWidths } from './widths.js'
import type { ColumnWidth, WidthChange } from './widths.js'

/*
 * A column's width in AG Grid as the page configures it (0151), without a
 * server: a width the section keeps drawn when its column is made, and
 * never again from the definitions, which would put back a width the
 * person has dragged past since; a width the Columns panel sets drawn by the
 * grid and told back as the person's; a field's column resized by Alt and
 * an arrow on its header -- AG Grid's own, which the page lets stand --
 * told as each step is made, while the section keeps each; a double click
 * on a header's edge sizing nothing; and a row's Delete never resized. What a pointer's drag on an edge does is the browser gate's
 * (scripts/browser/widths.mjs): AG Grid reads a drag from where things are
 * drawn, and jsdom draws nothing. That the page keeps what is told, and its
 * sizing never takes it away, is the page's against the real server
 * (grid-keys.test.tsx, columns-panel.test.tsx).
 *
 * Found by role and accessible name, with two reads the accessibility tree
 * cannot answer, made where they are: a header cell's width, its
 * `style.width`, which has no role or name and is what a width changes; and
 * a header's resize handle, AG Grid's `.ag-header-cell-resize`, which has
 * neither either.
 */

afterEach(cleanup)

const column = (key: string, label: string): ArrangedColumn => ({ key, label, sortable: true, source: null, shown: true })
const COLUMNS = [column('id', 'Id'), column('amount', 'Amount'), column('notes', 'Notes')]
const ROWS: GridRow[] = [7, 8].map((no) => ({
  id: `k1:${String(no)}`,
  record: `k1:${String(no)}`,
  version: null,
  answers: { id: no, amount: '12.50', notes: 'rush' },
  labels: {},
}))

/** A grid of two rows with a row's Delete, drawn at the widths `widths` keeps, every width it tells as set given to `onTold`, and its API to `onReady`. */
function Grid({
  widths,
  onTold,
  onReady = () => {},
}: {
  widths: readonly ColumnWidth[]
  onTold: (changes: WidthChange[]) => void
  onReady?: (api: GridApi<GridRow>) => void
}): ReactElement {
  const [options] = useState(() =>
    gridOptionsFor({
      labelledBy: 'records',
      firstColumn: () => 'id',
      on: {
        openToken: () => null,
        ready: (api) => onReady(api),
        resized: () => {},
        asked: () => {},
        drilling: () => false,
        sorted: () => {},
        widthsSet: (changes) => onTold(changes),
        example: () => {},
      },
    }),
  )
  return (
    <>
      <h3 id="records">Records</h3>
      <div style={{ width: 800, height: 300 }}>
        <AgGridReact<GridRow>
          gridOptions={options}
          columnDefs={columnDefsOf(COLUMNS, { noun: 'Order', press: () => {} }, new Set(), widths)}
          datasource={{ getRows: (params) => params.successCallback(ROWS, ROWS.length) }}
        />
      </div>
    </>
  )
}

/** The grid as a section holds it: what it tells as set, in `told`, kept and drawn again at once, as use-grid-state.ts keeps it. */
function Kept({ told }: { told: WidthChange[] }): ReactElement {
  const [widths, setWidths] = useState<ColumnWidth[]>([{ field: 'amount', width: 240 }])
  return (
    <Grid
      widths={widths}
      onTold={(changes) => {
        told.push(...changes)
        setWidths((before) => withWidths(before, changes))
      }}
    />
  )
}

/** A header of the grid, by the label it starts with: its sort's words follow. */
const header = (label: string): HTMLElement =>
  within(screen.getByRole('grid', { name: 'Records' })).getByRole('columnheader', { name: new RegExp(`^${label}`) })
/** A header's width as AG Grid draws it: a DOM read, said above. */
const width = (label: string): string => header(label).style.width

describe('a column’s width in the grid (0151)', () => {
  // A width the section keeps is the column's when the column is made, and
  // only then: drawn again from the definitions -- a width told a moment
  // before, a column moved -- it would put back a width the person had
  // dragged past since; and no drawing of it is told back as set, or every
  // drawing would be kept again (watched failing with the width left out of
  // the definitions: 200px, AG Grid's own; and with it given as the
  // definitions' `width`: 400px once they said 400).
  test('draws a kept width when its column is made, and never again from the definitions', async () => {
    const told: WidthChange[] = []
    const { rerender } = render(<Grid widths={[{ field: 'amount', width: 240 }]} onTold={(changes) => told.push(...changes)} />)
    await waitFor(() => expect(width('Amount')).toBe('240px'))
    rerender(<Grid widths={[{ field: 'amount', width: 400 }]} onTold={(changes) => told.push(...changes)} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(width('Amount')).toBe('240px')
    rerender(<Grid widths={[]} onTold={(changes) => told.push(...changes)} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(width('Amount')).toBe('240px')
    expect(told).toEqual([])
  })

  // A width the Columns panel sets is drawn by the grid, as the person's,
  // and told back as a drag's is, so the section keeps it by the one way a
  // width is kept (watched failing with it set as the API's own: 280px
  // drawn, and nothing told).
  test('draws a width the panel sets, and tells it as the person’s', async () => {
    const told: WidthChange[] = []
    let grid: GridApi<GridRow> | null = null
    render(
      <Grid
        widths={[]}
        onTold={(changes) => told.push(...changes)}
        onReady={(api) => {
          grid = api
        }}
      />,
    )
    await waitFor(() => expect(grid).not.toBeNull())
    drawWidths(grid as unknown as GridApi<GridRow>, [{ field: 'amount', width: 280 }])
    await waitFor(() => expect(width('Amount')).toBe('280px'))
    await waitFor(() => expect(told).toEqual([{ field: 'amount', width: 280 }]))
  })

  // The page's own sizing to the content (use-grid-sizing.ts) is never
  // told as set: kept, every column the first page sized would be the
  // person's, and none would be sized again (watched failing with every
  // finished resize told, whatever its source: Notes at its content's 90
  // told as set).
  test('tells nothing of the page’s own sizing', async () => {
    const told: WidthChange[] = []
    let grid: GridApi<GridRow> | null = null
    render(
      <Grid
        widths={[]}
        onTold={(changes) => told.push(...changes)}
        onReady={(api) => {
          grid = api
        }}
      />,
    )
    await waitFor(() => expect(grid).not.toBeNull())
    const before = width('Notes')
    ;(grid as unknown as GridApi<GridRow>).autoSizeColumns({ colIds: ['notes'], skipHeader: true, defaultMaxWidth: 320 })
    await waitFor(() => expect(width('Notes')).not.toBe(before))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(told).toEqual([])
  })

  // AG Grid's Alt and an arrow on a focused header resizes its column, two
  // pixels a press, and the page lets it: AG Grid takes those keys from the
  // browser on a header whether or not a column resizes, so stopping it
  // would give them to nothing. Each step is told as a width set, whole,
  // for the section to keep, which renders again between the presses
  // (watched failing with the kept width drawn from the definitions: the
  // first step's 242 put back under the second, which was told as 242 too;
  // with nothing told: [] for two presses; and with the columns not resizable, as before 0151: the
  // header stayed at 240px).
  test('tells each step Alt and an arrow on a header resizes its column by', async () => {
    const told: WidthChange[] = []
    render(<Kept told={told} />)
    await waitFor(() => expect(width('Amount')).toBe('240px'))
    header('Amount').focus()
    await userEvent.setup().keyboard('{Alt>}{ArrowRight}{ArrowRight}{/Alt}')
    expect(width('Amount')).toBe('244px')
    expect(told).toEqual([
      { field: 'amount', width: 242 },
      { field: 'amount', width: 244 },
    ])
  })

  // A double click on a header's edge sizes nothing: AG Grid's own would
  // size the column past the page's cap, and say so as the page's sizing
  // does, so the page could not keep it; Columns' Fit does it (watched
  // failing with AG Grid's double click left on: the column sized from
  // 240px to 98px, and nothing told).
  test('sizes nothing for a double click on a header’s edge', async () => {
    const told: WidthChange[] = []
    render(<Grid widths={[{ field: 'amount', width: 240 }]} onTold={(changes) => told.push(...changes)} />)
    await waitFor(() => expect(width('Amount')).toBe('240px'))
    const edge = header('Amount').querySelector('.ag-header-cell-resize')
    expect(edge).not.toBeNull()
    fireEvent.dblClick(edge as Element)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(width('Amount')).toBe('240px')
    expect(told).toEqual([])
  })

  // A row's Delete is its button's width: Alt and an arrow on its header
  // change nothing and tell nothing -- Left, since it is drawn at the most
  // it may be (watched failing with its column resizable: the Delete header
  // went from 160px to 156px).
  test('resizes no row’s Delete', async () => {
    const told: WidthChange[] = []
    render(<Grid widths={[]} onTold={(changes) => told.push(...changes)} />)
    await waitFor(() => expect(header('Delete')).toBeTruthy())
    const before = width('Delete')
    header('Delete').focus()
    await userEvent.setup().keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}')
    expect(width('Delete')).toBe(before)
    expect(told.map((change) => change.field)).not.toContain(DELETE_COLUMN)
    expect(told).toEqual([])
  })
})
