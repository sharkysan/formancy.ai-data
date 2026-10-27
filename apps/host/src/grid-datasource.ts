import type { IDatasource, IGetRowsParams, SortModelItem } from 'ag-grid-community'
import type { DataClient, FormRecord, ListSortTerm, PublishedForm, RecordListQuery } from '@formancy/data-client'

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

/** The readable fields of `definition`, in the form's order, without the parent's field in a child grid. */
export function columnsOf(definition: PublishedForm, parentField: string | null): GridColumn[] {
  const readable = new Set(definition.readable)
  const sortable = new Set(definition.list?.sortable ?? [])
  return definition.form.model.fields
    .filter((field) => readable.has(field.key) && field.key !== parentField)
    .map((field) => {
      const source = (field as { optionsSource?: unknown }).optionsSource
      return { key: field.key, label: String(field.label ?? field.key), sortable: sortable.has(field.key), source: typeof source === 'string' ? source : null }
    })
}

/** The list request for one block: the submitted search, the grid's sort, the parent, and the block as offset and limit. */
export function listQuery({
  search,
  sortModel,
  parent,
  startRow,
  endRow,
}: {
  search: string
  sortModel: readonly SortModelItem[]
  parent: RecordListQuery['parent']
  startRow: number
  endRow: number
}): RecordListQuery {
  return {
    search,
    sort: sortModel.map((item) => ({ field: item.colId, direction: item.sort })),
    parent,
    filter: [],
    offset: startRow,
    limit: endRow - startRow,
  }
}

/** A page's records as grid rows, each with an id; labels are filled in afterwards. */
export function rowsOf(records: readonly FormRecord[], start: number): GridRow[] {
  return records.map((row, index) => ({ id: row.record ?? `row-${String(start + index)}`, record: row.record, version: row.version, answers: row.answers, labels: {} }))
}

/** What a cell shows: a lookup's label where the server gave one, otherwise the answer as the form holds it. */
export function cellText(row: GridRow | undefined, column: GridColumn): string {
  if (row === undefined) return ''
  const label = row.labels[column.key]
  if (label !== undefined) return label
  const value = row.answers[column.key]
  return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const range = (from: number, to: number): string => `${String(from)}–${String(to)}`

/** What the line says while a block is asked for. */
export function loading(start: number, size: number, noun?: string): string {
  return noun === undefined ? `Loading rows ${range(start + 1, start + size)}.` : `Loading ${noun} rows ${range(start + 1, start + size)}.`
}

/** What the line says once a block has answered: the range, whether more follow, and the help and recovery that belong to it. */
export function answered({
  start,
  count,
  hasMore,
  search,
  untokened,
  canCreate,
  noun,
}: {
  start: number
  count: number
  hasMore: boolean
  search: string
  untokened: number
  canCreate: boolean
  noun?: string
}): { text: string; help: string | null; clear: boolean } {
  if (count === 0 && start === 0) {
    const searched = search.trim()
    if (searched !== '') return { text: `No records match “${searched}”.`, help: null, clear: true }
    if (noun !== undefined) return { text: `No ${noun} rows.`, help: canCreate ? `New ${noun} starts the first one.` : null, clear: false }
    return { text: 'No records.', help: canCreate ? 'New record starts the first one.' : null, clear: false }
  }
  const shown = noun === undefined ? `Rows ${range(start + 1, start + count)}` : `${noun} rows ${range(start + 1, start + count)}`
  const tail = untokened > 0 ? ` ${String(untokened)} of these rows cannot be opened.` : ''
  return { text: `${shown}${hasMore ? '; more follow.' : '.'}${tail}`, help: null, clear: false }
}

/** What the datasource tells the grid component as it goes. */
export interface DatasourceHooks {
  /** A block asked for, in this order: the grid keeps the sort, which a file of its records is sorted by (0080). */
  loading(start: number, end: number, sort: ListSortTerm[]): void
  answered(start: number, rows: readonly GridRow[], hasMore: boolean): void
  refused(message: string): void
}

/**
 * The infinite row model's datasource over `records/list` for one search and
 * one parent: a new one is made when either changes, and AG Grid starts
 * again from the first page. One request at a time, the grid's own
 * `maxConcurrentDatasourceRequests`; a block AG Grid no longer wants is
 * answered as failed and says nothing.
 */
export function createDatasource({
  client,
  formId,
  columns,
  search,
  parent,
  hooks,
}: {
  client: DataClient
  formId: string
  columns: readonly GridColumn[]
  search: string
  parent: RecordListQuery['parent']
  hooks: DatasourceHooks
}): IDatasource & { abort(): void } {
  let current: AbortController | undefined
  const lookups = columns.filter((column) => column.source !== null)

  async function rowsFor(params: IGetRowsParams, query: RecordListQuery, signal: AbortSignal): Promise<{ rows: GridRow[]; hasMore: boolean } | string> {
    const listed = await client.list(formId, query, signal)
    if (!listed.ok) return listed.message
    const rows = rowsOf(listed.value.rows, params.startRow)
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
    return { rows, hasMore: listed.value.hasMore }
  }

  return {
    getRows(params) {
      current?.abort()
      const controller = new AbortController()
      current = controller
      const query = listQuery({ search, sortModel: params.sortModel, parent, startRow: params.startRow, endRow: params.endRow })
      hooks.loading(params.startRow, params.endRow, query.sort)
      rowsFor(params, query, controller.signal).then(
        (answer) => {
          if (controller.signal.aborted) return params.failCallback()
          if (typeof answer === 'string') {
            params.failCallback()
            hooks.refused(answer)
            return
          }
          params.successCallback(answer.rows, answer.hasMore ? undefined : params.startRow + answer.rows.length)
          hooks.answered(params.startRow, answer.rows, answer.hasMore)
        },
        () => params.failCallback(),
      )
    },
    abort() {
      current?.abort()
    },
  }
}
