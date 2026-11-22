import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { DataClient, Deleting, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useRegionFocus } from './action-flow.js'
import { answer, ask, checked, checking, chosenWork, close, goneOf, heading, IDLE, marksOf, send, settledText, toCheck } from './chosen-deletion.js'
import type { ChosenDeletion, ChosenTarget } from './chosen-deletion.js'
import { holdsAsked } from './chosen-rows.js'
import type { ChosenRows } from './chosen-rows.js'
import { useSaving } from './delete-flow.js'
import { HELD } from './deletion.js'
import { formsAtRisk, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import { gridOwner } from './leave.js'
import type { PaneWork } from './leave.js'
import type { RecordGridHandle } from './record-grid.js'
import type { Session } from './session.js'
import type { HeldLevels } from './use-drill.js'

/*
 * A deletion of the records chosen of the Records grid's page (0174),
 * through chosen-deletion.ts's states, against the server
 * (`client.deleteChosen`, 0173), with the guard: asked from the bar above
 * the grid (selection-bar.tsx), where the form's `bulk.delete` offers it,
 * and drawn in the region under the bar (chosen-delete-region.tsx). 0166's
 * rules for a question over a choice are this one's:
 *
 * - **One question at a time.** Asking closes any other owner's
 *   confirmation -- a delete's, a run's -- and every request the person
 *   makes of the guard closes this one's, nothing sent.
 * - **It stands only while the choice holds what it asked over.** A box
 *   ticked or unticked, Clear the choice, or another page drawn closes the
 *   confirmation, nothing sent, and gives the keyboard back to the bar's
 *   button where it was in the region; Delete them sends the records
 *   chosen as it is pressed, each at the newest version the page knows.
 * - **The open record chosen.** Its forms that hold work are listed as
 *   discarded with it, as are the Drill down levels that hold a record
 *   chosen (0094); typed into since it asked, they are named before
 *   anything is sent. Delete them waits for a save of it out, and while
 *   the deletion is out its Save sends nothing and says why (`hold`).
 * - **The guard counts it** as the records grid's work, as a run over a
 *   selection is (0166): out, or answered with a record whose fate is not
 *   known and not checked, it goes only with the grid.
 * - **Once answered**, the page is read again; the records deleted, or
 *   found gone, leave the choice, and those not deleted stay chosen, each
 *   marked with why on its box; the open record, where it left the page, is
 *   closed as a delete closes it, and every level that held one dropped.
 *   A check reads what is not known, and settles the choice again. Nothing
 *   is sent again from an outcome.
 * - **The keyboard** goes to every state that asks something of the
 *   person, each time it is a new one -- a deletion out asked again
 *   included -- and back to the bar's button on Keep them and Close.
 */

export interface ChosenDelete {
  /** Whether the form serves this person a deletion of chosen records (`PublishedForm.bulk`, 0173): the bar's button, and the column, only then. */
  offered: boolean
  /** What deleting a record of the form also does, which the confirmation says (0050, 0051): null where the form offers no delete. */
  deleting: Deleting | null
  deletion: ChosenDeletion
  /** The region the deletion is drawn in: focused for each new state. */
  regionRef: RefObject<HTMLDivElement | null>
  /** The bar's button, where the keyboard goes back to. */
  buttonRef: RefObject<HTMLButtonElement | null>
  /** A save of the open record is out, and the confirmation is over it: Delete them waits for the answer. */
  saving: boolean
  ask(): void
  /** Keep them, or Escape: nothing sent, the keyboard back on the bar's button. */
  keep: () => void
  /** Delete them. */
  confirm(): void
  /** Check them: a read of each record whose fate is not known. */
  check: () => void
  /** Close what the server answered: the keyboard back on the bar's button. */
  close: () => void
}

export interface ChosenDeleteOptions {
  client: DataClient
  /** The form, by its id, and its title, which names each record. */
  entry: Pick<FormMenuEntry, 'id' | 'title'>
  definition: PublishedForm
  /** The open record's own forms: listed, held and closed where it is chosen. */
  sessions: readonly Session[]
  /** The records grid, read again once the server answered. */
  grid: RefObject<RecordGridHandle | null>
  chosen: ChosenRows
  /** The Drill down levels, whose forms that hold a chosen record are listed as discarded with it (0094). */
  drill: { levels: Pick<HeldLevels, 'atRisk'> }
  /** A record has left the page -- deleted, not found, or found gone: dropped from every level that holds it, and closed where it is the open one. */
  onGone: (record: string) => void
  /** The records half shown, where a layout hides it: true when it was hidden, and is drawn on the next render. */
  onShow: (half: 'records') => boolean
}

/** What the flow's handlers share: the deletion as it is now, how to change it, and the options as of the last render. */
interface FlowState {
  current: { current: ChosenDeletion }
  set(next: ChosenDeletion): void
  /** How many deletions were sent, or dropped by a discard: an answer for an earlier one is not this page's to show. */
  sent: { current: number }
  latest: { current: ChosenDeleteOptions }
  regionRef: RefObject<HTMLDivElement | null>
  buttonRef: RefObject<HTMLButtonElement | null>
}

/** Two lists of forms at risk name the same forms. */
const named = (pane: PaneWork): string => `${pane.owner} ${String(pane.renderer)}`

/** The record the detail's forms hold, by its token. */
const openRecord = (flow: FlowState): string | null => flow.latest.current.sessions[0]?.state().record ?? null

/** The open record, where `target` holds it, and null otherwise. */
const overOpen = (flow: FlowState, target: ChosenTarget): string | null => {
  const open = openRecord(flow)
  return open !== null && target.records.some((each) => each.record === open) ? open : null
}

const release = (flow: FlowState): void => {
  for (const session of flow.latest.current.sessions) session.release('bulk')
}

/** The keyboard back on the bar's button. */
const back = (flow: FlowState): void => flow.buttonRef.current?.focus()

/** A confirmation whose records are no longer the ones chosen closed, nothing sent; true when it was. */
function dropped(flow: FlowState): boolean {
  const now = flow.current.current
  if (now.state !== 'confirming' || holdsAsked(flow.latest.current.chosen.records(), now.target.records)) return false
  const held = flow.regionRef.current?.contains(document.activeElement) === true
  flow.set(IDLE)
  if (held) back(flow)
  return true
}

export function useChosenDelete(options: ChosenDeleteOptions): ChosenDelete {
  const latest = useRef(options)
  latest.current = options
  const guard = useGuardContext()
  const { registry } = guard
  const [deletion, setShown] = useState<ChosenDeletion>(IDLE)
  const current = useRef<ChosenDeletion>(IDLE)
  const sent = useRef(0)
  const regionRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
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
      buttonRef,
    }),
    [],
  )
  const savingNow = useSaving(options.sessions)
  const entry = useChosenEntry(flow)
  const { chosen, definition } = options
  useEffect(() => chosen.subscribe(() => void dropped(flow)), [chosen, flow])
  useRegionFocus(
    deletion.state === 'idle' ? 0 : deletion.n,
    regionRef,
    () => latest.current.onShow('records'),
    () => guard.waiting(),
  )

  /** The forms that hold work which deleting `target`'s records drops, as the guard would list them: the open record's, and the levels that hold one, each once. */
  const atStake = (target: ChosenTarget): PaneWork[] => {
    const { id } = latest.current.entry
    const levels = target.records.flatMap(({ record }) => latest.current.drill.levels.atRisk(id, record))
    const forms = [...(overOpen(flow, target) === null ? [] : formsAtRisk(registry, { kind: 'new' })), ...levels]
    return forms.filter((pane, index) => forms.findIndex((other) => named(other) === named(pane)) === index)
  }

  return {
    offered: definition.bulk.delete && definition.deleting !== null,
    deleting: definition.deleting,
    deletion,
    regionRef,
    buttonRef,
    // Delete them waits for a save of the open record only where it is one of the records asked over.
    saving: savingNow && deletion.state === 'confirming' && overOpen(flow, deletion.target) !== null,
    ask() {
      const records = latest.current.chosen.records()
      // Nothing chosen, nothing asked: the bar says what to do first.
      if (records.length === 0) return
      for (const other of registry.entries()) if (other !== entry) other.close?.()
      const target: ChosenTarget = { noun: latest.current.entry.title, records }
      flow.set(ask(current.current, target, atStake(target)))
    },
    confirm: () => confirmDeletion(flow, atStake),
    check: () => checkDeletion(flow),
    keep() {
      if (current.current.state !== 'confirming') return
      flow.set(IDLE)
      back(flow)
    },
    close() {
      const now = current.current
      if ((now.state !== 'answered' && now.state !== 'refused') || chosenWork(now) !== null) return
      flow.set(IDLE)
      back(flow)
    },
  }
}

