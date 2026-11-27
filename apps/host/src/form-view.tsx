import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import type { DataClient, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import type { ChildForm } from './children.js'
import { trailOf } from './crumbs.js'
import { DeleteRegion } from './delete-confirm.js'
import { useDemo } from './demo-tools.js'
import { useDeleteFlow } from './delete-flow.js'
import { detailTarget, gone, rowTarget, SAVE_OUT } from './deletion.js'
import type { DeleteTarget } from './deletion.js'
import { Detail } from './detail.js'
import { DrillLevel } from './drill-level.js'
import { FormHead, savedWith } from './form-head.js'
import { columnsOf } from './grid-datasource.js'
import type { GridRow } from './grid-datasource.js'
import { useGuardContext } from './guard.js'
import type { Layout, View } from './layout.js'
import { levelOpens } from './lookup-opens.js'
import { renderersOf } from './panes.js'
import { axisOf } from './prefs.js'
import type { Axis, RendererChoice, Shares } from './prefs.js'
import { DELETE_COLUMN } from './record-grid.js'
import type { RecordGridHandle } from './record-grid.js'
import { Records } from './records.js'
import { RecordTabs } from './record-tabs.js'
import { focusChoice } from './segmented.js'
import { useActions } from './selection-bar.js'
import { laneStyle, Split, useLine } from './split.js'
import { Trail } from './trail.js'
import { useDrill } from './use-drill.js'
import type { FormOf } from './use-drill.js'
import { DISCARDED, useMasterRecord } from './use-master-record.js'

/**
 * One open form (0047): its header -- the title and id, what this person
 * may do, the Layout group -- the unsaved notice when a request waits, and
 * the lanes: the Records panel, the line between it and the record in Side
 * by side and in Stacked (0145), and the detail with the record's forms and
 * its child sections, in tabs beside it (0142).
 *
 * Every lane stays mounted in every layout and view: a layout or view change
 * alters classes and `hidden`, nothing else, so it discards no draft and a
 * grid keeps its page, sort and search. Mounted again for another form.
 *
 * The record is the page's, in memory: never in the address (layout.ts).
 * Where the server offers delete, the record's header and each row of the grid ask for
 * one, in place, under what asked (0053, delete-flow.ts); the header offers each action
 * over the open record the server serves too (0162, action-flow.ts), and the bar above
 * the grid each over the records chosen of its page (0166, selection-bar.tsx) and, where
 * the server offers it, their deletion (0174). Each lookup of the record offers Open under
 * its field, which goes a Drill down level below it, from any layout (0141). What the
 * detail holds, and every way it changes, is use-master-record.ts's.
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
  shares,
  notice,
  headingRef,
  onLayout,
  onView,
  onRenderer,
  onSplit,
  onSplitSettled,
  childFormsOf,
  formOf,
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
  /** The records' share of the lanes' width in Side by side, and of the window's height in Stacked. */
  shares: Shares
  notice: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
  /** A layout shown; entering Drill down, on the level it shows; `chose`, the person's in the Layout group, which is kept (0145). */
  onLayout: (layout: Layout, at?: { view: View; level?: number }, chose?: boolean) => void
  /** `replace`: the view changed without a step of its own in the history -- after a delete, the record view is not one to go back to. */
  onView: (view: View, replace?: boolean, level?: number) => void
  onRenderer: (choice: RendererChoice) => void
  onSplit: (axis: Axis, share: number) => void
  onSplitSettled: (axis: Axis, share: number) => void
  /** The children the menu names for a form: each Drill down level's sections. */
  childFormsOf: (formId: string) => Promise<ChildForm[]>
  /** A form a lookup's record opens in (0141), as the menu names it and the server defines it. */
  formOf: FormOf
}): ReactElement {
  const formId = entry.id
  const { ask } = useGuardContext()
  const after = useAfterRender()
  const grid = useRef<RecordGridHandle>(null)
  const lanes = useRef<HTMLDivElement>(null)
  const recordsHeading = useRef<HTMLHeadingElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const demo = useDemo()
  /** How many times the separator has been let go: each grid in the lanes fits its columns again. */
  const [released, setReleased] = useState(0)
  const deleteButton = useRef<HTMLButtonElement>(null)

  const title = entry.title
  const canCreate = definition.operations.includes('create')
  const columns = useMemo(() => columnsOf(definition, null), [definition])
  const drilling = layout === 'drill'
  const both = renderer === 'both'
  /** One view at a time: Separate views' two, or Drill down's levels (0090). */
  const paged = layout === 'separate' || layout === 'drill'
  const master = useMasterRecord({
    client,
    formId,
    definition,
    title,
    childForms,
    both,
    drilling,
    grid,
    after,
    demo,
    toDetail,
    // Read when the detail changes, after `drill` below is made.
    dropLevels: () => drill.dropAll(),
  })
  const { open, openRef, sessions, opening, say } = master
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
      master.load(target.record)
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
    onDrill: (at) => onLayout('drill', { view: 'record', level: at }),
    headingOf: (at) => (at === 0 ? recordsHeading.current : detailHeading.current),
    childFormsOf,
    formOf,
  })
  // The record's actions (0162), and those over a selection (0166): a run reads the record again into its panes, and its row and the sections it names;
  // a deletion of the records chosen (0174) closes the open one where it deleted it, as a delete does, and a change of them (0176) reads it again.
  const actions = useActions({
    client,
    entry,
    definition,
    sessions,
    opening,
    renderer,
    grid,
    drill,
    onReread: master.storedIn,
    onLoad: master.load,
    onGone: dropRecord,
    onShow: reveal,
  })
  /** Open under the record's lookups: its record a level down; refused, said on the detail's line. */
  const offer = drill.offer({ level: 1, owner: 'master' }, levelOpens(definition, null), (message) => say([message], 'refused'))

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
    dropRecord(target.record)
    grid.current?.removed(gone(target, word))
    if (quiet) return
    if (paged) onView('records', true)
    after(() => recordsHeading.current?.focus())
  }

  /** A record gone from the page dropped from every Drill down level that holds it, and closed where it is the open one: its forms emptied (0053, 0094, 0174). */
  function dropRecord(token: string): void {
    drill.levels.recordGone(formId, token)
    master.close(token)
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

  const note = narrow && layout === 'side-by-side'
  const parent = open?.kind === 'record' ? { kind: 'record' as const, token: open.token } : open?.kind === 'new' ? { kind: 'new' as const } : null
  const splitter = useLine(axisOf(layout), shares, lanes)
  const style = laneStyle(shares, splitter)
  /** Drill down's trail: the records, the record, and each level held down to the one shown. */
  const crumbs = trailOf(title, open === null ? null : open.kind === 'record' ? { token: open.token, name: master.name } : 'new', drill.path, drill.shown)

  return (
    <>
      <FormHead
        title={title}
        formId={formId}
        operations={definition.operations}
        layout={layout}
        note={note}
        together={savedWith(definition, title)}
        headingRef={headingRef}
        onLayout={(next) => onLayout(next, next === 'drill' ? drill.enter(open !== null) : undefined, true)}
      />
      {notice}
      {drilling ? <Trail crumbs={crumbs} compact={phone} onUp={(at, button) => drill.up(at, () => button.focus())} /> : null}
      <div className="lanes" data-layout={layout} data-view={paged ? view : 'records'} data-line={splitter?.axis} ref={lanes} style={style}>
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
          newRef={master.newRef}
          searchRef={searchRef}
          search={search}
          refit={released}
          onSearch={setSearch}
          onNew={master.startNew}
          onOpen={master.askRow}
          remove={canDelete ? { noun: title, press: deleteRow } : undefined}
          after={
            removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'row' && definition.deleting !== null ? (
              <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase="records-delete" />
            ) : null
          }
          selection={actions.selection}
          drilling={drilling}
          tree={childForms.find((each) => each.child.form === formId)?.child.field ?? null}
          onTreeOpen={master.openFrom}
        />
        {splitter === null ? null : (
          <Split
            line={splitter}
            controls="master"
            lanes={lanes}
            labelledBy="records-heading"
            onMove={(share) => onSplit(splitter.axis, share)}
            onSettle={(share) => {
              onSplitSettled(splitter.axis, share)
              setReleased((count) => count + 1)
            }}
          />
        )}
        <Detail
          formTitle={title}
          formId={formId}
          open={open}
          line={master.line}
          layout={layout}
          canCreate={canCreate}
          hidden={drilling ? drill.shown !== 1 : paged && view === 'records'}
          headingRef={detailHeading}
          onBack={back}
          renderer={renderer}
          onRenderer={chooseRenderer}
          demo={demo}
          loadRefusal={master.loadRefusal}
          loadRef={master.loadRef}
          onLoad={master.load}
          sessions={sessions}
          onAnswer={master.answered}
          onLoaded={master.loadedSaved}
          canDuplicate={master.canDuplicate}
          duplicateRef={master.duplicateRef}
          onDuplicate={() => master.startCopy('duplicate')}
          canChange={master.canChange}
          changeRef={master.changeRef}
          onChange={() => master.startCopy('change')}
          canDelete={canDelete}
          saving={saving}
          deleteRef={deleteButton}
          onDelete={deleteOpen}
          deleteRegion={
            removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'detail' && definition.deleting !== null ? (
              <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase="detail-delete" />
            ) : null
          }
          running={actions.running}
          offer={offer}
          body={(panes, heading) => (
            <RecordTabs
              client={client}
              childForms={childForms}
              record={master.tabStart}
              heading={heading}
              headingId="detail-heading"
              idBase="detail"
              parentNoun={title}
              parent={parent}
              stored={master.stored}
              renderer={renderer}
              refit={released}
              onShow={() => reveal('record')}
              drill={drill}
              level={1}
              drilling={drilling}
              saveSet={master.saveSet}
            >
              {panes}
            </RecordTabs>
          )}
        />
        {drill.path.map((step) => (
          <DrillLevel
            key={step.key}
            client={client}
            step={step}
            childForms={drill.childrenOf(step.form.id)}
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
