import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import {
  ColumnApiModule,
  ColumnAutoSizeModule,
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
import type {
  CellKeyDownEvent,
  ColDef,
  ColumnResizedEvent,
  GridApi,
  GridOptions,
  ICellRendererParams,
  IRowNode,
  Module,
  RowClickedEvent,
} from 'ag-grid-community'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import type { ListSortTerm } from '@formancy/data-client'
import type { ArrangedColumn } from './columns.js'
import { cellText } from './grid-datasource.js'
import type { GridRow } from './grid-datasource.js'
import { roomGrid, ROW_HEIGHT } from './grid-theme.js'
import { boxKeys, HeaderBox, NeverFilter } from './header-filter.js'
import { changedWidths, headerFloor, WIDEST } from './widths.js'
import type { ColumnWidth, WidthChange } from './widths.js'

/*
 * How the page configures AG Grid Community for a record grid (0047): the
 * modules, the columns and the options, decided once here and read by
 * record-grid.tsx, which holds the grid's state -- and the two things the
 * page reads of the grid and sets on it, the open row's selection and the
 * sort the headers show.
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
 * - **Nothing edits or moves**, so Delete and Backspace clear nothing and
 *   nothing is sent from here but the page's list. A person orders and
 *   hides columns in the section's Columns panel instead (columns-panel.tsx,
 *   0106), whose every change is a key's: a header dragged has no keyboard
 *   path (formancy.ai 0046).
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
 *   form offers delete: a cell the arrow keys reach, whose button takes the
 *   keyboard when the cell does. It is out of the Tab order, so the grid
 *   stays one stop, and its Enter and Space are its own, never the row's.
 *   It asks the page, which confirms in place; no key deletes.
 */

/**
 * Every module the options below use, and no other: `AllCommunityModule`
 * would ship code nothing calls. RowApiModule is for finding the open row,
 * ColumnAutoSizeModule for sizing columns to the first page -- a header's
 * edge and Alt with an arrow are the core module's own (0151) -- LocaleModule
 * for the page's own words in AG Grid's live region, ColumnApiModule for
 * reading the headers' sort and showing the section's on them (0105),
 * CustomFilterModule for the floating row that holds each header's box
 * (0132);
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
]
ModuleRegistry.registerModules([...GRID_MODULES])

export type OpenHow = 'click' | 'space' | 'enter'

const SPACE_OR_ENTER = (key: string): boolean => key === ' ' || key === 'Enter'

/** What AG Grid's live region says about a row: what the page does with it. */
const ROW_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space opens this record. Enter opens it and moves to it.',
  ariaRowDeselect: 'This record is open.',
  ariaRowToggleSelection: 'Space opens this record.',
}

/** The same in Drill down, where Space and Enter both go down to the record (0090). */
const DRILL_ROW_WORDS: Readonly<Record<string, string>> = {
  ariaRowSelect: 'Space or Enter opens this record and moves to it.',
  ariaRowDeselect: 'This record is open. Space or Enter moves to it.',
  ariaRowToggleSelection: 'Space or Enter opens this record.',
}

/** The value of a loading or failed row: nothing. AG Grid's skeleton says "Row data is loading" and "ERR". */
function EmptyCell(): null {
  return null
}

/**
 * The first shown column's cell: the value after a slot that holds a violet
 * bar on the open row, the shape that says "open" (UX-SPEC §5.9). SVG attributes,
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

/** The sort the grid's headers show, in its order: what a header press leaves, or what was applied to them. */
export function headerSort(grid: GridApi<GridRow>): ListSortTerm[] {
  return grid
    .getColumnState()
    .filter((column) => column.sort === 'asc' || column.sort === 'desc')
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((column) => ({ field: column.colId, direction: column.sort as ListSortTerm['direction'] }))
}

/** The column of a row's Delete: `~` is in no field key (session.ts), so it never names a field's column. */
export const DELETE_COLUMN = '~delete'

/** What a row's Delete asks: the form's title, which its name gives, and what a press does. */
export interface RowDelete {
  noun: string
  press(row: GridRow): void
}

/**
 * A row's Delete: an outline in the room's `--invalid`, text and border and
 * never a fill. Its own style attribute, in room variables, because no rule
 * of host.css reaches into a grid (0047); 28 pixels tall, past the 24 of
 * WCAG 2.5.8, inside the 36 of a row.
 */
const DELETE_LOOK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '28px',
  padding: '0 10px',
  border: '1px solid var(--invalid)',
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--invalid)',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: 1,
  cursor: 'pointer',
}

/**
 * The cell of a row's Delete. AG Grid moves the keyboard between cells, and
 * this cell hands it to its button whenever the cell itself is focused, so
 * the arrow keys reach a real button named for the record; the button is
 * `tabIndex` -1, so Tab still leaves the grid in one stop. A row with no
 * token has none: it cannot be addressed.
 */
