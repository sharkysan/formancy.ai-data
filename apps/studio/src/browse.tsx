import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { browseRelations, findObject, LIST_PAGE_SIZE } from '@formancy/data-core'
import type { ApiValue, BrowseEqualTerm, BrowseFilterTerm, BrowseRelations, BrowseSortTerm, MetadataSnapshot, ObjectRef, OmittedColumn } from '@formancy/data-core'
import type { BrowseAnswer } from '@formancy/data-server'
import type { AdminClient } from './api.js'
import { FilterPanel, filterables, sayCondition } from './browse-filter.js'
import type { Filterable } from './browse-filter.js'
import { describeRef } from './choice.js'
import { useFocusAfterRender } from './focus.js'
import { KeyHints, Related, sayTerms } from './related.js'

/** What the page on screen was asked for, so the next and previous pages, a sort and a Back ask for the same object, values, filter and search. */
interface Asked {
  object: ObjectRef
  /** The columns and values the page is narrowed to: a follow's (0103), and `[]` for a page Show rows asked for. */
  equal: BrowseEqualTerm[]
  /** The person's own conditions on the page's columns (0104): `[]` for a page Show rows or a follow asked for. */
  filter: BrowseFilterTerm[]
  search: string
  sort: BrowseSortTerm | null
  offset: number
}

/**
 * What a page that arrives does to the way back: Show rows starts a new
 * trail; a follow adds the page it left, and Back takes off the page it
 * returns to, each of them `moved`, which puts the selector, the search
 * box and the keyboard on the page reached. A page, a sort or a filter is
 * `null`, and keeps the trail as it is.
 */
type Move = { trail: Asked[]; moved: boolean } | null

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

/** How the status line begins: what narrows the page -- a follow's values, then the filter, then a search -- before what it shows. */
function narrowedBy(asked: Asked): string {
  const lead = [
    ...(asked.equal.length === 0 ? [] : [`where ${sayTerms(asked.equal)}`]),
    ...(asked.filter.length === 0 ? [] : [`filtered by ${asked.filter.map(sayCondition).join(' and ')}`]),
    ...(asked.search === '' ? [] : [`matching “${asked.search}”`]),
    'showing',
  ].join(', ')
  return `${lead.charAt(0).toUpperCase()}${lead.slice(1)}`
}

/**
 * The Browse step (0099): a page of rows of any table or view the
 * discovered connection can see, as its account reads them, fifty at a
 * time, with a search and a sort by any column the page shows; and a row's
 * foreign keys followed either way (0103), each follow a browse of the
 * other end narrowed to the row's values, with a Back to the page it left.
 * A page is filtered by the person's own conditions on its columns (0104),
 * which paging and sorting keep. Show rows asks for what its form says and
 * nothing of the page on screen, so it drops the filter as it drops the
 * sort; a follow starts the other end unfiltered, since the page left's
 * conditions name its own columns; and Back returns to the page as it was
 * asked, filter included, while the followed page's own filter goes with
 * it.
 *
 * Read only: nothing here changes a row, and the server refuses the route
 * to anybody without a browse role, which the step list says before the
 * step is opened. The tables and views to choose from are the discovery's,
 * and so are the keys a row offers; the server discovers again for every
 * page, so a name the catalog no longer has is refused rather than read.
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
  // The pages a follow left, the last one first back.
  const [trail, setTrail] = useState<Asked[]>([])
  // The row on the page whose related rows are open, by its place on the page.
  const [related, setRelated] = useState<number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  // How many pages a move has reached: the filter's panel is mounted afresh for each.
  const [visit, setVisit] = useState(0)
  const busy = useRef(false)
  const focusAfterRender = useFocusAfterRender()

  /** Asks for a page, and answers whether it arrived; `focus` names what takes the keyboard once it has, when the move does not. */
  async function load(asked: Asked, move: Move = null, focus: string | null = null): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    setRefusal(null)
    const outcome = await client.browse(connection, { object: asked.object, equal: asked.equal, filter: asked.filter, search: asked.search, sort: asked.sort === null ? [] : [asked.sort], offset: asked.offset, limit: LIST_PAGE_SIZE })
    busy.current = false
    if (!outcome.ok) {
      setRefusal(outcome.message)
      return false
    }
    setShown({ asked, page: outcome.value })
    setRelated(null)
    if (focus !== null) focusAfterRender(focus)
    if (move === null) return true
    setTrail(move.trail)
    setVisit((count) => count + 1)
    if (!move.moved) return true
    setChosen(describeRef(asked.object))
    setSearch(asked.search)
    focusAfterRender('browsed-heading')
    return true
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    const object = snapshot.objects.find((candidate) => describeRef(candidate.ref) === chosen)
    if (object === undefined) return
    void load({ object: object.ref, equal: [], filter: [], search: search.trim(), sort: null, offset: 0 }, { trail: [], moved: false })
  }

  function follow(object: ObjectRef, equal: BrowseEqualTerm[]): void {
    if (shown === null) return
    void load({ object, equal, filter: [], search: '', sort: null, offset: 0 }, { trail: [...trail, shown.asked], moved: true })
  }

  function back(): void {
    const to = trail.at(-1)
    if (to === undefined) return
    void load(to, { trail: trail.slice(0, -1), moved: true })
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
      {shown === null ? null : (
        <Page
          asked={shown.asked}
          page={shown.page}
          relations={browseRelations(snapshot, shown.page.object)}
          filterables={filterables(findObject(snapshot, shown.page.object), shown.page.columns)}
          visit={visit}
          related={related}
          back={trail.at(-1)?.object ?? null}
          onLoad={(asked, focus) => load(asked, null, focus ?? null)}
          onRelated={(index) => setRelated((open) => (open === index ? null : index))}
          onFollow={follow}
          onBack={back}
        />
      )}
    </>
  )
}

