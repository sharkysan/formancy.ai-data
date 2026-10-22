import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import type { DataClient } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { again, answer, checked, checking, close, confirm, deletionWork, HELD, IDLE, send } from './deletion.js'
import type { DeleteTarget, Deletion } from './deletion.js'
import { formsAtRisk, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import { gridOwner } from './leave.js'
import type { LeaveRequest, PaneWork } from './leave.js'
import type { Session } from './session.js'

/*
 * One owner's deletions on the page (0053) -- the record's, or a child
 * section's -- run through deletion.ts's states, against the server, with
 * the guard. The record's detail and each grid row ask; the owner draws the
 * region where it was asked for, and says what happened when the record has
 * gone from the page.
 *
 * - **One question at a time.** Asking closes any other owner's
 *   confirmation, and every request the person makes of the guard closes
 *   this one's: nothing is deleted, and the request goes on through the
 *   guard. An answer that asks the guard -- a read come back, a record
 *   created -- closes nothing.
 * - **The guard counts it.** A deletion out, or one that may have been done
 *   and is not checked, is work (leave.ts): the detail's, when it names the
 *   record open there, otherwise its grid's. Discard drops the page's track
 *   of it; a deletion answered after that takes its row from the grid and
 *   says so there, if it was done, and nothing else is heard of it.
 * - **The record's forms hold** while its deletion is out: a press of Save
 *   sends nothing and says why. While a save of the record is out, its
 *   Delete it waits for the answer.
 * - **The version** a delete of the open record names is the newest the
 *   detail heard, as it is when Delete it is pressed (`useHeard`).
 * - **What a delete drops** is listed in its confirmation, as the guard
 *   would list it -- the open record's forms, and the Drill down levels
 *   that hold the record, from any row (0094) -- and nothing is dropped
 *   before Delete it; typed into since, it is named before anything is
 *   sent.
 * - **The keyboard** goes to every state that asks something of the person,
 *   each time it is a new one -- in Separate views to the view it is drawn
 *   in, which the person may have left while it was out -- and back to what
 *   asked on Keep it.
 */

export interface DeleteFlow {
  deletion: Deletion
  /** The region the deletion is drawn in, wherever it was asked from: focused for each new state. */
  regionRef: RefObject<HTMLDivElement | null>
  /** A save of the record is out in one of its forms: the open record's Delete it waits for the answer. */
  saving: boolean
  /** The newest version of `record` the detail heard, if it holds it. */
  heard(record: string): string | null
  /** Ask whether to delete `target`. */
  ask(target: DeleteTarget): void
  /** Keep it, or Escape: nothing deleted, the keyboard back on what asked. */
  keep(): void
  /** Delete it. */
  confirm(): void
  /** Check whether it was deleted. */
  check(): void
  /** Delete it again: the confirmation again. */
  again(): void
  /** Close a refusal's notice: the keyboard back on what asked. */
  close(): void
  /** Close the record a delete could not find: gone from the page, said as closed. */
  closeRecord(): void
  /** Load the saved record: read again into the detail. */
  load(): void
}

export interface DeleteFlowOptions {
  client: DataClient
  formId: string
  /** `master`, or a child section's key: whose work a deletion of the open record is. */
  owner: string
  /** The record's own forms, held while its deletion is out. */
  sessions: readonly Session[]
  /** The request whose discards are what a delete of the open record drops: New for the record, New <child> for a child row. */
  discards: LeaveRequest
  /** The forms of the Drill down levels that hold `target`'s record, and of every level below them, that hold work: the delete drops them too (0094). None when no level holds it. */
  held?: (target: DeleteTarget) => readonly PaneWork[]
  /** The record has gone from the page: deleted, or not found and closed. `quiet` when the person moved on before the answer came: only the grid hears it. */
  onGone(target: DeleteTarget, word: 'Deleted' | 'Closed', quiet: boolean): void
  /** Load the saved record. */
  onLoad(target: DeleteTarget): void
  /** The keyboard back on what asked. */
  onBack(target: DeleteTarget): void
  /** The view the region is drawn in, shown: in Separate views the person may have gone to the other while the deletion was out. True when it was hidden, and is drawn on the next render. */
  onShow(target: DeleteTarget): boolean
}

/** What the flow's handlers share: the deletion as it is now, how to change it, and the owner's options as of the last render. */
interface FlowState {
  current: { current: Deletion }
  set(next: Deletion): void
  /** How many deletions were sent, or dropped by a discard: an answer for an earlier one is not this owner's to show. */
  sent: { current: number }
  latest: { current: DeleteFlowOptions }
  regionRef: RefObject<HTMLDivElement | null>
}

/** Two lists of forms at risk name the same forms. */
const named = (pane: PaneWork): string => `${pane.owner} ${String(pane.renderer)}`

const release = (flow: FlowState): void => {
  for (const session of flow.latest.current.sessions) session.release()
}

export function useDeleteFlow(options: DeleteFlowOptions): DeleteFlow {
  // What the answers read when they arrive: the owner's handlers as of now.
  const latest = useRef(options)
  latest.current = options
  const { registry } = useGuardContext()
  const [deletion, setShown] = useState<Deletion>(IDLE)
  const current = useRef<Deletion>(IDLE)
  const sent = useRef(0)
  const regionRef = useRef<HTMLDivElement>(null)
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
    }),
    [],
  )
  const heard = useHeard(options.sessions)
  const saving = useSaving(options.sessions)
  const entry = useDeletionEntry(options.owner, flow)
  useRegionFocus(deletion, regionRef, (target) => latest.current.onShow(target))

  /** The forms that hold work which a delete of `target` drops, as the guard would list them: the open record's, and the levels that hold it, each once. */
  const atStake = (target: DeleteTarget): PaneWork[] => {
    const forms = [...(target.open ? formsAtRisk(registry, latest.current.discards) : []), ...(latest.current.held?.(target) ?? [])]
    return forms.filter((pane, index) => forms.findIndex((other) => named(other) === named(pane)) === index)
  }

  return {
    deletion,
    regionRef,
    saving,
    heard,
    ask(target) {
      for (const other of registry.entries()) if (other !== entry) other.close?.()
      flow.set(confirm(current.current, target, atStake(target)))
    },
    confirm: () => sendDeletion(flow, atStake, heard),
    check: () => checkDeletion(flow),
    ...regionAnswers(flow),
  }
}