function DeleteCell(params: ICellRendererParams<GridRow> & { remove: RowDelete }): ReactElement | null {
  const button = useRef<HTMLButtonElement>(null)
  const cell = params.eGridCell
  useEffect(() => {
    const forward = (event: FocusEvent): void => {
      if (event.target === cell) button.current?.focus({ preventScroll: true })
    }
    cell.addEventListener('focus', forward)
    if (document.activeElement === cell) button.current?.focus({ preventScroll: true })
    return () => cell.removeEventListener('focus', forward)
  }, [cell])
  const row = params.data
  if (row === undefined || row.record === null) return null
  const { remove } = params
  return (
    <button type="button" tabIndex={-1} ref={button} style={DELETE_LOOK} aria-label={`Delete ${remove.noun} ${row.record}`} onClick={() => remove.press(row)}>
      Delete
    </button>
  )
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
 * (grid-datasource.ts). The first shown carries the open row's bar.
 */
export function columnDefsOf(
  columns: readonly ArrangedColumn[],
  remove?: RowDelete,
  boxed: ReadonlySet<string> = new Set(),
  widths: readonly ColumnWidth[] = [],
  floors: ReadonlyMap<string, number> = new Map(),
): ColDef<GridRow>[] {
  const first = columns.find((column) => column.shown)?.key
  const set = new Map(widths.map((each) => [each.field, each.width]))
  const fields: ColDef<GridRow>[] = columns.map((column) => {
    const width = set.get(column.key)
    return {
      colId: column.key,
      headerName: column.label,
      valueGetter: (params) => cellText(params.data, column),
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
      ...(column.key === first ? { cellRenderer: OpenCell } : {}),
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
  if (remove === undefined) return fields
  // Last, so Tab into the grid still lands on the open row's first column, and the bar stays first.
  return [
    ...fields,
    {
      colId: DELETE_COLUMN,
      headerName: 'Delete',
      valueGetter: () => '',
      sortable: false,
      minWidth: headerFloor('Delete', false),
      maxWidth: 160,
      cellRenderer: DeleteCell,
      cellRendererParams: { remove },
    },
  ]
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

/** What a grid tells the page, and asks of it. */
export interface GridCallbacks {
  /** The record open in the detail, if any: read every time, never kept. */
  openToken(): string | null
  ready(api: GridApi<GridRow>): void
  resized(): void
  /** A row asked for -- by a click, Space or Enter -- whether or not it has a token. */
  asked(row: GridRow | undefined, how: OpenHow, rowIndex: number | null, colId: string): void
  /** Whether the grid is shown in Drill down, where Space and Enter both go down: read every time AG Grid words a row. */
  drilling(): boolean
  /** The headers' sort changed: by a press on one, or by the page showing the section's (0105). */
  sorted(): void
  /** A width the person set -- by a header's edge, Alt and an arrow, or the Columns panel -- once it is set (0151). */
  widthsSet(changes: WidthChange[]): void
  /** `=` on a cell: its value kept as its column's condition (0133), or said where the column offers none. */
  example(row: GridRow | undefined, colId: string): void
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
  return {
    theme: roomGrid,
    // The theme's rows, said again: a grid made inside a hidden view cannot measure its theme.
    rowHeight: ROW_HEIGHT,
    defaultColDef: {
      editable: false,
      // A field's column says otherwise (columnDefsOf); a row's Delete keeps its button's width.
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
    // A double click on a header's edge sizes nothing: the Columns panel's Fit does (above).
    suppressAutoSize: true,
    alwaysShowHorizontalScroll: true,
    scrollbarWidth: 16,
    tabToNextCell: () => false,
    tabToNextHeader: () => false,
    // What AG Grid's live region says about a row is what the page does with
    // it, in the layout shown now: the options are the grid's for its life,
    // and a layout changes under it.
    getLocaleText: ({ key, defaultValue }) => (on.drilling() ? DRILL_ROW_WORDS : ROW_WORDS)[key] ?? defaultValue,
    focusGridInnerElement: (params) => {
      const token = on.openToken()
      const node = token === null ? undefined : params.api.getRowNode(token)
      if (node === undefined || node.rowIndex === null) return false
      params.api.ensureIndexVisible(node.rowIndex)
      params.api.setFocusedCell(node.rowIndex, firstColumn())
      return true
    },
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
        .filter((column) => column.getColId() !== DELETE_COLUMN)
        .map((column) => ({ field: column.getColId(), width: Math.round(column.getActualWidth()) }))
      const changes = event.source === 'uiColumnResized' ? changedWidths(finished, settled) : []
      for (const { field, width } of finished) settled.set(field, width)
      if (changes.length > 0) on.widthsSet(changes)
    },
    onRowClicked: (event: RowClickedEvent<GridRow>) => {
      // A press of the row's Delete is the button's, never the row's: it does not open the record it asks about.
      if (event.event?.target instanceof Element && event.event.target.closest('button') !== null) return
      on.asked(event.data, 'click', event.rowIndex, firstColumn())
    },
    onCellKeyDown: (event: CellKeyDownEvent<GridRow>) => {
      const keyboard = event.event as KeyboardEvent | null | undefined
      const key = keyboard?.key ?? ''
      // `=` keeps the rows with the cell's value (0133) -- not with Ctrl or
      // Cmd, which zoom, nor a plain Alt; AltGr, which some layouts type `=`
      // with, is Ctrl and Alt together.
      if (key === '=' && keyboard !== null && keyboard !== undefined && !keyboard.metaKey && keyboard.ctrlKey === keyboard.altKey) {
        on.example(event.data, event.column.getColId())
        return
      }
      // Space and Enter on a row's Delete are its button's: the browser presses it.
      if (!SPACE_OR_ENTER(key) || event.column.getColId() === DELETE_COLUMN) return
      event.event?.preventDefault()
      on.asked(event.data, key === 'Enter' ? 'enter' : 'space', event.rowIndex, event.column.getColId())
    },
  }
}
