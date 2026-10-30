import type { ReactElement, ReactNode, RefObject } from 'react'
import type { Said } from './leave.js'
import type { Layout } from './layout.js'
import { Pane } from './pane.js'
import { CHOICES, renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { RecordBar } from './record-bar.js'
import { SAVE_OUT } from './deletion.js'
import { Segmented } from './segmented.js'
import type { SaveResult, Session } from './session.js'
import { Words } from './words.js'

/** What the detail shows: nothing yet, a new record, or a saved one by its token. */
/** What the detail holds: nothing, a new record, a record, or the next version of one (0115). */
export type MasterOpen = null | { kind: 'new' } | { kind: 'record'; token: string } | { kind: 'next'; of: string }

/**
 * The detail (UX-SPEC §5.10, §5.11): the open record's heading, the way back
 * to its row, Duplicate record where the form offers a copy (0107), Delete
 * record where it offers delete and its confirmation in place (0053), a
 * status line, the renderer switch, opening by token, the
 * record's form in the renderers chosen, and the child sections below.
 *
 * Only the chosen renderer's form is mounted (the person's decision of
 * 2026-10-10); "Both" draws them side by side where there is room for two
 * papers and stacked where there is not. Every session stays, mounted or
 * not, and the unsaved-changes guard asks before a switch hides one that
 * holds work.
 */
export function Detail({
  formTitle,
  formId,
  open,
  line,
  layout,
  canCreate,
  hidden,
  headingRef,
  onBack,
  renderer,
  onRenderer,
  tokenOpen,
  onTokenToggle,
  loadRefusal,
  loadRef,
  onLoad,
  sessions,
  onAnswer,
  onLoaded,
  canDuplicate,
  duplicateRef,
  onDuplicate,
  canChange,
  changeRef,
  onChange,
  canDelete,
  saving,
  deleteRef,
  onDelete,
  deleteRegion,
  children,
}: {
  formTitle: string
  formId: string
  open: MasterOpen
  line: { said: Said; kind: 'answer' | 'refused' }
  layout: Layout
  canCreate: boolean
  hidden: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  onBack: () => void
  renderer: RendererChoice
  onRenderer: (choice: RendererChoice) => void
  tokenOpen: boolean
  onTokenToggle: (open: boolean) => void
  loadRefusal: string | null
  loadRef: RefObject<HTMLButtonElement | null>
  onLoad: (token: string) => void
  sessions: readonly Session[]
  onAnswer: (result: SaveResult, session: Session) => void
  /** A pane's "Load the saved record" replaced its draft with what is stored. */
  onLoaded: (session: Session) => void
  /** The form offers this person a copy (0107): Duplicate record in the header of an open record. */
  canDuplicate: boolean
  duplicateRef: RefObject<HTMLButtonElement | null>
  onDuplicate: () => void
  /** The open record is an open version this person may change from a date (0115): Change from a date in its header. */
  canChange: boolean
  changeRef: RefObject<HTMLButtonElement | null>
  onChange: () => void
  /** The form offers this person delete (0053): Delete record in the header of an open record. */
  canDelete: boolean
  /** A save of the record is out: Delete record waits for its answer. */
  saving: boolean
  deleteRef: RefObject<HTMLButtonElement | null>
  onDelete: () => void
  /** The delete's confirmation, right after the header row that holds Delete record. */
  deleteRegion: ReactNode
  children: ReactNode
}): ReactElement {
  const separate = layout === 'separate'
  const shown = renderersOf(renderer)
  const heading: Said = open === null ? ['No record open'] : open.kind === 'new' ? ['New record'] : open.kind === 'next' ? ['Next version of ', { code: open.of }] : [`${formTitle} `, { code: open.token }]

  return (
    <section className="detail" id="detail" aria-labelledby="detail-heading" hidden={hidden}>
      <div className="panel detail-head" data-empty={open === null ? '' : undefined}>
        <div className="title-row">
          <h3 id="detail-heading" className="section-heading" tabIndex={-1} ref={headingRef}>
            <Words said={heading} />
          </h3>
          {/* In Drill down the trail is the way back (0090). */}
          {layout !== 'drill' && (separate || open?.kind === 'record') ? (
            <button type="button" className={separate ? 'button back' : 'button quiet back'} onClick={onBack}>
              {separate ? (
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              {separate ? 'Back to the records' : 'Go to its row'}
            </button>
          ) : null}
          {canDuplicate && open?.kind === 'record' ? (
            <button type="button" className="button" ref={duplicateRef} onClick={onDuplicate}>
              Duplicate record
            </button>
          ) : null}
          {canChange && open?.kind === 'record' ? (
            <button type="button" className="button" ref={changeRef} onClick={onChange}>
              Change from a date
            </button>
          ) : null}
          {canDelete && open?.kind === 'record' ? (
            // An outline in --invalid, never a fill: the one control here that cannot be taken back.
            <button type="button" className="button danger" ref={deleteRef} aria-disabled={saving ? 'true' : undefined} aria-describedby={saving ? 'detail-delete-waits' : undefined} onClick={onDelete}>
              Delete record
            </button>
          ) : null}
          {saving ? (
            <span id="detail-delete-waits" hidden>
              {SAVE_OUT}
            </span>
          ) : null}
        </div>
        {deleteRegion}
        <p role="status" className="status quiet-line" data-kind={line.kind}>
          <Words said={line.said} />
        </p>
        {open === null ? (
          <div className="empty-detail">
            <p>{canCreate ? 'Choose a row under Records, or press New record.' : 'Choose a row under Records.'}</p>
            <p className="keys">
              <kbd>Space</kbd> opens a row. <kbd>Enter</kbd> opens it and moves here.
            </p>
          </div>
        ) : null}
        <div className="detail-tools">
          <Segmented legend="Renderer" name={`renderer-${formId}`} className="renderer" options={CHOICES} value={renderer} onChange={onRenderer} />
          <RecordBar open={tokenOpen} onToggle={onTokenToggle} refusal={loadRefusal} loadRef={loadRef} onLoad={onLoad} />
        </div>
      </div>
      <div className="panes" data-count={shown.length} hidden={open === null}>
        {sessions
          .filter((session) => shown.includes(session.renderer))
          .map((session) => (
            <Pane key={session.renderer} session={session} title={formTitle} idBase={formId} onAnswer={(result) => onAnswer(result, session)} onLoaded={() => onLoaded(session)} />
          ))}
      </div>
      {children}
    </section>
  )
}
