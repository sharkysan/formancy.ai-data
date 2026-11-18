import { useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { OptionsSources } from '@formancy/react'
import type { ActionFlow } from './action-flow.js'
import { AngularForm } from './angular-mount.js'
import { SAVE_OUT } from './deletion.js'
import { RENDERER_NAMES, WORK } from './leave.js'
import type { Said } from './leave.js'
import { ReactForm } from './react-form.js'
import { checkedText, CONTINUE, heading, isSelection, NONE_CHANGED, READ_AGAIN, RUNNING, RUNS_ON, RUNS_OVER_CHOSEN } from './running.js'
import type { RunTarget } from './running.js'
import { ServerDid } from './server-did.js'
import { DECLINED_BY, RegionHeading, Words } from './words.js'

/*
 * The open record's actions (0162): a button for each in the detail's
 * header, beside Duplicate record and Delete record, and the region a run
 * is drawn in, in place under the header with no overlay, as a delete's
 * is (0053):
 *
 * - **asking**: the action's dialog, drawn by the renderer the person
 *   chose -- React where both are shown -- on white paper in Blueprint,
 *   its submit Continue; the page adds no rule inside the paper. Escape is
 *   Keep it, unless the renderer took the key.
 * - **confirming**: focused, described by what it does and what reading
 *   the record again drops, and framed as a delete's question is. The next
 *   Tab reaches Keep it, so the keyboard is never put on the button that
 *   runs; Escape is Keep it. While a save of the record is out, Run it says
 *   so and waits; while the run is out, both answers say so and do nothing.
 * - **done**: what the administrator wrote, or "Done.", in the room's teal
 *   for a moment (0146) -- what the server did -- which describes the
 *   region the keyboard is taken to, so it is said as it lands; and where
 *   the record could not be read again, that, and the saved record.
 * - **Not run**: the server's sentence verbatim, a reason the deployment
 *   worded said as its own (0156), and the saved record offered after a
 *   stale run -- the region the keyboard is taken to described by what it
 *   says, so it is said as it lands, as done's is.
 * - **It may have run** (0031): the sentence, and a check that reads the
 *   record and says what the read showed in a status line already on the
 *   page; still at the version sent, Run it again; changed, the saved
 *   record; either, or not found, Close. No "Run it again anyway": a run
 *   can always be checked.
 *
 * Over the records chosen of a page (0166), the same region under the bar
 * above the grid, in the words of a selection: the heading counts them,
 * the confirmation says that one refused changes none, done says how many
 * it ran over, and Not run names the records the server's refusal is
 * about, by the words a row's Delete names its record with, that nothing
 * was done to any, and offers to read the page again -- never to run it
 * again anyway. A check reads every record, and where some moved and some
 * did not, it did not run, and the page is read again.
 */

/** "It is about Order `k1:7` and Order `k1:9`.": the records a refusal of a run over a selection names, as a row's Delete names each. */
function about(target: RunTarget, named: readonly string[]): Said {
  const each = named.flatMap((record, index): Said => [index === 0 ? '' : index === named.length - 1 ? ' and ' : ', ', `${target.noun} `, { code: record }])
  return ['It is about ', ...each, '.']
}

/** What the page offers to read again: over a selection, its page; over the open record, the saved record. */
const loadLabel = (target: RunTarget): string => (isSelection(target) ? 'Read the page again' : 'Load the saved record')

/** A dialog asks for typed answers, never a lookup: its renderer is handed no option source. */
const NO_SOURCES: OptionsSources = {}

/** The actions in the detail's header: one button each, named by its label. */
export function ActionButtons({ flow }: { flow: ActionFlow }): ReactElement {
  return (
    <>
      {flow.actions.map((action) => (
        <button key={action.name} type="button" className="button" ref={flow.buttonRef(action.name)} onClick={() => flow.ask(action)}>
          {flow.label(action)}
        </button>
      ))}
    </>
  )
}

/** The region a run is drawn in, under the detail's header; nothing when there is no run. */
export function ActionRegion({ flow, idBase }: { flow: ActionFlow; idBase: string }): ReactElement | null {
  const now = flow.run
  if (now.state === 'idle') return null
  if (now.state === 'asking') return <ActionDialog flow={flow} idBase={idBase} />
  if (now.state === 'confirming' || now.state === 'sending') return <ActionConfirm flow={flow} idBase={idBase} />
  return <ActionOutcome flow={flow} idBase={idBase} />
}

/** Escape as Keep it, where nothing inside took the key first: a renderer's list closing, say. */
const escapes =
  (flow: ActionFlow, busy: boolean) =>
  (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || busy) return
    event.preventDefault()
    flow.keep()
  }

