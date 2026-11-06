import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { FormEngine } from '@formancy/core'
import type { FormRecord } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { AngularForm } from './angular-mount.js'
import type { LookupOffer } from './lookup-opens.js'
import { ReactForm } from './react-form.js'
import { ServerDid } from './server-did.js'
import type { SaveResult, Session, Submitted } from './session.js'
import { useSteadyOffer } from './steady-offer.js'
import { UnknownNotice } from './unknown-notice.js'
import { NoticeHeading } from './words.js'

/** How a renderer is written for a person. */
const NAMES = { react: 'React', angular: 'Angular' } as const

/** What the notice says beside the server's sentence after a stale save: the draft is not lost. */
export const DRAFT_KEPT = 'Your changes are still in the form.'

/** What the saved line says while a save is unanswered. */
export const SAVING = 'Saving…'

/** What the saved line says once "Load the saved record" has replaced the draft. */
export const DISCARDED = 'Loaded the saved record. Your changes were discarded.'

/** What the saved line's colour repeats: the server's answer, a save still out, or a refusal (UX-SPEC §5.11). */
type Kind = 'answer' | 'pending' | 'refused'

/** What a save opened, and the how-manyth notice it is: a new one is drawn afresh, never over the last one's state. */
type Notice = { kind: 'stale' | 'refused' | 'unknown'; message: string; n: number }

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
 * What a save the server answered says -- "Saved.", "Created record …" --
 * is drawn in the room's teal for a moment (0146), a state's move among
 * them, which is a save of its field (0127); a save still out, a refusal
 * and the pane's own words are not.
 *
 * The saved line is the pane's, outside that key, because a live region is
 * heard when its text changes, not when it arrives already holding some: the
 * one that says the draft was discarded, or what a replaced form's save
 * answered, must be there before it speaks. What it said is kept with the
 * generation it was said for, so a new form starts with an empty line.
 *
 * Given an `offer`, each lookup the server names forms for offers Open
 * under its field, in the paper (0141). The renderers are handed one offer
 * while its Opens say the same, a press read through a ref
 * (steady-offer.ts), so neither redraws a field for a render of the page,
 * nor Angular starts again.
 *
 * Where the record's tabs hide the pane (0142), a refused save's notice,
 * or the renderer's summary of a refused answer, which take the keyboard,
 * show its tab first (`onShow`): nothing hidden takes the keyboard, and a
 * refusal said there is heard by nobody.
 */
