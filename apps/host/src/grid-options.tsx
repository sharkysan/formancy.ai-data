import type { ReactElement } from 'react'
import {
  ColumnApiModule,
  ColumnAutoSizeModule,
  CustomEditorModule,
  CustomFilterModule,
  InfiniteRowModelModule,
  LocaleModule,
  ModuleRegistry,
  PaginationModule,
  RenderApiModule,
  RowApiModule,
  RowSelectionModule,
  ScrollApiModule,
} from 'ag-grid-community'
import type { ColDef, ColumnResizedEvent, EditableCallbackParams, GridApi, GridOptions, ICellRendererParams, IRowNode, Module } from 'ag-grid-community'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import type { ListSortTerm } from '@formancy/data-client'
import { CellEditorOf } from './cell-editors.js'
import { CHOOSE_COLUMN } from './choose-column.js'
import type { ArrangedColumn } from './columns.js'
import { DELETE_COLUMN, deleteColumn } from './delete-column.js'
import type { RowDelete } from './delete-column.js'
import { cellText } from './grid-datasource.js'
import type { GridRow } from './grid-datasource.js'
import { keyOptions } from './grid-keys.js'
import type { KeyCallbacks } from './grid-keys.js'
import { roomGrid, ROW_HEIGHT } from './grid-theme.js'
import { boxKeys, HeaderBox, NeverFilter } from './header-filter.js'
import type { GridEdit } from './use-grid-edit.js'
import { changedWidths, headerFloor, WIDEST } from './widths.js'
import type { ColumnWidth, WidthChange } from './widths.js'

/*
 * How the page configures AG Grid Community for a record grid (0047): the
 * modules, the columns and the options, decided once here and read by
 * record-grid.tsx, which holds the grid's state -- and the two things the
 * page reads of the grid and sets on it, the open row's selection and the
 * sort the headers show. What a key or a press does on the grid, and what
 * its live region says of a row, are grid-keys.ts's.
 *
 * - **The page decides which row is open, not AG Grid.** Click selection is
 *   off, and Space and Enter are the page's (grid-keys.ts), so AG Grid
 *   never selects a row: the open record's is selected by the page
 *   (`select`).
 * - **No AG Grid words.** No overlays, empty loading cells, and its live
 *   region says what the page does with a row (grid-keys.ts).
 * - **A page no longer shown is asked for again**, never reused: one block
 *   in the cache (0022, 0029). No count is asked for, so no paging panel.
 * - **Nothing moves, and nothing edits but the open record**, so nothing is
 *   sent from here but the page's list: a grid given the open record's
 *   edit (use-grid-edit.ts, 0179) draws that row from its engine and edits
 *   its cells there, in an editor of the page's own (cell-editors.tsx),
 *   whose save is the record's form's; every other cell is not editable
 *   (grid-keys.ts). A person orders and hides columns in the section's
 *   Columns panel instead (columns-panel.tsx, 0106), whose every change is
 *   a key's: a header dragged has no keyboard path (formancy.ai 0046).
 * - **A field's column is resized by hand** (0151): its header's edge
 *   dragged, as AG Grid draws it, or Alt and an arrow on its header, which
 *   is AG Grid's own and takes those keys from the browser whether a column
 *   resizes or not; and from the Columns panel, the keyboard's way that is
 *   named and said, whose width is set on the grid as the person's
 *   (`drawWidths`). Each width set is told to the section, which keeps it;
 *   the grid draws a kept width when it makes the column, and from then on
 *   the width the grid has is the column's. A double click on an
 *   edge sizes nothing (`suppressAutoSize`): AG Grid's would size the
 *   column past the page's cap and say it as the page's own sizing does, so
 *   it could not be kept; the panel's Fit does it. A row's Delete is not
 *   resized.
 * - **A row's Delete is a real button** (0053), in a last column where the
 *   form offers delete (delete-column.tsx), and **a row's box a real
 *   checkbox** (0166), in a first column where the form offers this person
 *   an action over a selection, on Delete's pattern (choose-column.tsx).
 *   Each takes its own keys, never the row's (grid-keys.ts).
 */

