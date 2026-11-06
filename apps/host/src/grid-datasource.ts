import type { IDatasource, IGetRowsParams, SortModelItem } from 'ag-grid-community'
import type { DataClient, FormRecord, ListFilterTerm, ListSortTerm, PublishedForm, RecordListQuery } from '@formancy/data-client'
import { sameSort } from './views.js'
import { fieldHeading } from '@formancy/data-client'

/*
 * What a record grid asks the runtime plane for, and what it says about the
 * answer (0044, 0047). AG Grid Community's infinite row model asks for rows
 * `startRow` to `endRow` with its sort model; that becomes one
 * `records/list` request -- a POST, so the search is in no URL -- and one
 * `lookups/:source/resolve` per lookup column on the page, so a lookup's
 * cell shows its label. The status line's sentences are derived from the
 * page's numbers, never typed per state.
 *
 * AG Grid's own words never reach the person: its overlays are off and its
 * loading cells are empty (grid-options.tsx), and the status line speaks.
 */

/** One column of a record grid: a field the person may read. */
export interface GridColumn {
  key: string
  label: string
  sortable: boolean
  /** The lookup's option source when the field is a lookup, whose cells show labels. */
  source: string | null
}

/** One row as a grid holds it: the record, its id in the grid, and the labels of its lookup answers. */
export interface GridRow {
  /** The record's token, or `row-<n>` for a row whose key does not fit a token: never null, so AG Grid can find it. */
  id: string
  record: string | null
  version: string | null
  answers: Readonly<Record<string, unknown>>
  labels: Readonly<Record<string, string>>
}

/** What a press on a row with no token says. */
export const CANNOT_OPEN = 'This row cannot be opened: its key does not fit in a record token.'

/**
 * What the line adds under the server's sentence when it refuses a filter
 * (`not-filterable`, 0104): asking again would be refused again, so the
 * recovery is the condition, which its chip and its box still hold.
 */
export const REFUSED_FILTER_HELP = 'Change the condition in Filter and press Enter, or remove it.'

/**
 * What the line adds when a new list -- a search, a filter, a view, a sort
 * -- is refused and the last list's rows stay on screen (0146): Previous
 * rows and Next rows wait for the list asked for, which they would not page.
 */
export const STANDING_HELP = 'The rows shown are the list before this one. Previous rows and Next rows wait until Ask again lists it.'

/** The readable fields of `definition`, in the form's order, without the parent's field in a child grid. */
export function columnsOf(definition: PublishedForm, parentField: string | null): GridColumn[] {
  const readable = new Set(definition.readable)
  const sortable = new Set(definition.list?.sortable ?? [])
  return definition.form.model.fields
    .filter((field) => readable.has(field.key) && field.key !== parentField)
    .map((field) => {
      const source = (field as { optionsSource?: unknown }).optionsSource
      return { key: field.key, label: fieldHeading(field), sortable: sortable.has(field.key), source: typeof source === 'string' ? source : null }
    })
}

/** AG Grid's sort model as a list request's sort: its columns in their order, each one way. */
export function sortOfModel(sortModel: readonly SortModelItem[]): ListSortTerm[] {
  return sortModel.map((item) => ({ field: item.colId, direction: item.sort }))
}

/** The list request for one block: the submitted search, the section's sort (0105), the parent, the applied filter (0104), and the block as the cursor it continues after and its size (0108). */
export function listQuery({
  search,
  sort,
  parent,
  filter,
  after,
  size,
}: {
  search: string
  sort: readonly ListSortTerm[]
  parent: RecordListQuery['parent']
  filter: readonly ListFilterTerm[]
  after: string | null
  size: number
}): RecordListQuery {
  return {
    search,
    sort: [...sort],
    parent,
    filter: [...filter],
    after,
    limit: size,
  }
}