export function Pane({
  session,
  title,
  level = 4,
  idBase,
  namedBy,
  onAnswer,
  onLoaded,
  offer,
  onShow,
}: {
  session: Session
  title: string
  /** The heading's level: under the detail's h3, or a child row's h5 (0047). */
  level?: 4 | 6
  /** What the pane's element ids start with: the session's namespace, unique on the page. */
  idBase: string
  /** A child row's heading, which names its panes first, so no two regions share a name. */
  namedBy?: string
  /** A save the server answered with a record: the workspace shows it in its grid. */
  onAnswer?: (result: SaveResult) => void
  /** The stored record replaced the draft, by "Load the saved record": the workspace shows what is stored, as after a save. */
  onLoaded?: () => void
  /** Open under each lookup of the record (0141); none under a child row's rail. */
  offer?: LookupOffer
  /** The pane's tab shown, where the record's tabs hide it: true when it was hidden, and is drawn on the next render (0142). */
  onShow?: (() => boolean) | undefined
}): ReactElement {
  const { engine, generation } = useSyncExternalStore(session.subscribe, session.opened)
  const steady = useSteadyOffer(offer)
  const name = NAMES[session.renderer]
  const headingId = `pane-${idBase}-${session.renderer}`
  const Heading = level === 4 ? 'h4' : 'h6'
  const heading = useRef<HTMLHeadingElement>(null)
  // The generation "Load the saved record" opened, so the new part can say so
  // and the keyboard can go somewhere deliberate rather than to the page.
  const [reloaded, setReloaded] = useState<number | null>(null)
  const [line, setLine] = useState<{ generation: number; text: string; kind: Kind; said: number | null }>({ generation, text: '', kind: 'answer', said: null })
  /** How many saves the line has said the server answered: each is drawn in teal anew (0146). */
  const saves = useRef(0)
  // Said for the form on screen when it is said: a save answered after Load
  // or New is the replaced form's, and the new form's line is where it goes.
  const say = useCallback(
    (text: string, kind: Kind = 'answer', stored = false) => {
      if (stored) saves.current += 1
      setLine({ generation: session.opened().generation, text, kind, said: stored ? saves.current : null })
    },
    [session],
  )

  useEffect(() => {
    if (reloaded === generation) heading.current?.focus()
  }, [reloaded, generation])

  /** The stored record replaces the draft: said on the line, and the keyboard on the heading. */
  const loaded = useCallback(() => {
    setReloaded(session.opened().generation)
    say(DISCARDED)
    onLoaded?.()
  }, [session, say, onLoaded])

  return (
    <section className="pane" aria-labelledby={namedBy === undefined ? headingId : `${namedBy} ${headingId}`}>
      <div className="pane-top">
        <Heading id={headingId} className="pane-heading" tabIndex={-1} ref={heading}>
          {name}
        </Heading>
        <p role="status" className="saved" data-kind={line.kind}>
          {line.generation !== generation ? '' : line.said === null ? line.text : <ServerDid said={line.said}>{line.text}</ServerDid>}
        </p>
      </div>
      <PaneBody
        key={generation}
        session={session}
        engine={engine}
        name={name}
        title={title}
        headingId={headingId}
        named={namedBy === undefined ? headingId : `${namedBy} ${headingId}`}
        noticeLevel={level}
        say={say}
        offer={steady}
        onAnswer={onAnswer}
        onReload={async () => {
          const problem = await session.reload()
          if (problem === null) loaded()
          return problem
        }}
        onLoad={(record) => {
          session.open(record)
          loaded()
        }}
        onShow={onShow}
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
  named,
  noticeLevel,
  say,
  offer,
  onAnswer,
  onReload,
  onLoad,
  onShow,
}: {
  session: Session
  engine: FormEngine
  name: string
  title: string
  headingId: string
  /** The ids that name the pane: a notice is named by them and its own heading. */
  named: string
  noticeLevel: 4 | 6
  /** `stored`: the server saved or created the record, which the line says in teal for a moment. */
  say: (text: string, kind?: Kind, stored?: boolean) => void
  offer: LookupOffer | undefined
  onAnswer: ((result: SaveResult) => void) | undefined
  onReload: () => Promise<string | null>
  onLoad: (record: FormRecord) => void
  onShow: (() => boolean) | undefined
}): ReactElement {
  const [notice, setNotice] = useState<Notice | null>(null)
  const opened = useRef(0)
  const open = (kind: Notice['kind'], message: string): void => {
    opened.current += 1
    setNotice({ kind, message, n: opened.current })
  }
  const [sheet, setSheet] = useState<HTMLFormElement | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const noticeId = `${headingId}-notice`

  // The pane's tab, as of the last render: a save's answer comes later.
  const toShow = useRef(onShow)
  toShow.current = onShow
  const after = useAfterRender()

  // A refused save takes the keyboard to what was refused, the way the
  // renderers' error summary does: focused, not announced as an alert, which
  // would say it twice (formancy.ai's ErrorSummary and ResumeNotice). In a
  // tab another hides, once the tab is shown (0142).
  useEffect(() => {
    if (notice === null) return
    const focus = (): void => noticeRef.current?.focus()
    if (toShow.current?.() === true) after(focus)
    else focus()
  }, [notice, after])

  /**
   * What a save's answer does to this part of the pane. It may arrive after
   * this part is gone -- Load or New replaced the form -- when only the
   * pane's line is still there to say it.
   */
  function show(result: SaveResult | null): void {
    if (result?.kind === 'busy' || result?.kind === 'replaced' || result?.kind === 'held') {
      // About another press, or another form: the notice, if any, is still this form's.
      // A press that sent nothing is refused; a replaced form's answer is an answer.
      say(result.message, result.kind === 'replaced' ? 'answer' : 'refused')
      return
    }
    if (result?.kind === 'stale' || result?.kind === 'refused' || result?.kind === 'unknown') {
      say('')
      open(result.kind, result.message)
      return
    }
    setNotice(null)
    if (result?.kind === 'saved' || result?.kind === 'created') onAnswer?.(result)
    // A refused selection is said on its field and in the error summary,
    // which takes the focus -- its tab shown first, where one hides it --
    // and this line says only that nothing was saved.
    if (result?.kind === 'invalid') {
      toShow.current?.()
      say(`Not saved. ${result.message}`, 'refused')
      // TEMPORARY B6: no save said as the server's.
    } else say(result === null ? '' : result.message)
  }

  async function submit(outcome: Submitted): Promise<void> {
    // The line changes as soon as a save is sent, so the answer is heard even
    // when its words are the last save's: "Saved." twice in a row is no change
    // to a live region, and nothing would be said.
    if (outcome.ok) say(SAVING, 'pending')
    show(await session.save(outcome))
  }

  async function reload(): Promise<void> {
    const problem = await onReload()
    if (problem !== null) open('refused', problem)
  }

  return (
    <>
      {notice?.kind === 'unknown' ? (
        // Keyed by the notice: a second unknown save is another save, whose
        // check, confirmation and focus start again rather than inherit the first's.
        <UnknownNotice
          key={notice.n}
          session={session}
          message={notice.message}
          label={`${named} ${noticeId}`}
          noticeId={noticeId}
          noticeLevel={noticeLevel}
          noticeRef={noticeRef}
          onLoad={onLoad}
        />
      ) : notice === null ? null : (
        <div role="region" aria-labelledby={`${named} ${noticeId}`} tabIndex={-1} ref={noticeRef} className="notice" data-kind={notice.kind}>
          <NoticeHeading level={noticeLevel} id={noticeId}>
            Not saved
          </NoticeHeading>
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
      <form
        className="sheet"
        aria-label={`${title}, ${name}`}
        data-formancy-theme="blueprint"
        noValidate
        onSubmit={(event) => event.preventDefault()}
        ref={setSheet}
      >
        {session.renderer === 'react' ? (
          <ReactForm engine={engine} sources={session.sources} offer={offer} onSubmit={(outcome) => void submit(outcome)} />
        ) : (
          <AngularForm sheet={sheet} engine={engine} sources={session.sources} offer={offer} onSubmit={(outcome) => void submit(outcome)} />
        )}
      </form>
    </>
  )
}