function ActionDialog({ flow, idBase }: { flow: ActionFlow; idBase: string }): ReactElement | null {
  const [sheet, setSheet] = useState<HTMLFormElement | null>(null)
  const now = flow.run
  if (now.state !== 'asking') return null
  const headingId = `${idBase}-heading`
  return (
    <div role="region" className="action-ask" aria-labelledby={headingId} tabIndex={-1} ref={flow.regionRef} onKeyDown={escapes(flow, false)}>
      <RegionHeading level={4} id={headingId}>
        <Words said={heading(now.target)} />
      </RegionHeading>
      <form
        className="sheet"
        aria-label={`${now.target.label}, ${RENDERER_NAMES[flow.renderer]}`}
        data-formancy-theme="blueprint"
        noValidate
        onSubmit={(event) => event.preventDefault()}
        ref={setSheet}
      >
        {flow.renderer === 'react' ? (
          <ReactForm engine={now.dialog} sources={NO_SOURCES} submitLabel={CONTINUE} onSubmit={flow.answered} />
        ) : (
          <AngularForm sheet={sheet} engine={now.dialog} sources={NO_SOURCES} submitLabel={CONTINUE} onSubmit={flow.answered} />
        )}
      </form>
      <div className="notice-actions">
        <button type="button" className="button" onClick={flow.keep}>
          Keep it
        </button>
      </div>
    </div>
  )
}

function ActionConfirm({ flow, idBase }: { flow: ActionFlow; idBase: string }): ReactElement | null {
  const now = flow.run
  if (now.state !== 'confirming' && now.state !== 'sending') return null
  const sending = now.state === 'sending'
  const discards = now.state === 'confirming' ? now.discards : []
  const busy = sending ? 'true' : undefined
  // A save of the record out: Run it waits for its answer, which moves the version it would name.
  const waits = !sending && flow.saving
  const headingId = `${idBase}-heading`
  return (
    <div
      role="region"
      className="notice"
      data-kind="confirm"
      aria-labelledby={headingId}
      aria-describedby={discards.length === 0 ? `${idBase}-lead` : `${idBase}-lead ${idBase}-list`}
      tabIndex={-1}
      ref={flow.regionRef}
      onKeyDown={escapes(flow, sending)}
    >
      <RegionHeading level={4} id={headingId}>
        <Words said={[...heading(now.target), '?']} />
      </RegionHeading>
      <div id={`${idBase}-lead`}>
        <p className="notice-text">{flow.confirmation(now.target.action) ?? (isSelection(now.target) ? RUNS_OVER_CHOSEN : RUNS_ON)}</p>
        {discards.length === 0 ? null : <p className="notice-text">{READ_AGAIN}</p>}
      </div>
      {discards.length === 0 ? null : (
        <ul id={`${idBase}-list`} className="notice-list">
          {discards.map((pane) => (
            <li key={`${pane.owner} ${String(pane.renderer)}`}>
              <Words said={pane.name} />
              {pane.renderer === null ? '' : `, ${RENDERER_NAMES[pane.renderer]}`}: {pane.work === null ? '' : WORK[pane.work]}
            </li>
          ))}
        </ul>
      )}
      <p role="status" id={`${idBase}-status`} className="notice-text pending">
        {sending ? RUNNING : waits ? SAVE_OUT : ''}
      </p>
      <div className="notice-actions run-actions">
        <button type="button" className="button" aria-disabled={busy} onClick={() => (sending ? undefined : flow.keep())}>
          Keep it
        </button>
        <button
          type="button"
          className="button"
          aria-disabled={sending || waits ? 'true' : undefined}
          aria-describedby={waits ? `${idBase}-status` : undefined}
          onClick={() => (sending ? undefined : flow.confirm())}
        >
          Run it
        </button>
      </div>
    </div>
  )
}

