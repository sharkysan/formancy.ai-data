import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { DataClient } from '@formancy/data-client'
import type { ChildForm } from './children.js'
import { useAfterRender } from './after-render.js'
import { AngularForm } from './angular-mount.js'
import type { ParentOpen } from './children.js'
import { columnsOf } from './grid-datasource.js'
import type { GridColumn, GridRow, ListClient } from './grid-datasource.js'
import { useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { ReactForm } from './react-form.js'
import { DELETE_COLUMN, RecordGrid } from './record-grid.js'
import type { OpenHow, RecordGridHandle } from './record-grid.js'
import { countsOf, mayOf, pendingName, tabLine } from './rows-said.js'
import { CHANGE_COLUMN, createSaveSet, isTogether } from './save-set.js'
import type { HeldRow, SaveSet, TogetherForm } from './save-set.js'
import type { Session } from './session.js'
import { Words } from './words.js'

/** How a renderer is written for a person. */
const NAMES = { react: 'React', angular: 'Angular' } as const

/** A together tab's grid lists in no order but the set's, and by no filter: these never change. */
const NONE: readonly never[] = []

/**
 * The rows of a record's together children, held for its Save (0155): one
 * set for every pane of the record and every tab of its rows, made once
 * for the form, its children read when it asks, since they may answer after
 * the record is drawn.
 */
export function useSaveSet(client: DataClient, formId: string, parentNoun: string, childForms: readonly ChildForm[]): SaveSet {
  const childrenNow = useRef(childForms)
  childrenNow.current = childForms
  return useMemo(() => createSaveSet({ client, formId, parentNoun, forms: () => childrenNow.current.filter(isTogether) }), [client, formId, parentNoun])
}

/** What the rail's line says of a row whose version moved, or which is gone, since its change was read. */
export const MOVED = 'Changed by someone else since it was read: Save refuses this row unless you load it as stored.'

/**
 * The first field of the rail's first paper focused, once a renderer has
 * drawn it: React at once, Angular once its application has started,
 * which no render of this page waits for.
 */
function focusFirstField(rail: HTMLElement | null): void {
  if (rail === null) return
  const find = (): HTMLElement | null =>
    rail.querySelector<HTMLElement>('form.sheet input:not([disabled]), form.sheet select:not([disabled]), form.sheet textarea:not([disabled])')
  const now = find()
  if (now !== null) {
    now.focus()
    return
  }
  const observer = new MutationObserver(() => {
    const found = find()
    if (found === null) return
    observer.disconnect()
    found.focus()
  })
  observer.observe(rail, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), 15_000)
}

/**
 * The rows of a child saved with its record (0155), in a tab beside it
 * (0142): its heading and Add, a line that says how many rows there are,
 * the bound, why a control is not there and the changes held -- a polite
 * live region, as a grid's line is -- with Go to Save beside it, which
 * shows the record's tab and puts the keyboard on its Save and sends
 * nothing; then the rows in a grid of the page's own set, each row's
 * change in words in a column of its own, and Remove, or Undo remove, in
 * the row's last column; and the row opened, by a click, Space or Enter
 * (0047), on a rail below, in every layout -- Drill down included, since
 * its draft is the record's save's (0090 narrowed) -- in the child's own
 * document with the field that names the record left out, which the save
 * supplies, and Done as its submit, which closes the rail where the
 * engine accepts and sends nothing.
 *
 * Nothing here sends a row: the record's own Save does (session.ts,
 * save-set.ts). Add is absent at the maximum and Remove at the minimum, as
 * formancy.ai 0184 draws a repeater's -- and Undo remove at the maximum,
 * which would add one past it -- and each is drawn only where the menu's
 * flags let this person (0155); the line says why one is not. A row whose
 * change is in the save still out has neither Remove nor Undo remove until
 * it is answered. A row's forms are keyed by the row's slot, which a new
 * row keeps when its save stores it and its key becomes its token, so the
 * field being typed into while it was out keeps the keyboard; and a new
 * row is named by the number its ref was minted with, which no other row
 * of the record's child is given, so its name does not move when another
 * is removed.
 *
 * Its rows are the save set's, which outlives the tab: a tab drawn again
 * for the same record finds them as they were, and the guard counts them
 * as the record's work and names them (`pendingName`).
 */