/**
 * Every module the options below use, and no other: `AllCommunityModule`
 * would ship code nothing calls. RowApiModule is for finding the open row,
 * ColumnAutoSizeModule for sizing columns to the first page -- a header's
 * edge and Alt with an arrow are the core module's own (0151) -- LocaleModule
 * for the page's own words in AG Grid's live region, ColumnApiModule for
 * reading the headers' sort and showing the section's on them (0105),
 * CustomFilterModule for the floating row that holds each header's box
 * (0132), CustomEditorModule for the open record's cells' editors (0179);
 * grid-keys.test.tsx fails on the console error AG Grid writes for an
 * option whose module is missing.
 */
export const GRID_MODULES: readonly Module[] = [
  InfiniteRowModelModule,
  PaginationModule,
  RowSelectionModule,
  RenderApiModule,
  ScrollApiModule,
  RowApiModule,
  ColumnAutoSizeModule,
  LocaleModule,
  ColumnApiModule,
  CustomFilterModule,
  CustomEditorModule,
]
ModuleRegistry.registerModules([...GRID_MODULES])

/** The value of a loading or failed row: nothing. AG Grid's skeleton says "Row data is loading" and "ERR". */
function EmptyCell(): null {
  return null
}

/** A row's mark after its first value -- Saving…, Not saved (0179) -- set off by its own margin and weight: a style attribute, as nothing inside the grid is styled by a host rule. */
const MARK_LOOK = { marginLeft: '8px', fontWeight: 600 } as const

/**
 * The first shown column's cell: the value after a slot that holds a violet
 * bar on the open row, the shape that says "open" (UX-SPEC §5.9). SVG attributes,
 * no CSS rule: nothing inside the grid is styled by the host. Hidden from
 * the accessibility tree, where `aria-selected` says it. Then the open
 * row's mark, where its draft's save is out or did not store (0179): text,
 * read with the row.
 */
function OpenCell(params: ICellRendererParams<GridRow> & { edit?: GridEdit }): ReactElement {
  const open = params.node.isSelected() === true
  const mark = params.edit?.mark(params.data) ?? ''
  return (
    <>
      <svg aria-hidden="true" focusable="false" width="12" height="15" viewBox="0 0 12 15">
        {open ? <rect x="0" y="0" width="4" height="15" rx="2" fill="var(--client)" /> : null}
      </svg>
      {String(params.value ?? '')}
      {mark === '' ? null : <span style={MARK_LOOK}>{mark}</span>}
    </>
  )
}

/** Every row of the page selected exactly when it is the open record's; the rows whose selection changed. */
export function select(grid: GridApi<GridRow>, open: string | null): IRowNode<GridRow>[] {
  const changed: IRowNode<GridRow>[] = []
  grid.forEachNode((node) => {
    if (node.data === undefined) return
    const want = node.data.record !== null && node.data.record === open
    if (node.isSelected() !== want) {
      node.setSelected(want)
      changed.push(node)
    }
  })
  return changed
}

/**
 * Whether AG Grid took a block's rows, answered from `start`: each is the
 * grid's row at its index. A block the cache was purged of after AG Grid
 * made it is asked for all the same, a task after it was made, and the
 * block made in its place waits until it has answered, one ask at a time;
 * AG Grid then sets its rows aside (`InfiniteBlock`, `RowNodeBlockLoader`,
 * ag-grid-community 36.2.0). Two reloads before that task -- a together
 * row's keystroke and its Done (0155) -- made one. Such a block says
 * nothing and tells no section it was drawn (`onListed`, record-grid.tsx):
 * the block made in its place does. A grid not ready, or gone, holds
 * nothing to read: the block is taken.
 */
export function took(grid: GridApi<GridRow> | null, start: number, rows: readonly GridRow[]): boolean {
  if (grid === null || grid.isDestroyed()) return true
  return rows.every((row, index) => grid.getRowNode(row.id)?.rowIndex === start + index)
}

/** The sort the grid's headers show, in its order: what a header press leaves, or what was applied to them. */
export function headerSort(grid: GridApi<GridRow>): ListSortTerm[] {
  return grid
    .getColumnState()
    .filter((column) => column.sort === 'asc' || column.sort === 'desc')
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((column) => ({ field: column.colId, direction: column.sort as ListSortTerm['direction'] }))
}

