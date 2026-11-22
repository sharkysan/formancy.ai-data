import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { lookupSources } from '@formancy/data-client'
import type { DeleteChosenOutcome, Deleting, UpdateChosenOutcome } from '@formancy/data-client'
import { useRegionFocus } from './action-flow.js'
import { changeFields, CHANGE_READING } from './chosen-change.js'
import type { ChangeField } from './chosen-change.js'
import { continueChange, tickField } from './chosen-change-flow.js'
import { atStake, back, dropped, openAtRisk, openRecord, overOpen, release } from './chosen-flow-state.js'
import type { ChosenOptions, FlowState } from './chosen-flow-state.js'
import {
  answer,
  askChange,
  askDelete,
  checked,
  checking,
  chosenWork,
  close,
  foundNow,
  heading,
  IDLE,
  keepOpen,
  leftOf,
  marksOf,
  recordClosed,
  send,
  settledText,
  toCheck,
  wordsOf,
} from './chosen-request.js'
import type { ChosenKind, ChosenRequest, ChosenTarget } from './chosen-request.js'
import { useSaving } from './delete-flow.js'
import { useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import { gridOwner, unlisted } from './leave.js'
import type { PaneWork } from './leave.js'
import type { Renderer, Submitted } from './session.js'

/*
 * A request over the records chosen of the Records grid's page -- their
 * deletion (0174) or their change to the values given (0176) -- through
 * chosen-request.ts's states, against the server (`client.deleteChosen`,
 * 0173; `client.updateChosen`, 0175), with the guard: asked from the bar
 * above the grid (selection-bar.tsx), where the form's `bulk` offers it,
 * and drawn in the region under the bar (chosen-region.tsx). One flow for
 * both, so one is out at a time, and 0166's rules for a question over a
 * choice are both's:
 *
 * - **One question at a time.** Asking closes any other owner's
 *   confirmation -- a delete's, a run's -- and every request the person
 *   makes of the guard closes this one's, nothing sent. Either asked while
 *   the other is out, or not known yet, is that one asked again.
 * - **It stands only while the choice holds what it asked over.** A box
 *   ticked or unticked, Clear the choice, or another page drawn closes a
 *   change's fields or a confirmation, nothing sent, and gives the
 *   keyboard back to the bar's button where it was in the region; Delete
 *   them and Change them send the records chosen as they are pressed, each
 *   at the newest version the page knows.
 * - **The open record chosen.** Its forms that hold work are listed as
 *   discarded -- with it, by a deletion, as are the Drill down levels that
 *   hold a record chosen (0094); by reading it again once a change changed
 *   it (0162) -- and typed into since it asked, they are named before
 *   anything is sent. Sending waits for a save of it out, and while the
 *   request is out its Save sends nothing and says why (`hold`).
 * - **The guard counts it** as the records grid's work, as a run over a
 *   selection is (0166): out, or answered with a record whose fate is not
 *   known and not checked, it goes only with the grid.
 * - **Once answered**, the page is read again; the records done, or found
 *   done, leave the choice, and those not done stay chosen, each marked
 *   with why on its box. Where the open record left the page by a
 *   deletion, it is closed as a delete closes it, and every level that held
 *   one dropped -- but the open record a check finds gone, where its forms
 *   hold work, is left open until Close the record, as after a delete's
 *   check (0053): its Save was given back when the answer was lost, and
 *   what was typed since was never listed. Where a change changed it, or a
 *   check finds it moved on, it is read again into its forms through the
 *   guard, which asks about a form typed into since it was listed. Nothing
 *   is sent again from an outcome.
 * - **The keyboard** goes to every state that asks something of the
 *   person, each time it is a new one -- a request out asked again
 *   included -- and back to the bar's button that asked on Keep them and
 *   Close.
 */

export interface ChosenFlow {
  /** Whether the form serves this person a deletion of chosen records (`bulk.delete`, 0173): Delete the chosen…, and the column, only then. */
  deletes: boolean
  /** What deleting a record of the form also does, which a deletion's confirmation says (0050, 0051): null where the form offers no delete. */
  deleting: Deleting | null
  /** The fields the form serves this person a change of chosen records in (`bulk.update`, 0175): Change the chosen…, and the column, only where there is one. */
  changes: readonly ChangeField[]
  request: ChosenRequest
  /** The renderer a change's fields are drawn by: the one the person chose to show, React where both are shown, as an action's dialog (0162). */
  renderer: Renderer
  /** The lookups a change's fields search, under the policy's filter for an update. */
  sources: ReturnType<typeof lookupSources>
  /** The region the request is drawn in: focused for each new state. */
  regionRef: RefObject<HTMLDivElement | null>
  /** The bar's buttons, where the keyboard goes back to. */
  deleteRef: RefObject<HTMLButtonElement | null>
  changeRef: RefObject<HTMLButtonElement | null>
  /** A save of the open record is out, and the confirmation is over it: sending waits for the answer. */
  saving: boolean
  /** The open record a check of a deletion found gone, left open while its forms hold work, and still the one open: Close the record closes it. */
  stillOpen: string | null
  askDelete(): void
  askChange(): void
  /** A field's box of a change ticked or unticked. */
  tick(field: string, on: boolean): void
  /** A change's Continue: what the renderer submitted. */
  answered: (submitted: Submitted) => void
  /** Keep them, or Escape: nothing sent, the keyboard back on the bar's button. */
  keep: () => void
  /** Delete them, or Change them. */
  confirm(): void
  /** Check them: a read of each record whose fate is not known. */
  check: () => void
  /** Close what the server answered: the keyboard back on the bar's button. */
  close: () => void
  /** Close the record a check found gone and left open: its forms emptied, the region the keyboard's again. */
  closeRecord: () => void
}

export function useChosen(options: ChosenOptions): ChosenFlow {
  const latest = useRef(options)
  latest.current = options
  const guard = useGuardContext()
  const { registry } = guard
  const [request, setShown] = useState<ChosenRequest>(IDLE)
  const current = useRef<ChosenRequest>(IDLE)
  const sent = useRef(0)
  const regionRef = useRef<HTMLDivElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  const flow = useMemo<FlowState>(
    () => ({
      current,
      set: (next) => {
        current.current = next
        setShown(next)
      },
      sent,
      latest,
      regionRef,
      buttons: { delete: deleteRef, change: changeRef },
      registry,
    }),
    [registry],
  )
  const savingNow = useSaving(options.sessions)
  const entry = useChosenEntry(flow)
  const { chosen, definition, client } = options
  const formId = options.entry.id
  useEffect(() => chosen.subscribe(() => void dropped(flow)), [chosen, flow])
  useRegionFocus(
    request.state === 'idle' ? 0 : request.n,
    regionRef,
    () => latest.current.onShow('records'),
    () => guard.waiting(),
  )
  const changes = useMemo(() => changeFields(definition), [definition])
  // Read through the policy's filter for an update: a change is an update of each record (0175).
  const sources = useMemo(() => lookupSources(client, formId, definition.form, 'update'), [client, formId, definition])
  const left = request.state === 'answered' ? request.open : null

  return {
    deletes: definition.bulk.delete && definition.deleting !== null,
    deleting: definition.deleting,
    changes,
    request,
    renderer: options.renderer === 'angular' ? 'angular' : 'react',
    sources,
    regionRef,
    deleteRef,
    changeRef,
    // Sending waits for a save of the open record only where it is one of the records asked over.
    saving: savingNow && request.state === 'confirming' && overOpen(flow, request.target) !== null,
    // Opened another, or closed by the person meanwhile: nothing of it is left to close.
    stillOpen: left !== null && openRecord(flow) === left ? left : null,
    askDelete: () => askOver(flow, entry, 'delete'),
    askChange: () => askOver(flow, entry, 'change'),
    tick: (field, on) => tickField(flow, field, on),
    answered: (submitted) => continueChange(flow, submitted),
    confirm: () => confirmRequest(flow),
    check: () => checkRequest(flow),
    ...regionAnswers(flow),
  }
}

/** Delete the chosen… or Change the chosen…: every other owner's question closed, and this one asked over the records chosen now; nothing chosen, nothing asked -- the bar says what to do first. */
function askOver(flow: FlowState, entry: PaneEntry, kind: ChosenKind): void {
  const records = flow.latest.current.chosen.records()
  if (records.length === 0) return
  for (const other of flow.registry.entries()) if (other !== entry) other.close?.()
  const target: ChosenTarget = { noun: flow.latest.current.entry.title, records }
  const now = flow.current.current
  flow.set(kind === 'delete' ? askDelete(now, target, atStake(flow, 'delete', target)) : askChange(now, target))
}

/** The answers that end what the region shows, each only in the state it is drawn in. */
function regionAnswers(flow: FlowState): Pick<ChosenFlow, 'keep' | 'close' | 'closeRecord'> {
  const { current } = flow
  return {
    keep() {
      const now = current.current
      if (now.state !== 'asking' && now.state !== 'confirming') return
      flow.set(IDLE)
      back(flow, now.kind)
    },
    close() {
      const now = current.current
      if ((now.state !== 'answered' && now.state !== 'refused') || chosenWork(now) !== null) return
      flow.set(IDLE)
      back(flow, now.kind)
    },
    closeRecord() {
      const now = current.current
      if (now.state !== 'answered' || now.open === null) return
      const record = now.open
      flow.set(recordClosed(now))
      if (openRecord(flow) === record) flow.latest.current.onGone(record)
    },
  }
}

/**
 * The request as the guard knows it: the records grid's work, as a run
 * over a selection is (0166), drawn by no renderer. A request of the
 * person's closes what holds none -- a change's fields with what was typed
 * into them, as a dialog's answers are (0162) -- and gives the keyboard
 * back to the bar's button when it was in the region.
 */
function useChosenEntry(flow: FlowState): PaneEntry {
  const entry = useMemo<PaneEntry>(
    () => ({
      owner: gridOwner('master'),
      renderer: null,
      name: () => {
        const now = flow.current.current
        return now.state === 'idle' ? [] : [heading(now.kind, now.target, false)]
      },
      work: () => chosenWork(flow.current.current),
      discard: () => {
        flow.sent.current += 1
        release(flow)
        flow.set(IDLE)
      },
      close: () => {
        const now = flow.current.current
        const next = close(now)
        if (next === now || now.state === 'idle') return
        const held = flow.regionRef.current?.contains(document.activeElement) === true
        flow.set(next)
        if (held) back(flow, now.kind)
      },
    }),
    [flow],
  )
  useRegistered(useMemo(() => [entry], [entry]))
  return entry
}

/** Delete them, or Change them: sent, unless the choice changed, a save of the open record chosen is out, or a form it drops was typed into since it asked. */
function confirmRequest(flow: FlowState): void {
  const now = flow.current.current
  // A choice changed since it asked is not what it confirms: closed, nothing sent.
  if (now.state !== 'confirming' || dropped(flow)) return
  const { sessions, client, entry, chosen } = flow.latest.current
  const open = overOpen(flow, now.target)
  // A save out moves the version the request would name: sending waits for its answer, and says so.
  if (open !== null && sessions.some((session) => session.isSaving())) return
  // Typed into since the question was asked: named before anything is sent.
  const risky = atStake(flow, now.kind, now.target)
  if (unlisted(risky, now.discards)) {
    flow.set({ ...now, discards: risky, n: now.n + 1 })
    return
  }
  // The records chosen now, each at the newest version the page knows: a save answered while it asked moved the open record's.
  const out = send(now, chosen.records())
  if (out.state !== 'sending') return
  flow.set(out)
  flow.sent.current += 1
  const mine = flow.sent.current
  if (open !== null) for (const session of sessions) session.hold(wordsOf(out.kind).held, 'bulk')
  const records = out.target.records.map(({ record, version }) => ({ record, version }))
  const asked: Promise<DeleteChosenOutcome | UpdateChosenOutcome> =
    out.kind === 'delete' ? client.deleteChosen(entry.id, { records }) : client.updateChosen(entry.id, { records, answers: out.change?.answers ?? {} })
  void asked.then((outcome) => {
    // Discarded while it was out: the grid it was asked from has gone with it.
    if (flow.sent.current !== mine) return
    release(flow)
    flow.set(answer(flow.current.current, outcome))
    settled(flow, out, 'answer', out.discards)
  })
}

/**
 * The page once the server answered, or a check read what was not known
 * -- `before`, the request as it was until then: the records done leave
 * the choice, each still chosen is marked with why, and the grid's page is
 * read again; then the open record, where it is one of them, closed after
 * a deletion, or read again after a change that this answer or this check
 * found changed it.
 */
function settled(flow: FlowState, before: ChosenRequest, by: 'answer' | 'check', discards: readonly PaneWork[]): void {
  const now = flow.current.current
  if (now.state !== 'answered') return
  const { chosen, grid } = flow.latest.current
  const left = leftOf(now)
  const still = [...chosen.now().chosen].filter((token) => !left.has(token))
  chosen.settle(left, marksOf(now), settledText(now, still, chosen.name))
  const open = openRecord(flow)
  if (now.kind === 'delete') closeGone(flow, left, by)
  else if (open !== null && foundNow(before, now, open)) readChanged(flow, open, by === 'answer' ? discards : [])
  grid.current?.reload()
}

/**
 * The records a deletion took, dropped from the detail and every level
 * that holds one, the open one closed -- but the open record a check finds
 * gone stays open where its forms hold work (`keepOpen`): its Save was the
 * person's again from the lost answer on.
 */
function closeGone(flow: FlowState, left: ReadonlySet<string>, by: 'answer' | 'check'): void {
  const open = by === 'check' ? openRecord(flow) : null
  const stays = open !== null && left.has(open) && openAtRisk(flow).length > 0 ? open : null
  for (const record of left) if (record !== stays) flow.latest.current.onGone(record)
  if (stays !== null) flow.set(keepOpen(flow.current.current, stays))
}

/**
 * The open record a change changed, or a check found moved on, read again
 * into its forms through the guard, as after an action that ran over it
 * (0162): the change moved its version, so forms that kept the one from
 * before would make the next Save stale against a change the person
 * made. The forms its confirmation listed (`discards`) drop without asking
 * again -- none after a check, since the lost answer gave their Save back
 * -- and one typed into since is asked about. Until the read has opened,
 * been refused, been kept from or had its question replaced, its Save
 * sends nothing.
 */
function readChanged(flow: FlowState, open: string, discards: readonly PaneWork[]): void {
  const { opening, sessions } = flow.latest.current
  const mine = flow.sent.current
  // Held for this request alone: one sent since holds the forms itself.
  const read = (): void => {
    if (flow.sent.current === mine) release(flow)
  }
  for (const session of sessions) session.hold(CHANGE_READING, 'bulk')
  const agreed = discards.flatMap((pane) => (pane.renderer === null ? [] : [pane.renderer]))
  opening.readAgain({ kind: 'changed-chosen', record: open, agreed }, open, {
    opened: () => {
      read()
      const [session] = flow.latest.current.sessions
      if (session !== undefined) flow.latest.current.onReread(session)
    },
    refused: read,
    // Kept editing: the forms keep what was typed since, at the version before the change, and the region the keyboard.
    back: () => {
      read()
      flow.regionRef.current?.focus({ preventScroll: true })
    },
    dropped: read,
  })
}

/** Check them: one read of each record whose fate is not known, and a second press while they read sends nothing. */
function checkRequest(flow: FlowState): void {
  const now = flow.current.current
  const started = checking(now)
  const unknown = toCheck(now)
  if (started === now || unknown === null) return
  flow.set(started)
  const { client, entry } = flow.latest.current
  void client.reconcileChosen(entry.id, unknown).then((found) => {
    // Discarded, or another request's since: this check is not what the page shows.
    if (flow.current.current !== started) return
    flow.set(checked(started, found))
    settled(flow, started, 'check', [])
  })
}
