import { useMemo, useRef, useState } from 'react'
import type { ListFilterTerm, ListSortTerm, PublishedForm } from '@formancy/data-client'
import { defaultChoices, keptOf, openGrid, parseKept } from './columns.js'
import type { ColumnChoice, GridState } from './columns.js'
import type { GridColumn } from './grid-datasource.js'
import { browserStorage, gridKey, readPreference, removePreference, writePreference } from './prefs.js'
import type { GridSection } from './prefs.js'

/*
 * A section's grid as the section holds it (0104, 0105, 0106): the filter
 * its panel applied, the sort its view or its headers gave it, and its
 * columns as the person arranged them. The Records panel holds one, and
 * every child section its own.
 *
 * It opens on what this browser kept for the form and the kind of section
 * (columns.ts's `openGrid`), and every change is kept as it is made --
 * columns, filter or sort, through prefs.ts's wrapped calls, so a browser
 * that keeps nothing changes nothing here. Kept in the change itself, not
 * after a render: an opening writes nothing, and a list nobody chose is
 * never kept, so a form's default view stays the form's.
 */

/** A section's grid, and how the section changes it. */
export interface SectionGrid {
  filter: ListFilterTerm[]
  sort: ListSortTerm[]
  choices: ColumnChoice[]
  /** The filter applied, by the filter panel. */
  setFilter(filter: ListFilterTerm[]): void
  /** A header sorted by the person. */
  setSort(sort: ListSortTerm[]): void
  /** A view shown, or "All records": its filter and its sort together, so the grid asks one first page. */
  pick(filter: ListFilterTerm[], sort: ListSortTerm[]): void
  /** A column shown, hidden or moved. */
  setChoices(choices: ColumnChoice[]): void
  /** The form's order, every column shown, and no columns kept any more; a list kept stays kept. */
  resetChoices(): void
}

export function useGridState({ formId, section, columns, list }: { formId: string; section: GridSection; columns: readonly GridColumn[]; list: PublishedForm['list'] }): SectionGrid {
  const storage = useMemo(browserStorage, [])
  const key = gridKey(section, formId)
  const [state, setState] = useState<GridState>(() => openGrid(parseKept(readPreference(storage, key)), columns, list))
  // What the last change left, so the next builds on it before React has
  // drawn it: AG Grid tells a header's sort a task late (record-grid.tsx),
  // and a change made in between is kept with it, not lost.
  const now = useRef(state)

  const change = (patch: Partial<GridState>): void => {
    const next = { ...now.current, ...patch }
    now.current = next
    const kept = keptOf(next, list?.views ?? [])
    if (kept === null) removePreference(storage, key)
    else writePreference(storage, key, JSON.stringify(kept))
    setState(next)
  }

  return {
    filter: state.filter,
    sort: state.sort,
    choices: state.choices,
    setFilter: (filter) => change({ filter, listKept: true }),
    setSort: (sort) => change({ sort, listKept: true }),
    pick: (filter, sort) => change({ filter, sort, listKept: true }),
    setChoices: (choices) => change({ choices, columnsKept: true }),
    resetChoices: () => change({ choices: defaultChoices(columns), columnsKept: false }),
  }
}
