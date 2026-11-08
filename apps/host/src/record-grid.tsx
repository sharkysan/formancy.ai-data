import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { GridApi } from 'ag-grid-community'
import type { DataClient, ListFilterTerm, ListSortTerm, PublishedForm, RecordListQuery } from '@formancy/data-client'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { arrange } from './columns.js'
import type { ColumnChoice } from './columns.js'
import { answered, CANNOT_OPEN, createDatasource, loading, REFUSED_FILTER_HELP, STANDING_HELP, STARTED_AGAIN } from './grid-datasource.js'
import type { DatasourceHooks, GridColumn, GridRow, GridSource } from './grid-datasource.js'
import { columnDefsOf, gridOptionsFor, headerSort, select } from './grid-options.js'
import type { OpenHow, RowDelete } from './grid-options.js'
import { ROW_HEIGHT } from './grid-theme.js'
import { filterByExample } from './cell-example.js'
import { HeaderFilterContext } from './header-filter.js'
import { pageRecords } from './known-records.js'
import type { Said } from './leave.js'
import { Pager } from './pager.js'
import type { Status } from './pager.js'
import { wellHeight } from './grid-sizing.js'
import { useGridSizing } from './use-grid-sizing.js'
import { useHeldRows } from './use-held-rows.js'
import type { HeldRows } from './use-held-rows.js'
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
 * let go, only where the grid is drawn (use-grid-sizing.ts, 0142).
 *
 * The rows on screen stay while the next are asked for (0146): a page
 * turned to and a new list's first page are asked for before AG Grid is
 * shown them (use-held-rows.ts), and the well is marked `data-waiting`,
 * which the room's stylesheet dims, while the line says what is asked; the
 * grid hears only the list shown and the list asked for. While a refused
 * new list stands, Previous rows and Next rows wait, and a reload asks for
 * that list. What the server answered is said in the room's teal for a
 * moment, a page's own sentence not (pager.tsx).
 *
 * A record gone from it (0053) -- deleted, or not found by a delete and
 * closed -- is said once, before the sentence of the page asked for again;
 * a page left empty that is not the first says nothing, and AG Grid shows
 * the page before it.
 *
 * What it lists is its section's: the search submitted, the parent, the
 * filter its section applied (grid-filter.tsx, 0104), whose fields its line
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
  /** The keyboard on the first row's first cell shown, when the page has a row; false otherwise. */
  focusFirst(): boolean
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
  onClearSearch?: () => void
  /** Told whether the grid's first page came back with no rows under a filter: the section's filter offers a way out. */
  onFiltered?: (empty: boolean) => void
}

