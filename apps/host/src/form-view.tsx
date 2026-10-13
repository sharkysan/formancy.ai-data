import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react'
import type { DataClient, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { ChildSection } from './children.js'
import type { ChildForm } from './children.js'
import { DeleteRegion } from './delete-confirm.js'
import { useDeleteFlow } from './delete-flow.js'
import { detailTarget, gone, rowTarget, SAVE_OUT } from './deletion.js'
import type { DeleteTarget } from './deletion.js'
import { Detail } from './detail.js'
import type { MasterOpen } from './detail.js'
import { columnsOf } from './grid-datasource.js'
import type { GridRow } from './grid-datasource.js'
import { paneEntry, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { Said } from './leave.js'
import { LAYOUTS } from './layout.js'
import type { Layout, View } from './layout.js'
import { useOpening } from './opening.js'
import { operationTags } from './operations.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { DELETE_COLUMN } from './record-grid.js'
import type { OpenHow, RecordGridHandle, RowAt } from './record-grid.js'
import { Records } from './records.js'
import { Segmented, focusChoice } from './segmented.js'
import { createSession } from './session.js'
import type { SaveResult, Session } from './session.js'
import { Split } from './split.js'

const LAYOUT_LABELS: Readonly<Record<Layout, string>> = { 'side-by-side': 'Side by side', stacked: 'Stacked', separate: 'Separate views' }

const DISCARDED: Said = ['Discarded the unsaved changes. ']

/**
 * The open form's header (UX-SPEC §5.5, §5.6): its heading, which names
 * main, what this person may do with it as tags -- a fill and no border, so
 * they are never taken for buttons -- and the Layout group, which says so
 * when the window draws Side by side stacked.
 */
function FormHead({
  title,
  formId,
  operations,
  layout,
  note,
  headingRef,
  onLayout,
}: {
  title: string
  formId: string
  operations: PublishedForm['operations']
  layout: Layout
  note: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  onLayout: (layout: Layout) => void
}): ReactElement {
  return (
    <div className="form-head">
      <div className="form-id">
        <h2 id="form-heading" className="form-title" tabIndex={-1} ref={headingRef}>
          <span>{title}</span> <code>{formId}</code>
        </h2>
        <ul className="ops" aria-label="Operations">
          {operationTags(operations).map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      </div>
      <Segmented legend="Layout" name="layout" className="layout" options={LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] }))} value={layout} onChange={onLayout} describedBy={note ? 'layout-note' : undefined}>
        {note ? (
          <p className="hint layout-note" id="layout-note">
            In a window this narrow, Side by side is drawn stacked.
          </p>
        ) : null}
      </Segmented>
    </div>
  )
}

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
  historyView,
  narrow,
  renderer,
  split,
  notice,
  headingRef,
  onLayout,
  onView,
  onRenderer,
  onSplit,
  onSplitSettled,
}: {
  client: DataClient
  entry: FormMenuEntry
  definition: PublishedForm
  childForms: readonly ChildForm[]
  layout: Layout
  view: View
  /** How many times Back or Forward has changed the view: each time, the keyboard goes to what the view shows. */
  historyView: number
  /** The window draws Side by side stacked (≤ 56rem). */
  narrow: boolean
  renderer: RendererChoice
  split: number
  notice: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
  onLayout: (layout: Layout) => void
  /** `replace`: the view changed without a step of its own in the history -- after a delete, the record view is not one to go back to. */
  onView: (view: View, replace?: boolean) => void
  onRenderer: (choice: RendererChoice) => void
  onSplit: (share: number) => void
  onSplitSettled: (share: number) => void
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
  /** How many times the separator has been let go: each grid in the lanes fits its columns again. */
  const [released, setReleased] = useState(0)
  const deleteButton = useRef<HTMLButtonElement>(null)

  const title = entry.title
  const canCreate = definition.operations.includes('create')
  const columns = useMemo(() => columnsOf(definition, null), [definition])
  const sessions = useMemo(() => (['react', 'angular'] as const).map((which) => createSession({ client, formId, definition, renderer: which })), [client, formId, definition])
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

  const both = renderer === 'both'
  const say = (said: Said, kind: 'answer' | 'refused' = 'answer'): void => setLine({ said, kind })

  /** In Separate views, `half` shown if it is not, without a step of its own in the history: the page moved there, the person did not. True when it was hidden. */
  function reveal(half: View): boolean {
    if (layout !== 'separate' || view === half) return false
    onView(half, true)
    return true
  }

  /** The detail, with the keyboard on its heading: in Separate views, the record view. */
  function toDetail(): void {
    if (layout === 'separate') onView('record')
    after(() => detailHeading.current?.focus())
  }

  /** The record now open in every pane, and what the detail's line says of it, if anything. */
  function opened(token: string, said?: Said): void {
    setOpen({ kind: 'record', token })
    setLoadRefusal(null)
    if (said !== undefined) say(said)
  }

  function askRow(token: string, how: OpenHow, at: RowAt): void {
    const moves = how === 'enter'
    if (open?.kind === 'record' && open.token === token) {
      if (moves) toDetail()
      return
    }
    const request = { kind: 'row', record: token } as const
    const toRow = (): void => grid.current?.focusAt(at)
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
        for (const session of sessions) session.open()
        setOpen({ kind: 'new' })
        setLoadRefusal(null)
        say([...(discarded ? DISCARDED : []), both ? 'Both forms are empty, for a new record.' : 'The form is empty, for a new record.'])
        toDetail()
      },
      () => newRef.current?.focus(),
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
          opened: (now) => opened(now.token, [...(now.discarded ? DISCARDED : []), 'Loaded record ', { code: token }, both ? ' into both forms.' : ' into the form.']),
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
    if (layout === 'separate') onView('records')
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
  }

  /** The open record's Delete, in the detail's header (0053). While a save of it is out, it waits for the answer, and says so. */
  function deleteOpen(): void {
    const now = openRef.current
    if (now?.kind !== 'record') return
    if (saving) say([SAVE_OUT], 'refused')
    else removal.ask(detailTarget(title, now.token, removal.heard(now.token)))
  }

  /** A row's Delete (0053); the open record's row waits for a save of it, as its header's Delete does. */
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
    const now = openRef.current
    if (now?.kind === 'record' && now.token === target.record) {
      opening.replaced()
      for (const session of sessions) session.open()
      openRef.current = null
      setOpen(null)
      setLoadRefusal(null)
      say([])
    }
    grid.current?.removed(gone(target, word))
    if (quiet) return
    if (layout === 'separate') onView('records', true)
    after(() => recordsHeading.current?.focus())
  }

  // Back or Forward between the two views of Separate views: the half the
  // keyboard was in is hidden now, so it goes where the view's own buttons
  // would send it -- without what those buttons also do, writing an entry,
  // which would drop the one Forward goes to.
  useEffect(() => {
    if (historyView === 0) return
    if (view === 'record' && openRef.current !== null) after(() => detailHeading.current?.focus())
    else if (view === 'records') toOpenRow()
    // On each change made by history, and only then.
  }, [historyView])

  const separate = layout === 'separate'
  const sideBySide = layout === 'side-by-side'
  const note = narrow && sideBySide
  const parent = open?.kind === 'record' ? { kind: 'record' as const, token: open.token } : open?.kind === 'new' ? { kind: 'new' as const } : null
  const twice = (form: string): boolean => childForms.filter((child) => child.child.form === form).length > 1
  const style = { '--records-share': `${String(split)}fr`, '--record-share': `${String(100 - split)}fr` } as CSSProperties

  return (
    <>
      <FormHead title={title} formId={formId} operations={definition.operations} layout={layout} note={note} headingRef={headingRef} onLayout={onLayout} />
      {notice}
      <div className="lanes" data-layout={layout} data-view={separate ? view : 'records'} ref={lanes} style={style}>
        <Records
          ref={grid}
          client={client}
          formId={formId}
          definition={definition}
          columns={columns}
          hidden={separate && view === 'record'}
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
          after={removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'row' && definition.deleting !== null ? <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase="records-delete" /> : null}
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
          hidden={separate && view === 'records'}
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
          canDelete={canDelete}
          saving={saving}
          deleteRef={deleteButton}
          onDelete={deleteOpen}
          deleteRegion={removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'detail' && definition.deleting !== null ? <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase="detail-delete" /> : null}
        >
          {parent === null
            ? null
            : childForms.map((form, index) => (
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
                />
              ))}
        </Detail>
      </div>
    </>
  )
}