/** The answers that end what the region shows, each only in the state it is drawn in: the keyboard back, the record gone, or read again. */
function regionAnswers(flow: FlowState): Pick<DeleteFlow, 'keep' | 'again' | 'close' | 'closeRecord' | 'load'> {
  const { current, latest } = flow
  return {
    keep() {
      const now = current.current
      if (now.state !== 'confirming') return
      flow.set(IDLE)
      latest.current.onBack(now.target)
    },
    again() {
      flow.set(again(current.current))
    },
    close() {
      const now = current.current
      if (now.state !== 'refused') return
      flow.set(IDLE)
      latest.current.onBack(now.target)
    },
    closeRecord() {
      const now = current.current
      if (now.state !== 'not-found' && !(now.state === 'checked' && now.found.kind === 'absent')) return
      flow.set(IDLE)
      latest.current.onGone(now.target, 'Closed', false)
    },
    load() {
      const now = current.current
      if (!(now.state === 'refused' && now.stale) && !(now.state === 'checked' && now.found.kind === 'changed')) return
      flow.set(IDLE)
      latest.current.onLoad(now.target)
    },
  }
}

/**
 * The deletion as the guard knows it: the detail's work when it names the
 * record open there, its grid's otherwise (leave.ts's `gridOwner`), drawn
 * by no renderer. A request of the person's closes its confirmation, and
 * gives the keyboard back to what asked when it was in the region.
 */
function useDeletionEntry(owner: string, flow: FlowState): PaneEntry {
  const entry = useMemo<PaneEntry>(
    () => ({
      get owner() {
        const now = flow.current.current
        return now.state !== 'idle' && !now.target.open ? gridOwner(owner) : owner
      },
      renderer: null,
      name: () => {
        const now = flow.current.current
        return now.state === 'idle' ? [] : [`${now.target.noun} `, { code: now.target.record }]
      },
      work: () => deletionWork(flow.current.current),
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
        if (held) flow.latest.current.onBack(now.target)
      },
    }),
    [owner, flow],
  )
  useRegistered(useMemo(() => [entry], [entry]))
  return entry
}

/**
 * Each new state that asks something of the person takes the keyboard --
 * once its view is shown, when Separate views hid it. Not scrolled
 * sideways: a region scrolled into view horizontally moves the whole page
 * by the scrollbar's gutter (unsaved-notice.tsx).
 */