export const RecordGrid = forwardRef<RecordGridHandle, RecordGridProps>(function RecordGrid(props, handle): ReactElement {
  const {
    client,
    formId,
    columns,
    choices,
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
  const retryButton = useRef<HTMLButtonElement>(null)
  // What the grid's callbacks read when they run: its options are made once.
  const latest = useRef(props)
  latest.current = props
  const [status, setStatus] = useState<Status>({
    kind: 'loading',
    text: [quiet ? '' : loading(0, LIST_PAGE_SIZE, props.noun)],
    help: null,
    clear: false,
    retry: false,
    said: null,
  })
  /** How many times the line has said what the server answered: each time, its words are drawn in teal anew. */
  const answers = useRef(0)
  /** The line as it is, and as it was when a page was asked first: said again where AG Grid is not moved to that page. */
  const statusNow = useRef(status)
  statusNow.current = status
  const beforeAsk = useRef<Status | null>(null)
  /** The rows held while the next are asked for, read when a hook runs: made below, from the datasource these hooks are given to. */
  const heldNow = useRef<HeldRows | null>(null)
  /** What `from` says is the page's: the list shown, or the list asked for (use-held-rows.ts). */
  const ours = (from: GridSource): boolean => heldNow.current?.live(from) ?? true
  const [pager, setPager] = useState({ page: 0, hasMore: false })
  const shown = useRef({ rows: 0, loaded: false, sized: false, owed: false, quiet, retrying: false })
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

  /**
   * The well as tall as its page, never past its cap. A DOM read: the
   * header's height is laid out by AG Grid, and is its every row -- the
   * columns' and, where the line may name a column, the boxes' (0132),
   * which counted as the first alone left the last row under the scrollbar.
   */
  const fit = useCallback(() => {
    const container = well.current
    if (container === null) return
    const header = container.querySelector('.ag-header')?.getBoundingClientRect().height || 40
    const height = wellHeight(header, shown.current.loaded ? shown.current.rows : 0, Number.parseFloat(getComputedStyle(container).maxHeight))
    container.style.height = `${String(height)}px`
    // Never shorter than its header and one whole row: a panel short of
    // room shrinks the well to its least (records.css), which was a row
    // under one header row, and less than one under the boxes' row (0132).
    container.style.minHeight = `${String(Math.ceil(header + ROW_HEIGHT + 18))}px`
  }, [])

  const { sizeOnce, sizeAdded } = useGridSizing({ api, well, shown, fit, refit })

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
    grid.applyColumnState({
      state: wanted.map((term, index) => ({ colId: term.field, sort: term.direction, sortIndex: index })),
      defaultState: { sort: null, sortIndex: null },
    })
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
      loading: (start, end, ahead, from) => {
        if (!ours(from)) return
        // Asked first, the rows on screen stay, and so does the page they are on; asked by AG Grid, a refusal before is not Ask again's.
        if (ahead) beforeAsk.current = statusNow.current
        else {
          shown.current.loaded = false
          heldNow.current?.heard()
        }
        latest.current.onFiltered?.(false)
        api.current?.setGridAriaProperty('busy', 'true')
        const words = shown.current.quiet ? '' : loading(start, end - start, latest.current.noun)
        shown.current.quiet = false
        setStatus((before) => ({ kind: 'loading', text: [words], help: null, clear: false, retry: before.retry && shown.current.retrying, said: null }))
        if (!ahead) setPager((before) => ({ ...before, page: Math.floor(start / LIST_PAGE_SIZE) }))
      },
      answered: (start, rows, hasMore, asked, from) => {
        if (!ours(from)) return
        heldNow.current?.heard()
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
        answers.current += 1
        setStatus({ kind: 'answer', text: first([said.text]), help: said.help, clear: said.clear, retry: false, said: answers.current })
        // The records the page shows, by the labels the line, the chips and the boxes then say a lookup's condition by (0135).
        for (const [field, named] of pageRecords(shownColumns, rows)) headersNow.current?.heard?.(field, named)
        latest.current.onFiltered?.(start === 0 && rows.length === 0 && asked.length > 0)
        setPager({ page: Math.floor(start / LIST_PAGE_SIZE), hasMore })
        applySelection()
        fit()
        sizeOnce()
        // Columns shown while nothing was listed: sized to these rows, once they are drawn -- or, hidden, owed with the rest.
        if (rows.length > 0 && unsized.current.size > 0) {
          const waiting = [...unsized.current]
          unsized.current.clear()
          sizeAdded(waiting)
        }
        // Ask again stays where it was pressed until the answer; then the rows that came.
        if (fromRetry && rows.length > 0 && firstShown.current !== '') api.current?.setFocusedCell(start, firstShown.current)
        // After `=`, the keyboard back on the row it was pressed on, or the first, in its column (0133).
        const example = exampleAt.current
        if (example !== null && start === 0) {
          exampleAt.current = null
          const grid = api.current
          const node = example.record === null ? undefined : grid?.getRowNode(example.record)
          const at = node?.rowIndex ?? (rows.length > 0 ? 0 : null)
          if (grid !== null && !grid.isDestroyed() && at !== null) {
            grid.ensureIndexVisible(at)
            grid.setFocusedCell(at, example.colId)
          }
        }
      },
      refused: (message, code, ahead, from) => {
        if (!ours(from)) return
        // Asked first, the rows on screen are still there, and the pager still theirs.
        shown.current = ahead ? { ...shown.current, retrying: false } : { ...shown.current, rows: 0, loaded: true, retrying: false }
        api.current?.setGridAriaProperty('busy', null)
        // A filter the server cannot apply is refused again however often it is asked: its recovery is the condition.
        const filterRefused = code === 'not-filterable'
        // A new list refused stands, over the last list's rows: the pager waits for it.
        const stands = ahead && heldNow.current !== null && heldNow.current.source !== from
        latest.current.onFiltered?.(false)
        setStatus({
          kind: 'refused',
          text: first([message]),
          help: filterRefused ? REFUSED_FILTER_HELP : stands ? STANDING_HELP : null,
          clear: false,
          retry: !filterRefused,
          said: null,
        })
        if (ahead) return
        setPager((before) => ({ ...before, hasMore: false }))
        fit()
      },
      restart: (from) => {
        if (!ours(from)) return
        // The row the asked page comes after is gone (0108): the first page
        // is where the list starts again, and its line says why first. A
        // task later, so AG Grid is out of the block it is failing.
        shown.current = { ...shown.current, retrying: false }
        removedLine.current = [STARTED_AGAIN]
        setTimeout(() => heldNow.current?.restart(), 0)
      },
    }),
    [applySelection, fit, sizeOnce, sizeAdded],
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
  useEffect(() => {
    if (sort !== told.current) showSort()
  }, [sort, showSort])
  useEffect(() => {
    // The parent changed: its line has spoken, and this one waits for the answer.
    if (quiet) shown.current.quiet = true
  }, [quiet, parent?.record])
  useEffect(() => applySelection(), [openToken, applySelection])
  // After the parent's line is quieted above: a new list's first page is asked here, and its line is the quiet one.
  // A page AG Grid was not moved to: the wait is over, and the line says what it said before the ask.
  const held = useHeldRows(api, datasource, () => {
    api.current?.setGridAriaProperty('busy', null)
    if (beforeAsk.current !== null) setStatus(beforeAsk.current)
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
      say(line) {
        setStatus({ kind: 'answer', text: line, help: null, clear: false, retry: false, said: null })
      },
      removed(line) {
        removedLine.current = line
        if (heldNow.current?.reload() !== true) api.current?.purgeInfiniteCache()
      },
    }),
    [],
  )

  // A row's Delete reads the page's handler when pressed: the column is made once per noun.
  const removeNoun = props.remove?.noun
  // A box under each header the section's filter line may name (0132), the keys as one string so the columns are made again only when they change.
  const headerFilters = useContext(HeaderFilterContext)
  const headersNow = useRef(headerFilters)
  headersNow.current = headerFilters
  /** Where `=` kept a cell's value (0133): the keyboard goes back to that row and column once the list it asked for answers. */
  const exampleAt = useRef<{ record: string | null; colId: string } | null>(null)
  // The grid described by the filter line's hint, which says `=`, where there is a line to say it.
  const describedBy = headerFilters !== null && headerFilters.fields.length > 0 ? (headerFilters.hint ?? null) : null
  useEffect(() => {
    const grid = api.current
    if (grid !== null && !grid.isDestroyed()) grid.setGridAriaProperty('describedby', describedBy)
  }, [describedBy])
  const boxedKeys = (headerFilters?.fields ?? []).map((field) => field.field).join('\n')
  const columnDefs = useMemo(
    () =>
      columnDefsOf(
        arranged,
        removeNoun === undefined ? undefined : { noun: removeNoun, press: (row) => latest.current.remove?.press(row) },
        new Set(boxedKeys === '' ? [] : boxedKeys.split('\n')),
      ),
    [arranged, removeNoun, boxedKeys],
  )

  // The header's height changes after the well is fitted -- its row of
  // boxes laid out (0132), a label wrapping -- and a well fitted to the
  // header as it was leaves less than a row under it: fitted again each time.
  useEffect(() => {
    const header = well.current?.querySelector('.ag-header')
    if (header === null || header === undefined || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => fit())
    observer.observe(header)
    return () => observer.disconnect()
  }, [fit, boxedKeys])

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
            const headers = headersNow.current
            if (headers !== null && headers.fields.length > 0 && headers.hint !== undefined) ready.setGridAriaProperty('describedby', headers.hint)
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
            if (row.record === null) setStatus({ kind: 'refused', text: [CANNOT_OPEN], help: null, clear: false, retry: false, said: null })
            else latest.current.onOpen(row.record, how, { rowIndex: rowIndex ?? 0, colId })
          },
          drilling: () => latest.current.drilling === true,
          example: (row, colId) => {
            if (filterByExample(headersNow.current, row, colId)) {
              exampleAt.current = { record: row?.record ?? null, colId }
              return
            }
            const label = latest.current.columns.find((column) => column.key === colId)?.label ?? colId
            setStatus({
              kind: 'answer',
              text: [`= keeps no value of ${label}: the filter cannot say one.`],
              help: null,
              clear: false,
              retry: false,
              said: null,
            })
          },
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
          waits={held.standing}
          asking={shown.current.retrying}
          retryRef={retryButton}
          onClear={onClearSearch}
          onRetry={() => {
            if (shown.current.retrying) return
            shown.current.retrying = true
            setStatus((before) => ({ ...before, retry: true }))
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
      {/* Dimmed by the room's stylesheet while a page is asked for: the rows on screen stay (0146). */}
      <div className={`grid-bench ${bench}`} ref={well} data-waiting={status.kind === 'loading' ? '' : undefined} onPointerDown={() => held.press(true)}>
        <AgGridReact<GridRow> gridOptions={options} columnDefs={columnDefs} datasource={held.source} />
      </div>
      {after}
    </>
  )
})
