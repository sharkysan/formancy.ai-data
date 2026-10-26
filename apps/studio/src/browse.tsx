import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { LIST_PAGE_SIZE } from '@formancy/data-core'
import type { ApiValue, BrowseSortTerm, MetadataSnapshot, ObjectRef, OmittedColumn } from '@formancy/data-core'
import type { BrowseAnswer } from '@formancy/data-server'
import type { AdminClient } from './api.js'
import { describeRef } from './choice.js'

/** What the page on screen was asked for, so the next and previous pages and a sort ask for the same object and search. */
interface Asked {
  object: ObjectRef
  search: string
  sort: BrowseSortTerm | null
  offset: number
}

const REASONS: Readonly<Record<OmittedColumn['reason'], string>> = {
  'not-readable': 'this connection may not read it',
  'no-text': 'it has no text form to show',
}

/** A value as a cell shows it: NULL said, so it is never read as empty text. */
function Cell({ value }: { value: ApiValue | undefined }): ReactElement {
  if (value === null || value === undefined) return <span className="null">NULL</span>
  return <>{String(value)}</>
}

/** The order a column header's button asks for next: ascending, then descending, then ascending again. */
function nextSort(current: BrowseSortTerm | null, column: string): BrowseSortTerm {
  return { column, direction: current?.column === column && current.direction === 'asc' ? 'desc' : 'asc' }
}

/**
 * The Browse step (0099): a page of rows of any table or view the
 * discovered connection can see, as its account reads them, fifty at a
 * time, with a search and a sort by any column the page shows.
 *
 * Read only: nothing here changes a row, and the server refuses the route
 * to anybody without a browse role, which the step list says before the
 * step is opened. The tables and views to choose from are the discovery's;
 * the server discovers again for every page, so a name the catalog no
 * longer has is refused rather than read.
 *
 * A press while a page is on its way does nothing, and a button with
 * nothing to do says so through `aria-disabled` rather than `disabled`,
 * which would drop the keyboard's focus at the last page.
 */
export function BrowseStep({ client, connection, snapshot }: { client: AdminClient; connection: string; snapshot: MetadataSnapshot }): ReactElement {
  const tables = snapshot.objects.filter((object) => object.kind === 'table')
  const views = snapshot.objects.filter((object) => object.kind === 'view')
  const [chosen, setChosen] = useState(snapshot.objects[0] === undefined ? '' : describeRef(snapshot.objects[0].ref))
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState<{ asked: Asked; page: BrowseAnswer } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const busy = useRef(false)

  async function load(asked: Asked): Promise<void> {
    if (busy.current) return
    busy.current = true
    setRefusal(null)
    const outcome = await client.browse(connection, { object: asked.object, search: asked.search, sort: asked.sort === null ? [] : [asked.sort], offset: asked.offset, limit: LIST_PAGE_SIZE })
    busy.current = false
    if (outcome.ok) setShown({ asked, page: outcome.value })
    else setRefusal(outcome.message)
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    const object = snapshot.objects.find((candidate) => describeRef(candidate.ref) === chosen)
    if (object === undefined) return
    void load({ object: object.ref, search: search.trim(), sort: null, offset: 0 })
  }

  const option = (ref: ObjectRef) => <option key={describeRef(ref)} value={describeRef(ref)}>{describeRef(ref)}</option>

  return (
    <>
      <p className="lede">
        The rows of the tables and views <code>{connection}</code> can see, as its account <code>{snapshot.account.user}</code> reads
        them: its grants and row security decide what is here. Nothing on this step changes a row.
      </p>
      {snapshot.objects.length === 0 ? (
        <p className="none">This connection can see no table or view.</p>
      ) : (
        <form className="browse-ask" onSubmit={submit}>
          <div className="pair">
            <div className="field">
              <label htmlFor="browse-object">Table or view</label>
              <select id="browse-object" value={chosen} onChange={(event) => setChosen(event.target.value)}>
                {tables.length === 0 ? null : <optgroup label="Tables">{tables.map((object) => option(object.ref))}</optgroup>}
                {views.length === 0 ? null : <optgroup label="Views">{views.map((object) => option(object.ref))}</optgroup>}
              </select>
            </div>
            <div className="field">
              <label htmlFor="browse-search">Search</label>
              <input id="browse-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
          <p className="actions">
            <button type="submit" className="primary">
              Show rows
            </button>
          </p>
        </form>
      )}
      {refusal === null ? null : (
        <p role="alert" className="problem-box">
          {refusal}
        </p>
      )}
      {shown === null ? null : <Page asked={shown.asked} page={shown.page} onLoad={(asked) => void load(asked)} />}
    </>
  )
}

