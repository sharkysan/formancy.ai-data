import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DataClient, FormMenuChild, FormMenuEntry, ListFilterTerm, ListSortTerm, PublishedForm } from '@formancy/data-client'
import { FilterPanel } from './filter-panel.js'
import { panelFields } from './filter-terms.js'
import { columnsOf } from './grid-datasource.js'
import { paneEntry, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import { useOpening } from './opening.js'
import { Pane } from './pane.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { DELETE_COLUMN, RecordGrid } from './record-grid.js'
import type { OpenHow, RecordGridHandle, RowAt } from './record-grid.js'
import { createSession } from './session.js'
import type { SaveResult } from './session.js'
import { useAfterRender } from './after-render.js'
import { DeleteRegion } from './delete-confirm.js'
import { DownloadCsv } from './download.js'
import { useDeleteFlow } from './delete-flow.js'
import { detailTarget, gone, rowTarget, SAVE_OUT } from './deletion.js'
import type { DeleteTarget } from './deletion.js'
import type { GridRow } from './grid-datasource.js'
import { Words } from './words.js'
import type { HeldLevels, SectionDrill } from './use-drill.js'
import { ViewPicker } from './view-picker.js'
import { openingView } from './views.js'

/** What the record above a child section is: a saved record, or a new one not saved yet. */
export type ParentOpen = { kind: 'new' } | { kind: 'record'; token: string }

/** A child form under the open record: the menu's entry, the child form's own, and its definition. */
export interface ChildForm {
  child: FormMenuChild
  menu: FormMenuEntry
  definition: PublishedForm
}

type ChildOpen = null | { kind: 'new' } | { kind: 'record'; token: string }

/**
 * One child form's rows under the open record (0045, 0047): its grid, listed
 * with `parent: { field, record }` and the parent's column left out, and,
 * once a row is opened or New is pressed, the child row's own forms on a
 * rail below it.
 *
 * Its sessions are its own, keyed `<child form>~<field>`, so a form that is
 * its own child -- an employee's manager -- or two sections of one form --
 * an order under its creator and its approver -- never mint one element id
 * twice. A new child row is preset with the parent, whose field is drawn
 * disabled on the page's copy: presentation only; the server checks only
 * that the parent is one this person may reference (0043).
 *
 * The section is mounted again for every parent, so its rows, its open row
 * and its forms are that parent's; the workspace asks before a request drops
 * a child row's work.
 *
 * Where the child form offers delete, a child row is deleted from its own
 * detail's header or from its row, after a confirmation in place, as the
 * record is (0053); then the keyboard goes to this section's heading.
 *
 * Under a saved parent its grid has a filter panel of its own, over the
 * fields the child form offers (0104), and its head offers Download CSV
 * (0080): the child form's file of that parent's rows, under the section's
 * filter, in the grid's sort, the parent's column kept, so the file says
 * whose rows they are. A new parent has no rows to give. The filter is the
 * section's, so another parent's section starts with none -- or, where the
 * server offers the child form's views, with its default view's filter and
 * sort, which its View picker before the filter panel sets as the Records
 * panel's does (0105).
 * The section is drawn only for a child whose `list` this person is offered
 * -- the workspace leaves any other out when the form is chosen -- so the
 * button asks nothing more of the definition.
 *
 * In Drill down (0090) a row opened, or New, goes down a level instead of
 * onto the rail (`drill`): the rail is not drawn -- a row open on it from
 * another layout stays mounted and hidden, its work still the guard's --
 * and the grid marks the row the level below holds. In every layout, a
 * row a Drill down level holds asks about that level and the levels below
 * before its Delete asks anything, and once gone takes them with it
 * (`levels`). A section of a level from 2 down is owned under its level
 * (`ownerBase`, `idBase`), so no owner or id is twice.
 */
export function ChildSection({
  client,
  form,
  index,
  twice,
  parentNoun,
  parent,
  renderer,
  refit,
  onShow,
  ownerBase = '',
  idBase = 'child',
  drill,
  levels,
}: {
  client: DataClient
  form: ChildForm
  index: number
  /** The same child form under this parent through another field too: the heading names the field. */
  twice: boolean
  parentNoun: string
  parent: ParentOpen
  renderer: RendererChoice
  /** How many times the separator has been let go: the grid's columns fit again each time. */
  refit: number
  /** The record view shown, in Separate views: a deletion's answer may come once the person has gone to the records. True when it was hidden. */
  onShow: () => boolean
  /** What the section's owner starts with: a Drill down level's (`drillBase`), or nothing at level 1. */
  ownerBase?: string
  /** What its element ids start with: `child` at level 1. */
  idBase?: string
  /** In Drill down, how the section goes down a level (0090). */
  drill?: SectionDrill | undefined
  /** The Drill down levels held, which a row deleted here may hold, in every layout. */
  levels?: HeldLevels | undefined
}): ReactElement {
  const { child, menu, definition } = form
  const owner = `${ownerBase}${child.form}~${child.field}`
  const { ask } = useGuardContext()
  const after = useAfterRender()
  const grid = useRef<RecordGridHandle>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const sectionHeading = useRef<HTMLHeadingElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<ChildOpen>(null)
  const [line, setLine] = useState<Said>([])
  const [waitingShown, setWaitingShown] = useState(true)
  const openRef = useRef<ChildOpen>(null)
  openRef.current = open

  const title = menu.title
  const fieldLabel = String(definition.form.model.fields.find((field) => field.key === child.field)?.label ?? child.field)
  const headingId = `${idBase}-${String(index)}-heading`
  const canCreate = menu.operations.includes('create') && definition.operations.includes('create')
  const waiting = parent.kind === 'new'
  const waitingText = `${title} rows are listed once this ${parentNoun} is saved.`

  const sessions = useMemo(
    () => (['react', 'angular'] as const).map((which) => createSession({ client, formId: child.form, definition, renderer: which, namespace: owner, fixed: [child.field] })),
    [client, child.form, child.field, definition, owner],
  )
  const entries = useMemo<PaneEntry[]>(
    () =>
      sessions.map((session) =>
        paneEntry(owner, session, (): Said => {
          const now = openRef.current
          return now?.kind === 'record' ? [`${title} `, { code: now.token }] : [`New ${title}`]
        }),
      ),
    [sessions, owner, title],
  )
  useRegistered(entries)
  const opening = useOpening({ client, formId: child.form, owner, sessions })
  const columns = useMemo(() => columnsOf(definition, child.field), [definition, child.field])
  const filterable = useMemo(() => panelFields(definition), [definition])
  const views = definition.list?.views ?? []
  const [filter, setFilter] = useState<ListFilterTerm[]>(() => openingView(views)?.filter ?? [])
  const [sort, setSort] = useState<ListSortTerm[]>(() => openingView(views)?.sort ?? [])
  const canDelete = menu.operations.includes('delete') && definition.operations.includes('delete') && definition.deleting !== null
  const removal = useDeleteFlow({
    client,
    formId: child.form,
    owner,
    sessions,
    discards: { kind: 'child-new', owner, title },
    held: (target) => levels?.atRisk(child.form, target.record) ?? [],
    onGone: (target, word, quiet) => rowGone(target, word, quiet),
    onLoad: (target) => {
      grid.current?.reload()
      openRow(target.record, 'enter', () => detailHeading.current?.focus())
    },
    onBack: (target) => {
      if (target.from.kind === 'detail') deleteButton.current?.focus()
      // The row by its record, which the grid may have moved or taken away: then this section's heading.
      else if (grid.current?.focusRecord(target.record, DELETE_COLUMN) !== true) sectionHeading.current?.focus()
    },
    onShow,
  })
  const { saving } = removal

  const prefix = (discarded: boolean): Said => (discarded ? ['Discarded the unsaved changes. '] : [])

  // Its handle, for the levels below: a row they held gone, a save there to show.
  const register = levels?.register
  const listing = parent.kind === 'record' ? parent.token : null
  useEffect(() => {
    if (register === undefined || listing === null) return undefined
    register(owner, { parent: listing, removed: (said) => grid.current?.removed(said), focusHeading: () => sectionHeading.current?.focus(), reload: () => grid.current?.reload() })
    return () => register(owner, null)
  }, [register, owner, listing])

  function askRow(token: string, how: OpenHow, at: RowAt): void {
    // In Drill down every open goes down a level: a click, Space and Enter alike.
    if (drill !== undefined) {
      drill.descend({ kind: 'record', token }, () => grid.current?.focusAt(at), (message) => grid.current?.say([message]))
      return
    }
    if (open?.kind === 'record' && open.token === token) {
      if (how === 'enter') detailHeading.current?.focus()
      return
    }
    openRow(token, how, () => grid.current?.focusAt(at))
  }

  /** Read the row and open it in this section's forms, through the guard; `toRow` gives the keyboard back. */
  function openRow(token: string, how: OpenHow, toRow: () => void): void {
    const request = { kind: 'child-row', owner, record: token } as const
    ask(
      request,
      (discarded) =>
        opening.read(request, token, discarded, {
          opened: (now) => {
            setOpen({ kind: 'record', token })
            setLine([...prefix(now.discarded), 'Opened ', { code: token }, '.'])
            after(() => {
              if (how === 'enter') detailHeading.current?.focus()
              else if (now.discarded) toRow()
            })
          },
          refused: (message) => setLine([message]),
          back: toRow,
        }),
      toRow,
    )
  }

  /** The open row's Delete, in its detail's header (0053); while a save of it is out, it waits, and says so. */
  function deleteOpen(): void {
    const now = openRef.current
    if (now?.kind !== 'record') return
    if (saving) setLine([SAVE_OUT])
    else removal.ask(detailTarget(title, now.token, removal.heard(now.token)))
  }

  /** A row's Delete (0053); the open row's waits for a save of it, as its header's Delete does. A row a Drill down level holds names the levels in its confirmation (0094). */
  function deleteRow(row: GridRow): void {
    const now = openRef.current
    const target = rowTarget(title, row, now?.kind === 'record' ? { record: now.token, heard: removal.heard(now.token) } : null)
    if (target === null) return
    if (target.open && saving) grid.current?.say([SAVE_OUT])
    else removal.ask(target)
  }

  /** The row has gone from the page: its detail emptied when open, the grid asked again and saying so first, the keyboard on this section's heading. */
  function rowGone(target: DeleteTarget, word: 'Deleted' | 'Closed', quiet: boolean): void {
    const now = openRef.current
    if (now?.kind === 'record' && now.token === target.record) {
      opening.replaced()
      for (const session of sessions) session.open()
      openRef.current = null
      setOpen(null)
      setLine([])
    }
    grid.current?.removed(gone(target, word))
    levels?.recordGone(child.form, target.record)
    if (!quiet) after(() => sectionHeading.current?.focus())
  }

  function startNew(): void {
    if (parent.kind !== 'record') {
      // Said again, on the line that already says it: emptied, then filled,
      // which a live region hears as a change.
      setWaitingShown(false)
      after(() => setWaitingShown(true))
      return
    }
    const parentToken = parent.token
    if (drill !== undefined) {
      drill.descend({ kind: 'new' }, () => newButton.current?.focus(), (message) => grid.current?.say([message]))
      return
    }
    ask(
      { kind: 'child-new', owner, title },
      (discarded) => {
        opening.replaced()
        for (const session of sessions) session.open({ record: null, version: null, answers: { [child.field]: parentToken } })
        setOpen({ kind: 'new' })
        setLine([...prefix(discarded), `A new ${title}, for ${parentNoun} `, { code: parentToken }, '.'])
        after(() => detailHeading.current?.focus())
      },
      () => newButton.current?.focus(),
    )
  }

  /** A child row saved or created here: the grid shows what is stored, and a created row is the section's (opening.ts). */
  function answered(result: SaveResult, from: (typeof sessions)[number]): void {
    grid.current?.reload()
    opening.answered(result, from, (now) => {
      setOpen({ kind: 'record', token: now.token })
      if (now.discarded) setLine([...prefix(true), 'Opened ', { code: now.token }, '.'])
    })
  }

  return (
    <section className="child" aria-labelledby={headingId}>
      <div className="section-head">
        <h4 id={headingId} className="child-heading" tabIndex={-1} ref={sectionHeading}>
          {twice ? `${title}, ${fieldLabel}` : title}
        </h4>
        {canCreate ? (
          <button
            type="button"
            className="button"
            ref={newButton}
            aria-disabled={waiting ? 'true' : undefined}
            aria-describedby={waiting ? `${headingId}-waiting` : undefined}
            onClick={startNew}
          >
            New {title}
          </button>
        ) : null}
        {parent.kind === 'record' ? <DownloadCsv client={client} formId={child.form} idBase={`${headingId}-export`} query={() => ({ search: '', sort, parent: { field: child.field, record: parent.token }, filter })} /> : null}
      </div>
      {waiting ? (
        <p role="status" id={`${headingId}-waiting`} className="status" data-kind="loading">
          {waitingShown ? waitingText : ''}
        </p>
      ) : (
        <>
          <p className="child-sub">
            <Words said={[`For ${parentNoun} `, { code: parent.token }]} />
          </p>
          <RecordGrid
            ref={grid}
            client={client}
            formId={child.form}
            definition={definition}
            columns={columns}
            labelledBy={headingId}
            noun={title}
            parent={{ field: child.field, record: parent.token }}
            search=""
            filter={filter}
            sort={sort}
            openToken={drill !== undefined ? drill.held : open?.kind === 'record' ? open.token : null}
            canCreate={canCreate}
            quiet
            toolbarStart={
              <>
                <ViewPicker
                  idBase={headingId}
                  views={views}
                  filter={filter}
                  sort={sort}
                  onPick={(picked, sorted) => {
                    setFilter(picked)
                    setSort(sorted)
                  }}
                />
                {filterable.length === 0 ? null : <FilterPanel idBase={`${headingId}-filter`} fields={filterable} filter={filter} onFilter={setFilter} />}
              </>
            }
            refit={refit}
            bench="child-bench"
            {...(canDelete ? { remove: { noun: title, press: deleteRow } } : {})}
            after={removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'row' && definition.deleting !== null ? <DeleteRegion flow={removal} deleting={definition.deleting} level={5} idBase={`${headingId}-row-delete`} /> : null}
            drilling={drill !== undefined}
            onOpen={askRow}
            onSort={setSort}
          />
        </>
      )}
      {open === null ? null : (
        <div className="child-detail" hidden={drill !== undefined}>
          <div className="title-row">
            <h5 id={`${headingId}-detail`} className="child-detail-heading" tabIndex={-1} ref={detailHeading}>
              <Words said={open.kind === 'record' ? [`${title} `, { code: open.token }] : [`New ${title}`]} />
            </h5>
            {canDelete && open.kind === 'record' ? (
              <button type="button" className="button danger" ref={deleteButton} aria-disabled={saving ? 'true' : undefined} aria-describedby={saving ? `${headingId}-delete-waits` : undefined} onClick={deleteOpen}>
                Delete {title}
              </button>
            ) : null}
            {saving ? (
              <span id={`${headingId}-delete-waits`} hidden>
                {SAVE_OUT}
              </span>
            ) : null}
          </div>
          {removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'detail' && definition.deleting !== null ? <DeleteRegion flow={removal} deleting={definition.deleting} level={6} idBase={`${headingId}-delete`} /> : null}
          <p role="status" className="status quiet-line">
            <Words said={line} />
          </p>
          <div className="panes" data-count={renderersOf(renderer).length}>
            {sessions
              .filter((session) => renderersOf(renderer).includes(session.renderer))
              .map((session) => (
                // The paper is named for the child row, so it differs from the record's own form of the same title.
                <Pane key={session.renderer} session={session} title={open.kind === 'record' ? `${title} ${open.token}` : `New ${title}`} level={6} idBase={owner} namedBy={`${headingId}-detail`} onAnswer={(result) => answered(result, session)} />
              ))}
          </div>
        </div>
      )}
    </section>
  )
}
