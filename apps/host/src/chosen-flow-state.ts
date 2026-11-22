import type { RefObject } from 'react'
import type { DataClient, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { IDLE } from './chosen-request.js'
import type { ChosenKind, ChosenRequest, ChosenTarget } from './chosen-request.js'
import { holdsAsked } from './chosen-rows.js'
import type { ChosenRows } from './chosen-rows.js'
import { formsAtRisk } from './guard.js'
import type { Registry } from './guard.js'
import { eachOnce } from './leave.js'
import type { PaneWork } from './leave.js'
import type { Opening } from './opening.js'
import type { RendererChoice } from './prefs.js'
import type { RecordGridHandle } from './record-grid.js'
import type { Session } from './session.js'
import type { HeldLevels } from './use-drill.js'

/*
 * What a request over the records chosen shares with its handlers
 * (chosen-flow.ts, and a change's question, chosen-change-flow.ts): the
 * options as of the last render, the request as it is now, and the rules
 * every step asks -- which forms it drops, where the keyboard goes back
 * to, and that a question stands only while the choice holds what it
 * asked over (0166).
 */

export interface ChosenOptions {
  client: DataClient
  /** The form, by its id, and its title, which names each record. */
  entry: Pick<FormMenuEntry, 'id' | 'title'>
  definition: PublishedForm
  /** The open record's own forms: listed, held, and closed or read again where it is chosen. */
  sessions: readonly Session[]
  /** How the open record is read again into its forms once a change changed it (0162). */
  opening: Opening
  /** The renderers the person chose to show: a change's fields are drawn by that one, by React where both are shown. */
  renderer: RendererChoice
  /** The records grid, read again once the server answered. */
  grid: RefObject<RecordGridHandle | null>
  chosen: ChosenRows
  /** The Drill down levels, whose forms that hold a chosen record are listed as discarded with it by a deletion (0094). */
  drill: { levels: Pick<HeldLevels, 'atRisk'> }
  /** A record has left the page -- deleted, not found, or found gone: dropped from every level that holds it, and closed where it is the open one. */
  onGone: (record: string) => void
  /** The open record was read again into its forms after a change: what the page shows of it besides follows `session`. */
  onReread(session: Session): void
  /** The records half shown, where a layout hides it: true when it was hidden, and is drawn on the next render. */
  onShow: (half: 'records') => boolean
}

/** What the flow's handlers share: the request as it is now, how to change it, and the options as of the last render. */
export interface FlowState {
  current: { current: ChosenRequest }
  set(next: ChosenRequest): void
  /** How many requests were sent, or dropped by a discard: an answer for an earlier one is not this page's to show. */
  sent: { current: number }
  latest: { current: ChosenOptions }
  regionRef: RefObject<HTMLDivElement | null>
  buttons: Readonly<Record<ChosenKind, RefObject<HTMLButtonElement | null>>>
  /** Every pane the guard knows: what a request drops is read from it as the guard would read it. */
  registry: Registry
}

/** The record the detail's forms hold, by its token. */
export const openRecord = (flow: FlowState): string | null => flow.latest.current.sessions[0]?.state().record ?? null

/** The open record, where `target` holds it, and null otherwise. */
export const overOpen = (flow: FlowState, target: ChosenTarget): string | null => {
  const open = openRecord(flow)
  return open !== null && target.records.some((each) => each.record === open) ? open : null
}

/** The forms the open record's closing drops that hold work: its own, its sections', and every Drill down level's. */
export const openAtRisk = (flow: FlowState): PaneWork[] => formsAtRisk(flow.registry, { kind: 'new' })

/**
 * The forms that hold work which the request drops, as the guard would
 * list them: a deletion's, the open record's and the levels that hold
 * one, each once; a change's, the open record's own, read again once it
 * is changed.
 */
export function atStake(flow: FlowState, kind: ChosenKind, target: ChosenTarget): PaneWork[] {
  const open = overOpen(flow, target)
  if (kind === 'change') return open === null ? [] : formsAtRisk(flow.registry, { kind: 'changed-chosen', record: open })
  const { entry, drill } = flow.latest.current
  const levels = target.records.flatMap(({ record }) => drill.levels.atRisk(entry.id, record))
  return eachOnce([...(open === null ? [] : openAtRisk(flow)), ...levels])
}

export const release = (flow: FlowState): void => {
  for (const session of flow.latest.current.sessions) session.release('bulk')
}

/** The keyboard back on the bar's button that asked. */
export const back = (flow: FlowState, kind: ChosenKind): void => flow.buttons[kind].current?.focus()

/** A question -- a change's fields, or a confirmation -- whose records are no longer the ones chosen closed, nothing sent; true when it was. */
export function dropped(flow: FlowState): boolean {
  const now = flow.current.current
  if ((now.state !== 'asking' && now.state !== 'confirming') || holdsAsked(flow.latest.current.chosen.records(), now.target.records)) return false
  const held = flow.regionRef.current?.contains(document.activeElement) === true
  flow.set(IDLE)
  if (held) back(flow, now.kind)
  return true
}
