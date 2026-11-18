import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { GridApi } from 'ag-grid-community'
import type { ListFilterTerm, ListSortTerm, PublishedForm, RecordListQuery } from '@formancy/data-client'
import { chooseColumn } from './choose-column.js'
import type { ChosenRows } from './chosen-rows.js'
import { arrange } from './columns.js'
import type { ColumnChoice } from './columns.js'
import { answered, createDatasource } from './grid-datasource.js'
import type { DatasourceHooks, GridColumn, GridRow, GridSource, ListClient } from './grid-datasource.js'
import { columnDefsOf, drawWidths, gridOptionsFor, liveDelete, select, took } from './grid-options.js'
import type { OpenHow, RowDelete } from './grid-options.js'
import type { SizeState } from './grid-sizing.js'
import type { Said } from './leave.js'
import { Pager } from './pager.js'
import { useGridLine } from './use-grid-line.js'
import { useGridSizing } from './use-grid-sizing.js'
import { useGridSort } from './use-grid-sort.js'
import { useHeaderFilters } from './use-header-filters.js'
import { useHeaderFloors } from './use-header-floors.js'
import { useHeldRows } from './use-held-rows.js'
import type { HeldRows } from './use-held-rows.js'
import type { ColumnWidth, Measured, WidthChange } from './widths.js'

export type { OpenHow, RowDelete } from './grid-options.js'
export { DELETE_COLUMN } from './grid-options.js'

/*
 * One record grid: AG Grid Community over the infinite row model, a page of
 * `LIST_PAGE_SIZE` rows at a time from `records/list` (0044, 0047), with the
 * pager and the status line that speak for it. The master grid and every
 * child grid are this one component, which puts its parts together: how
 * AG Grid is configured is grid-options.tsx's, what is asked and said
 * grid-datasource.ts's, what the line says and where the pager is
 * use-grid-line.ts's, the sort on the headers use-grid-sort.ts's, the boxes
 * under them and `=` on a cell use-header-filters.ts's, and the columns'
 * widths and the well's height use-grid-sizing.ts's. Where the form offers
 * this person an action over a selection, the boxes a person chooses the
 * page's records with are a first column (choose-column.tsx), and each
 * page drawn is told to the choice, which a page of another list or
 * another page clears (chosen-rows.ts, 0166); what the panel draws above
 * the well -- the actions over the records chosen -- is its own.
 *
 * What it holds itself: whether its page has answered and how many rows it
 * drew, and the open record's row selected in the grid after every page --
 * so `aria-selected` and the bar say what the detail shows. The well is as
 * tall as its page, and its columns are sized to the first page and again
 * each time the separator is let go, only where the grid is drawn
 * (use-grid-sizing.ts, 0142).
 *
 * The rows on screen stay while the next are asked for (0146): a page
 * turned to and a new list's first page are asked for before AG Grid is
 * shown them (use-held-rows.ts), and the well is marked `data-waiting`,
 * which the room's stylesheet dims, while the line says what is asked; the
 * grid hears only the list shown and the list asked for. While a refused
 * new list stands, Previous rows and Next rows wait, and a reload asks for
 * that list. A page left empty that is not the first -- its last record
 * gone (0053) -- says nothing, and AG Grid shows the page before it.
 *
 * What it lists is its section's: the search submitted, the parent, the
 * filter its section applied (grid-filter.tsx, 0104), whose fields its line
 * names, and the sort (0105), which its headers show (use-grid-sort.ts).
 *
 * The columns are the section's too (0106): in its order, and those it hid
 * kept in the grid, hidden, with their sort. A change of them is drawn by
 * the grid and asks nothing: the datasource and the options never depend
 * on them, and the open row's bar and the keyboard's way into the grid
 * follow the first column shown. A column shown again is sized to the
 * rows on the page, as the first page sized the rest. And so are their
 * widths (0151): one the person sets -- on a header, or in the Columns
 * panel, which sets it here (`setWidths`) -- is told to the section, one
 * the section keeps is drawn when its column is made, and none is sized
 * away (use-grid-sizing.ts); the panel reads a column's width here
 * (`widthOf`).
 */