/** What the server answered a run, each a focused region the keyboard is taken to, never an alert -- which would say it twice. */
function ActionOutcome({ flow, idBase }: { flow: ActionFlow; idBase: string }): ReactElement | null {
  const now = flow.run
  const headingId = `${idBase}-heading`
  const region = { role: 'region', 'aria-labelledby': headingId, tabIndex: -1, ref: flow.regionRef } as const
  const closes = (
    <button type="button" className="button" onClick={flow.close}>
      Close
    </button>
  )
  if (now.state === 'done') {
    const described = now.reread === null ? `${idBase}-done` : `${idBase}-done ${idBase}-unread`
    return (
      <div {...region} className="notice" data-kind="done" aria-describedby={described}>
        <RegionHeading level={4} id={headingId}>
          <Words said={heading(now.target)} />
        </RegionHeading>
        <p id={`${idBase}-done`} className="notice-text">
          <ServerDid said={now.n}>{now.said}</ServerDid>
        </p>
        {now.reread === null ? null : <p id={`${idBase}-unread`} className="notice-text">{`It ran, and the record could not be read again: ${now.reread}`}</p>}
        <div className="notice-actions">
          {now.reread === null ? null : (
            <button type="button" className="button" onClick={flow.load}>
              Load the saved record
            </button>
          )}
          {closes}
        </div>
      </div>
    )
  }
  if (now.state === 'refused') {
    const many = isSelection(now.target)
    const named = many && now.named.length > 0
    // Every sentence it says, in order: the server's, the deployment's mark, the records named, and that none was changed.
    const said = [
      ['message', true],
      ['declined', now.declined],
      ['about', named],
      ['none', many],
    ] as const
    const described = said.flatMap(([part, shown]) => (shown ? [`${idBase}-${part}`] : [])).join(' ')
    return (
      <div {...region} className="notice" data-kind="refused" aria-describedby={described}>
        <RegionHeading level={4} id={headingId}>
          Not run
        </RegionHeading>
        <p id={`${idBase}-message`} className="notice-text">
          {now.message}
        </p>
        {now.declined ? (
          <p id={`${idBase}-declined`} className="notice-text">
            {DECLINED_BY}
          </p>
        ) : null}
        {named ? (
          <p id={`${idBase}-about`} className="notice-text">
            <Words said={about(now.target, now.named)} />
          </p>
        ) : null}
        {many ? (
          <p id={`${idBase}-none`} className="notice-text">
            {NONE_CHANGED}
          </p>
        ) : null}
        <div className="notice-actions">
          {now.stale || named ? (
            <button type="button" className="button" onClick={flow.load}>
              {loadLabel(now.target)}
            </button>
          ) : null}
          {closes}
        </div>
      </div>
    )
  }
  if (now.state !== 'unknown' && now.state !== 'checked') return null
  const found = now.state === 'checked' ? now.found : null
  const unread = found === null || found.kind === 'unread'
  const many = isSelection(now.target)
  return (
    <div {...region} className="notice" data-kind="unknown">
      <RegionHeading level={4} id={headingId}>
        It may have run
      </RegionHeading>
      <p className="notice-text">{now.unknown.message}</p>
      <p role="status" className="notice-text">
        {found === null ? '' : checkedText(found, many)}
      </p>
      <div className="notice-actions">
        {unread ? (
          <button type="button" className="button" aria-disabled={now.state === 'unknown' && now.checking ? 'true' : undefined} onClick={flow.check}>
            Check whether it ran
          </button>
        ) : null}
        {found?.kind === 'unchanged' ? (
          <button type="button" className="button" onClick={flow.again}>
            Run it again
          </button>
        ) : null}
        {found?.kind === 'changed' || found?.kind === 'mixed' ? (
          <button type="button" className="button" onClick={flow.load}>
            {loadLabel(now.target)}
          </button>
        ) : null}
        {unread ? null : closes}
      </div>
    </div>
  )
}