/** One page on screen: what it leaves out and how it is ordered, the rows, and the way to the next and previous pages. */
function Page({ asked, page, onLoad }: { asked: Asked; page: BrowseAnswer; onLoad: (asked: Asked) => void }): ReactElement {
  const name = describeRef(page.object)
  const first = asked.offset + 1
  const last = asked.offset + page.rows.length
  const range = page.rows.length === 0 ? (asked.offset === 0 ? 'no rows' : `no rows from row ${String(first)}`) : `rows ${String(first)} to ${String(last)}`
  const atStart = asked.offset === 0
  return (
    <section className="browsed" aria-labelledby="browsed-heading">
      <h3 id="browsed-heading">
        <code>{name}</code> <span className="kind">{page.kind}</span>
      </h3>
      <p role="status">
        {asked.search === '' ? 'Showing' : `Matching “${asked.search}”, showing`} {range}
        {page.hasMore ? ', and more follow.' : '.'}
      </p>
      {page.omitted.length === 0 ? null : (
        <p className="hint">Not shown: {page.omitted.map((entry) => `${entry.column}, because ${REASONS[entry.reason]}`).join('; ')}.</p>
      )}
      {page.ordered === 'key' ? null : (
        <p className="hint">
          {name} has no key this connection may read, so its rows are ordered by every column shown: two rows alike in all of them may
          trade places between pages.
        </p>
      )}
      <div className="rows" role="region" aria-labelledby="rows-caption" tabIndex={0}>
        <table>
          <caption id="rows-caption">
            {name}, {range}
          </caption>
          <thead>
            <tr>
              {page.columns.map((column) => {
                const sorted = asked.sort?.column === column.name ? asked.sort.direction : null
                const next = nextSort(asked.sort, column.name)
                // Named by aria-label, its visible name first: a visually hidden span is positioned, so a browser
                // names the button with a space before its comma, and the grid's region would not clip it.
                return (
                  <th key={column.name} scope="col" aria-sort={sorted === null ? undefined : sorted === 'asc' ? 'ascending' : 'descending'}>
                    <button
                      type="button"
                      className="sort"
                      aria-label={`${column.name}, sort ${next.direction === 'asc' ? 'ascending' : 'descending'}`}
                      onClick={() => onLoad({ ...asked, sort: next, offset: 0 })}
                    >
                      {column.name}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, index) => (
              // A row has no identity a view can promise; its place on the page is what it is.
              <tr key={asked.offset + index}>
                {page.columns.map((column) => (
                  <td key={column.name}>
                    <Cell value={row[column.name]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="actions">
        <button type="button" className="button" aria-disabled={atStart} onClick={() => (atStart ? undefined : onLoad({ ...asked, offset: Math.max(0, asked.offset - LIST_PAGE_SIZE) }))}>
          Previous page
        </button>
        <button type="button" className="button" aria-disabled={!page.hasMore} onClick={() => (page.hasMore ? onLoad({ ...asked, offset: asked.offset + LIST_PAGE_SIZE }) : undefined)}>
          Next page
        </button>
      </p>
    </section>
  )
}