export function TogetherSection({
  client,
  form,
  index,
  parentNoun,
  parent,
  heading,
  renderer,
  saveSet,
  refit,
  ownerBase = '',
  idBase = 'child',
  onTab,
  goToSave,
}: {
  client: DataClient
  form: TogetherForm
  index: number
  parentNoun: string
  parent: ParentOpen
  /** What the record is called, which the guard names its rows' changes after. */
  heading: Said
  renderer: RendererChoice
  saveSet: SaveSet
  refit: number
  ownerBase?: string
  idBase?: string
  /** The tab shown, where another hides it: true when it was hidden (0142). */
  onTab?: () => boolean
  /** The record's tab shown, and the keyboard on its Save. */
  goToSave: () => void
}): ReactElement {
  const { child, menu, definition } = form
  const owner = `${ownerBase}${child.form}~${child.field}`
  const parentKey = parent.kind === 'record' ? parent.token : 'new'
  const rows = useMemo(() => saveSet.child(form, owner, parentKey), [saveSet, form, owner, parentKey])
  const version = useSyncExternalStore(saveSet.subscribe, saveSet.version)
  const after = useAfterRender()
  const grid = useRef<RecordGridHandle>(null)
  const sectionHeading = useRef<HTMLHeadingElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const railHeading = useRef<HTMLHeadingElement>(null)
  /** Where the keyboard goes once the grid has drawn the set again. */
  const onListed = useRef<(() => void) | null>(null)
  const headingNow = useRef(heading)
  headingNow.current = heading
  const [railLine, setRailLine] = useState<Said>([])

  const title = menu.title
  const headingId = `${idBase}-${String(index)}-heading`
  const may = mayOf(rows)
  const counts = countsOf(rows)
  const { min, max } = child.together
  const adds = may.create && counts.held < max
  // Undo remove is an Add of the row: absent at the maximum, as Add is.
  const removes = (row: HeldRow): boolean =>
    !saveSet.sending(row) && (row.ref !== null ? may.create : may.delete) && (row.removed ? counts.held < max : counts.held > min)

  useEffect(() => {
    if (rows.listing.kind === 'idle') void saveSet.list(rows)
  }, [saveSet, rows])

  // The grid draws the set as it is now: asked again from memory each time it changes.
  useEffect(() => {
    grid.current?.reload()
  }, [version])

  // The record's rows are its work: the guard asks before anything drops them (0047).
  const entries = useMemo<PaneEntry[]>(
    () => [
      {
        owner,
        renderer: null,
        name: () => pendingName(headingNow.current, rows),
        work: () => (saveSet.pending(rows) ? 'changed' : null),
        discard: () => saveSet.discard(rows),
      },
    ],
    [owner, rows, saveSet],
  )
  useRegistered(entries)

  // A save refused about these rows takes the keyboard here: the tab shown first, then its heading or the row's problems.
  const focus = rows.focus
  useEffect(() => {
    if (focus === null) return
    saveSet.focused(rows)
    onTab?.()
    after(() => {
      if (focus.to === 'heading') {
        sectionHeading.current?.focus()
        return
      }
      // The row's forms summarise their problems and focus that themselves when they are drawn with them; one drawn already is focused here.
      const summary = rail.current?.querySelector<HTMLElement>('[data-formancy-part="error-summary"]')
      summary?.focus()
    })
    // Once for each ask, by its number.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- an ask is acted on once, by its number
  }, [focus?.n])

  const columns = useMemo<GridColumn[]>(
    () => [...columnsOf(definition, child.field), { key: CHANGE_COLUMN, label: 'Change', sortable: false, source: null }],
    [definition, child.field],
  )
  const choices = useMemo(() => columns.map((column) => ({ field: column.key, shown: true })), [columns])
  /** The grid's rows, from the page's own set: one page, never the server's (0155). */
  const memory = useMemo<ListClient>(
    () => ({
      list: async () => ({ ok: true, value: { rows: saveSet.gridRows(rows), hasMore: false, next: null } }),
      resolve: client.resolve,
    }),
    [client, saveSet, rows],
  )

  const open = rows.open === null ? undefined : rows.rows.find((row) => row.key === rows.open)
  /** A row by its key, for its name; a new one by its ref's number, never another row's. */
  const nameOf = (row: HeldRow): Said => (row.ref === null ? [`${title} `, { code: row.key }] : [`New ${title} ${row.ref.slice(1)}`])
  const named = (row: HeldRow): string =>
    nameOf(row)
      .map((part) => (typeof part === 'string' ? part : part.code))
      .join('')

  function openRow(key: string, how: OpenHow): void {
    if (!rows.rows.some((row) => row.key === key)) return
    setRailLine([])
    saveSet.open(rows, key)
    if (how === 'enter') after(() => railHeading.current?.focus())
  }

  function add(): void {
    const row = saveSet.add(rows)
    setRailLine([`Added ${named(row)}: it is saved with the ${parentNoun}.`])
    after(() => focusFirstField(rail.current))
  }

  function done(row: HeldRow): void {
    saveSet.open(rows, null)
    const key = row.key
    onListed.current = () => {
      if (grid.current?.focusRecord(key) !== true) sectionHeading.current?.focus()
    }
  }

  function press(gridRow: GridRow): void {
    const row = rows.rows.find((each) => each.key === gridRow.record)
    if (row === undefined) return
    const { key } = row
    const gone = saveSet.remove(rows, key, !row.removed)
    onListed.current = () => {
      // A new row is taken off the page; a stored one keeps its place, its button now the other way.
      if (gone) (addButton.current ?? sectionHeading.current)?.focus()
      else grid.current?.focusRecord(key, DELETE_COLUMN)
    }
  }

  async function loadLine(row: HeldRow): Promise<void> {
    const name = nameOf(row)
    const loaded = await saveSet.loadLine(rows, row.key)
    if (loaded.kind === 'gone') {
      // Off the page with its rail: the tab's line says so, and the keyboard goes to the tab's heading, not the page.
      setRailLine([])
      after(() => sectionHeading.current?.focus())
      return
    }
    setRailLine(loaded.kind === 'loaded' ? [`Loaded `, ...name, ' as stored. Your changes to it were discarded.'] : [loaded.message])
    after(() => railHeading.current?.focus())
  }

  const removable = may.create || may.delete
  const said = (gridRow: GridRow): { text: string; name: string } | null => {
    const row = rows.rows.find((each) => each.key === gridRow.record)
    if (row === undefined || !removes(row)) return null
    return row.removed ? { text: 'Undo remove', name: `Undo remove ${named(row)}` } : { text: 'Remove', name: `Remove ${named(row)}` }
  }

  return (
    <section className="child" aria-labelledby={headingId}>
      <div className="section-head">
        <h4 id={headingId} className="child-heading" tabIndex={-1} ref={sectionHeading}>
          {title}
        </h4>
        {adds ? (
          <button type="button" className="button" ref={addButton} onClick={add}>
            Add {title}
          </button>
        ) : null}
      </div>
      <p className="child-sub">
        <Words said={parent.kind === 'record' ? [`For ${parentNoun} `, { code: parent.token }] : [`For the new ${parentNoun}`]} />
      </p>
      <RecordGrid
        ref={grid}
        client={memory}
        formId={child.form}
        definition={definition}
        columns={columns}
        choices={choices}
        widths={NONE}
        labelledBy={headingId}
        noun={title}
        parent={null}
        search=""
        filter={NONE}
        sort={NONE}
        openToken={rows.open}
        canCreate={false}
        quiet
        alone
        toolbarStart={
          <div className="pager">
            <div className="status-cell">
              <p role="status" className="status" data-kind={rows.listing.kind === 'refused' ? 'refused' : 'answer'}>
                {tabLine(rows, parentNoun, saveSet.sending)}
              </p>
            </div>
            {may.create || may.update || may.delete ? (
              <div className="actions">
                <button type="button" className="button" onClick={goToSave}>
                  Go to Save
                </button>
              </div>
            ) : null}
          </div>
        }
        refit={refit}
        bench="child-bench"
        {...(removable ? { remove: { noun: title, press, said, heading: 'Remove' } } : {})}
        onOpen={(key, how) => openRow(key, how)}
        onSort={() => {}}
        onWidths={() => {}}
        onListed={() => {
          const then = onListed.current
          onListed.current = null
          then?.()
        }}
      />
      {open === undefined ? null : (
        <div className="child-detail" ref={rail}>
          <div className="title-row">
            <h5 id={`${headingId}-detail`} className="child-detail-heading" tabIndex={-1} ref={railHeading}>
              <Words said={nameOf(open)} />
            </h5>
            {open.moved !== null && open.ref === null ? (
              <button type="button" className="button" onClick={() => void loadLine(open)}>
                Load this line
              </button>
            ) : null}
          </div>
          <p role="status" className="status quiet-line">
            <Words said={open.moved === null ? railLine : [MOVED]} />
          </p>
          <div className="panes" data-count={renderersOf(renderer).length}>
            {saveSet
              .drafts(rows, open)
              .filter((session) => renderersOf(renderer).includes(session.renderer))
              .map((session) => (
                <RowPane
                  key={`${String(open.slot)} ${session.renderer}`}
                  session={session}
                  title={named(open)}
                  idBase={`${owner}~${String(open.slot)}`}
                  namedBy={`${headingId}-detail`}
                  onDone={() => done(open)}
                />
              ))}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * One renderer's form of a together row on the rail: a region named by
 * the row and the renderer, and the row's document on white paper in
 * Blueprint, whose submit is Done. Done runs the engine's own submit, as
 * any submit does, and closes the rail where it accepts: the draft is the
 * row's pending change from its first keystroke, and nothing is sent.
 */
function RowPane({
  session,
  title,
  idBase,
  namedBy,
  onDone,
}: {
  session: Session
  title: string
  idBase: string
  namedBy: string
  onDone: () => void
}): ReactElement {
  const { engine } = useSyncExternalStore(session.subscribe, session.opened)
  const [sheet, setSheet] = useState<HTMLFormElement | null>(null)
  const name = NAMES[session.renderer]
  const headingId = `pane-${idBase}-${session.renderer}`
  const submitted = (outcome: { ok: boolean }): void => {
    if (outcome.ok) onDone()
  }
  return (
    <section className="pane" aria-labelledby={`${namedBy} ${headingId}`}>
      <div className="pane-top">
        <h6 id={headingId} className="pane-heading">
          {name}
        </h6>
      </div>
      <form
        className="sheet"
        aria-label={`${title}, ${name}`}
        data-formancy-theme="blueprint"
        noValidate
        onSubmit={(event) => event.preventDefault()}
        ref={setSheet}
      >
        {session.renderer === 'react' ? (
          <ReactForm engine={engine} sources={session.sources} submitLabel="Done" onSubmit={submitted} />
        ) : (
          <AngularForm sheet={sheet} engine={engine} sources={session.sources} submitLabel="Done" onSubmit={submitted} />
        )}
      </form>
    </section>
  )
}
