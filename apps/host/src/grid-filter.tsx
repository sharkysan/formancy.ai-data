import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { ListFilterTerm, StateMoves } from '@formancy/data-client'
import { FilterChips, useUndo } from './filter-chips.js'
import { FilterLine } from './filter-line.js'
import { lineFields } from './filter-terms.js'
import type { PanelField } from './filter-terms.js'

/*
 * A grid's filter in its toolbar: the line a person types it in and the
 * chips that say each condition in words, which with the boxes under the
 * grid's headers (0132) are one filter seen three ways. Each changes the
 * one filter the section lists by, and each shows it whatever changed it.
 * One per grid, on a row of its own. The panel that built one condition
 * from menus is retired (0134).
 */

export function GridFilter({
  idBase,
  fields,
  moves,
  filter,
  onFilter,
  empty,
  slash = false,
  onLeave,
}: {
  idBase: string
  /** The fields the list is filtered by (`panelFields`), offered or not. */
  fields: readonly PanelField[]
  /** The form's state field and its states' labels, which the line offers as values. */
  moves: StateMoves | null
  filter: readonly ListFilterTerm[]
  onFilter: (next: ListFilterTerm[]) => void
  /** Whether the grid's first page under this filter came back with no rows. */
  empty: boolean
  /** Whether `/` puts the keyboard on this grid's line: the Records grid's. */
  slash?: boolean
  /** Where the keyboard goes when Esc leaves the line. */
  onLeave?: () => void
}): ReactElement {
  const line = useMemo(() => lineFields(fields, moves), [fields, moves])
  const undoing = useUndo(filter, onFilter)
  return (
    <div className="filter-block">
      {line.length === 0 ? null : (
        <FilterLine
          idBase={`${idBase}-line`}
          fields={line}
          filter={filter}
          onFilter={onFilter}
          onClear={() => undoing.removing([], 'clearing the filter')}
          slash={slash}
          {...(onLeave === undefined ? {} : { onLeave })}
        />
      )}
      <FilterChips idBase={idBase} fields={fields} filter={filter} undoing={undoing} empty={empty} />
    </div>
  )
}