/** Where a row was asked for from, so the keyboard can be given back there. */
export interface RowAt {
  rowIndex: number
  colId: string
}

export interface RecordGridHandle {
  /** A record's cell -- its first, or the column `colId` names -- focused, when its row is on this page; false otherwise. */
  focusRecord(token: string, colId?: string): boolean
  /** The keyboard back on the cell a request came from. */
  focusAt(at: RowAt): void
  /** The keyboard on the first row's first cell shown, when the page has a row; false otherwise. */
  focusFirst(): boolean
  /** The page asked for again: after a save, so stored values show. */
  reload(): void
  /** A sentence of the page's own on the status line, until the next answer. */
  say(line: Said): void
  /** A record gone from the grid: the page asked for again, and `line` said once, before its sentence. */
  removed(line: Said): void
  /** A column as the grid draws it now -- its width and the least and most it may be -- or null where the grid has none (0151). */
  widthOf(field: string): Measured | null
  /** Widths the Columns panel set, drawn by the grid and told back as a drag's are; a width taken away -- Fit -- given to the section, and the column sized to the rows shown (0151). */
  setWidths(changes: WidthChange[]): void
}

export interface RecordGridProps {
  /** What it lists through: the runtime plane, or a set the page holds -- a together tab's rows (0155), one page, answered from memory. */
  client: ListClient
  formId: string
  definition: PublishedForm
  columns: readonly GridColumn[]
  /** The section's arrangement of `columns`: their order, and which are shown (0106). */
  choices: readonly ColumnChoice[]
  /** The widths the person set, which the grid draws when it makes a column and never sizes away (0151). */
  widths: readonly ColumnWidth[]
  /** The heading that names the grid. */
  labelledBy: string
  /** A child grid's title: its sentences name its rows. The master has none. */
  noun?: string
  parent: RecordListQuery['parent']
  /** The search as submitted, never as typed. */
  search: string
  /**
   * The filter as applied (0104): each block is asked for with it, and a new
   * one starts the list again from its first page, as a new search does.
   * Compared by identity, so the caller keeps it as state.
   */
  filter: readonly ListFilterTerm[]
  /**
   * The sort (0105): each block is asked for in it and the headers show it,
   * and a new one starts the list again from its first page, as a new filter
   * does. Compared by identity, so the caller keeps it as state.
   */
  sort: readonly ListSortTerm[]
  openToken: string | null
  canCreate: boolean
  /** The first page is asked for without a word: a child reloaded because its parent changed, which the parent's line has just said. */
  quiet?: boolean
  /** What the toolbar holds before the pager: the master's search. */
  toolbarStart?: ReactNode
  /**
   * How many times the separator between the records and the record has
   * been let go: each time, the columns are sized again, to the rows shown
   * then (the person's decision of 2026-10-10).
   */
  refit?: number
  bench: 'master-bench' | 'child-bench'
  /** Where the form offers delete: each row's Delete names it with this noun, and a press asks the page (0053). */
  remove?: RowDelete
  /** What the panel holds after the well: a row's delete confirmation, in place. */
  after?: ReactNode
  /** The records a person chooses of the page for an action over them (0166): a column of boxes, and each page drawn told to it. */
  choose?: ChosenRows
  /** What the panel holds between the toolbar and the well: the actions over the records chosen, and a run's region (0166). */
  aboveWell?: ReactNode
  /** Shown in Drill down, where every open goes down a level: what the grid says of a row follows (0090). */
  drilling?: boolean
  onOpen(token: string, how: OpenHow, at: RowAt): void
  /** A header sorted by the person: the grid's sort now, in its order, for the section to hold as given -- the grid knows its own report by identity. */
  onSort(sort: ListSortTerm[]): void
  /** A width the person set -- by a header's edge, Alt and an arrow, or the Columns panel -- for the section to keep (0151). */
  onWidths(changes: WidthChange[]): void
  onClearSearch?: () => void
  /** Told whether the grid's first page came back with no rows under a filter: the section's filter offers a way out. */
  onFiltered?: (empty: boolean) => void
  /** A set the page holds, one page of it (0155): no pager and no line of the grid's own, the section's saying what it holds. */
  alone?: boolean
  /** Told each time a page has answered and is drawn: where a section puts the keyboard back on a row its set changed. */
  onListed?: () => void
}

