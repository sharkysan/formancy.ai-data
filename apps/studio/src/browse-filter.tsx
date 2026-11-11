import type { ReactElement } from 'react'
import type { BrowseFilterTerm, LineField } from '@formancy/data-core'
import { FilterChips, useUndo } from './browse-chips.js'
import { FilterLine } from './browse-line.js'
import { asBrowse, asLine } from './browse-terms.js'
import type { FilterChange, Filterable } from './browse-terms.js'

/**
 * The line and the chips above the table, sharing the page's Undo, which a
 * chip removed, Clear the filter and a line emptied each offer. Mounted
 * afresh for every page a move reaches, so an Undo, or an edit left in the
 * line, belongs to the page it was made on.
 */
export function BrowseFilter({
  columns,
  fields,
  filter,
  onFilter,
  onLeave,
}: {
  columns: readonly Filterable[]
  /** What the line may name: `lineFields` of `columns`. */
  fields: readonly LineField[]
  filter: readonly BrowseFilterTerm[]
  onFilter: FilterChange
  /** Where the keyboard goes when Esc leaves the line: the table. */
  onLeave: () => void
}): ReactElement {
  const undoing = useUndo(filter, onFilter)
  return (
    <div className="browse-filter">
      {fields.length === 0 ? null : (
        <FilterLine
          fields={fields}
          filter={asLine(filter)}
          // What the line reads in place of every condition on a column it names, on the filter as it will stand.
          onFilter={(read, arrived) =>
            void onFilter((base) => [...base.filter((term) => !fields.some((field) => field.field === term.column)), ...asBrowse(read)], { arrived })
          }
          onClear={(arrived) => undoing.removing(() => [], 'clearing the filter', null, arrived)}
          onLeave={onLeave}
        />
      )}
      <FilterChips columns={columns} filter={filter} undoing={undoing} />
    </div>
  )
}