function useRegionFocus(deletion: Deletion, regionRef: RefObject<HTMLDivElement | null>, show: (target: DeleteTarget) => boolean): void {
  const after = useAfterRender()
  const n = deletion.state === 'idle' ? 0 : deletion.n
  useEffect(() => {
    if (deletion.state === 'idle' || deletion.state === 'sending') return
    const focus = (): void => {
      const region = regionRef.current
      region?.focus({ preventScroll: true })
      region?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
    // A hidden view is drawn on the next render, and nothing hidden takes the keyboard.
    if (show(deletion.target)) after(focus)
    else focus()
    // Only on a new state: the deletion out keeps the confirmation's number, and the keyboard where it is.
  }, [n])
}

/** Delete it: sent, unless a save of the open record is out or a form it drops was typed into since it asked. */
function sendDeletion(flow: FlowState, atStake: (target: DeleteTarget) => PaneWork[], heard: (record: string) => string | null): void {
  const now = flow.current.current
  if (now.state !== 'confirming') return
  const { sessions, client, formId } = flow.latest.current
  // A save out moves the version the delete would name: Delete it waits for its answer, and says so.
  if (now.target.open && sessions.some((session) => session.isSaving())) return
  // Typed into since the question was asked: named before anything is dropped, as the guard names it.
  const risky = atStake(now.target)
  if (risky.some((pane) => !now.discards.some((listed) => named(listed) === named(pane)))) {
    flow.set({ ...now, discards: risky, n: now.n + 1 })
    return
  }
  // The open record's newest version as of now: a save answered while it asked moved it.
  const target = now.target.open ? { ...now.target, version: heard(now.target.record) ?? now.target.version } : now.target
  flow.set(send({ ...now, target }))
  flow.sent.current += 1
  const mine = flow.sent.current
  if (target.open) for (const session of sessions) session.hold(HELD)
  void client.delete(formId, { record: target.record, version: target.version }).then((outcome) => {
    if (flow.sent.current !== mine) {
      // Discarded while it was out: the person moved on, and only the grid hears that it went.
      if (outcome.ok) flow.latest.current.onGone(target, 'Deleted', true)
      return
    }
    release(flow)
    const { next, gone } = answer(flow.current.current, outcome)
    flow.set(next)
    if (gone) flow.latest.current.onGone(target, 'Deleted', false)
  })
}

/** Check whether an unknown deletion was done: one read, and a second press while it reads sends nothing. */
function checkDeletion(flow: FlowState): void {
  const now = flow.current.current
  const unread = now.state === 'checked' && now.found.kind === 'unread'
  if (!(now.state === 'unknown' && !now.checking) && !unread) return
  flow.set(checking(now))
  const { unknown } = now
  const { client, formId } = flow.latest.current
  void client.reconcile(formId, unknown).then((found) => {
    const at = flow.current.current
    // Discarded, or another deletion's since: this check is not what the page shows.
    if (at.state !== 'unknown' || at.unknown !== unknown) return
    flow.set(checked(at, found))
  })
}

/**
 * The newest version of its record the detail heard (0053): whichever of
 * its forms last opened or saved one at a version it did not hold before --
 * a read, a save's answer, a pane's own Load the saved record, a check's
 * load. Each form moves on its own, and under one person a version only
 * moves forward; a form's stale save, or a discard back to what it held,
 * changes nothing it heard.
 */
export function useHeard(sessions: readonly Session[]): (record: string) => string | null {
  const last = useRef<{ record: string; version: string } | null>(null)
  useEffect(() => {
    const seen = new Map<Session, string>()
    const offs = sessions.map((session) =>
      session.subscribe(() => {
        const { record, version } = session.state()
        const at = `${String(record)} ${String(version)}`
        if (seen.get(session) === at) return
        seen.set(session, at)
        if (record !== undefined && version !== undefined) last.current = { record, version }
      }),
    )
    return () => {
      for (const off of offs) off()
    }
  }, [sessions])
  return useCallback(
    (record: string) => (last.current?.record === record ? last.current.version : (sessions.find((session) => session.state().record === record)?.state().version ?? null)),
    [sessions],
  )
}

/** Whether a save of the record is out in any of its forms, as it changes: its Delete waits for the answer. */
export function useSaving(sessions: readonly Session[]): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = sessions.map((session) => session.subscribe(listener))
      return () => {
        for (const off of offs) off()
      }
    },
    [sessions],
  )
  return useSyncExternalStore(subscribe, () => sessions.some((session) => session.isSaving()))
}