export const RecordGrid = forwardRef<RecordGridHandle, RecordGridProps>(function RecordGrid(props, handle): ReactElement {
  const {
    client,
    formId,
    columns,
    choices,
    widths,
    labelledBy,
    parent,
    search,
    filter,
    sort,
    openToken,
    quiet = false,
    toolbarStart,
    refit = 0,
    bench,
    after,
    onClearSearch,
  } = props
  const api = useRef<GridApi<GridRow> | null>(null)
  const well = useRef<HTMLDivElement>(null)
  // What the grid's callbacks read when they run: its options are made once.
  const latest = useRef(props)
  latest.current = props
  /** The rows held while the next are asked for, read when a hook runs: made below, from the datasource these hooks are given to. */
  const heldNow = useRef<HeldRows | null>(null)
  /** What `from` says is the page's: the list shown, or the list asked for (use-held-rows.ts). */
  const ours = (from: GridSource): boolean => heldNow.current?.live(from) ?? true
  const shown = useRef<SizeState>({ rows: 0, loaded: false, sized: false, owed: false })
  const arranged = useMemo(() => arrange(columns, choices), [columns, choices])
  /** The first column shown: where the open row's bar is, and the keyboard goes into a row. Read when needed, so a column moved or hidden asks nothing again. */
  const firstShown = useRef('')
  firstShown.current = arranged.find((column) => column.shown)?.key ?? ''

  const applySelection = useCallback(() => {
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    const changed = select(grid, latest.current.openToken)
    // The bar is drawn by the first shown column's cell, from the row's selection.
    const first = firstShown.current
    if (changed.length > 0 && first !== '') grid.refreshCells({ rowNodes: changed, columns: [first], force: true })
  }, [])

  const { boxedKeys, headers } = useHeaderFilters(api)
  const { fit, sizeOnce, sizeWaiting, sizeColumns } = useGridSizing({ api, well, shown, refit, arranged, widths, boxedKeys })
  const { showSort, sorted } = useGridSort(api, sort, (told) => props.onSort(told))
  const { status, pager, asking, retryRef, line } = useGridLine({ quiet, parent: parent?.record, noun: props.noun })

  const hooks = useMemo<DatasourceHooks>(
    () => ({
      loading: (start, end, ahead, from) => {
        if (!ours(from)) return
        // Asked by AG Grid, a refusal before is not Ask again's.
        if (!ahead) {
          shown.current.loaded = false
          heldNow.current?.heard()
        }
        latest.current.onFiltered?.(false)
        api.current?.setGridAriaProperty('busy', 'true')
        line.loading(start, end, ahead)
      },
      answered: (start, rows, hasMore, asked, from) => {
        if (!ours(from) || !took(api.current, start, rows)) return
        heldNow.current?.heard()
        // A page left empty that is not the first -- its last row deleted --
        // says nothing: with fewer rows than the page starts at, AG Grid's
        // pagination moves to the last page there is and asks for it, which
        // says what the grid shows (P7, measured in delete-rows.test.tsx,
        // 0053).
        if (rows.length === 0 && start > 0) return
        // The page drawn, which keeps the choice made on it, or clears one made on another (0166).
        latest.current.choose?.page(from, start, rows)
        shown.current = { ...shown.current, rows: rows.length, loaded: true }
        api.current?.setGridAriaProperty('busy', null)
        const { noun, canCreate, columns: shownColumns } = latest.current
        // The fields the block's own filter is on, by the labels the grid's headers carry.
        const filtered = asked.map((term) => shownColumns.find((column) => column.key === term.field)?.label ?? term.field)
        const said = answered({
          start,
          count: rows.length,
          hasMore,
          search: latest.current.search,
          filtered,
          untokened: rows.filter((row) => row.record === null).length,
          canCreate,
          ...(noun === undefined ? {} : { noun }),
        })
        const fromRetry = line.answered(start, said, hasMore)
        // The records the page shows, by the labels the line, the chips and the boxes then say a lookup's condition by (0135).
        headers.heard(shownColumns, rows)
        latest.current.onFiltered?.(start === 0 && rows.length === 0 && asked.length > 0)
        applySelection()
        fit()
        sizeOnce()
        latest.current.onListed?.()
        // Columns shown while nothing was listed: sized to these rows, once they are drawn -- or, hidden, owed with the rest.
        sizeWaiting(rows.length)
        // Ask again stays where it was pressed until the answer; then the rows that came.
        if (fromRetry && rows.length > 0 && firstShown.current !== '') api.current?.setFocusedCell(start, firstShown.current)
        // After `=`, the keyboard back where it was pressed (0133).
        headers.listed(start, rows)
      },
      refused: (message, code, ahead, from) => {
        if (!ours(from)) return
        // Asked first, the rows on screen are still there, and the pager still theirs.
        if (!ahead) shown.current = { ...shown.current, rows: 0, loaded: true }
        api.current?.setGridAriaProperty('busy', null)
        // A new list refused stands, over the last list's rows: the pager waits for it.
        const stands = ahead && heldNow.current !== null && heldNow.current.source !== from
        latest.current.onFiltered?.(false)
        line.refused(message, code, ahead, stands)
        if (!ahead) fit()
      },
      restart: (from) => {
        if (!ours(from)) return
        // The row the asked page comes after is gone (0108): the first page
        // is where the list starts again, and its line says why first. A
        // task later, so AG Grid is out of the block it is failing.
        line.restart()
        setTimeout(() => heldNow.current?.restart(), 0)
      },
    }),
    [applySelection, fit, sizeOnce, sizeWaiting, line, headers],
  )

  // A new search, another parent, another filter or another sort is a new
  // list, from its first page: a new datasource, which AG Grid starts again
  // from row 0, and asks once the headers show the sort.
  const datasource = useMemo(
    () => createDatasource({ client, formId, columns, search, parent, filter, sort, hooks }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the parent is its field and its record: a new object holding the same two is the same list, and a new datasource would ask it again
    [client, formId, columns, search, parent?.field, parent?.record, filter, sort, hooks],
  )
  useEffect(() => () => datasource.abort(), [datasource])
  useEffect(() => applySelection(), [openToken, applySelection])
  // After the parent's line is quieted (use-grid-line.ts): a new list's first page is asked here, and its line is the quiet one.
  // A page AG Grid was not moved to: the wait is over, and the line says what it said before the ask.
  const held = useHeldRows(api, datasource, () => {
    api.current?.setGridAriaProperty('busy', null)
    line.stuck()
  })
  heldNow.current = held

  useImperativeHandle(
    handle,
    () => ({
      focusRecord(token, colId = firstShown.current) {
        const grid = api.current
        const node = grid?.getRowNode(token)
        if (grid === null || grid === undefined || grid.isDestroyed() || node === undefined || node.rowIndex === null) return false
        grid.ensureIndexVisible(node.rowIndex)
        grid.setFocusedCell(node.rowIndex, colId)
        return true
      },
      focusAt({ rowIndex, colId }) {
        const grid = api.current
        if (grid === null || grid.isDestroyed()) return
        grid.ensureIndexVisible(rowIndex)
        grid.setFocusedCell(rowIndex, colId)
      },
      focusFirst() {
        const grid = api.current
        if (grid === null || grid.isDestroyed() || shown.current.rows === 0 || firstShown.current === '') return false
        grid.ensureIndexVisible(0)
        grid.setFocusedCell(0, firstShown.current)
        return true
      },
      reload() {
        // A list on its way, or a refused one standing, is the one to list again: the rows shown are the last list's.
        if (heldNow.current?.reload() !== true) api.current?.purgeInfiniteCache()
      },
      say(said) {
        line.say(said)
      },
      removed(said) {
        line.removed(said)
        if (heldNow.current?.reload() !== true) api.current?.purgeInfiniteCache()
      },
      widthOf(field) {
        const grid = api.current
        const column = grid === null || grid.isDestroyed() ? null : grid.getColumn(field)
        return column === null ? null : { width: column.getActualWidth(), min: column.getMinWidth(), max: column.getMaxWidth() }
      },
      setWidths(changes) {
        const grid = api.current
        const set = changes.flatMap(({ field, width }) => (width === null ? [] : [{ field, width }]))
        if (grid !== null && !grid.isDestroyed()) drawWidths(grid, set)
        const fitted = changes.filter((change) => change.width === null)
        if (fitted.length === 0) return
        latest.current.onWidths(fitted)
        // A kept width given back is sized as the section draws it; a column with none is sized here, to the rows shown now.
        const kept = new Set(latest.current.widths.map((each) => each.field))
        const never = fitted.map((change) => change.field).filter((field) => !kept.has(field))
        if (never.length > 0) sizeColumns(never)
      },
    }),
    [sizeColumns, line],
  )

  // A row's Delete reads the page's handler when pressed: the column is made once per noun -- and per header and words (0155).
  const removeNoun = props.remove?.noun
  const removeWorded = props.remove?.said !== undefined
  const removeHeading = props.remove?.heading
  const { choose } = props
  // Each header's floor, measured again where the page's fonts loading changed one (0151).
  const floors = useHeaderFloors(columns)
  const columnDefs = useMemo(
    () =>
      columnDefsOf(
        arranged,
        removeNoun === undefined ? undefined : liveDelete(() => latest.current.remove, removeNoun, removeWorded, removeHeading),
        new Set(boxedKeys === '' ? [] : boxedKeys.split('\n')),
        // Read, not a dependency: a kept width is drawn when its column is made, and a width set since is the grid's already (0151).
        latest.current.widths,
        floors,
        choose === undefined ? undefined : chooseColumn(choose),
      ),
    [arranged, removeNoun, removeWorded, removeHeading, boxedKeys, floors, choose],
  )

  const options = useMemo(
    () =>
      gridOptionsFor({
        labelledBy,
        firstColumn: () => firstShown.current,
        on: {
          openToken: () => latest.current.openToken,
          ready: (ready) => {
            api.current = ready
            if (!shown.current.loaded) ready.setGridAriaProperty('busy', 'true')
            headers.ready(ready)
            // The sort the section opens on: a default view's (0105).
            showSort()
          },
          sorted,
          widthsSet: (changes) => latest.current.onWidths(changes),
          resized: fit,
          asked: (row, how, rowIndex, colId) => {
            if (row === undefined) return
            if (row.record === null) line.cannotOpen()
            else latest.current.onOpen(row.record, how, { rowIndex: rowIndex ?? 0, colId })
          },
          drilling: () => latest.current.drilling === true,
          example: (row, colId) => {
            if (headers.example(row, colId)) return
            const label = latest.current.columns.find((column) => column.key === colId)?.label ?? colId
            line.say([`= keeps no value of ${label}: the filter cannot say one.`])
          },
        },
      }),
    // The options are the grid's for its life; what changes is read through `latest` and `firstShown`.
    [labelledBy, fit, showSort, sorted, line, headers],
  )

  return (
    <>
      <div className="toolbar">
        {toolbarStart}
        <Pager
          alone={props.alone === true}
          status={status}
          first={pager.page === 0}
          last={!pager.hasMore}
          waits={held.standing}
          asking={asking}
          retryRef={retryRef}
          onClear={onClearSearch}
          onRetry={() => {
            if (!line.askAgain()) return
            if (!held.again()) api.current?.purgeInfiniteCache()
          }}
          onPrevious={() => {
            if (pager.page > 0 && !held.standing) held.turn(-1)
          }}
          onNext={() => {
            if (pager.hasMore && !held.standing) held.turn(1)
          }}
        />
      </div>
      {props.aboveWell}
      {/* Dimmed by the room's stylesheet while a page is asked for: the rows on screen stay (0146). */}
      <div className={`grid-bench ${bench}`} ref={well} data-waiting={status.kind === 'loading' ? '' : undefined} onPointerDown={() => held.press(true)}>
        <AgGridReact<GridRow> gridOptions={options} columnDefs={columnDefs} datasource={held.source} />
      </div>
      {after}
    </>
  )
})
