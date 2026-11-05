import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { ListFilterTerm, StateMoves } from '@formancy/data-client'
import { FilterChips } from './filter-chips.js'
import { FilterLine } from './filter-line.js'
import { FilterPanel } from './filter-panel.js'
import { lineFields } from './filter-terms.js'
import type { PanelField } from './filter-terms.js'

/*
 * A grid's filter, seen three ways that are one filter: the line a person
 * types it in, the chips that say each condition in words, and the panel
 * that builds one condition from menus. Each changes the one filter the
 * section lists by, and each shows it whatever changed it. One per grid,
 * in its toolbar, on a row of its own.
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
  const offered = fields.filter((field) => field.offered)
  return (
    <div className="filter-block">
      {line.length === 0 ? null : (
        <FilterLine idBase={`${idBase}-line`} fields={line} filter={filter} onFilter={onFilter} slash={slash} {...(onLeave === undefined ? {} : { onLeave })} />
      )}
      <FilterChips idBase={idBase} fields={fields} filter={filter} onFilter={onFilter} empty={empty} />
      {offered.length === 0 ? null : <FilterPanel idBase={idBase} fields={offered} filter={filter} onFilter={onFilter} />}
    </div>
  )
}