/**
 * One column per field the person may read, in the order the section
 * arranged them (0106): its label, sortable where the server says, made at
 * the width the person set where they set one (`widths`, 0151), and
 * otherwise sized to the first page's content (use-grid-sizing.ts, capped
 * there so one long note does not take the well); never below what its header needs
 * (`floors`, measured by use-header-floors.ts, or `headerFloor` where none is given), nor a person's drag past `WIDEST`. A column the person
 * hid is there, `hide`, with whatever sort it holds: the sort a view or the
 * section gives it is the headers' still, so the datasource asks for it
 * (grid-datasource.ts). The first shown carries the open row's bar. Given
 * the open record's `edit` (0179), the open row is drawn from its engine and
 * a field's cell is editable where the edit says, in the page's editor.
 */
export function columnDefsOf(
  columns: readonly ArrangedColumn[],
  remove?: RowDelete,
  boxed: ReadonlySet<string> = new Set(),
  widths: readonly ColumnWidth[] = [],
  floors: ReadonlyMap<string, number> = new Map(),
  /** The column of the boxes a person chooses records with (choose-column.tsx, 0166): first, where the form offers this person an action over a selection or a deletion or a change of chosen records (0174, 0176). */
  choose?: ColDef<GridRow>,
  /** The open record's edit in its row (use-grid-edit.ts, 0179): the Records grid's alone. */
  edit?: GridEdit,
): ColDef<GridRow>[] {
  const first = columns.find((column) => column.shown)?.key
  const set = new Map(widths.map((each) => [each.field, each.width]))
  const fields: ColDef<GridRow>[] = columns.map((column) => {
    const width = set.get(column.key)
    return {
      colId: column.key,
      headerName: column.label,
      valueGetter: (params) => cellText(edit === undefined ? params.data : edit.drawn(params.data), column),
      sortable: column.sortable,
      unSortIcon: column.sortable,
      hide: !column.shown,
      resizable: true,
      minWidth: floors.get(column.key) ?? headerFloor(column.label, column.sortable),
      maxWidth: WIDEST,
      // A width kept is the column's when it is made, and only then: drawn
      // again from the definitions -- a column moved, a width told a moment
      // before -- it would put back a width the person has since dragged
      // past (grid-widths.test.tsx). After that the grid's width is the column's.
      ...(width === undefined ? {} : { initialWidth: width }),
      ...(column.key === first ? { cellRenderer: OpenCell, cellRendererParams: { edit } } : {}),
      // Editable where the open record's edit says, now: AG Grid asks each time an edit would start (0179).
      ...(edit === undefined
        ? {}
        : {
            editable: (params: EditableCallbackParams<GridRow>) => edit.editable(params.data, column.key),
            cellEditor: CellEditorOf,
            cellEditorParams: { edit, field: column.key },
          }),
      // A box under the header where the filter line may name the column (0132): the page's, never AG Grid's filter or its button.
      // Shown only: a hidden column's box would keep a row of empty cells under the headers.
      ...(boxed.has(column.key) && column.shown
        ? {
            filter: NeverFilter,
            floatingFilter: true,
            floatingFilterComponent: HeaderBox,
            suppressFloatingFilterButton: true,
            suppressHeaderFilterButton: true,
            suppressHeaderKeyboardEvent: boxKeys,
          }
        : {}),
    }
  })
  const chosen = choose === undefined ? fields : [choose, ...fields]
  if (remove === undefined) return chosen
  // Last, so Tab into the grid still lands on the open row's first column, and the bar stays first.
  return [...chosen, deleteColumn(remove)]
}

/**
 * Widths set on the grid as the person's: the Columns panel's Wider and
 * Narrower (0151), which AG Grid then tells as it tells a drag's, so the
 * section keeps them by the one way, and a width is drawn by the grid alone.
 */
export function drawWidths(grid: GridApi<GridRow>, widths: readonly ColumnWidth[]): void {
  if (widths.length === 0) return
  grid.setColumnWidths(
    widths.map(({ field, width }) => ({ key: field, newWidth: width })),
    true,
    'uiColumnResized',
  )
}

