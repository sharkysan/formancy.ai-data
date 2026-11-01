import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { describeReassigned } from '@formancy/data-core'
import type { DriftChange, DriftReport } from '@formancy/data-core'
import type { DraftQueue, DraftRead } from '@formancy/data-server'
import type { AdminClient, Failure, Published } from './api.js'
import { describeRef } from './choice.js'
import { labelOf } from './document.js'
import { Changes } from './drift-change.js'
import { DraftPolicy } from './draft-policy.js'
import { useFocusAfterRender } from './focus.js'
import { SavedView } from './list-views.js'
import { FormPaper } from './preview.js'

/** The opened draft's heading, where the keyboard goes when it is read, and when a decision takes its buttons away. */
const HEADING = 'draft-heading'

type Queue = { state: 'reading' } | { state: 'read'; queue: DraftQueue } | { state: 'failed'; message: string }

interface Addressed {
  form: string
  draft: number
}

/**
 * `revision`: which read this is. Each read is a new document, so a new
 * engine, and a new provider over it. `again`: a read after a decision,
 * whose failure leaves the decision's answer standing.
 */
type Read = { state: 'reading' } | { state: 'read'; draft: DraftRead; revision: number } | { state: 'failed'; message: string; again: boolean }

/** What the server answered a decision. */
type Decided =
  | { kind: 'approved'; version: number; drift: DriftReport }
  | { kind: 'rejected'; withdrawn: boolean }
  | { kind: 'incompatible'; message: string; changes: DriftChange[] }
  | { kind: 'refused'; message: string }

/** A draft's base, as a sentence says it -- the server's words for it. */
const over = (base: number | null) => (base === null ? 'as the first version' : `over version ${String(base)}`)

/** Who submitted a draft, and whether that is the person reading. */
const who = (submittedBy: string, me: string) => (submittedBy === me ? `${submittedBy} (you)` : submittedBy)

/** What a draft that is no longer pending became, in one line. */
function stateOf(draft: DraftRead): string | null {
  if (draft.state === 'rejected')
    return draft.withdrawn === true
      ? `Withdrawn by ${draft.rejectedBy ?? 'its submitter'}, who submitted it.`
      : `Rejected by ${draft.rejectedBy ?? 'a publisher'}.`
  if (draft.state === 'published') return `Published as version ${String((draft.expectedBase ?? 0) + 1)}.`
  if (draft.state === 'stale') {
    const now = draft.current === null ? 'no version is published now' : `version ${String(draft.current)} is the newest now`
    return `Submitted ${over(draft.expectedBase)}, and ${now}: nothing can approve it.`
  }
  return null
}

function decidedBy(outcome: Failure): Decided {
  return outcome.code === 'incompatible'
    ? { kind: 'incompatible', message: outcome.message, changes: outcome.changes ?? [] }
    : { kind: 'refused', message: outcome.message }
}

/**
 * The Review step, under review only (0065): the drafts waiting for a
 * publisher, and one opened to decide on.
 *
 * The queue is what the server lists as pending, read when the step opens,
 * after every decision, and when asked: nothing notifies anybody of a
 * draft. Opened, a draft is described, and its form drawn on the paper the
 * Preview step draws -- what the people filling it in would see if it were
 * approved -- and its policy below it: who they are, and what approving it
 * grants them (`DraftPolicy`); then its list views in words (0105). Its decisions are the server's `refuses`
 * for this reader and nothing else: Approve and publish where approval is
 * not refused; Reject, or Withdraw on one's own draft, where rejection is
 * not; and the server's sentence for each it refuses. The studio decides
 * no grant of its own, so what it offers and what the server would answer
 * cannot differ.
 *
 * A decision is answered in the server's words, the draft is read again,
 * and the queue with it; a read that fails then leaves the answer
 * standing, since what was decided was decided. A draft no longer pending
 * offers nothing, and the keyboard on a button that went with its state
 * goes to the draft's heading.
 */
