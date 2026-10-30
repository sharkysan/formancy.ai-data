import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import type { DataClient, ListFilterTerm, ListSortTerm, PublishedForm, RecordListQuery } from '@formancy/data-client'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { arrange } from './columns.js'
import type { ColumnChoice } from './columns.js'
import { answered, CANNOT_OPEN, createDatasource, loading, REFUSED_FILTER_HELP, STARTED_AGAIN } from './grid-datasource.js'
import type { DatasourceHooks, GridColumn, GridRow } from './grid-datasource.js'
import { columnDefsOf, gridOptionsFor } from './grid-options.js'
import type { OpenHow, RowDelete } from './grid-options.js'
import { ROW_HEIGHT } from './grid-theme.js'
import type { Said } from './leave.js'
import { Pager } from './pager.js'
import type { Status } from './pager.js'
import { sameSort } from './views.js'

export type { OpenHow, RowDelete } from './grid-options.js'
export { DELETE_COLUMN } from './grid-options.js'

/*
 * One record grid: AG Grid Community over the infinite row model, a page of
 * `LIST_PAGE_SIZE` rows at a time from `records/list` (0044, 0047), with the
 * pager and the status line that speak for it. The master grid and every
 * child grid are this one component; how AG Grid is configured is
 * grid-options.tsx's, and what is asked and said grid-datasource.ts's.
 *
 * What it holds: the page's numbers, what the line says, and the open
 * record's row selected in the grid after every page -- so `aria-selected`
 * and the bar say what the detail shows -- and the well as tall as its page,
 * its columns sized to the first page and again each time the separator is
 * let go.
 *
 * A record gone from it (0053) -- deleted, or not found by a delete and
 * closed -- is said once, before the sentence of the page asked for again;
 * a page left empty that is not the first says nothing, and AG Grid shows
 * the page before it.
 *
 * What it lists is its section's: the search submitted, the parent, the
 * filter its panel applied (filter-panel.tsx, 0104), whose fields its line
 * names, and the sort. A filter the server refuses is said in the server's
 * sentence with what to do instead of Ask again, which would be refused the
 * same.
 *
 * The sort is the section's too (0105), so a view picked can set it with
 * the filter: the headers are made to show it whenever they show another,
 * and a header the person sorts by is told to the section, which then
 * holds that sort. Its datasource asks for a block only once the headers
 * show the section's sort (grid-datasource.ts), so a new filter and a new
 * sort together are one first page.
 *
 * The columns are the section's too (0106): in its order, and those it hid
 * kept in the grid, hidden, with their sort. A change of them is drawn by
 * the grid and asks nothing: the datasource and the options never depend
 * on them, and the open row's bar and the keyboard's way into the grid
 * follow the first column shown. A column shown again is sized to the
 * rows on the page, as the first page sized the rest.
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
  /** The page asked for again: after a save, so stored values show. */
  reload(): void
  /** A sentence of the page's own on the status line, until the next answer. */
  say(line: Said): void
  /** A record gone from the grid: the page asked for again, and `line` said once, before its sentence. */
  removed(line: Said): void
}

export interface RecordGridProps {
  client: DataClient
  formId: string
  definition: PublishedForm
  columns: readonly GridColumn[]
  /** The section's arrangement of `columns`: their order, and which are shown (0106). */
  choices: readonly ColumnChoice[]
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
  /** Shown in Drill down, where every open goes down a level: what the grid says of a row follows (0090). */
  drilling?: boolean
  onOpen(token: string, how: OpenHow, at: RowAt): void
  /** A header sorted by the person: the grid's sort now, in its order, for the section to hold as given -- the grid knows its own report by identity. */
  onSort(sort: ListSortTerm[]): void
  onClearSearch?(): void
}

