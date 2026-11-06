import { useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DataClient } from '@formancy/data-client'
import type { ChildForm } from './children.js'
import { recordName } from './crumbs.js'
import { DeleteRegion } from './delete-confirm.js'
import { useDeleteFlow } from './delete-flow.js'
import { detailTarget, SAVE_OUT } from './deletion.js'
import { paneEntry, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import { drillBase, drillOwner } from './leave.js'
import type { Said } from './leave.js'
import { levelOpens } from './lookup-opens.js'
import { useOpening } from './opening.js'
import { Pane } from './pane.js'
import { renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { RecordTabs } from './record-tabs.js'
import { createSession } from './session.js'
import type { SaveResult, Session } from './session.js'
import type { Drill, DrillStep } from './use-drill.js'
import { Words } from './words.js'

type LevelOpen = { kind: 'new' } | { kind: 'record'; token: string }

/**
 * One level of Drill down from 2 down (0090): a child row of the level
 * above, as a section's rail shows one -- its heading, Delete where its form
 * offers it, a status line, its form in the renderers chosen, with the
 * parent's field preset and drawn disabled -- and beside it, in tabs as
 * the open record's are (0142), the child sections the menu names for its
 * own form, which go down a level in turn.
 * Or the record a lookup of the level above names, opened by its Open in a
 * form of the person's choosing (0141): the same, with no field preset.
 * Its record's lookups offer Open in turn, a level further down.
 *
 * Its sessions are its own, owned under its level (`drillOwner`), so a form
 * that is its own child mints no element id twice and the guard drops a
 * level with every level above it. Mounted once per step: a row replaced
 * is a level mounted again.
 */
export function DrillLevel({
  client,
  step,
  childForms,
  renderer,
  hidden,
  refit,
  drill,
}: {
  client: DataClient
  step: DrillStep
  /** The children the menu names for this level's form; null until they answer. */
  childForms: readonly ChildForm[] | null
  renderer: RendererChoice
  hidden: boolean
  refit: number
  drill: Drill
}): ReactElement {
  const { level, form, through } = step
  const { id: formId, menu, definition } = form
  const owner = drillOwner(level, formId, through.field)
  /** The field naming the level above: a child row's parent, which the page fills in; a lookup's record has none. */
  const parentField = through.kind === 'child' ? through.field : null
  const idBase = `drill-${String(level)}`
  const headingId = `${idBase}-heading`
  const title = menu.title
  const deleteButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<LevelOpen>(step.token === null ? { kind: 'new' } : { kind: 'record', token: step.token })
  const openRef = useRef(open)
  openRef.current = open
  const [line, setLine] = useState<Said>(step.said)
  /** The level's record as stored, which a section's condition is read from (0109); null while it is new. */
  const [stored, setStored] = useState<Readonly<Record<string, unknown>> | null>(step.record === null ? null : step.record.answers)

  // Opened once, as the level is placed: with the record read, or new under the parent.
  const sessions = useMemo(
    () =>
      (['react', 'angular'] as const).map((which) => {
        const session = createSession({ client, formId, definition, renderer: which, namespace: owner, fixed: parentField === null ? [] : [parentField] })
        const answers = through.kind === 'child' ? { [through.field]: through.parent } : {}
        session.open(step.record === null ? { record: null, version: null, answers } : structuredClone(step.record))
        return session
      }),
    // A level is mounted again for another step: these never change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a level's sessions are made once as it is placed, and a level is mounted again for another step, so none of these changes under it
    [],
  )
  const entries = useMemo<PaneEntry[]>(
    () =>
      sessions.map((session) =>
        paneEntry(owner, session, (): Said => {
          const now = openRef.current
          return now.kind === 'record' ? [`${title} `, { code: now.token }] : [`New ${title}`]
        }),
      ),
    [sessions, owner, title],
  )
  useRegistered(entries)
  const opening = useOpening({ client, formId, owner, sessions })
  const canDelete = menu.operations.includes('delete') && definition.operations.includes('delete') && definition.deleting !== null
  const removal = useDeleteFlow({
    client,
    formId,
    owner,
    sessions,
    discards: { kind: 'drill-delete', below: level - 1, record: open.kind === 'record' ? open.token : '' },
    onGone: (target, word, quiet) => {
      opening.replaced()
      drill.gone(step, target, word, quiet)
    },
    onLoad: (target) => {
      // The stored record read again into this level's forms: what it replaces is this level's own.
      const request = { kind: 'child-row', owner, record: target.record } as const
      opening.read(request, target.record, false, {
        opened: (now, record) => {
          setLine(['Opened ', { code: now.token }, '.'])
          setStored(record.answers)
        },
        refused: (message) => setLine([message]),
        back: () => deleteButton.current?.focus(),
      })
    },
    onBack: () => deleteButton.current?.focus(),
    onShow: () => drill.reveal(level),
  })
  const { saving } = removal

  const nameOf = (session: Session): string | null => recordName(definition.form.model.fields, session.saved().answers, parentField)

  /** Open under this level's lookups (0141), but its parent field (`opensBelow`): its record a level further down; refused, said on this level's line. Made once, as the renderers keep one offer (steady-offer.ts). */
  const opens = useMemo(() => levelOpens(definition, parentField), [definition, parentField])
  const offer = drill.offer({ level, owner }, opens, (message) => setLine([message]))

  /** A save one of this level's forms answered: a created row is the level's, and its crumb names what is stored. */
  function answered(result: SaveResult, from: Session): void {
    if (result.kind === 'saved' || result.kind === 'created') setStored(from.saved().answers)
    opening.answered(result, from, (now) => {
      setOpen({ kind: 'record', token: now.token })
      if (now.discarded) setLine(['Discarded the unsaved changes. ', 'Opened ', { code: now.token }, '.'])
      drill.saved(step, now.token, nameOf(from))
    })
    const now = openRef.current
    if (result.kind === 'saved' && now.kind === 'record') drill.saved(step, now.token, nameOf(from))
  }

  /** A form's "Load the saved record": the crumb and the section above say what is stored, as after a save. */
  function loaded(from: Session): void {
    setStored(from.saved().answers)
    const now = openRef.current
    if (now.kind === 'record') drill.saved(step, now.token, nameOf(from))
  }

  /** This level's Delete, in its header (0053); while a save of it is out, it waits, and says so. */
  function deleteOpen(): void {
    const now = openRef.current
    if (now.kind !== 'record') return
    if (saving) setLine([SAVE_OUT])
    else removal.ask(detailTarget(title, now.token, removal.heard(now.token)))
  }

  const heading: Said = open.kind === 'record' ? [`${title} `, { code: open.token }] : [`New ${title}`]
  const parentNow = open.kind === 'record' ? { kind: 'record' as const, token: open.token } : { kind: 'new' as const }

  return (
    <section className="detail drill-level" aria-labelledby={headingId} hidden={hidden}>
      <div className="panel detail-head">
        <div className="title-row">
          <h3 id={headingId} className="section-heading" tabIndex={-1} ref={drill.headingRef(level)}>
            <Words said={heading} />
          </h3>
          {canDelete && open.kind === 'record' ? (
            <button
              type="button"
              className="button danger"
              ref={deleteButton}
              aria-disabled={saving ? 'true' : undefined}
              aria-describedby={saving ? `${idBase}-delete-waits` : undefined}
              onClick={deleteOpen}
            >
              Delete {title}
            </button>
          ) : null}
          {saving ? (
            <span id={`${idBase}-delete-waits`} hidden>
              {SAVE_OUT}
            </span>
          ) : null}
        </div>
        {removal.deletion.state !== 'idle' && removal.deletion.target.from.kind === 'detail' && definition.deleting !== null ? (
          <DeleteRegion flow={removal} deleting={definition.deleting} level={4} idBase={`${idBase}-delete`} />
        ) : null}
        <p role="status" className="status quiet-line">
          <Words said={line} />
        </p>
      </div>
      <RecordTabs
        client={client}
        childForms={childForms ?? []}
        record={open}
        heading={heading}
        headingId={headingId}
        idBase={idBase}
        childIdBase={`${idBase}-child`}
        ownerBase={drillBase(level)}
        parentNoun={title}
        parent={parentNow}
        stored={stored}
        renderer={renderer}
        refit={refit}
        onShow={() => drill.reveal(level)}
        drill={drill}
        level={level}
        drilling
      >
        {(show) => (
          <div className="panes" data-count={renderersOf(renderer).length}>
            {sessions
              .filter((session) => renderersOf(renderer).includes(session.renderer))
              .map((session) => (
                // The paper is named for the row, so it differs from a level above of the same form.
                <Pane
                  key={session.renderer}
                  session={session}
                  title={open.kind === 'record' ? `${title} ${open.token}` : `New ${title}`}
                  idBase={owner}
                  namedBy={headingId}
                  onAnswer={(result) => answered(result, session)}
                  onLoaded={() => loaded(session)}
                  offer={offer}
                  onShow={show}
                />
              ))}
          </div>
        )}
      </RecordTabs>
    </section>
  )
}
