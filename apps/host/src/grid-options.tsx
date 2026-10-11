import type { ReactElement } from 'react'
import { ColumnAutoSizeModule, InfiniteRowModelModule, LocaleModule, ModuleRegistry, PaginationModule, RenderApiModule, RowApiModule, RowSelectionModule, ScrollApiModule } from 'ag-grid-community'
import type { CellKeyDownEvent, ColDef, GridApi, GridOptions, ICellRendererParams, Module, RowClickedEvent } from 'ag-grid-community'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { cellText } from './grid-datasource.js'
import type { GridColumn, GridRow } from './grid-datasource.js'
import { roomGrid, ROW_HEIGHT } from './grid-theme.js'

/*
 * How the page configures AG Grid Community for a record grid (0047): the
 * modules, the columns and the options, decided once here and read by
 * record-grid.tsx, which holds the grid's state.
 *
 * - **The page decides which row is open, not AG Grid.** Click selection is
 *   off and Space and Enter are held from AG Grid on every cell, so its own
 *   Space never toggles a selection -- which would deselect the open row --
 *   and the page is told of both keys and of a click instead.
 * - **One Tab stop.** Tab and Shift+Tab leave the grid; Tab into it lands on
 *   the open record's row when it is on this page.
 * - **No AG Grid words.** No overlays, empty loading cells, and its live
 *   region says what the page does with a row.
 * - **A page no longer shown is asked for again**, never reused: one block
 *   in the cache (0022, 0029). No count is asked for, so no paging panel.
 * - **Nothing edits, moves or resizes**, so Delete and Backspace clear
 *   nothing and nothing is sent from here but the page's list.
 */

/**
 * Every module the options below use, and no other: `AllCommunityModule`
 * would ship code nothing calls. RowApiModule is for finding the open row,
 * ColumnAutoSizeModule for sizing columns to the first page, LocaleModule
 * for the page's own words in AG Grid's live region; grid-keys.test.tsx
 * fails on the console error AG Grid writes for an option whose module is
 * missing.
 */
export const GRID_MODULES: readonly Module[] = [InfiniteRowModelModule, PaginationModule, RowSelectionModule, RenderApiModule, ScrollApiModule, RowApiModule, ColumnAutoSizeModule, LocaleModule]
ModuleRegistry.registerModules([...GRID_MODULES])

export type OpenHow = 'click' | 'space' | 'enter'

const SPACE_OR_ENTER = (key: string): boolean => key === ' ' || key === 'Enter'

/** The value of a loading or failed row: nothing. AG Grid's skeleton says "Row data is loading" and "ERR". */
function EmptyCell(): null {
  return null
}

/**
 * The first column's cell: the value after a slot that holds a violet bar on
 * the open row, the shape that says "open" (UX-SPEC §5.9). SVG attributes,
 * no CSS rule: nothing inside the grid is styled by the host. Hidden from
 * the accessibility tree, where `aria-selected` says it.
 */
function OpenCell(params: ICellRendererParams<GridRow>): ReactElement {
  const open = params.node.isSelected() === true
  return (
    <>
      <svg aria-hidden="true" focusable="false" width="12" height="15" viewBox="0 0 12 15">
        {open ? <rect x="0" y="0" width="4" height="15" rx="2" fill="var(--client)" /> : null}
      </svg>
      {String(params.value ?? '')}
    </>
  )
}

/**
 * The narrowest a column may be: its header's widest word, so a header wraps
 * between words and never cuts one, with WCAG 1.4.12's letter-spacing
 * allowed for, the cell's padding, and the sort icon. Measured in the
 * header's face where the page can draw text; estimated where it cannot.
 */
function headerMinWidth(label: string, sortable: boolean): number {
  const words = label.split(/\s+/)
  let widest = Math.max(...words.map((word) => word.length * 8))
  // jsdom has no 2D canvas: the estimate stands there.
  const context = typeof CanvasRenderingContext2D === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (context !== null) {
    context.font = '600 13px "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif'
    widest = Math.max(...words.map((word) => context.measureText(word).width + word.length * 0.12 * 13))
  }
  return Math.ceil(widest) + 24 + (sortable ? 22 : 0) + 4
}

/**
 * One column per field the person may read, in the form's order: its label,
 * sortable where the server says, sized to the first page's content, never
 * below what its header needs, and capped so one long note does not take
 * the well. The first carries the open row's bar.
 */
export function columnDefsOf(columns: readonly GridColumn[]): ColDef<GridRow>[] {
  return columns.map((column, index) => ({
    colId: column.key,
    headerName: column.label,
    valueGetter: (params) => cellText(params.data, column),
    sortable: column.sortable,
    unSortIcon: column.sortable,
    minWidth: headerMinWidth(column.label, column.sortable),
    maxWidth: 320,
    ...(index === 0 ? { cellRenderer: OpenCell } : {}),
  }))
}

/** What a grid tells the page, and asks of it. */
export interface GridCallbacks {
  /** The record open in the detail, if any: read every time, never kept. */
  openToken(): string | null
  ready(api: GridApi<GridRow>): void
  resized(): void
  /** A row asked for -- by a click, Space or Enter -- whether or not it has a token. */
  asked(row: GridRow | undefined, how: OpenHow, rowIndex: number | null, colId: string): void
}

/** The options of a grid named by the heading `labelledBy`, for its whole life. */
export function gridOptionsFor({ labelledBy, firstColumn, on }: { labelledBy: string; firstColumn: string; on: GridCallbacks }): GridOptions<GridRow> {
  return {
    theme: roomGrid,
    // The theme's rows, said again: a grid made inside a hidden view cannot measure its theme.
    rowHeight: ROW_HEIGHT,
    defaultColDef: {
      editable: false,
      resizable: false,
      suppressMovable: true,
      // A header wraps instead of setting its column's width (WCAG 1.4.12).
      wrapHeaderText: true,
      autoHeaderHeight: true,
      // Space and Enter belong to the page: AG Grid's own toggle never runs.
      suppressKeyboardEvent: (params) => SPACE_OR_ENTER(params.event.key),
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
    alwaysShowHorizontalScroll: true,
    scrollbarWidth: 16,
    tabToNextCell: () => false,
    tabToNextHeader: () => false,
    // What AG Grid's live region says about a row is what the page does with it.
    localeText: {
      ariaRowSelect: 'Space opens this record. Enter opens it and moves to it.',
      ariaRowDeselect: 'This record is open.',
      ariaRowToggleSelection: 'Space opens this record.',
    },
    focusGridInnerElement: (params) => {
      const token = on.openToken()
      const node = token === null ? undefined : params.api.getRowNode(token)
      if (node === undefined || node.rowIndex === null) return false
      params.api.ensureIndexVisible(node.rowIndex)
      params.api.setFocusedCell(node.rowIndex, firstColumn)
      return true
    },
    onGridReady: (event) => {
      event.api.setGridAriaProperty('labelledby', labelledBy)
      on.ready(event.api)
    },
    onGridSizeChanged: () => on.resized(),
    onRowClicked: (event: RowClickedEvent<GridRow>) => on.asked(event.data, 'click', event.rowIndex, firstColumn),
    onCellKeyDown: (event: CellKeyDownEvent<GridRow>) => {
      const key = (event.event as KeyboardEvent | null | undefined)?.key ?? ''
      if (!SPACE_OR_ENTER(key)) return
      event.event?.preventDefault()
      on.asked(event.data, key === 'Enter' ? 'enter' : 'space', event.rowIndex, event.column.getColId())
    },
  }
}
