import type { ListFilterTerm, ListSortTerm, ListView, PublishedForm } from '@formancy/data-client'
import type { GridColumn } from './grid-datasource.js'
import { openingView, viewFiltering, viewMatching } from './views.js'

/*
 * A grid's columns as a person arranges them, and what one viewer's browser
 * keeps of a grid (0106), as data: the columns' order and which are shown,
 * and the list the grid shows. columns-panel.tsx is where a person changes
 * the columns, use-grid-state.ts where a section holds them and keeps them,
 * and record-grid.tsx where the grid draws them.
 *
 * A hidden column is hidden, never removed: the grid keeps it, with its
 * sort, so a view or a kept sort on a column nobody sees is still one the
 * grid's headers hold, and its datasource still asks for it
 * (grid-datasource.ts).
 *
 * What is kept is one value per form and kind of section, and never a
 * condition of a filter -- a value typed into one is the person's, and no
 * typed value is written to storage (0104): the list is kept as the view it
 * is, by name, or else as its sort alone.
 */

/** One column of a grid as arranged: a field the person may read, and whether it is shown. */
export interface ColumnChoice {
  field: string
  shown: boolean
}

/** A column the grid draws, in the person's order: the form's column, and whether it is shown. */
export interface ArrangedColumn extends GridColumn {
  shown: boolean
}

/** A grid's columns as the form gives them: every one shown, in the form's order. */
export function defaultChoices(columns: readonly GridColumn[]): ColumnChoice[] {
  return columns.map((column) => ({ field: column.key, shown: true }))
}

/**
 * A choice over the columns the form offers now: those it no longer offers
 * dropped, those it offers since appended, shown, in the form's order. Null
 * when none of the choice's own columns is shown: a grid opened on the
 * columns added since alone is nobody's choice, so the caller takes the
 * defaults.
 */
export function mergeChoices(choices: readonly ColumnChoice[], columns: readonly GridColumn[]): ColumnChoice[] | null {
  const offered = new Set(columns.map((column) => column.key))
  const kept = choices.filter((choice) => offered.has(choice.field))
  if (!kept.some((choice) => choice.shown)) return null
  const named = new Set(kept.map((choice) => choice.field))
  return [...kept, ...columns.filter((column) => !named.has(column.key)).map((column) => ({ field: column.key, shown: true }))]
}

/** The form's columns in the order `choices` gives them, each shown or not: what the grid draws and the panel lists. */
export function arrange(columns: readonly GridColumn[], choices: readonly ColumnChoice[]): ArrangedColumn[] {
  const byKey = new Map(columns.map((column) => [column.key, column]))
  return (mergeChoices(choices, columns) ?? defaultChoices(columns)).flatMap((choice) => {
    const column = byKey.get(choice.field)
    return column === undefined ? [] : [{ ...column, shown: choice.shown }]
  })
}

/** `field` one place up (-1) or down (1); `choices` itself, unchanged, where it is at that end already. */
export function moveChoice(choices: readonly ColumnChoice[], field: string, by: -1 | 1): readonly ColumnChoice[] {
  const at = choices.findIndex((choice) => choice.field === field)
  const to = at + by
  if (at < 0 || to < 0 || to >= choices.length) return choices
  const next = [...choices]
  next[at] = choices[to] as ColumnChoice
  next[to] = choices[at] as ColumnChoice
  return next
}

/** `field` shown or hidden; `choices` itself, unchanged, where hiding it would leave no column shown -- a row is opened through its cells. */
export function showChoice(choices: readonly ColumnChoice[], field: string, shown: boolean): readonly ColumnChoice[] {
  const others = choices.filter((choice) => choice.field !== field && choice.shown)
  if (!shown && others.length === 0) return choices
  return choices.map((choice) => (choice.field === field ? { field, shown } : choice))
}

/**
 * What one viewer's browser keeps of a form's grid in one section: the
 * person's columns, when they arranged them, and the list, when they chose
 * one -- a view by its name, its own sort with it or the person's in its
 * place; or a sort with no view, where `[]` is every record, whatever the
 * form's default view is.
 */
export interface KeptGrid {
  version: 1
  columns?: ColumnChoice[]
  view?: string
  sort?: ListSortTerm[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Exactly these keys, and no other: a key this release does not write is a shape it does not know. */
const only = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key))

const distinct = (fields: readonly string[]): boolean => new Set(fields).size === fields.length

const isChoice = (value: unknown): value is ColumnChoice =>
  isRecord(value) && only(value, ['field', 'shown']) && typeof value['field'] === 'string' && value['field'] !== '' && typeof value['shown'] === 'boolean'

const isSortTerm = (value: unknown): value is ListSortTerm =>
  isRecord(value) &&
  only(value, ['field', 'direction']) &&
  typeof value['field'] === 'string' &&
  value['field'] !== '' &&
  (value['direction'] === 'asc' || value['direction'] === 'desc')

