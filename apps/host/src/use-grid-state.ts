import { useMemo, useRef, useState } from 'react'
import type { ListFilterTerm, ListSortTerm, PublishedForm } from '@formancy/data-client'
import { defaultChoices, keptOf, openGrid, parseKept, widthsAfter, withKept } from './columns.js'
import type { ColumnChoice, GridState, KeptPart } from './columns.js'
import type { GridColumn } from './grid-datasource.js'
import { browserStorage, gridKey, readPreference, removePreference, writePreference } from './prefs.js'
import type { GridSection } from './prefs.js'
import type { ColumnWidth, WidthChange } from './widths.js'

/*
 * A section's grid as the section holds it (0104, 0105, 0106): the filter
 * its panel applied, the sort its view or its headers gave it, its columns
 * as the person arranged them, and the widths they set, by a header's edge
 * or the Columns panel (0151). The Records panel holds one, and every child
 * section its own.
 *
 * It opens on what this browser kept for the form and the section
 * (columns.ts's `openGrid`), and every change is kept as it is made --
 * columns, widths, filter or sort, through prefs.ts's wrapped calls, so a browser
 * that keeps nothing changes nothing here -- the part changed written over
 * what is stored, the other left as it is (`withKept`). Kept in the change itself, not
 * after a render: an opening writes nothing, and a list nobody chose is
 * never kept, so a form's default view stays the form's.
 */

/** A section's grid, and how the section changes it. */
export interface SectionGrid {
  filter: ListFilterTerm[]
  sort: ListSortTerm[]
  choices: ColumnChoice[]
  /** The widths the person set; a column with none is sized to its content. */
  widths: ColumnWidth[]
  /** The filter applied, by its line, a chip, a header's box or a cell (0131-0133). */
  setFilter: (filter: ListFilterTerm[]) => void
  /** A header sorted by the person. */
  setSort: (sort: ListSortTerm[]) => void
  /** A view shown, or "All records": its filter and its sort together, so the grid asks one first page. */
  pick: (filter: ListFilterTerm[], sort: ListSortTerm[]) => void
  /** A column shown, hidden or moved. */
  setChoices: (choices: ColumnChoice[]) => void
  /** A column's width set by a header's edge or the panel, or taken away by Fit (0151). */
  setWidths: (changes: readonly WidthChange[]) => void
  /** The form's order, every column shown and sized to its content, and no columns or widths kept any more; a list kept stays kept. */
  resetChoices: () => void
}

export function useGridState({
  formId,
  section,
  columns,
  list,
}: {
  formId: string
  section: GridSection
  columns: readonly GridColumn[]
  list: PublishedForm['list']
}): SectionGrid {
  const storage = useMemo(browserStorage, [])
  const key = gridKey(section, formId)
  const [state, setState] = useState<GridState>(() => openGrid(parseKept(readPreference(storage, key)), columns, list))
  // What the last change left, so the next builds on it before React has
  // drawn it: AG Grid tells a header's sort a task late (record-grid.tsx),
  // and a change made in between is kept with it, not lost.
  const now = useRef(state)

  // Only the part changed is written over what is stored: another section
  // under this key may have kept the other part since this one opened.
  const change = (patch: Partial<GridState>, ...parts: KeptPart[]): void => {
    const next = { ...now.current, ...patch }
    now.current = next
    const kept = withKept(parseKept(readPreference(storage, key)), keptOf(next, list?.views ?? []), ...parts)
    if (kept === null) removePreference(storage, key)
    else writePreference(storage, key, JSON.stringify(kept))
    setState(next)
  }

  return {
    filter: state.filter,
    sort: state.sort,
    choices: state.choices,
    widths: state.widths,
    setFilter: (filter) => change({ filter, listKept: true }, 'list'),
    setSort: (sort) => change({ sort, listKept: true }, 'list'),
    pick: (filter, sort) => change({ filter, sort, listKept: true }, 'list'),
    setChoices: (choices) => change({ choices, columnsKept: true }, 'columns'),
    // Over the widths stored, not this section's own: another under the key may have set one since (`widthsAfter`).
    setWidths: (changes) => change({ widths: widthsAfter(parseKept(readPreference(storage, key)), now.current.widths, columns, changes) }, 'widths'),
    resetChoices: () => change({ choices: defaultChoices(columns), columnsKept: false, widths: [] }, 'columns', 'widths'),
  }
}
