import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { FormEngine } from '@formancy/core'
import { AngularForm } from './angular-mount.js'
import { ReactForm } from './react-form.js'
import type { SaveResult, Session, Submitted } from './session.js'

/** How a renderer is written for a person. */
const NAMES = { react: 'React', angular: 'Angular' } as const

/** What the notice says beside the server's sentence after a stale save: the draft is not lost. */
export const DRAFT_KEPT = 'Your changes are still in the form.'

/** What the saved line says while a save is unanswered. */
export const SAVING = 'Saving…'

/** What the saved line says once "Load the saved record" has replaced the draft. */
export const DISCARDED = 'Loaded the saved record. Your changes were discarded.'

type Notice = { kind: 'stale' | 'refused'; message: string }

/**
 * One renderer's half of the page: a region named by its heading, the saved
 * line, the notice a refused save opens, and the form on white paper in
 * Blueprint.
 *
 * The engine is the session's, read through `useSyncExternalStore`, and
 * everything below the saved line is keyed by how many times the session has
 * opened one: Load, New and "Load the saved record" start that part again --
 * a new engine, and in Angular a new application -- and a save, which keeps
 * the engine, does not.
 *
 * The saved line is the pane's, outside that key, because a live region is
 * heard when its text changes, not when it arrives already holding some: the
 * one that says the draft was discarded, or what a replaced form's save
 * answered, must be there before it speaks. What it said is kept with the
 * generation it was said for, so a new form starts with an empty line.
 */
export function Pane({ session, title }: { session: Session; title: string }): ReactElement {
  const { engine, generation } = useSyncExternalStore(session.subscribe, session.opened)
  const name = NAMES[session.renderer]
  const headingId = `pane-${session.renderer}`
  const heading = useRef<HTMLHeadingElement>(null)
  // The generation "Load the saved record" opened, so the new part can say so
  // and the keyboard can go somewhere deliberate rather than to the page.
  const [reloaded, setReloaded] = useState<number | null>(null)
  const [line, setLine] = useState({ generation, text: '' })
  // Said for the form on screen when it is said: a save answered after Load
  // or New is the replaced form's, and the new form's line is where it goes.
  const say = useCallback((text: string) => setLine({ generation: session.opened().generation, text }), [session])

  useEffect(() => {
    if (reloaded === generation) heading.current?.focus()
  }, [reloaded, generation])

  return (
    <section className="pane" aria-labelledby={headingId}>
      <h2 id={headingId} className="pane-heading" tabIndex={-1} ref={heading}>
        {name}
      </h2>
      <p role="status" className="saved">
        {line.generation === generation ? line.text : ''}
      </p>
      <PaneBody
        key={generation}
        session={session}
        engine={engine}
        name={name}
        title={title}
        headingId={headingId}
        say={say}
        onReload={async () => {
          const problem = await session.reload()
          if (problem === null) {
            setReloaded(session.opened().generation)
            say(DISCARDED)
          }
          return problem
        }}
      />
    </section>
  )
}

function PaneBody({
  session,
  engine,
  name,
  title,
  headingId,
  say,
  onReload,
}: {
  session: Session
  engine: FormEngine
  name: string
  title: string
  headingId: string
  say: (text: string) => void
  onReload: () => Promise<string | null>
}): ReactElement {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sheet, setSheet] = useState<HTMLFormElement | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const noticeId = `${headingId}-notice`

  // A refused save takes the keyboard to what was refused, the way the
  // renderers' error summary does: focused, not announced as an alert, which
  // would say it twice (formancy.ai's ErrorSummary and ResumeNotice).
  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus()
  }, [notice])

  /**
   * What a save's answer does to this part of the pane. It may arrive after
   * this part is gone -- Load or New replaced the form -- when only the
   * pane's line is still there to say it.
   */
  function show(result: SaveResult | null): void {
    if (result?.kind === 'busy' || result?.kind === 'replaced') {
      // About another press, or another form: the notice, if any, is still this form's.
      say(result.message)
      return
    }
    if (result?.kind === 'stale' || result?.kind === 'refused') {
      say('')
      setNotice({ kind: result.kind, message: result.message })
      return
    }
    setNotice(null)
    // A refused selection is said on its field and in the error summary,
    // which takes the focus; this line says only that nothing was saved.
    say(result === null ? '' : result.kind === 'invalid' ? `Not saved. ${result.message}` : result.message)
  }

  async function submit(outcome: Submitted): Promise<void> {
    // The line changes as soon as a save is sent, so the answer is heard even
    // when its words are the last save's: "Saved." twice in a row is no change
    // to a live region, and nothing would be said.
    if (outcome.ok) say(SAVING)
    show(await session.save(outcome))
  }

  async function reload(): Promise<void> {
    const problem = await onReload()
    if (problem !== null) setNotice({ kind: 'refused', message: problem })
  }

  return (
    <>
      {notice === null ? null : (
        <div role="region" aria-labelledby={`${headingId} ${noticeId}`} tabIndex={-1} ref={noticeRef} className="notice" data-kind={notice.kind}>
          <h3 id={noticeId} className="notice-heading">
            Not saved
          </h3>
          <p className="notice-text">{notice.message}</p>
          {notice.kind === 'stale' ? (
            <>
              <p className="notice-text">{DRAFT_KEPT}</p>
              <button type="button" className="button" onClick={() => void reload()}>
                Load the saved record
              </button>
            </>
          ) : null}
        </div>
      )}
      <form className="sheet" aria-label={`${title}, ${name}`} data-formancy-theme="blueprint" noValidate onSubmit={(event) => event.preventDefault()} ref={setSheet}>
        {session.renderer === 'react' ? (
          <ReactForm engine={engine} sources={session.sources} onSubmit={(outcome) => void submit(outcome)} />
        ) : (
          <AngularForm sheet={sheet} engine={engine} sources={session.sources} onSubmit={(outcome) => void submit(outcome)} />
        )}
      </form>
    </>
  )
}