export function ReviewStep({ client, me }: { client: AdminClient; me: string }): ReactElement {
  const [queue, setQueue] = useState<Queue>({ state: 'reading' })
  const [reads, setReads] = useState(0)
  const [opened, setOpened] = useState<Addressed | null>(null)
  const [read, setRead] = useState<Read>({ state: 'reading' })
  // The answer and the draft it answers, kept apart from the draft's read: a read that fails after it does not take the answer away.
  const [decided, setDecided] = useState<{ answer: Decided; on: DraftRead } | null>(null)
  const [pending, setPending] = useState(false)
  // The draft opened last: an answer about one opened before it is not shown.
  const opening = useRef(0)
  // Each read of a draft, which keys its paper: a draft read again after a decision is a new document.
  const reading = useRef(0)
  const focusAfter = useFocusAfterRender()

  useEffect(() => {
    let current = true
    void client.drafts().then((outcome) => {
      if (current) setQueue(outcome.ok ? { state: 'read', queue: outcome.value } : { state: 'failed', message: outcome.message })
    })
    return () => {
      current = false
    }
  }, [client, reads])

  async function readDraft(at: Addressed, asked: number, again = false): Promise<boolean> {
    const outcome = await client.draft(at.form, at.draft)
    if (asked !== opening.current) return false
    setRead(outcome.ok ? { state: 'read', draft: outcome.value, revision: (reading.current += 1) } : { state: 'failed', message: outcome.message, again })
    return outcome.ok && outcome.value.state === 'pending'
  }

  async function open(at: Addressed): Promise<void> {
    const asked = (opening.current += 1)
    setOpened(at)
    setRead({ state: 'reading' })
    setDecided(null)
    await readDraft(at, asked)
    // Below the queue: the keyboard goes to what it opened.
    if (asked === opening.current) focusAfter(HEADING)
  }

  async function decide(draft: DraftRead, decision: 'approve' | 'reject'): Promise<void> {
    // A second press while the first is on its way does nothing; the buttons stay enabled, so they keep the keyboard.
    if (pending) return
    const asked = opening.current
    setPending(true)
    setDecided(null)
    let answer: Decided
    if (decision === 'approve') {
      const outcome = await client.approveDraft(draft.form, draft.draft)
      answer = outcome.ok ? { kind: 'approved', version: outcome.value.version, drift: outcome.value.drift } : decidedBy(outcome)
    } else {
      const outcome = await client.rejectDraft(draft.form, draft.draft)
      answer = outcome.ok ? { kind: 'rejected', withdrawn: outcome.value.withdrawn } : decidedBy(outcome)
    }
    setReads((count) => count + 1)
    if (asked === opening.current) {
      setDecided({ answer, on: draft })
      const stillPending = await readDraft(draft, asked, true)
      if (!stillPending && asked === opening.current) focusAfter(HEADING)
    }
    setPending(false)
  }

  return (
    <>
      <p className="lede">
        Each draft is a version an administrator submitted for review. A publisher other than its submitter approves it, which publishes it as the next version,
        or rejects it; its submitter may withdraw it. Nothing here changes a table.
      </p>
      <section className="review queue" aria-labelledby="queue-heading">
        <h3 id="queue-heading">Waiting for review</h3>
        {queue.state === 'reading' ? (
          <p>Reading the drafts waiting…</p>
        ) : queue.state === 'failed' ? (
          <p className="problem-box">{queue.message}</p>
        ) : (
          <QueueList queue={queue.queue} me={me} onOpen={(at) => void open(at)} />
        )}
        <p className="next">
          <button type="button" className="button" onClick={() => setReads((count) => count + 1)}>
            Read the queue again
          </button>
        </p>
      </section>
      {opened === null ? null : (
        <section className="review draft" aria-labelledby={HEADING}>
          <h3 id={HEADING} tabIndex={-1}>
            Draft {opened.draft} of {opened.form}
          </h3>
          {read.state === 'reading' ? (
            <p>Reading the draft…</p>
          ) : read.state === 'failed' ? (
            <p className="problem-box">{read.again ? `The draft could not be read again: ${read.message}` : read.message}</p>
          ) : (
            <DraftView
              draft={read.draft}
              revision={read.revision}
              me={me}
              decided={decided?.answer ?? null}
              onDecide={(decision) => void decide(read.draft, decision)}
            />
          )}
          {decided === null ? null : <Decision decided={decided.answer} draft={decided.on} />}
        </section>
      )}
    </>
  )
}

function QueueList({ queue, me, onOpen }: { queue: DraftQueue; me: string; onOpen: (at: Addressed) => void }): ReactElement {
  return (
    <>
      {queue.drafts.length === 0 ? (
        // A form whose drafts could not be read may hold some: the empty list is only what could be read.
        <p className="none">{queue.unreadable.length === 0 ? 'No draft is waiting for review.' : 'No draft that could be read is waiting for review.'}</p>
      ) : (
        <ul aria-labelledby="queue-heading">
          {queue.drafts.map((entry) => (
            <li key={`${entry.form}/${String(entry.draft)}`}>
              <p>{`${entry.form}, draft ${String(entry.draft)}: “${entry.title}”, submitted by ${who(entry.submittedBy, me)} ${over(entry.expectedBase)}.`}</p>
              <button type="button" className="button" onClick={() => onOpen({ form: entry.form, draft: entry.draft })}>
                Open draft {entry.draft} of {entry.form}
              </button>
            </li>
          ))}
        </ul>
      )}
      {queue.unreadable.map((form) => (
        <p key={form} className="problem-box">
          The drafts of {form} could not be read, and are not listed: the operator&rsquo;s log says why.
        </p>
      ))}
    </>
  )
}

