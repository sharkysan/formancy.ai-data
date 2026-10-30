import { useMemo, useState } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import type { DataClient, PublishedForm } from '@formancy/data-client'
import { ColumnsPanel } from './columns-panel.js'
import { DownloadCsv } from './download.js'
import { FilterPanel } from './filter-panel.js'
import { panelFields } from './filter-terms.js'
import { listed } from './grid-datasource.js'
import type { GridColumn } from './grid-datasource.js'
import { RecordGrid } from './record-grid.js'
import type { OpenHow, RecordGridHandle, RowAt, RowDelete } from './record-grid.js'
import type { GridSection } from './prefs.js'
import { RecordTree } from './record-tree.js'
import { Segmented } from './segmented.js'
import { useGridState } from './use-grid-state.js'
import { ViewPicker } from './view-picker.js'

/**
 * The Records panel (UX-SPEC §5.8): its heading, New record when the person
 * may create and Download CSV where the definition says the records can be
 * listed (0080), the search, the filter, and the grid with its pager. A
 * search is submitted with the Search button or Enter, never per keystroke,
 * and the hint names the fields it looks in -- the server's
 * `list.searchable`, by their labels. No search form when nothing is
 * searchable, and no filter panel when nothing is filterable (0104). The
 * View picker before the filter, where the server offers views (0105): the
 * filter and the sort start as the default view's, or empty, and a view
 * picked sets both. Columns between them (0106), where the person orders
 * and hides the grid's columns. The columns, and the list as a view or a
 * sort, are kept in this browser for the form and start the panel the next
 * time it is opened (use-grid-state.ts). A file is of what the grid lists:
 * the search submitted, never what the box holds, the filter applied, and
 * the sort, with every column whatever the grid hides. None of it is
 * written into the address, as no filter is (0104).
 */
/** The Records panel's grid, kept apart from every child section's (0106). */
const RECORDS: GridSection = { kind: 'records' }

export function Records({
  client,
  formId,
  definition,
  columns,
  hidden,
  openToken,
  canCreate,
  gridRef: grid,
  headingRef,
  newRef,
  searchRef,
  search,
  refit,
  onSearch,
  onNew,
  onOpen,
  remove,
  after,
  drilling,
  tree,
  onTreeOpen,
}: {
  client: DataClient
  formId: string
  definition: PublishedForm
  columns: readonly GridColumn[]
  hidden: boolean
  openToken: string | null
  canCreate: boolean
  gridRef: RefObject<RecordGridHandle | null>
  headingRef: RefObject<HTMLHeadingElement | null>
  newRef: RefObject<HTMLButtonElement | null>
  searchRef: RefObject<HTMLInputElement | null>
  search: string
  /** How many times the separator has been let go: the grid's columns fit again each time. */
  refit: number
  onSearch: (search: string) => void
  onNew: () => void
  onOpen: (token: string, how: OpenHow, at: RowAt) => void
  /** Where the form offers delete: each row's Delete (0053). */
  remove: RowDelete | undefined
  /** A row's delete confirmation, in place under the grid. */
  after: ReactNode
  /** Shown in Drill down: the grid's rows say so (0090). */
  drilling: boolean
  /** The lookup field through which the form is its own child, which offers its records as a tree (0110); null for none. */
  tree: string | null
  /** A record opened from the tree; `back` gives the keyboard back to its item. */
  onTreeOpen: (token: string, how: OpenHow, back: () => void) => void
}): ReactElement {
  const [typed, setTyped] = useState(search)
  const [shape, setShape] = useState<'grid' | 'tree'>('grid')
  const views = definition.list?.views ?? []
  /** The filter as applied, the sort and the columns: the grid's, and the file's but for the columns, for this form, which mounts the panel again (form-view.tsx). */
  const state = useGridState({ formId, section: RECORDS, columns, list: definition.list })
  const { filter, sort } = state
  const labels = new Map(columns.map((column) => [column.key, column.label]))
  const searchable = (definition.list?.searchable ?? []).map((key) => labels.get(key) ?? key)
  const filterable = useMemo(() => panelFields(definition), [definition])

  const searchBlock =
    searchable.length === 0 ? null : (
      <div className="search-block">
        <form
          role="search"
          aria-label="Search records"
          className="search"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch(typed.trim())
          }}
        >
          <label htmlFor="search">Search</label>
          <input id="search" type="text" autoComplete="off" spellCheck={false} enterKeyHint="search" aria-describedby="search-hint" ref={searchRef} value={typed} onChange={(event) => setTyped(event.target.value)} />
          <button type="submit" className="button">
            Search
          </button>
        </form>
        <p className="hint search-hint" id="search-hint">
          Looks in {listed(searchable)} when you press Search.
        </p>
      </div>
    )

  return (
    <section className="panel master" id="master" aria-labelledby="records-heading" hidden={hidden}>
      <div className="section-head">
        <h3 id="records-heading" className="section-heading" tabIndex={-1} ref={headingRef}>
          Records
        </h3>
        {canCreate ? (
          <button type="button" className="primary" ref={newRef} onClick={onNew}>
            New record
          </button>
        ) : null}
        {definition.list === null ? null : <DownloadCsv client={client} formId={formId} idBase="records-export" query={() => ({ search, sort, parent: null, filter })} />}
      </div>
      {tree === null ? null : (
        <Segmented
          legend="Show the records as"
          name="records-shape"
          className="records-shape"
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'tree', label: 'Tree' },
          ]}
          value={shape}
          onChange={setShape}
        />
      )}
      {tree !== null && shape === 'tree' ? (
        <RecordTree client={client} formId={formId} definition={definition} field={tree} labelledBy="records-heading" openToken={openToken} onOpen={onTreeOpen} />
      ) : (
      <RecordGrid
        ref={grid}
        client={client}
        formId={formId}
        definition={definition}
        columns={columns}
        choices={state.choices}
        labelledBy="records-heading"
        parent={null}
        search={search}
        filter={filter}
        sort={sort}
        openToken={openToken}
        canCreate={canCreate}
        toolbarStart={
          <>
            {searchBlock}
            <ViewPicker idBase="records" views={views} filter={filter} sort={sort} onPick={state.pick} />
            <ColumnsPanel idBase="records-columns" columns={columns} choices={state.choices} onChoices={state.setChoices} onReset={state.resetChoices} />
            {filterable.length === 0 ? null : <FilterPanel idBase="records-filter" fields={filterable} filter={filter} onFilter={state.setFilter} />}
          </>
        }
        refit={refit}
        bench="master-bench"
        {...(remove === undefined ? {} : { remove })}
        after={after}
        drilling={drilling}
        onOpen={onOpen}
        onSort={state.setSort}
        onClearSearch={() => {
          setTyped('')
          onSearch('')
          searchRef.current?.focus()
        }}
      />
      )}
    </section>
  )
}