/**
 * The value kept, read: null for anything but exactly `KeptGrid` -- another
 * release's, a hand edit, text that is not JSON, a field named twice --
 * which is then as if nothing were kept, so the grid opens as the form
 * gives it.
 */
export function parseKept(text: string | null): KeptGrid | null {
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value['version'] !== 1 || !only(value, ['version', 'columns', 'view', 'sort'])) return null
  const { columns, view, sort } = value
  if (columns !== undefined && !(Array.isArray(columns) && columns.every(isChoice) && distinct(columns.map((choice) => choice.field)))) return null
  if (view !== undefined && !(typeof view === 'string' && view !== '')) return null
  if (sort !== undefined && !(Array.isArray(sort) && sort.every(isSortTerm) && distinct(sort.map((term) => term.field)))) return null
  return { version: 1, ...(columns === undefined ? {} : { columns }), ...(view === undefined ? {} : { view }), ...(sort === undefined ? {} : { sort }) }
}

/** A section's grid: its columns, its filter and its sort, and whether the columns and the list are the person's own -- kept, so kept again with the next change -- or the form's. */
export interface GridState {
  choices: ColumnChoice[]
  filter: ListFilterTerm[]
  sort: ListSortTerm[]
  columnsKept: boolean
  listKept: boolean
}

/**
 * What a section opens on, from what was kept and what the form offers now
 * (`list`): the kept columns over the form's (`mergeChoices`), or the
 * form's; and the list --
 *
 * - a kept view still offered by that name: its conditions, and its sort or
 *   the kept one;
 * - a kept view no longer offered: the default view (0105), as if nothing
 *   were kept, since the conditions it stood for are gone;
 * - a kept sort with no view: no conditions, and the sort;
 * - nothing kept: the default view.
 *
 * A kept sort keeps only its terms still in `list.sortable`, without a
 * word: what is left of the order the person chose, never the default
 * view's in its place. One opening, so the grid asks one first page.
 */
export function openGrid(kept: KeptGrid | null, columns: readonly GridColumn[], list: PublishedForm['list']): GridState {
  const merged = kept?.columns === undefined ? null : mergeChoices(kept.columns, columns)
  const arranged = merged === null ? { choices: defaultChoices(columns), columnsKept: false } : { choices: merged, columnsKept: true }
  const sortable = new Set(list?.sortable ?? [])
  const sort = kept?.sort?.filter((term) => sortable.has(term.field))
  const views = list?.views ?? []
  const named = kept?.view === undefined ? undefined : views.find((view) => view.name === kept.view)
  if (named !== undefined) return { ...arranged, filter: named.filter, sort: sort ?? named.sort, listKept: true }
  if (kept?.view === undefined && sort !== undefined) return { ...arranged, filter: [], sort, listKept: true }
  const opening = openingView(views)
  return { ...arranged, filter: opening?.filter ?? [], sort: opening?.sort ?? [], listKept: false }
}

/**
 * What is kept of a section's list in `state`: the view its filter and
 * sort are, by name; a view's conditions sorted another way, as the view's
 * name and the sort -- its conditions are the administrator's, not typed;
 * otherwise the sort alone, whether the filter is empty or the person's own
 * conditions, which are not kept (0104).
 */
function listOf(state: GridState, views: readonly ListView[]): Pick<KeptGrid, 'view' | 'sort'> {
  const sort = state.sort.map(({ field, direction }) => ({ field, direction }))
  const view = viewMatching(views, state.filter, state.sort)
  if (view !== null) return { view: view.name }
  const conditions = viewFiltering(views, state.filter)
  return conditions === null ? { sort } : { view: conditions.name, sort }
}

/**
 * What is kept of a section's grid in `state`, or null for nothing: its
 * columns when they are the person's, and its list when that is
 * (`listOf`).
 */
export function keptOf(state: GridState, views: readonly ListView[]): KeptGrid | null {
  if (!state.columnsKept && !state.listKept) return null
  const columns = state.columnsKept ? { columns: state.choices.map(({ field, shown }) => ({ field, shown })) } : {}
  return { version: 1, ...columns, ...(state.listKept ? listOf(state, views) : {}) }
}

/**
 * What to write when a section changes one part of its grid -- its
 * `columns` or its `list` -- over what is `stored` under its key: that part
 * as the section has it now (`ours`), the other as stored. A section reads
 * storage only when it opens, so another on screen under the same key --
 * a form that is its own child, at two levels of Drill down -- may have
 * kept the other part since, and a change of columns here must not undo a
 * view picked there. Null when neither part is left.
 */
export function withKept(stored: KeptGrid | null, ours: KeptGrid | null, changed: 'columns' | 'list'): KeptGrid | null {
  const columns = (changed === 'columns' ? ours : stored)?.columns
  const { view, sort } = (changed === 'list' ? ours : stored) ?? {}
  if (columns === undefined && view === undefined && sort === undefined) return null
  return { version: 1, ...(columns === undefined ? {} : { columns }), ...(view === undefined ? {} : { view }), ...(sort === undefined ? {} : { sort }) }
}