/** A page's records as grid rows, each with an id; labels are filled in afterwards. */
export function rowsOf(records: readonly FormRecord[], start: number): GridRow[] {
  return records.map((row, index) => ({
    id: row.record ?? `row-${String(start + index)}`,
    record: row.record,
    version: row.version,
    answers: row.answers,
    labels: {},
  }))
}

/** What a cell shows: a lookup's label where the server gave one, otherwise the answer as the form holds it. */
export function cellText(row: GridRow | undefined, column: GridColumn): string {
  if (row === undefined) return ''
  const label = row.labels[column.key]
  if (label !== undefined) return label
  const value = row.answers[column.key]
  return value === null || value === undefined
    ? ''
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
      ? String(value)
      : JSON.stringify(value)
}

const range = (from: number, to: number): string => `${String(from)}–${String(to)}`

/** `['Order number', 'Status', 'Notes']` as "Order number, Status and Notes". */
export function listed(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${String(words.at(-1))}`
}

/** What the line says while a block is asked for. */
export function loading(start: number, size: number, noun?: string): string {
  return noun === undefined ? `Loading rows ${range(start + 1, start + size)}.` : `Loading ${noun} rows ${range(start + 1, start + size)}.`
}

/**
 * What the line says once a block has answered: the range, whether more
 * follow, the fields its filter is on (0104), and the help and recovery that
 * belong to it. A list nothing matches says what narrowed it -- the search,
 * the filter or both -- so "No records." never reads as an empty table when
 * it is an empty search or an empty filter.
 */
export function answered({
  start,
  count,
  hasMore,
  search,
  filtered = [],
  untokened,
  canCreate,
  noun,
}: {
  start: number
  count: number
  hasMore: boolean
  search: string
  /** The labels of the fields the block's filter has a condition on, in its order. */
  filtered?: readonly string[]
  untokened: number
  canCreate: boolean
  noun?: string
}): { text: string; help: string | null; clear: boolean } {
  const filter = filtered.length === 0 ? null : `the filter on ${listed(filtered)}`
  if (count === 0 && start === 0) {
    const searched = search.trim()
    const rows = noun === undefined ? 'records' : `${noun} rows`
    if (searched !== '') return { text: `No ${rows} match “${searched}”${filter === null ? '' : ` and ${filter}`}.`, help: null, clear: true }
    if (filter !== null) return { text: `No ${rows} match ${filter}.`, help: null, clear: false }
    if (noun !== undefined) return { text: `No ${noun} rows.`, help: canCreate ? `New ${noun} starts the first one.` : null, clear: false }
    return { text: 'No records.', help: canCreate ? 'New record starts the first one.' : null, clear: false }
  }
  const shown = noun === undefined ? `Rows ${range(start + 1, start + count)}` : `${noun} rows ${range(start + 1, start + count)}`
  const narrowed = filtered.length === 0 ? '' : ` Filtered by ${listed(filtered)}.`
  const tail = untokened > 0 ? ` ${String(untokened)} of these rows cannot be opened.` : ''
  return { text: `${shown}${hasMore ? '; more follow.' : '.'}${narrowed}${tail}`, help: null, clear: false }
}

/** What the line says before the first page, once a page had nowhere to start (0108). */
export const STARTED_AGAIN = 'The record those rows came after is gone, so the list starts again at its first page.'

/**
 * What the datasource tells the grid component as it goes, each with the
 * list it comes from: the list shown and a list asked for share these, and
 * the grid hears only those two (use-held-rows.ts, 0146).
 */
export interface DatasourceHooks {
  /** A block asked for; `ahead`, asked before the grid is shown it, while the rows on screen stay (0146). */
  loading(start: number, end: number, ahead: boolean, from: GridSource): void
  /** A block answered, for the filter it was asked with: the line names the fields that filter is on. */
  answered(start: number, rows: readonly GridRow[], hasMore: boolean, filter: readonly ListFilterTerm[], from: GridSource): void
  /** A block refused, in the server's sentence, and its code: a filter the server cannot apply is not one to ask for again (0104). `ahead` as `loading` has it. */
  refused(message: string, code: string, ahead: boolean, from: GridSource): void
  /** A block with nowhere to start: the row it comes after is gone (0108), and the first page is where the list starts again. */
  restart(from: GridSource): void
}

/** What a datasource asks the runtime plane: a page of records, and the labels of a page's lookups. */
export type ListClient = Pick<DataClient, 'list' | 'resolve'>

/** How a page asked first ended: kept for the grid, refused and said, or dropped -- abandoned for a newer ask, or nowhere to start. */
export type AskedFirst = 'ready' | 'refused' | 'dropped'

/** A grid's datasource: AG Grid's, with the page's own two calls. */
export interface GridSource extends IDatasource {
  /**
   * The block from `start` asked for before AG Grid is shown it (0146): the
   * rows on screen stay while it is asked, and AG Grid, asking for that
   * block next, is answered from what came, asking nothing again.
   */
  askFirst(start: number, end: number): Promise<AskedFirst>
  /** What was asked first and not taken dropped: AG Grid was not moved to it, and the block it asks for there later asks the server. */
  drop(): void
  abort(): void
}

/**
 * The infinite row model's datasource over `records/list` for one search,
 * one parent, one filter and one sort: a new one is made when any of them
 * changes, and AG Grid starts again from the first page. Every block carries
 * the same filter, in the request's body, so its values are in no URL
 * (0104), and the same sort, the section's (0105). One request at a time,
 * the grid's own `maxConcurrentDatasourceRequests`; a block AG Grid no
 * longer wants is answered as failed and says nothing.
 *
 * A block is asked for after the row the block before it ended with (0108):
 * each answered block's `next` is kept by the row the block after it
 * starts at, the first block's by row 0 as none, and every answer of a block
 * -- asked again after a save, a delete or Ask again -- keeps it anew.
 * The pager only steps a page at a time, so the block asked for is one
 * whose start an answer gave. A block whose start no answer gave, or whose
 * row the server found gone (`cursor-gone`), has nowhere to start; it is
 * answered as failed and the grid starts again at the first page.
 *
 * A page the person turns to, and the first page of a new list, are asked
 * for first (`askFirst`, 0146), so AG Grid, which draws a block's rows empty
 * until it is answered, is only shown the block once the answer is there:
 * what was asked first answers that block once, and a block asked for again
 * asks the server.
 *
 * A block AG Grid asks for under another order than this list's asks the
 * server nothing: the grid's headers have not caught up with the section's
 * sort yet (record-grid.tsx), or a press on one has not reached the section,
 * whose new list then asks. The block asked for once they agree is the one
 * that is sent, so a view picked -- a new filter and a new sort at once --
 * is one first page, never one in the old order first. Until then it is
 * answered with the rows on screen, which stay, dimmed, while the new list
 * is asked for (0146); with none on screen yet, as failed.
 */
export function createDatasource({
  client,
  formId,
  columns,
  search,
  parent,
  filter,
  sort,
  hooks,
}: {
  client: ListClient
  formId: string
  columns: readonly GridColumn[]
  search: string
  parent: RecordListQuery['parent']
  filter: readonly ListFilterTerm[]
  sort: readonly ListSortTerm[]
  hooks: DatasourceHooks
}): GridSource {
  let current: AbortController | undefined
  const lookups = columns.filter((column) => column.source !== null)
  /** The cursor each block is asked for after, by the row it starts at. */
  const cursors = new Map<number, string | null>([[0, null]])
  /** A block asked first, until AG Grid takes it. */
  let kept: { start: number; rows: GridRow[]; hasMore: boolean } | null = null
  /** The rows the grid was last given, and whether more followed them: on screen, until it is given others. */
  let onScreen: { rows: GridRow[]; more: boolean } | null = null

  async function rowsFor(
    start: number,
    query: RecordListQuery,
    signal: AbortSignal,
  ): Promise<{ rows: GridRow[]; hasMore: boolean; next: string | null } | { refused: string; code: string }> {
    const page = await client.list(formId, query, signal)
    if (!page.ok) return { refused: page.message, code: page.code }
    const rows = rowsOf(page.value.rows, start)
    // One resolve per lookup column for the whole page; a label it does not
    // give is shown as the stored token.
    for (const column of lookups) {
      const tokens = [...new Set(rows.map((row) => row.answers[column.key]).filter((value): value is string => typeof value === 'string' && value !== ''))]
      if (tokens.length === 0) continue
      const named = await client.resolve(formId, column.source as string, { operation: 'read', tokens }, signal)
      if (!named.ok) continue
      const labels = new Map(named.value.map((row) => [row.token, row.label]))
      for (const row of rows) {
        const label = labels.get(String(row.answers[column.key]))
        if (label !== undefined) row.labels = { ...row.labels, [column.key]: label }
      }
    }
    return { rows, hasMore: page.value.hasMore, next: page.value.next }
  }

  /** The block from `start` asked for, after its cursor; `ahead` as the hooks have it. */
  function ask(
    start: number,
    end: number,
    ahead: boolean,
  ): { controller: AbortController; answer: Promise<Awaited<ReturnType<typeof rowsFor>> | 'aborted'> } | null {
    current?.abort()
    const after = cursors.get(start)
    if (after === undefined) return null
    const controller = new AbortController()
    current = controller
    const query = listQuery({ search, sort, parent, filter, after, size: end - start })
    hooks.loading(start, end, ahead, self)
    const answer = rowsFor(start, query, controller.signal).then(
      (answered) => {
        if (controller.signal.aborted) return 'aborted' as const
        if (!('refused' in answered) && answered.next !== null) cursors.set(start + answered.rows.length, answered.next)
        return answered
      },
      () => 'aborted' as const,
    )
    return { controller, answer }
  }

  /** `rows` given to AG Grid for the block from `start`: the last row where no more follow. */
  function give(params: IGetRowsParams, rows: GridRow[], hasMore: boolean): void {
    onScreen = { rows, more: hasMore }
    params.successCallback(rows, hasMore ? undefined : params.startRow + rows.length)
    hooks.answered(params.startRow, rows, hasMore, filter, self)
  }

  const self: GridSource = {
    getRows(params) {
      if (!sameSort(sortOfModel(params.sortModel), sort)) {
        current?.abort()
        // With more after them where they had more: counted as the last, AG Grid would clamp a page turned to back to this one.
        if (onScreen === null) params.failCallback()
        // TEMPORARY B8: a block asked under another order answered with no rows, as before 0146.
        else params.successCallback([], 0)
        return
      }
      const ready = kept
      kept = null
      if (ready !== null && ready.start === params.startRow) {
        give(params, ready.rows, ready.hasMore)
        return
      }
      const asked = ask(params.startRow, params.endRow, false)
      if (asked === null) {
        params.failCallback()
        hooks.restart(self)
        return
      }
      void asked.answer.then((answer) => {
        if (answer === 'aborted') return params.failCallback()
        if ('refused' in answer) {
          params.failCallback()
          if (answer.code === 'cursor-gone') hooks.restart(self)
          else hooks.refused(answer.refused, answer.code, false, self)
          return
        }
        give(params, answer.rows, answer.hasMore)
      })
    },
    async askFirst(start, end) {
      kept = null
      const asked = ask(start, end, true)
      if (asked === null) {
        hooks.restart(self)
        return 'dropped'
      }
      const answer = await asked.answer
      if (answer === 'aborted') return 'dropped'
      if ('refused' in answer) {
        if (answer.code === 'cursor-gone') {
          hooks.restart(self)
          return 'dropped'
        }
        hooks.refused(answer.refused, answer.code, true, self)
        return 'refused'
      }
      kept = { start, rows: answer.rows, hasMore: answer.hasMore }
      return 'ready'
    },
    drop() {
      kept = null
    },
    abort() {
      current?.abort()
    },
  }
  return self
}
