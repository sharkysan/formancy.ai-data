import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { browseRelations, findObject, LIST_PAGE_SIZE } from '@formancy/data-core'
import type { ApiValue, BrowseEqualTerm, BrowseRelations, BrowseSortTerm, MetadataSnapshot, ObjectRef, OmittedColumn } from '@formancy/data-core'
import type { BrowseAnswer } from '@formancy/data-server'
import type { AdminClient } from './api.js'
import { HeaderBoxes } from './browse-boxes.js'
import { BrowseFilter } from './browse-filter.js'
import { samePage, usePages } from './browse-pages.js'
import type { Asked, Build, Pages, Place } from './browse-pages.js'
import { filterables, lineFields } from './browse-terms.js'
import type { FilterChange, Filterable } from './browse-terms.js'
import { describeRef } from './choice.js'
import { sayCondition } from './condition-draft.js'
import { useFocusAfterRender } from './focus.js'
import { KeyHints, Related, sayTerms } from './related.js'

/** What the step's alert says: the server's refusal, or a header box's, and the box that owns it until it changes (0147). */
interface Refusal {
  message: string
  owner: string | null
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

/** How the status line begins: what narrows the page -- a follow's values, then the filter, then a search -- before what it shows. */
function narrowedBy(asked: Asked): string {
  const lead = [
    ...(asked.equal.length === 0 ? [] : [`where ${sayTerms(asked.equal)}`]),
    ...(asked.filter.length === 0 ? [] : [`filtered by ${asked.filter.map((term) => sayCondition(term.column, term)).join(' and ')}`]),
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
 * typed as a line, said as chips and set in a box under each column's
 * header (0147), which paging and sorting keep. Show rows asks for what its form says and
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
 * A press while a page is on its way is sent once that page has settled,
 * on the page as it then stands (`browse-pages.ts`), and one that no
 * longer applies there -- a second press of a follow, a box of the page a
 * move is leaving -- is dropped. A button with nothing to do says so
 * through `aria-disabled` rather than `disabled`, which would drop the
 * keyboard's focus at the last page.
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
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  // How many pages a move has reached: the filter's line, chips and boxes are mounted afresh for each.
  const [visit, setVisit] = useState(0)
  const focusAfterRender = useFocusAfterRender()

  const pages = usePages(
    (asked) =>
      client.browse(connection, {
        object: asked.object,
        equal: asked.equal,
        filter: asked.filter,
        search: asked.search,
        sort: asked.sort === null ? [] : [asked.sort],
        offset: asked.offset,
        limit: LIST_PAGE_SIZE,
      }),
    {
      // A refusal a box owns stays said until the box changes; any other goes as the next page is asked for.
      asking: () => setRefusal((said) => (said?.owner === null ? null : said)),
      arrived: (place, move, page, press) => {
        setShown({ asked: place.asked, page })
        setTrail(place.trail)
        setRelated(null)
        for (const run of press.arrived) run()
        if (press.focus !== null) focusAfterRender(press.focus)
        if (move === null) return
        // A move takes the boxes with the page they were on, and so the refusals they owned.
        setRefusal(null)
        setVisit((count) => count + 1)
        if (!move.moved) return
        setChosen(describeRef(place.asked.object))
        setSearch(place.asked.search)
        focusAfterRender('browsed-heading')
      },
      refused: (message, owner) => setRefusal({ message, owner }),
    },
  )

  function submit(event: FormEvent): void {
    event.preventDefault()
    const object = snapshot.objects.find((candidate) => describeRef(candidate.ref) === chosen)
    if (object === undefined) return
    const asked: Asked = { object: object.ref, equal: [], filter: [], search: search.trim(), sort: null, offset: 0 }
    void pages.ask(() => ({ place: { asked, trail: [] }, move: { moved: false } }))
  }

  /** A follow from the page on screen, which a second press -- the page then being the one followed to -- no longer applies to. */
  function follow(object: ObjectRef, equal: BrowseEqualTerm[]): void {
    if (shown === null) return
    const from = shown.asked
    void pages.ask((base) =>
      base === null || !samePage(base.asked, from)
        ? null
        : { place: { asked: { object, equal, filter: [], search: '', sort: null, offset: 0 }, trail: [...base.trail, base.asked] }, move: { moved: true } },
    )
  }

  /** Back from the page on screen to the page it was followed from, as that page stood. */
  function back(): void {
    if (shown === null) return
    const from = shown.asked
    void pages.ask((base) => {
      const to = base?.trail.at(-1)
      if (base === null || to === undefined || !samePage(base.asked, from)) return null
      return { place: { asked: to, trail: base.trail.slice(0, -1) }, move: { moved: true } }
    })
  }

  const option = (ref: ObjectRef) => (
    <option key={describeRef(ref)} value={describeRef(ref)}>
      {describeRef(ref)}
    </option>
  )

  return (
    <>
      <p className="lede">
        The rows of the tables and views <code>{connection}</code> can see, as its account <code>{snapshot.account.user}</code> reads them: its grants and row
        security decide what is here. Nothing on this step changes a row.
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
        <p role="alert" id="browse-refusal" className="problem-box">
          {refusal.message}
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
          pages={pages}
          refusedBy={refusal?.owner ?? null}
          onRefused={(message, owner) => setRefusal({ message, owner })}
          onUnsaid={(owner) => setRefusal((said) => (said?.owner === owner ? null : said))}
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
  /** How many pages a move has reached, which mounts the filter's line, chips and boxes afresh. */
  visit: number
  /** The row whose related rows are open, by its place on the page. */
  related: number | null
  /** The object of the page a follow left, which Back returns to. */
  back: ObjectRef | null
  /** How the step asks for its pages: what a press here builds on the page as it will stand. */
  pages: Pages
  /** The header box whose refusal the step's alert says, if one's. */
  refusedBy: string | null
  /** Says a header box's refusal where the step speaks, owned by the box until it changes. */
  onRefused: (message: string, owner: string) => void
  /** Says no longer what the box `owner` had refused. */
  onUnsaid: (owner: string) => void
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
function Page({
  asked,
  page,
  relations,
  filterables,
  visit,
  related,
  back,
  pages,
  refusedBy,
  onRefused,
  onUnsaid,
  onRelated,
  onFollow,
  onBack,
}: PageProps): ReactElement {
  const rows = useRef<HTMLDivElement>(null)
  const name = describeRef(page.object)
  const first = asked.offset + 1
  const last = asked.offset + page.rows.length
  const range = page.rows.length === 0 ? (asked.offset === 0 ? 'no rows' : `no rows from row ${String(first)}`) : `rows ${String(first)} to ${String(last)}`
  const atStart = asked.offset === 0
  const relating = relations.relations.length > 0
  const open = related === null ? undefined : page.rows[related]
  const fields = lineFields(filterables)
  /** A press on this page: what it makes of the page as it will stand, while that is still this page. */
  const here =
    (to: (base: Asked) => Asked): Build =>
    (base: Place | null) =>
      base === null || !samePage(base.asked, asked) ? null : { place: { asked: to(base.asked), trail: base.trail }, move: null }
  const ahead = pages.ahead !== null && samePage(pages.ahead.asked, asked) ? pages.ahead.asked.filter : asked.filter
  const filter = {
    filter: asked.filter,
    onFilter: ((change, press) =>
      pages.ask(
        here((base) => ({ ...base, filter: change(base.filter), offset: 0 })),
        press,
      )) satisfies FilterChange,
  }
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
          {name} has no key this connection may read, so its rows are ordered by every column shown: two rows alike in all of them may trade places between
          pages.
        </p>
      )}
      <KeyHints name={name} kind={page.kind} relations={relations} />
      {fields.length === 0 && asked.filter.length === 0 ? (
        <p className="hint">No column this page shows can be filtered.</p>
      ) : (
        // Keyed apart from the related rows below, whose key is a row's place: two siblings with one key leave React keeping a stale one.
        <BrowseFilter key={`filter-${String(visit)}`} columns={filterables} fields={fields} {...filter} onLeave={() => rows.current?.focus()} />
      )}
      <div className="rows" id="browse-rows" ref={rows} role="region" aria-labelledby="rows-caption" tabIndex={0}>
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
                      onClick={() => void pages.ask(here((base) => ({ ...base, sort: nextSort(base.sort, column.name), offset: 0 })))}
                    >
                      {column.name}
                    </button>
                  </th>
                )
              })}
            </tr>
            {fields.length === 0 ? null : (
              <HeaderBoxes
                key={`boxes-${String(visit)}`}
                columns={page.columns}
                relating={relating}
                fields={fields}
                {...filter}
                ahead={ahead}
                refusedBy={refusedBy}
                onRefused={onRefused}
                onUnsaid={onUnsaid}
              />
            )}
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
        <button
          type="button"
          className="button"
          aria-disabled={atStart}
          onClick={() => (atStart ? undefined : void pages.ask(here((base) => ({ ...base, offset: Math.max(0, base.offset - LIST_PAGE_SIZE) }))))}
        >
          Previous page
        </button>
        <button
          type="button"
          className="button"
          aria-disabled={!page.hasMore}
          onClick={() => (page.hasMore ? void pages.ask(here((base) => ({ ...base, offset: base.offset + LIST_PAGE_SIZE }))) : undefined)}
        >
          Next page
        </button>
      </p>
    </section>
  )
}
