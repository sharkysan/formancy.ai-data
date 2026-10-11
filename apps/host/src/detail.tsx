import type { ReactElement, ReactNode, RefObject } from 'react'
import type { Said } from './leave.js'
import type { Layout } from './layout.js'
import { Pane } from './pane.js'
import { CHOICES, renderersOf } from './panes.js'
import type { RendererChoice } from './prefs.js'
import { RecordBar } from './record-bar.js'
import { Segmented } from './segmented.js'
import type { SaveResult, Session } from './session.js'
import { Words } from './words.js'

/** What the detail shows: nothing yet, a new record, or a saved one by its token. */
export type MasterOpen = null | { kind: 'new' } | { kind: 'record'; token: string }

/**
 * The detail (UX-SPEC §5.10, §5.11): the open record's heading, the way back
 * to its row, a status line, the renderer switch, opening by token, the
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
  children: ReactNode
}): ReactElement {
  const separate = layout === 'separate'
  const shown = renderersOf(renderer)
  const heading: Said = open === null ? ['No record open'] : open.kind === 'new' ? ['New record'] : [`${formTitle} `, { code: open.token }]

  return (
    <section className="detail" id="detail" aria-labelledby="detail-heading" hidden={hidden}>
      <div className="panel detail-head" data-empty={open === null ? '' : undefined}>
        <div className="title-row">
          <h3 id="detail-heading" className="section-heading" tabIndex={-1} ref={headingRef}>
            <Words said={heading} />
          </h3>
          {separate || open?.kind === 'record' ? (
            <button type="button" className={separate ? 'button back' : 'button quiet back'} onClick={onBack}>
              {separate ? (
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              {separate ? 'Back to the records' : 'Go to its row'}
            </button>
          ) : null}
        </div>
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
            <Pane key={session.renderer} session={session} title={formTitle} idBase={formId} onAnswer={(result) => onAnswer(result, session)} />
          ))}
      </div>
      {children}
    </section>
  )
}