/** What a grid tells the page, and asks of it: what its keys and presses do (grid-keys.ts), and the rest. */
export interface GridCallbacks extends KeyCallbacks {
  ready(api: GridApi<GridRow>): void
  resized(): void
  /** The headers' sort changed: by a press on one, or by the page showing the section's (0105). */
  sorted(): void
  /** A width the person set -- by a header's edge, Alt and an arrow, or the Columns panel -- once it is set (0151). */
  widthsSet(changes: WidthChange[]): void
}

/** The options of a grid named by the heading `labelledBy`, for its whole life: `firstColumn` is read each time, since a person moves and hides columns under them (0106). */
export function gridOptionsFor({ labelledBy, firstColumn, on }: { labelledBy: string; firstColumn: () => string; on: GridCallbacks }): GridOptions<GridRow> {
  /**
   * The width each field's column had when its last resize finished --
   * the person's, the page's sizing or the panel's -- or when it was made:
   * what a resize the person ends is measured against, since AG Grid tells
   * a click on an edge as a resize finished where it began (0151).
   */
  const settled = new Map<string, number>()
  const seed = (api: GridApi<GridRow>): void => {
    for (const column of api.getColumns() ?? []) if (!settled.has(column.getColId())) settled.set(column.getColId(), Math.round(column.getActualWidth()))
  }
  const keys = keyOptions({ firstColumn, on })
  return {
    theme: roomGrid,
    // The theme's rows, said again: a grid made inside a hidden view cannot measure its theme.
    rowHeight: ROW_HEIGHT,
    defaultColDef: {
      ...keys.cell,
      // A field's column says otherwise (columnDefsOf); a row's Delete keeps its button's width.
      resizable: false,
      suppressMovable: true,
      // A header wraps instead of setting its column's width (WCAG 1.4.12).
      wrapHeaderText: true,
      autoHeaderHeight: true,
    },
    rowModelType: 'infinite',
    cacheBlockSize: LIST_PAGE_SIZE,
    paginationPageSize: LIST_PAGE_SIZE,
    paginationPageSizeSelector: false,
    pagination: true,
    suppressPaginationPanel: true,
    maxBlocksInCache: 1,
    maxConcurrentDatasourceRequests: 1,
    getRowId: (params) => params.data.id,
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: false, isRowSelectable: (node) => node.data?.record != null },
    suppressOverlays: ['loading', 'noRows', 'noMatchingRows'],
    loadingCellRenderer: EmptyCell,
    suppressRowVirtualisation: true,
    suppressColumnVirtualisation: true,
    ensureDomOrder: true,
    animateRows: false,
    suppressMultiSort: true,
    // A double click on a header's edge sizes nothing: the Columns panel's Fit does (above).
    suppressAutoSize: true,
    alwaysShowHorizontalScroll: true,
    scrollbarWidth: 16,
    // Tab, the live region's words, and what a press or a key on a row asks: the keys' (grid-keys.ts).
    ...keys.grid,
    onGridReady: (event) => {
      event.api.setGridAriaProperty('labelledby', labelledBy)
      seed(event.api)
      on.ready(event.api)
    },
    // A column made since, by a change of the form's columns, at the width it was made at.
    onGridColumnsChanged: (event) => seed(event.api),
    onGridSizeChanged: () => on.resized(),
    onSortChanged: () => on.sorted(),
    // The person's own: a drag let go, Alt and an arrow, or the panel's
    // width (`drawWidths`) -- AG Grid's `uiColumnResized`, each step of a
    // drag before it is let go not `finished` -- and only where the width
    // moved from where the resize began: a click on an edge, or Alt and an
    // arrow at an end, ends where it began (`changedWidths`). The page's own
    // sizing is `autosizeColumns`, never kept (grid-widths.test.tsx), and
    // settles its columns' widths as the person's resize does. Whole pixels,
    // which is what the section keeps (widths.ts).
    onColumnResized: (event: ColumnResizedEvent<GridRow>) => {
      if (!event.finished) return
      const finished = (event.columns ?? [])
        .filter((column) => column.getColId() !== DELETE_COLUMN && column.getColId() !== CHOOSE_COLUMN)
        .map((column) => ({ field: column.getColId(), width: Math.round(column.getActualWidth()) }))
      const changes = event.source === 'uiColumnResized' ? changedWidths(finished, settled) : []
      for (const { field, width } of finished) settled.set(field, width)
      if (changes.length > 0) on.widthsSet(changes)
    },
  }
}