/**
 * The deletion as the guard knows it: the records grid's work, as a run
 * over a selection is (0166), drawn by no renderer. A request of the
 * person's closes what holds none, and gives the keyboard back to the
 * bar's button when it was in the region.
 */
function useChosenEntry(flow: FlowState): PaneEntry {
  const entry = useMemo<PaneEntry>(
    () => ({
      owner: gridOwner('master'),
      renderer: null,
      name: () => {
        const now = flow.current.current
        return now.state === 'idle' ? [] : [heading(now.target, false)]
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
        if (held) back(flow)
      },
    }),
    [flow],
  )
  useRegistered(useMemo(() => [entry], [entry]))
  return entry
}

/** Delete them: sent, unless the choice changed, a save of the open record chosen is out, or a form it drops was typed into since it asked. */
function confirmDeletion(flow: FlowState, atStake: (target: ChosenTarget) => PaneWork[]): void {
  const now = flow.current.current
  // A choice changed since it asked is not what it confirms: closed, nothing sent.
  if (now.state !== 'confirming' || dropped(flow)) return
  const { sessions, client, entry, chosen } = flow.latest.current
  const open = overOpen(flow, now.target)
  // A save out moves the version the deletion would name: Delete them waits for its answer, and says so.
  if (open !== null && sessions.some((session) => session.isSaving())) return
  // Typed into since the question was asked: named before anything is sent.
  const risky = atStake(now.target)
  if (risky.some((pane) => !now.discards.some((listed) => named(listed) === named(pane)))) {
    flow.set({ ...now, discards: risky, n: now.n + 1 })
    return
  }
  // The records chosen now, each at the newest version the page knows: a save answered while it asked moved the open record's.
  const out = send(now, chosen.records())
  if (out.state !== 'sending') return
  flow.set(out)
  flow.sent.current += 1
  const mine = flow.sent.current
  if (open !== null) for (const session of sessions) session.hold(HELD, 'bulk')
  const records = out.target.records.map(({ record, version }) => ({ record, version }))
  void client.deleteChosen(entry.id, { records }).then((outcome) => {
    // Discarded while it was out: the grid it was asked from has gone with it.
    if (flow.sent.current !== mine) return
    release(flow)
    flow.set(answer(flow.current.current, outcome))
    settled(flow)
  })
}

/**
 * The page once the server answered, or a check read what was not known:
 * the records that have left it leave the choice and the detail, each
 * still chosen is marked with why, and the grid's page is read again.
 */
function settled(flow: FlowState): void {
  const now = flow.current.current
  if (now.state !== 'answered') return
  const { chosen, grid, onGone } = flow.latest.current
  const gone = goneOf(now)
  const left = [...chosen.now().chosen].filter((token) => !gone.has(token))
  chosen.settle(gone, marksOf(now), settledText(now, left, chosen.name))
  for (const record of gone) onGone(record)
  grid.current?.reload()
}

/** Check them: one read of each record whose fate is not known, and a second press while they read sends nothing. */
function checkDeletion(flow: FlowState): void {
  const now = flow.current.current
  const started = checking(now)
  const unknown = toCheck(now)
  if (started === now || unknown === null) return
  flow.set(started)
  const { client, entry } = flow.latest.current
  void client.reconcileChosen(entry.id, unknown).then((found) => {
    // Discarded, or another deletion's since: this check is not what the page shows.
    if (flow.current.current !== started) return
    flow.set(checked(started, found))
    settled(flow)
  })
}
