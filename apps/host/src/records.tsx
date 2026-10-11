import { forwardRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { DataClient, PublishedForm } from '@formancy/data-client'
import type { GridColumn } from './grid-datasource.js'
import { RecordGrid } from './record-grid.js'
import type { OpenHow, RecordGridHandle, RowAt } from './record-grid.js'

/** `['Order number', 'Status', 'Notes']` as "Order number, Status and Notes". */
function listed(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${String(words.at(-1))}`
}

/**
 * The Records panel (UX-SPEC §5.8): its heading, New record when the person
 * may create, the search, and the grid with its pager. A search is
 * submitted with the Search button or Enter, never per keystroke, and the
 * hint names the fields it looks in -- the server's `list.searchable`, by
 * their labels. No search form when nothing is searchable.
 */
export const Records = forwardRef<
  RecordGridHandle,
  {
    client: DataClient
    formId: string
    definition: PublishedForm
    columns: readonly GridColumn[]
    hidden: boolean
    openToken: string | null
    canCreate: boolean
    headingRef: RefObject<HTMLHeadingElement | null>
    newRef: RefObject<HTMLButtonElement | null>
    searchRef: RefObject<HTMLInputElement | null>
    search: string
    /** How many times the separator has been let go: the grid's columns fit again each time. */
    refit: number
    onSearch: (search: string) => void
    onNew: () => void
    onOpen: (token: string, how: OpenHow, at: RowAt) => void
  }
>(function Records({ client, formId, definition, columns, hidden, openToken, canCreate, headingRef, newRef, searchRef, search, refit, onSearch, onNew, onOpen }, grid): ReactElement {
  const [typed, setTyped] = useState(search)
  const labels = new Map(columns.map((column) => [column.key, column.label]))
  const searchable = (definition.list?.searchable ?? []).map((key) => labels.get(key) ?? key)

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
      </div>
      <RecordGrid
        ref={grid}
        client={client}
        formId={formId}
        definition={definition}
        columns={columns}
        labelledBy="records-heading"
        parent={null}
        search={search}
        openToken={openToken}
        canCreate={canCreate}
        toolbarStart={searchBlock}
        refit={refit}
        bench="master-bench"
        onOpen={onOpen}
        onClearSearch={() => {
          setTyped('')
          onSearch('')
          searchRef.current?.focus()
        }}
      />
    </section>
  )
})
