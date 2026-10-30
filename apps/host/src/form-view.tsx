import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react'
import type { DataClient, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { ChildSection } from './children.js'
import type { ChildForm } from './children.js'
import { crumbOf, recordName } from './crumbs.js'
import type { Crumb } from './crumbs.js'
import { DeleteRegion } from './delete-confirm.js'
import { useDeleteFlow } from './delete-flow.js'
import { detailTarget, gone, rowTarget, SAVE_OUT } from './deletion.js'
import type { DeleteTarget } from './deletion.js'
import { Detail } from './detail.js'
import type { MasterOpen } from './detail.js'
import { copiedLine, copyOf, leftOut } from './duplicate.js'
import { DrillLevel } from './drill-level.js'
import { FormHead } from './form-head.js'
import { columnsOf } from './grid-datasource.js'
import type { GridRow } from './grid-datasource.js'
import { paneEntry, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import type { Layout, View } from './layout.js'
import { OneChild } from './one-child.js'
import { useOpening } from './opening.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { DELETE_COLUMN } from './record-grid.js'
import type { OpenHow, RecordGridHandle, RowAt } from './record-grid.js'
import { Records } from './records.js'
import { sectionShown } from './section.js'
import { focusChoice } from './segmented.js'
import { createSession } from './session.js'
import type { SaveResult, Session } from './session.js'
import { Split } from './split.js'
import { Trail } from './trail.js'
import { useDrill } from './use-drill.js'

const DISCARDED: Said = ['Discarded the unsaved changes. ']

/**
 * One open form (0047): its header -- the title and id, what this person
 * may do, the Layout group -- the unsaved notice when a request waits, and
 * the lanes: the Records panel, the separator in Side by side, and the
 * detail with the record's forms and its child sections.
 *
 * Every lane stays mounted in every layout and view: a layout or view change
 * alters classes and `hidden`, nothing else, so it discards no draft and a
 * grid keeps its page, sort and search. Mounted again for another form.
 *
 * The record is the page's, in memory: never in the address (layout.ts).
 * Where the server offers delete, the record's header and each row of the
 * grid ask for one, in place, under what asked (0053, delete-flow.ts).
 */
export function FormView({
  client,
  entry,
  definition,
  childForms,
  layout,
  view,
  level,
  historyView,
  narrow,
  phone,
  renderer,
  split,
  notice,
  headingRef,
  onLayout,
  onView,
  onRenderer,
  onSplit,
  onSplitSettled,
  childFormsOf,
}: {
  client: DataClient
  entry: FormMenuEntry
  definition: PublishedForm
  childForms: readonly ChildForm[]
  layout: Layout
  view: View
  /** In Drill down's record view, the level the address asks for (0090). */
  level: number | undefined
  /** How many times Back or Forward has changed the view: each time, the keyboard goes to what the view shows. */
  historyView: number
  /** The window draws Side by side stacked (≤ 56rem). */
  narrow: boolean
  /** A phone's window (≤ 40rem): Drill down's trail draws its ends. */
  phone: boolean
  renderer: RendererChoice
  split: number
  notice: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
  /** A layout chosen; entering Drill down, on the level it shows. */
  onLayout: (layout: Layout, at?: { view: View; level?: number }) => void
  /** `replace`: the view changed without a step of its own in the history -- after a delete, the record view is not one to go back to. */
  onView: (view: View, replace?: boolean, level?: number) => void
  onRenderer: (choice: RendererChoice) => void
  onSplit: (share: number) => void
  onSplitSettled: (share: number) => void
  /** The children the menu names for a form: each Drill down level's sections. */
  childFormsOf: (formId: string) => Promise<ChildForm[]>
}): ReactElement {
  const formId = entry.id
  const { ask } = useGuardContext()
  const after = useAfterRender()
  const grid = useRef<RecordGridHandle>(null)
  const lanes = useRef<HTMLDivElement>(null)
  const recordsHeading = useRef<HTMLHeadingElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const newRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const loadRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<MasterOpen>(null)
  const openRef = useRef<MasterOpen>(null)
  openRef.current = open
  const [line, setLine] = useState<{ said: Said; kind: 'answer' | 'refused' }>({ said: [], kind: 'answer' })
  const [search, setSearch] = useState('')
  const [tokenOpen, setTokenOpen] = useState(false)
  const [loadRefusal, setLoadRefusal] = useState<string | null>(null)
  /** What the record's crumb calls it, from what is stored (crumbs.ts). */
  const [masterName, setMasterName] = useState<string | null>(null)
  /** The open record's answers as stored -- as read, or as its last save left them -- which a section's condition is read from (0109); null for a new record. */
  const [stored, setStored] = useState<Readonly<Record<string, unknown>> | null>(null)
  /** How many times the separator has been let go: each grid in the lanes fits its columns again. */
  const [released, setReleased] = useState(0)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const duplicateButton = useRef<HTMLButtonElement>(null)

  const title = entry.title
  const canCreate = definition.operations.includes('create')
  /** What a copy carries (0107): `null` from the server where it offers no create, and then no Duplicate record. */
  const copied = definition.copied ?? []
  const columns = useMemo(() => columnsOf(definition, null), [definition])
  const sessions = useMemo(
    () => (['react', 'angular'] as const).map((which) => createSession({ client, formId, definition, renderer: which })),
    [client, formId, definition],
  )
  const entries = useMemo<PaneEntry[]>(
    () =>
      sessions.map((session) =>
        paneEntry('master', session, (): Said => {
          const now = openRef.current
          return now?.kind === 'record' ? [`${title} `, { code: now.token }] : ['New record']
        }),
      ),
    [sessions, title],
  )
  useRegistered(entries)
  const opening = useOpening({ client, formId, owner: 'master', sessions })
  const canDelete = definition.operations.includes('delete') && definition.deleting !== null
  const removal = useDeleteFlow({
    client,
    formId,
    owner: 'master',
    sessions,
    discards: { kind: 'new' },
    // Read when a Delete asks, after `drill` below is made.
    held: (target) => drill.levels.atRisk(formId, target.record),
    onGone: (target, word, quiet) => recordGone(target, word, quiet),
    onLoad: (target) => {
      // The row's version moves with the record: the grid lists it again.
      grid.current?.reload()
      load(target.record)
    },
    onBack: (target) => {
      if (target.from.kind === 'detail') deleteButton.current?.focus()
      // The row by its record, which a search, a sort or a page may have moved or taken away: then the grid's heading.
      else if (grid.current?.focusRecord(target.record, DELETE_COLUMN) !== true) recordsHeading.current?.focus()
    },
    onShow: (target) => reveal(target.from.kind === 'detail' ? 'record' : 'records'),
  })
  const { saving } = removal
  const drill = useDrill({
    client,
    layout,
    view,
    level,
    historyView,
    open: open !== null,
    onView,
    headingOf: (at) => (at === 0 ? recordsHeading.current : detailHeading.current),
    childFormsOf,
  })
  const drilling = layout === 'drill'
  const nameOf = (session: Session): string | null => recordName(definition.form.model.fields, session.saved().answers, null)

  const both = renderer === 'both'
  /** One view at a time: Separate views' two, or Drill down's levels (0090). */
  const paged = layout === 'separate' || layout === 'drill'
  const say = (said: Said, kind: 'answer' | 'refused' = 'answer'): void => setLine({ said, kind })

  /** In Separate views, `half` shown if it is not, without a step of its own in the history: the page moved there, the person did not; in Drill down, its level, 0 or 1. True when it was hidden. */
  function reveal(half: View): boolean {
    const hidden = drilling ? drill.shown !== (half === 'records' ? 0 : 1) : paged && view !== half
    if (!hidden) return false
    onView(half, true, half === 'record' ? 1 : undefined)
    return true
  }

  /** The detail, with the keyboard on its heading: in Separate views, the record view; in Drill down, level 1. */
  function toDetail(): void {
    if (paged) onView('record', false, 1)
    after(() => detailHeading.current?.focus())
  }

  /** The record now open in every pane, and what the detail's line says of it, if anything. */
  function opened(token: string, said?: Said): void {
    drill.dropAll()
    setOpen({ kind: 'record', token })
    setMasterName(sessions[0] === undefined ? null : nameOf(sessions[0]))
    setStored(sessions[0]?.saved().answers ?? null)
    setLoadRefusal(null)
    if (said !== undefined) say(said)
  }

  function askRow(token: string, how: OpenHow, at: RowAt): void {
    openFrom(token, how, () => grid.current?.focusAt(at))
  }

  /** A record opened from the grid or the tree (0110), through the guard; `toRow` gives the keyboard back to where it was opened from. */
  function openFrom(token: string, how: OpenHow, toRow: () => void): void {
    // In Drill down every open goes down a level: a click and Space too (0090).
    const moves = how === 'enter' || drilling
    if (open?.kind === 'record' && open.token === token) {
      if (moves) toDetail()
      return
    }
    const request = { kind: 'row', record: token } as const
    ask(
      request,
      (discarded) =>
        opening.read(request, token, discarded, {
          opened: (now) => {
            opened(now.token, [...(now.discarded ? DISCARDED : []), 'Opened ', { code: token }, '.'])
            if (moves) toDetail()
            else if (now.discarded) after(toRow)
          },
          refused: (message, dropped) => {
            say([message], 'refused')
            if (dropped) after(toRow)
          },
          back: toRow,
        }),
      toRow,
    )
  }

  function startNew(): void {
    ask(
      { kind: 'new' },
      (discarded) => {
        opening.replaced()
        drill.dropAll()
        for (const session of sessions) session.open()
        setOpen({ kind: 'new' })
        setMasterName(null)
        setStored(null)
        setLoadRefusal(null)
        say([...(discarded ? DISCARDED : []), both ? 'Both forms are empty, for a new record.' : 'The form is empty, for a new record.'])
        toDetail()
      },
      () => newRef.current?.focus(),
    )
  }

  /**
   * Duplicate record (0107): the open record read again, and every pane
   * opened on a copy of it as a new record -- the answers the server names,
   * no token, no version -- after asking, as New does, about work the
   * detail holds. The line says what was copied and what was not.
   */
  function startDuplicate(): void {
    const now = openRef.current
    if (now?.kind !== 'record') return
    const request = { kind: 'duplicate', record: now.token } as const
    const back = (): void => duplicateButton.current?.focus()
    ask(
      request,
      (discarded) =>
        opening.read(
          request,
          now.token,
          discarded,
          {
            opened: (done, record) => {
              drill.dropAll()
              setOpen({ kind: 'new' })
              setMasterName(null)
              setStored(null)
              setLoadRefusal(null)
              say([...(done.discarded ? DISCARDED : []), ...copiedLine(done.token, leftOut(definition.form.model.fields, record, copied), both)])
              toDetail()
            },
            refused: (message) => say([message], 'refused'),
            back,
          },
          (record) => copyOf(record, copied),
        ),
      back,
    )
  }

  function load(token: string): void {
    setLoadRefusal(null)
    const request = { kind: 'load', record: token } as const
    const toLoad = (): void => loadRef.current?.focus()
    ask(
      request,
      (discarded) =>
        opening.read(request, token, discarded, {
          opened: (now) =>
            opened(now.token, [...(now.discarded ? DISCARDED : []), 'Loaded record ', { code: token }, both ? ' into both forms.' : ' into the form.']),
          refused: (message) => {
            setLoadRefusal(message)
            setTokenOpen(true)
          },
          back: toLoad,
        }),
      toLoad,
    )
  }

  /** The keyboard on the open row: its cell when it is on this page, otherwise the Records heading, which says so. */
  function toOpenRow(): void {
    after(() => {
      const now = openRef.current
      if (now?.kind === 'record' && grid.current?.focusRecord(now.token) === true) return
      recordsHeading.current?.focus()
      if (now?.kind === 'record') grid.current?.say(['Record ', { code: now.token }, ' is not on this page.'])
    })
  }

  /** Back to the records, or to the open row beside them. */
  function back(): void {
    if (paged) onView('records')
    toOpenRow()
  }

  function chooseRenderer(choice: RendererChoice): void {
    const hides = renderersOf(renderer).filter((which) => !renderersOf(choice).includes(which))
    const shows = { react: 'React', angular: 'Angular', both: 'Both' }[choice]
    ask(
      { kind: 'renderer', hides, shows },
      (discarded) => {
        onRenderer(choice)
        if (discarded) say([...DISCARDED, `Showing ${shows}.`])
      },
      () => focusChoice(`renderer-${formId}`, renderer),
    )
  }

  /** A save the server answered in the record's panes: the grid shows what is stored, and a created record is the detail's (opening.ts). */
  function answered(result: SaveResult, session: Session): void {
    grid.current?.reload()
    opening.answered(result, session, (now) => opened(now.token, now.discarded ? [...DISCARDED, 'Opened ', { code: now.token }, '.'] : undefined))
    if (result.kind !== 'saved') return
    setMasterName(nameOf(session))
    setStored(session.saved().answers)
  }

  /** A pane's "Load the saved record": the grid and the crumb say what is stored, as after a save. */
  function loadedSaved(session: Session): void {
    grid.current?.reload()
    setMasterName(nameOf(session))
    setStored(session.saved().answers)
  }

  /** The open record's Delete, in the detail's header (0053). While a save of it is out, it waits for the answer, and says so. */
  function deleteOpen(): void {
    const now = openRef.current
    if (now?.kind !== 'record') return
    if (saving) say([SAVE_OUT], 'refused')
    else removal.ask(detailTarget(title, now.token, removal.heard(now.token)))
  }

  /** A row's Delete (0053); the open record's row waits for a save of it, as its header's Delete does. A row a Drill down level holds -- a form that is its own child -- names the levels in its confirmation (0094). */
  function deleteRow(row: GridRow): void {
    const now = openRef.current
    const target = rowTarget(title, row, now?.kind === 'record' ? { record: now.token, heard: removal.heard(now.token) } : null)
    if (target === null) return
    if (target.open && saving) grid.current?.say([SAVE_OUT])
    else removal.ask(target)
  }

  /**
   * The record has gone from the page: deleted, or not found and closed.
   * Open, the detail is emptied; the grid asks for its page again and says
   * so first; and the keyboard goes to the Records heading -- in Separate
   * views the records view, without a step back to the record view. Quiet
   * when the person moved on before the answer: the grid alone hears it.
   */
  function recordGone(target: DeleteTarget, word: 'Deleted' | 'Closed', quiet: boolean): void {
    drill.levels.recordGone(formId, target.record)
    const now = openRef.current
    if (now?.kind === 'record' && now.token === target.record) {
      opening.replaced()
      drill.dropAll()
      for (const session of sessions) session.open()
      openRef.current = null
      setOpen(null)
      setLoadRefusal(null)
      say([])
    }
    grid.current?.removed(gone(target, word))
    if (quiet) return
    if (paged) onView('records', true)
    after(() => recordsHeading.current?.focus())
  }

  // Back or Forward between the two views of Separate views: the half the
  // keyboard was in is hidden now, so it goes where the view's own buttons
  // would send it -- without what those buttons also do, writing an entry,
  // which would drop the one Forward goes to.
  useEffect(() => {
    // Drill down's levels from 2 down are the drill's own (use-drill.ts).
    if (historyView === 0 || (drilling && drill.shown >= 2)) return
    if (view === 'record' && openRef.current !== null) after(() => detailHeading.current?.focus())
    else if (view === 'records') toOpenRow()
    // On each change made by history, and only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it runs on each change made by history, from the render that saw it, so what it reads is current
  }, [historyView])

  const sideBySide = layout === 'side-by-side'
  const note = narrow && sideBySide
  const parent = open?.kind === 'record' ? { kind: 'record' as const, token: open.token } : open?.kind === 'new' ? { kind: 'new' as const } : null
  const twice = (form: string): boolean => childForms.filter((child) => child.child.form === form).length > 1
  const style = { '--records-share': `${String(split)}fr`, '--record-share': `${String(100 - split)}fr` } as CSSProperties
  /** Drill down's trail: the records, the record, and each level held down to the one shown. */
  const crumbs: Crumb[] = [
    { level: 0, said: ['Records'] },
    ...(open === null ? [] : [crumbOf(1, title, open.kind === 'record' ? { token: open.token, name: masterName } : null)]),
    ...drill.path.map((step) => crumbOf(step.level, step.form.menu.title, step.token === null ? null : { token: step.token, name: step.name })),
  ].slice(0, drill.shown + 1)

  return (
    <>
      <FormHead
        title={title}
        formId={formId}
        operations={definition.operations}
        layout={layout}
        note={note}
        headingRef={headingRef}
        onLayout={(next) => (next === 'drill' ? onLayout(next, drill.enter(open !== null)) : onLayout(next))}
      />
      {notice}
      {drilling ? <Trail crumbs={crumbs} compact={phone} onUp={(at, button) => drill.up(at, () => button.focus())} /> : null}
      <div className="lanes" data-layout={layout} data-view={paged ? view : 'records'} ref={lanes} style={style}>
        <Records
          gridRef={grid}
          client={client}
          formId={formId}
          definition={definition}
          columns={columns}
          hidden={drilling ? drill.shown !== 0 : paged && view === 'record'}
          openToken={open?.kind === 'record' ? open.token : null}
          canCreate={canCreate}
          headingRef={recordsHeading}
          newRef={newRef}
          searchRef={searchRef}
          search={search}
          refit={released}
          onSearch={setSearch}
          onNew={startNew}
          onOpen={askRow}
          remove={canDelete ? { noun: title, press: deleteRow } : undefined}
          after={
            removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'row' && definition.deleting !== null ? (
              <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase="records-delete" />
            ) : null
          }
          drilling={drilling}
          tree={childForms.find((each) => each.child.form === formId)?.child.field ?? null}
          onTreeOpen={openFrom}
        />
        {sideBySide ? (
          <Split
            share={split}
            lanes={lanes}
            labelledBy="records-heading"
            onMove={onSplit}
            onSettle={(share) => {
              onSplitSettled(share)
              setReleased((count) => count + 1)
            }}
          />
        ) : null}
        <Detail
          formTitle={title}
          formId={formId}
          open={open}
          line={line}
          layout={layout}
          canCreate={canCreate}
          hidden={drilling ? drill.shown !== 1 : paged && view === 'records'}
          headingRef={detailHeading}
          onBack={back}
          renderer={renderer}
          onRenderer={chooseRenderer}
          tokenOpen={tokenOpen}
          onTokenToggle={setTokenOpen}
          loadRefusal={loadRefusal}
          loadRef={loadRef}
          onLoad={load}
          sessions={sessions}
          onAnswer={answered}
          onLoaded={loadedSaved}
          canDuplicate={copied.length > 0}
          duplicateRef={duplicateButton}
          onDuplicate={startDuplicate}
          canDelete={canDelete}
          saving={saving}
          deleteRef={deleteButton}
          onDelete={deleteOpen}
          deleteRegion={
            removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'detail' && definition.deleting !== null ? (
              <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase="detail-delete" />
            ) : null
          }
        >
          {parent === null
            ? null
            : childForms.map((form, index) =>
                form.child.one ? (
                  sectionShown(form.child, stored) ? (
                    <OneChild
                      key={`${form.child.form}~${form.child.field} ${parent.kind === 'record' ? parent.token : 'new'}`}
                      client={client}
                      form={form}
                      index={index}
                      parentNoun={title}
                      parent={parent}
                      renderer={renderer}
                    />
                  ) : null
                ) : (
                  <ChildSection
                    key={`${form.child.form}~${form.child.field} ${parent.kind === 'record' ? parent.token : 'new'}`}
                    client={client}
                    form={form}
                    index={index}
                    twice={twice(form.child.form)}
                    parentNoun={title}
                    parent={parent}
                    renderer={renderer}
                    refit={released}
                    onShow={() => reveal('record')}
                    levels={drill.levels}
                    drill={
                      drilling && parent.kind === 'record'
                        ? drill.section({ level: 1, owner: `${form.child.form}~${form.child.field}`, form, parentNoun: title, parent: parent.token })
                        : undefined
                    }
                  />
                ),
              )}
        </Detail>
        {drill.path.map((step) => (
          <DrillLevel
            key={step.key}
            client={client}
            step={step}
            childForms={drill.childrenOf(step.form.child.form)}
            renderer={renderer}
            hidden={!drilling || drill.shown !== step.level}
            refit={released}
            drill={drill}
          />
        ))}
      </div>
    </>
  )
}