/** Every row of the page selected exactly when it is the open record's; the rows whose selection changed. */
function select(grid: GridApi<GridRow>, open: string | null): IRowNode<GridRow>[] {
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
function headerSort(grid: GridApi<GridRow>): ListSortTerm[] {
  return grid
    .getColumnState()
    .filter((column) => column.sort === 'asc' || column.sort === 'desc')
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((column) => ({ field: column.colId, direction: column.sort as ListSortTerm['direction'] }))
}

/**
 * How tall a well is for `rows` rows: the header, a 36px band each (two
 * when there are none), the 16px scrollbar AG Grid keeps, and the frame --
 * and where the well's own max-height caps it, whole rows only, so no row is
 * cut by the scrollbar's band (UX-SPEC §3).
 */
function wellHeight(header: number, rows: number, cap: number): number {
  const band = 16
  let bands = Math.max(rows, 2)
  if (Number.isFinite(cap)) bands = Math.max(2, Math.min(bands, Math.floor((cap - header - band - 2) / ROW_HEIGHT)))
  return Math.ceil(header + bands * ROW_HEIGHT + band + 2)
}

export const RecordGrid = forwardRef<RecordGridHandle, RecordGridProps>(function RecordGrid(props, handle): ReactElement {
  const { client, formId, columns, choices, labelledBy, parent, search, filter, sort, openToken, quiet = false, toolbarStart, refit = 0, bench, after, onClearSearch } = props
  const api = useRef<GridApi<GridRow> | null>(null)
  const well = useRef<HTMLDivElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  // What the grid's callbacks read when they run: its options are made once.
  const latest = useRef(props)
  latest.current = props
  const [status, setStatus] = useState<Status>({ kind: 'loading', text: [quiet ? '' : loading(0, LIST_PAGE_SIZE, props.noun)], help: null, clear: false, retry: false })
  const [pager, setPager] = useState({ page: 0, hasMore: false })
  const shown = useRef({ rows: 0, loaded: false, sized: false, quiet, retrying: false })
  /** Columns shown while nothing was listed, waiting for a page with rows to be sized to (below). */
  const unsized = useRef(new Set<string>())
  /** What a record gone from the grid says before the next page's sentence, once. */
  const removedLine = useRef<Said | null>(null)
  /** The sentence of a page, after the removal said first if there is one -- which it then is not again. */
  const first = (said: Said): Said => {
    const before = removedLine.current
    removedLine.current = null
    return before === null ? said : [...before, ' ', ...said]
  }
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

  /** The well as tall as its page, never past its cap. A DOM read: the header's height is laid out by AG Grid. */
  const fit = useCallback(() => {
    const container = well.current
    if (container === null) return
    const header = container.querySelector('[role="row"][aria-rowindex="1"]')?.getBoundingClientRect().height || 40
    const height = wellHeight(header, shown.current.loaded ? shown.current.rows : 0, Number.parseFloat(getComputedStyle(container).maxHeight))
    container.style.height = `${String(height)}px`
  }, [])

  /** Each column sized to the first page that has rows, once, after those rows are drawn: paging never makes the columns jump; letting go of the separator does, below. */
  const sizeOnce = useCallback(() => {
    if (shown.current.sized || shown.current.rows === 0) return
    setTimeout(() => {
      const grid = api.current
      if (grid === null || grid.isDestroyed() || shown.current.sized || !shown.current.loaded) return
      grid.autoSizeAllColumns(true)
      shown.current.sized = true
      fit()
    }, 0)
  }, [fit])

  // The separator let go: the columns fitted again to the rows on the page
  // now, which a search or another page may have changed since they were
  // sized -- to their content, as the first page sized them, never stretched
  // to the lane's width (UX-SPEC §6.3). Nothing to fit while a page loads.
  const refitted = useRef(refit)
  useEffect(() => {
    if (refit === refitted.current) return
    refitted.current = refit
    const grid = api.current
    if (grid === null || grid.isDestroyed() || !shown.current.loaded || shown.current.rows === 0) return
    grid.autoSizeAllColumns(true)
    shown.current.sized = true
    fit()
  }, [refit, fit])

  /**
   * The section's sort on the headers, where they show another: they follow
   * it, and lead it only by a press. Every field a view or a kept sort
   * sorts by is a column here, shown or hidden (0106): a view is offered,
   * and a kept sort restored, only with fields in `list.sortable`, whose
   * fields `columnsOf` draws, leaving out only a child's parent field, a
   * lookup, which no list sorts by.
   */
  const showSort = useCallback(() => {
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    const wanted = latest.current.sort
    if (sameSort(headerSort(grid), wanted)) return
    grid.applyColumnState({ state: wanted.map((term, index) => ({ colId: term.field, sort: term.direction, sortIndex: index })), defaultState: { sort: null, sortIndex: null } })
  }, [])
  /**
   * The last sort the headers told the section of. AG Grid tells a press a
   * task late, so when the section holds what a press told it, the headers
   * may already show a later press on its way: showing the told one again
   * would undo it, as two quick Enters on a header did (export.test.tsx).
   */
  const told = useRef<readonly ListSortTerm[] | null>(null)

  const hooks = useMemo<DatasourceHooks>(
    () => ({
      loading: (start, end) => {
        shown.current.loaded = false
        api.current?.setGridAriaProperty('busy', 'true')
        const words = shown.current.quiet ? '' : loading(start, end - start, latest.current.noun)
        shown.current.quiet = false
        setStatus((before) => ({ kind: 'loading', text: [words], help: null, clear: false, retry: before.retry && shown.current.retrying }))
        setPager((before) => ({ ...before, page: Math.floor(start / LIST_PAGE_SIZE) }))
      },
      answered: (start, rows, hasMore, asked) => {
        // A page left empty that is not the first -- its last row deleted --
        // says nothing: with fewer rows than the page starts at, AG Grid's
        // pagination moves to the last page there is and asks for it, which
        // says what the grid shows (P7, measured in delete-rows.test.tsx,
        // 0053).
        if (rows.length === 0 && start > 0) return
        const fromRetry = shown.current.retrying && document.activeElement === retryButton.current
        shown.current = { ...shown.current, rows: rows.length, loaded: true, retrying: false }
        api.current?.setGridAriaProperty('busy', null)
        const { noun, canCreate, columns: shownColumns } = latest.current
        // The fields the block's own filter is on, by the labels the grid's headers carry.
        const filtered = asked.map((term) => shownColumns.find((column) => column.key === term.field)?.label ?? term.field)
        const said = answered({ start, count: rows.length, hasMore, search: latest.current.search, filtered, untokened: rows.filter((row) => row.record === null).length, canCreate, ...(noun === undefined ? {} : { noun }) })
        setStatus({ kind: 'answer', text: first([said.text]), help: said.help, clear: said.clear, retry: false })
        setPager({ page: Math.floor(start / LIST_PAGE_SIZE), hasMore })
        applySelection()
        fit()
        sizeOnce()
        // Columns shown while nothing was listed: sized to these rows, once they are drawn.
        if (rows.length > 0 && unsized.current.size > 0) {
          const waiting = [...unsized.current]
          unsized.current.clear()
          setTimeout(() => {
            const grid = api.current
            if (grid === null || grid.isDestroyed()) return
            grid.autoSizeColumns(waiting, true)
            fit()
          }, 0)
        }
        // Ask again stays where it was pressed until the answer; then the rows that came.
        if (fromRetry && rows.length > 0 && firstShown.current !== '') api.current?.setFocusedCell(start, firstShown.current)
      },
      refused: (message, code) => {
        shown.current = { ...shown.current, rows: 0, loaded: true, retrying: false }
        api.current?.setGridAriaProperty('busy', null)
        // A filter the server cannot apply is refused again however often it is asked: its recovery is the condition.
        const filterRefused = code === 'not-filterable'
        setStatus({ kind: 'refused', text: first([message]), help: filterRefused ? REFUSED_FILTER_HELP : null, clear: false, retry: !filterRefused })
        setPager((before) => ({ ...before, hasMore: false }))
        fit()
      },
      restart: () => {
        // The row the asked page comes after is gone (0108): the first page
        // is where the list starts again, and its line says why first. A
        // task later, so AG Grid is out of the block it is failing.
        shown.current = { ...shown.current, retrying: false }
        removedLine.current = [STARTED_AGAIN]
        setTimeout(() => {
          const grid = api.current
          if (grid !== null && !grid.isDestroyed()) grid.paginationGoToFirstPage()
        }, 0)
      },
    }),
    [applySelection, fit, sizeOnce],
  )

  // A new search, another parent, another filter or another sort is a new
  // list, from its first page: a new datasource, which AG Grid starts again
  // from row 0, and asks once the headers show the sort.
  const datasource = useMemo(() => createDatasource({ client, formId, columns, search, parent, filter, sort, hooks }), [client, formId, columns, search, parent?.field, parent?.record, filter, sort, hooks])
  useEffect(() => () => datasource.abort(), [datasource])
  useEffect(() => {
    if (sort !== told.current) showSort()
  }, [sort, showSort])
  useEffect(() => {
    // The parent changed: its line has spoken, and this one waits for the answer.
    if (quiet) shown.current.quiet = true
  }, [quiet, parent?.record])
  useEffect(() => applySelection(), [openToken, applySelection])

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
      reload() {
        api.current?.purgeInfiniteCache()
      },
      say(line) {
        setStatus({ kind: 'answer', text: line, help: null, clear: false, retry: false })
      },
      removed(line) {
        removedLine.current = line
        api.current?.purgeInfiniteCache()
      },
    }),
    [],
  )

  // A row's Delete reads the page's handler when pressed: the column is made once per noun.
  const removeNoun = props.remove?.noun
  const columnDefs = useMemo(
    () => columnDefsOf(arranged, removeNoun === undefined ? undefined : { noun: removeNoun, press: (row) => latest.current.remove?.press(row) }),
    [arranged, removeNoun],
  )

  // A column shown that was hidden when the page was sized: sized now, to
  // the rows shown, and the well fitted to a header the change may have
  // made taller or shorter. Shown while a page loads, or over a page with no
  // rows, it waits in `unsized` for the next page that has some, which
  // `answered` sizes it to: with nothing to size it to, it would keep AG
  // Grid's width until the separator is let go, and Stacked has none.
  const drawn = useRef(arranged)
  useEffect(() => {
    if (drawn.current === arranged) return
    const before = new Set(drawn.current.filter((column) => column.shown).map((column) => column.key))
    drawn.current = arranged
    const added = arranged.filter((column) => column.shown && !before.has(column.key)).map((column) => column.key)
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    if (!shown.current.loaded || shown.current.rows === 0) {
      for (const key of added) unsized.current.add(key)
      if (shown.current.loaded) setTimeout(() => (grid.isDestroyed() ? undefined : fit()), 0)
      return
    }
    setTimeout(() => {
      if (grid.isDestroyed()) return
      if (added.length > 0) grid.autoSizeColumns(added, true)
      fit()
    }, 0)
  }, [arranged, fit])
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
            // The sort the section opens on: a default view's (0105).
            showSort()
          },
          sorted: () => {
            const grid = api.current
            if (grid === null || grid.isDestroyed()) return
            const now = headerSort(grid)
            // Only a sort the section does not hold yet: the one it holds was put on the headers by showSort.
            if (sameSort(now, latest.current.sort)) return
            told.current = now
            latest.current.onSort(now)
          },
          resized: fit,
          asked: (row, how, rowIndex, colId) => {
            if (row === undefined) return
            if (row.record === null) setStatus({ kind: 'refused', text: [CANNOT_OPEN], help: null, clear: false, retry: false })
            else latest.current.onOpen(row.record, how, { rowIndex: rowIndex ?? 0, colId })
          },
          drilling: () => latest.current.drilling === true,
        },
      }),
    // The options are the grid's for its life; what changes is read through `latest` and `firstShown`.
    [labelledBy, fit, showSort],
  )

  return (
    <>
      <div className="toolbar">
        {toolbarStart}
        <Pager
          status={status}
          first={pager.page === 0}
          last={!pager.hasMore}
          asking={shown.current.retrying}
          retryRef={retryButton}
          onClear={onClearSearch}
          onRetry={() => {
            if (shown.current.retrying) return
            shown.current.retrying = true
            setStatus((before) => ({ ...before, retry: true }))
            api.current?.purgeInfiniteCache()
          }}
          onPrevious={() => {
            if (pager.page > 0) api.current?.paginationGoToPreviousPage()
          }}
          onNext={() => {
            if (pager.hasMore) api.current?.paginationGoToNextPage()
          }}
        />
      </div>
      <div className={`grid-bench ${bench}`} ref={well}>
        <AgGridReact<GridRow> gridOptions={options} columnDefs={columnDefs} datasource={datasource} />
      </div>
      {after}
    </>
  )
})