interface PageProps {
  asked: Asked
  page: BrowseAnswer
  /** The keys a row of this object can be followed through, from the studio's discovery. */
  relations: BrowseRelations
  /** What each column the page shows offers a filter, from the studio's discovery. */
  filterables: Filterable[]
  /** How many pages a move has reached, which mounts the filter's panel afresh. */
  visit: number
  /** The row whose related rows are open, by its place on the page. */
  related: number | null
  /** The object of the page a follow left, which Back returns to. */
  back: ObjectRef | null
  /** Asks for a page, and answers whether it arrived; `focus` names what takes the keyboard once it has. */
  onLoad: (asked: Asked, focus?: string) => Promise<boolean>
  onRelated: (index: number) => void
  onFollow: (object: ObjectRef, equal: BrowseEqualTerm[]) => void
  onBack: () => void
}

/**
 * One page on screen: the way back, what narrows it, what it leaves out and
 * how it is ordered, its filter, the rows -- each with its related rows,
 * where its object has a key to follow -- and the way to the next and
 * previous pages.
 */
function Page({ asked, page, relations, filterables, visit, related, back, onLoad, onRelated, onFollow, onBack }: PageProps): ReactElement {
  const name = describeRef(page.object)
  const first = asked.offset + 1
  const last = asked.offset + page.rows.length
  const range = page.rows.length === 0 ? (asked.offset === 0 ? 'no rows' : `no rows from row ${String(first)}`) : `rows ${String(first)} to ${String(last)}`
  const atStart = asked.offset === 0
  const relating = relations.relations.length > 0
  const open = related === null ? undefined : page.rows[related]
  return (
    <section className="browsed" aria-labelledby="browsed-heading">
      <h3 id="browsed-heading" tabIndex={-1}>
        <code>{name}</code> <span className="kind">{page.kind}</span>
      </h3>
      {back === null ? null : (
        <p className="actions">
          <button type="button" className="button" onClick={onBack}>
            Back to {describeRef(back)}
          </button>
        </p>
      )}
      <p role="status">
        {narrowedBy(asked)} {range}
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
      <KeyHints name={name} kind={page.kind} relations={relations} />
      {/* Keyed apart from the related rows below, whose key is a row's place: two siblings with one key leave React keeping a stale one. */}
      <FilterPanel key={`filter-${String(visit)}`}columns={filterables} active={asked.filter} onFilter={(filter, focus) => onLoad({ ...asked, filter, offset: 0 }, focus)} />
      <div className="rows" role="region" aria-labelledby="rows-caption" tabIndex={0}>
        <table>
          <caption id="rows-caption">
            {name}, {range}
          </caption>
          <thead>
            <tr>
              {relating ? <th scope="col">Related</th> : null}
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
                {relating ? (
                  <td>
                    {/* Named by aria-label, its visible word first (WCAG 2.5.3), for the same reason as a header's. */}
                    <button
                      type="button"
                      className="related-toggle"
                      aria-label={`Related to row ${String(asked.offset + index + 1)}`}
                      aria-expanded={related === index}
                      aria-controls={related === index ? 'related' : undefined}
                      onClick={() => onRelated(index)}
                    >
                      Related
                    </button>
                  </td>
                ) : null}
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
      {related === null || open === undefined ? null : (
        <Related key={related} id="related" name={name} number={asked.offset + related + 1} row={open} relations={relations} onFollow={onFollow} />
      )}
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
