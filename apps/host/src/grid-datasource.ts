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
 * recovery is the condition, which the panel still holds as typed.
 */
export const REFUSED_FILTER_HELP = 'Change the condition under Filter and apply it again, or remove it.'

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

/** What the datasource tells the grid component as it goes. */
export interface DatasourceHooks {
  /** A block asked for. */
  loading(start: number, end: number): void
  /** A block answered, for the filter it was asked with: the line names the fields that filter is on. */
  answered(start: number, rows: readonly GridRow[], hasMore: boolean, filter: readonly ListFilterTerm[]): void
  /** A block refused, in the server's sentence, and its code: a filter the server cannot apply is not one to ask for again (0104). */
  refused(message: string, code: string): void
  /** A block with nowhere to start: the row it comes after is gone (0108), and the first page is where the list starts again. */
  restart(): void
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
 * A block AG Grid asks for under another order than this list's is
 * answered as failed too, and asks the server nothing: the grid's headers
 * have not caught up with the section's sort yet (record-grid.tsx), or a
 * press on one has not reached the section, whose new list then asks. The
 * block asked for once they agree is the one that is sent, so a view
 * picked -- a new filter and a new sort at once -- is one first page, never
 * one in the old order first.
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
  client: DataClient
  formId: string
  columns: readonly GridColumn[]
  search: string
  parent: RecordListQuery['parent']
  filter: readonly ListFilterTerm[]
  sort: readonly ListSortTerm[]
  hooks: DatasourceHooks
}): IDatasource & { abort(): void } {
  let current: AbortController | undefined
  const lookups = columns.filter((column) => column.source !== null)
  /** The cursor each block is asked for after, by the row it starts at. */
  const cursors = new Map<number, string | null>([[0, null]])

  async function rowsFor(
    params: IGetRowsParams,
    query: RecordListQuery,
    signal: AbortSignal,
  ): Promise<{ rows: GridRow[]; hasMore: boolean; next: string | null } | { refused: string; code: string }> {
    const page = await client.list(formId, query, signal)
    if (!page.ok) return { refused: page.message, code: page.code }
    const rows = rowsOf(page.value.rows, params.startRow)
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

  return {
    getRows(params) {
      current?.abort()
      if (!sameSort(sortOfModel(params.sortModel), sort)) {
        params.failCallback()
        return
      }
      const after = cursors.get(params.startRow)
      if (after === undefined) {
        params.failCallback()
        hooks.restart()
        return
      }
      const controller = new AbortController()
      current = controller
      const query = listQuery({ search, sort, parent, filter, after, size: params.endRow - params.startRow })
      hooks.loading(params.startRow, params.endRow)
      rowsFor(params, query, controller.signal).then(
        (answer) => {
          if (controller.signal.aborted) return params.failCallback()
          if ('refused' in answer) {
            params.failCallback()
            if (answer.code === 'cursor-gone') hooks.restart()
            else hooks.refused(answer.refused, answer.code)
            return
          }
          if (answer.next !== null) cursors.set(params.startRow + answer.rows.length, answer.next)
          params.successCallback(answer.rows, answer.hasMore ? undefined : params.startRow + answer.rows.length)
          hooks.answered(params.startRow, answer.rows, answer.hasMore, filter)
        },
        () => params.failCallback(),
      )
    },
    abort() {
      current?.abort()
    },
  }
}