/** One draft, read: what it is, its form on paper, its policy, and the decisions this reader may make on it. */
function DraftView({
  draft,
  revision,
  me,
  decided,
  onDecide,
}: {
  draft: DraftRead
  revision: number
  me: string
  decided: Decided | null
  onDecide: (decision: 'approve' | 'reject') => void
}): ReactElement {
  const { bundle } = draft
  const fields = bundle.form.model.fields.length
  const title = typeof bundle.form.title === 'string' ? bundle.form.title : bundle.form.id
  const own = draft.submittedBy === me
  const pending = draft.state === 'pending'
  // A decision that worked says what the draft became; the line saying it again would be the same news twice.
  const settled = decided?.kind === 'approved' || decided?.kind === 'rejected'
  const state = settled ? null : stateOf(draft)
  const refusals = pending ? [...new Set([draft.refuses.approve?.message, draft.refuses.reject?.message].filter((message) => message !== undefined))] : []
  return (
    <>
      <p className="described">{`“${title}”, ${String(fields)} ${fields === 1 ? 'field' : 'fields'}, bound to ${describeRef(bundle.bindings.root)} on ${bundle.connection}.`}</p>
      <p className="described">{`Submitted by ${who(draft.submittedBy, me)} ${over(draft.expectedBase)}.`}</p>
      {state === null ? null : <p className="base">{state}</p>}
      {draft.keysConfirmed.length === 0 ? null : (
        <div className="notice">
          <h4 id="draft-keys">Keys its author confirmed</h4>
          <ul aria-labelledby="draft-keys">
            {draft.keysConfirmed.map((key) => (
              <li key={key.field}>{describeReassigned(key)}</li>
            ))}
          </ul>
        </div>
      )}
      <FormPaper document={bundle.form} bindings={bundle.bindings} label={`${title}, draft ${String(draft.draft)}`} revision={revision} />
      <DraftPolicy policy={bundle.policy} bindings={bundle.bindings} document={bundle.form} />
      {bundle.presentation.views === undefined ? null : (
        // What a person's grid is offered above it (0105), in words, so what is approved is what was read.
        <div className="draft-views">
          <h4 id="draft-views">List views</h4>
          <ol aria-labelledby="draft-views">
            {bundle.presentation.views.map((view) => (
              <li key={view.name}>
                <SavedView view={view} label={(key) => labelOf(bundle.form, key)} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {bundle.presentation.unfiltered === undefined ? null : (
        // What a person's Filter panel does not offer (0123), by the fields' labels.
        <div className="draft-views">
          <h4 id="draft-unfiltered">Left out of the Filter panel</h4>
          <ul aria-labelledby="draft-unfiltered">
            {bundle.presentation.unfiltered.map((key) => (
              <li key={key}>{labelOf(bundle.form, key)}</li>
            ))}
          </ul>
        </div>
      )}
      {!pending ? null : (
        <div className="decide">
          {draft.refuses.approve !== undefined && draft.refuses.reject !== undefined ? null : (
            <p className="actions">
              {draft.refuses.approve !== undefined ? null : (
                <button type="button" className="primary" onClick={() => onDecide('approve')}>
                  Approve and publish
                </button>
              )}
              {draft.refuses.reject !== undefined ? null : (
                <button type="button" className="button" onClick={() => onDecide('reject')}>
                  {own ? 'Withdraw' : 'Reject'}
                </button>
              )}
            </p>
          )}
          {refusals.map((message) => (
            <p key={message} className="hint">
              {message}
            </p>
          ))}
        </div>
      )}
    </>
  )
}

/** What the server answered a decision, each answer as the studio shows its kind elsewhere. */
function Decision({ decided, draft }: { decided: Decided; draft: DraftRead }): ReactElement {
  // The draft's own form, for the labels of the fields each change touches.
  const published: Published = { version: draft.expectedBase ?? 0, bundle: draft.bundle }
  if (decided.kind === 'approved') {
    return (
      <>
        <div role="status" className="done">
          <p>Published as version {decided.version}.</p>
        </div>
        <Changes
          changes={decided.drift.changes}
          published={published}
          id="approved-differs"
          heading="What differs from the database now, and blocks nothing"
          level="h4"
          none="Nothing it rests on has changed since it was generated."
        />
      </>
    )
  }
  if (decided.kind === 'rejected') {
    return (
      <div role="status" className="done">
        <p>
          {decided.withdrawn ? 'Withdrew' : 'Rejected'} draft {draft.draft} of {draft.form}: nothing was published.
        </p>
      </div>
    )
  }
  if (decided.kind === 'incompatible') {
    return (
      <div role="alert" className="problem-box">
        <p>{decided.message}</p>
        <Changes changes={decided.changes} published={published} id="approval-blocks" heading="What blocks it" level="h4" />
      </div>
    )
  }
  return (
    <p role="alert" className="problem-box">
      {decided.message}
    </p>
  )
}
