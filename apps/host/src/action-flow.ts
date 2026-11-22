import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createFormEngine } from '@formancy/core'
import type { DataClient, FormAction, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { holdsAsked } from './chosen-rows.js'
import type { ChosenRows } from './chosen-rows.js'
import { useHeard, useSaving } from './delete-flow.js'
import { formsAtRisk, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import { gridOwner } from './leave.js'
import type { PaneWork } from './leave.js'
import type { Opening } from './opening.js'
import type { RendererChoice } from './prefs.js'
import type { RecordGridHandle } from './record-grid.js'
import {
  again,
  answer,
  answered,
  ask,
  checked,
  checking,
  close,
  DONE,
  doneText,
  heading,
  IDLE,
  READING_AGAIN,
  RUN_HELD,
  runWork,
  send,
  unread,
  words,
} from './running.js'
import type { Run, RunRecord, RunTarget } from './running.js'
import type { Renderer, Session, Submitted } from './session.js'
import type { HeldLevels } from './use-drill.js'

/*
 * An action's runs on the page, through running.ts's states against the
 * server, with the guard: the open record's (0162), which the detail's
 * header offers, each action over the open record the form serves this
 * person (`PublishedForm.actions`, 0161); and, given the records grid's
 * choice (`chosen`), the actions over a selection, which the bar above the
 * grid offers (selection-bar.tsx, 0166) -- one flow each, so a run of each
 * may be out at once. The region under what asked asks, confirms and says
 * what the server answered.
 *
 * Over a selection, what differs is the records and what is read again:
 * the records chosen of the page shown, each at the version the page read
 * it at or the detail heard since (chosen-rows.ts), and once it ran the
 * page read again and the choice cleared. Where the open record is one of
 * them, the run is over it too, and everything below holds of it. A
 * question over a selection stands only while the choice holds what it
 * was asked over: a box ticked or unticked, Clear the choice, or another
 * page drawn -- which clears the choice, and the bar says so -- closes a
 * dialog or a confirmation, nothing run, since Run it would send records
 * the bar no longer says are chosen, or the person no longer sees.
 *
 * - **One question at a time.** Asking closes any other owner's
 *   confirmation -- a delete's -- and every request the person makes of
 *   the guard closes this one's, nothing run.
 * - **The guard counts it.** A run out, or one that may have run and is
 *   not checked, is the record's work (leave.ts): what drops the record
 *   asks first, and Discard drops the page's track of it.
 * - **Run it waits for a save out.** A save of the record moves the
 *   version the run would name, so while one is out Run it says so and
 *   sends nothing, as Delete it does (0053); and while the run is out, a
 *   press of the record's Save sends nothing and says why.
 * - **The version** the run names is the newest the detail heard as Run it
 *   is pressed (`useHeard`); a run again after a check names the version
 *   the lost run sent.
 * - **Done reads the record again**, into its own panes, through the guard
 *   -- the run moved its version, and the routine may have changed its
 *   values, so the panes' version from before would make the next Save
 *   stale against a move the person caused -- and the grids the action
 *   names besides. The forms its confirmation listed drop without being
 *   asked about again; one that holds work only since is asked about when
 *   the read answers. Until the read has opened, been refused, been kept
 *   from or had its question replaced, a Save of the record sends nothing;
 *   and a question the guard asks meanwhile about something else does not
 *   drop it: it waits for the person's answer (opening.ts).
 * - **The keyboard** goes to every state that asks something of the
 *   person, each time it is a new one -- a run out asked again included --
 *   unless the guard is asking the person something meanwhile, and back to
 *   the action that asked on Keep it and Close.
 */

export interface ActionFlow {
  run: Run
  /** The actions offered, in the form's order: over the open record, in the detail's header; over a selection, above the grid. */
  actions: readonly FormAction[]
  /** An action's label in words. */
  label(action: FormAction): string
  /** The confirmation's sentence: the administrator's, or null for the page's own. */
  confirmation(action: FormAction): string | null
  /** The renderer the dialog is drawn by. */
  renderer: Renderer
  /** The region the run is drawn in: focused for each new state. */
  regionRef: RefObject<HTMLDivElement | null>
  /** Where each action's button is, by its name: the keyboard goes back there. */
  buttonRef(name: string): (button: HTMLButtonElement | null) => void
  /** A save of the record is out in one of its forms: Run it waits for the answer. */
  saving: boolean
  ask(action: FormAction): void
  /** The dialog's Continue: what the renderer submitted. */
  answered: (submitted: Submitted) => void
  /** Keep it, or Escape: nothing run, the keyboard back on the action. */
  keep: () => void
  /** Run it. */
  confirm(): void
  /** Check whether an unknown run ran. */
  check: () => void
  /** Run it again, from the version the lost run sent. */
  again: () => void
  /** Close what the server answered: the keyboard back on the action. */
  close: () => void
  /** Load the saved record: after a stale run, a run whose record could not be read again, or a check that found it changed. */
  load: () => void
}

export interface ActionFlowOptions {
  client: DataClient
  /** The form, by its id, and its title, which names the record. */
  entry: Pick<FormMenuEntry, 'id' | 'title'>
  definition: PublishedForm
  /** The record's own forms, which hold the record open in the detail: held while a run is out, and read again after one. */
  sessions: readonly Session[]
  opening: Opening
  /** The renderers the person chose to show: the dialog is drawn by that one, by React where both are shown. */
  renderer: RendererChoice
  /** The records grid, which lists the record's row again after a run. */
  grid: RefObject<RecordGridHandle | null>
  /** The records grid's choice: given, the flow is the actions over a selection, over the records chosen (0166). */
  chosen?: ChosenRows
  /** The open record's sections, whose grids a run that names `children` lists again (0161). */
  drill: { levels: Pick<HeldLevels, 'reloadUnder'> }
  /** The record was read again into its panes after a run: what the page shows of it besides follows `session`. */
  onReread(session: Session): void
  /** Load the saved record, once its row is listed again: the run moved its version. */
  onLoad(record: string): void
  /** The half the region is in shown, where a layout hides it: true when it was hidden, and is drawn on the next render. */
  onShow(half: 'record' | 'records'): boolean
}

/** What the flow's handlers share: the run as it is now, how to change it, and the detail's options as of the last render. */
interface FlowState {
  current: { current: Run }
  set(next: Run): void
  /** How many runs were sent, or dropped by a discard: an answer for an earlier one is not this page's to show. */
  sent: { current: number }
  latest: { current: ActionFlowOptions }
  buttons: Map<string, HTMLButtonElement>
  regionRef: RefObject<HTMLDivElement | null>
}

const named = (pane: PaneWork): string => `${pane.owner} ${String(pane.renderer)}`

/** What holds the record's forms while a run is out: each flow its own, so the answer to one never lifts the other's. */
const holder = (flow: FlowState): 'action' | 'selection' => (flow.latest.current.chosen === undefined ? 'action' : 'selection')

const release = (flow: FlowState): void => {
  for (const session of flow.latest.current.sessions) session.release(holder(flow))
}

/** The record the detail's panes hold, by its token: the one its actions run over. */
const openRecord = (flow: FlowState): string | null => flow.latest.current.sessions[0]?.state().record ?? null

/** The open record, where `target` is over it -- the open record's action, or a selection that holds it -- and null otherwise. */
const overOpen = (flow: FlowState, target: RunTarget): string | null => {
  const open = openRecord(flow)
  return open !== null && target.records.some((each) => each.record === open) ? open : null
}

/**
 * The records a run is sent over, at their newest versions as Run it is
 * pressed: the open record's as the detail heard it last -- a save answered
 * while it asked moved it -- and a selection's as the page read each, or
 * the detail heard since (chosen-rows.ts): the records chosen now, which
 * `dropped` has found to be the ones it asked over.
 */
function newest(flow: FlowState, target: RunTarget, heard: (record: string) => string | null): RunRecord[] {
  const { chosen } = flow.latest.current
  if (chosen !== undefined) return chosen.records()
  return target.records.map(({ record, version }) => ({ record, version: heard(record) ?? version }))
}

/**
 * A question over a selection -- its dialog, or its confirmation -- whose
 * records are no longer the ones chosen closed, nothing run, and the
 * keyboard given back to the action where it was in the region; true when
 * it was. A run out, or answered, is no question, and stays.
 */
function dropped(flow: FlowState): boolean {
  const now = flow.current.current
  const { chosen } = flow.latest.current
  if (chosen === undefined || (now.state !== 'asking' && now.state !== 'confirming')) return false
  if (holdsAsked(chosen.records(), now.target.records)) return false
  const held = flow.regionRef.current?.contains(document.activeElement) === true
  flow.set(IDLE)
  if (held) back(flow, now.target)
  return true
}

/** The keyboard back on the action that asked. */
const back = (flow: FlowState, target: RunTarget): void => flow.buttons.get(target.action.name)?.focus()

export function useActionFlow(options: ActionFlowOptions): ActionFlow {
  const latest = useRef(options)
  latest.current = options
  const guard = useGuardContext()
  const { registry } = guard
  const [run, setShown] = useState<Run>(IDLE)
  const current = useRef<Run>(IDLE)
  const sent = useRef(0)
  const regionRef = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>()).current
  const flow = useMemo<FlowState>(
    () => ({
      current,
      set: (next) => {
        current.current = next
        setShown(next)
      },
      sent,
      latest,
      buttons,
      regionRef,
    }),
    [buttons],
  )
  const heard = useHeard(options.sessions)
  const savingNow = useSaving(options.sessions)
  const entry = useRunEntry(flow)
  const { definition, chosen } = options
  // A question over the choice stands only while it holds what it asked over.
  useEffect(() => chosen?.subscribe(() => void dropped(flow)), [chosen, flow])
  useRegionFocus(
    run.state === 'idle' ? 0 : run.n,
    regionRef,
    () => latest.current.onShow(chosen === undefined ? 'record' : 'records'),
    () => guard.waiting(),
  )
  const renderer: Renderer = options.renderer === 'angular' ? 'angular' : 'react'
  // Over a selection, Run it waits for a save only where the open record is one of the records chosen.
  const saving = savingNow && (chosen === undefined || (run.state === 'confirming' && overOpen(flow, run.target) !== null))

  /** The forms that hold work which reading the open record again drops, where the run is over it, as the guard would list them. */
  const atStake = (target: RunTarget): PaneWork[] => {
    const open = overOpen(flow, target)
    return open === null ? [] : formsAtRisk(registry, { kind: 'ran', record: open, label: target.label })
  }
  const label = (action: FormAction): string => words(definition.form, action.label) ?? action.name

  return {
    run,
    // The open record's header offers the actions over it, and the bar above the grid those over a selection (0166).
    actions: definition.actions.filter((action) => action.scope === (chosen === undefined ? 'record' : 'selection')),
    label,
    confirmation: (action) => words(definition.form, action.confirm),
    renderer,
    regionRef,
    buttonRef: (name) => (button) => {
      if (button === null) buttons.delete(name)
      else buttons.set(name, button)
    },
    saving,
    ask(action) {
      const record = openRecord(flow)
      // The records chosen of the page, in its order; the open record alone otherwise. Nothing to run over, nothing asked: the bar says what to do first.
      const records = chosen === undefined ? (record === null ? [] : [{ record, version: heard(record) ?? '' }]) : chosen.records()
      if (records.length === 0) return
      for (const other of registry.entries()) if (other !== entry) other.close?.()
      const { id, title } = latest.current.entry
      const target: RunTarget = { action, label: label(action), noun: title, records }
      // A dialog of its own for each question, its ids the form's and the action's, apart from every pane's (formancy.ai 0095).
      const dialog = action.dialog === null ? null : createFormEngine({ schema: action.dialog, formId: `${id}-${action.name}-${renderer}` })
      flow.set(ask(current.current, target, dialog, atStake(target)))
    },
    answered(submitted) {
      const now = current.current
      if (now.state !== 'asking' || !submitted.ok || typeof submitted.data !== 'object' || submitted.data === null) return
      flow.set(answered(now, submitted.data as Record<string, unknown>, atStake(now.target)))
    },
    confirm: () => confirmRun(flow, atStake, heard),
    check: () => checkRun(flow),
    again() {
      const now = current.current
      // Only from the check that found it not run: a press once it is out sends nothing, as a press of Run it does.
      if (now.state !== 'checked') return
      dispatch(flow, again(now))
    },
    ...regionAnswers(flow),
  }
}

/** The answers that end what the region shows, each only in the state it is drawn in: the keyboard back, or the record -- or the page -- read again. */
function regionAnswers(flow: FlowState): Pick<ActionFlow, 'keep' | 'close' | 'load'> {
  const { current, latest } = flow
  return {
    keep() {
      const now = current.current
      if (now.state !== 'asking' && now.state !== 'confirming') return
      flow.set(IDLE)
      back(flow, now.target)
    },
    close() {
      const now = current.current
      if (now.state === 'idle' || runWork(now) !== null) return
      flow.set(IDLE)
      back(flow, now.target)
    },
    load() {
      const now = current.current
      const many = latest.current.chosen !== undefined
      const offered =
        (now.state === 'refused' && (now.stale || (many && now.named.length > 0))) ||
        (now.state === 'done' && now.reread !== null) ||
        (now.state === 'checked' && (now.found.kind === 'changed' || now.found.kind === 'mixed'))
      if (!offered) return
      const open = overOpen(flow, now.target)
      flow.set(IDLE)
      latest.current.grid.current?.reload()
      // Over a selection, Read the page again: the rows at their versions now, the choice kept, the keyboard back on the action -- or the open record loaded, where it was the one not read again.
      if (!many) latest.current.onLoad(now.target.records[0]?.record ?? '')
      else if (now.state === 'done' && open !== null) latest.current.onLoad(open)
      else back(flow, now.target)
    },
  }
}

/**
 * The run as the guard knows it: the open record's work, drawn by no
 * renderer. A request of the person's closes what holds none, and gives
 * the keyboard back to the action that asked when it was in the region.
 */
function useRunEntry(flow: FlowState): PaneEntry {
  const entry = useMemo<PaneEntry>(
    () => ({
      // A run over a selection is the records grid's, as a delete asked from one of its rows is (0053): it goes only with the grid.
      owner: flow.latest.current.chosen === undefined ? 'master' : gridOwner('master'),
      renderer: null,
      name: () => {
        const now = flow.current.current
        return now.state === 'idle' ? [] : heading(now.target)
      },
      work: () => runWork(flow.current.current),
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
        if (held) back(flow, now.target)
      },
    }),
    [flow],
  )
  useRegistered(useMemo(() => [entry], [entry]))
  return entry
}

/**
 * Each new state that asks something of the person takes the keyboard --
 * `n`, its number, 0 while there is none -- once the half it is in is
 * shown where a layout hid it, but while the guard asks the person
 * something, which keeps it: they are answering that. A run out from Run
 * it keeps the confirmation's number, so the keyboard stays on Run it; a
 * run again, or the action asked again while it is out, is a new one; and
 * so for a deletion of chosen records (chosen-delete-flow.ts, 0174). Not
 * scrolled sideways: a region scrolled into view horizontally moves the
 * whole page by the scrollbar's gutter (unsaved-notice.tsx).
 */
export function useRegionFocus(n: number, regionRef: RefObject<HTMLDivElement | null>, show: () => boolean, waiting: () => boolean): void {
  const after = useAfterRender()
  useEffect(() => {
    if (n === 0 || waiting()) return
    const focus = (): void => {
      const region = regionRef.current
      region?.focus({ preventScroll: true })
      region?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
    if (show()) after(focus)
    else focus()
    // Only on a new state: the run out keeps the confirmation's number, and the keyboard where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it runs once for each new state, from the render that made it, so what it reads is that render's and nothing stale
  }, [n])
}

/** Run it: sent, unless a save of the open record it is over is out or a form the reread drops was typed into since it asked. */
function confirmRun(flow: FlowState, atStake: (target: RunTarget) => PaneWork[], heard: (record: string) => string | null): void {
  const now = flow.current.current
  // A choice changed since it asked is not what it confirms: closed, nothing sent.
  if (now.state !== 'confirming' || dropped(flow)) return
  // A save out moves the version the run would name: Run it waits for its answer, and says so.
  if (overOpen(flow, now.target) !== null && flow.latest.current.sessions.some((session) => session.isSaving())) return
  // Typed into since the question was asked: named before anything is sent.
  const risky = atStake(now.target)
  if (risky.some((pane) => !now.discards.some((listed) => named(listed) === named(pane)))) {
    flow.set({ ...now, discards: risky, n: now.n + 1 })
    return
  }
  // The records' newest versions as of now: a save answered while it asked moved the open record's.
  dispatch(flow, send(now, newest(flow, now.target, heard)))
}

/** The run out: its forms held, sent once, and what the server answered drawn -- unless a discard dropped it meanwhile. */
function dispatch(flow: FlowState, out: Run): void {
  if (out.state !== 'sending') return
  const { target, answers, discards } = out
  const { client, entry, sessions } = flow.latest.current
  flow.set(out)
  flow.sent.current += 1
  const mine = flow.sent.current
  // The record's forms held while it is out, where it is over the open record.
  if (overOpen(flow, target) !== null) for (const session of sessions) session.hold(RUN_HELD, holder(flow))
  const records = target.records.map(({ record, version }) => ({ record, version }))
  void client.runAction(entry.id, target.action.name, { records, answers }).then((outcome) => {
    if (flow.sent.current !== mine) return
    const said = doneText(target, words(flow.latest.current.definition.form, target.action.done) ?? DONE)
    const { next, done, problems } = answer(flow.current.current, outcome, said)
    if (problems !== undefined && next.state === 'asking') next.dialog.applyServerErrors(problems)
    flow.set(next)
    if (done) reread(flow, target, discards, mine)
    else release(flow)
  })
}

/**
 * After a run: its row -- or a selection's page -- listed again, and a
 * selection's choice cleared, the done region saying how many it ran over;
 * the open record, where the run was over it, read again into its panes,
 * through the guard, and the sections' grids where the action names them;
 * a read refused is said in the region. The record's forms stay held
 * until the read has opened, been refused, been kept from or had its
 * question replaced -- a Save before would name the version from before
 * the run -- and the forms its confirmation listed (`discards`) drop
 * without asking again. Nothing of the record when the detail holds
 * another by then.
 */
function reread(flow: FlowState, target: RunTarget, discards: readonly PaneWork[], mine: number): void {
  const { opening, grid, drill, sessions, chosen } = flow.latest.current
  grid.current?.reload()
  chosen?.clear()
  // Held for this run alone: a run sent since holds the forms itself.
  const settled = (): void => {
    if (flow.sent.current === mine) release(flow)
  }
  const record = overOpen(flow, target)
  if (record === null) {
    settled()
    return
  }
  for (const session of sessions) session.hold(READING_AGAIN, holder(flow))
  const agreed = discards.flatMap((pane) => (pane.renderer === null ? [] : [pane.renderer]))
  opening.readAgain({ kind: 'ran', record, label: target.label, agreed }, record, {
    opened: () => {
      settled()
      const [session] = flow.latest.current.sessions
      if (session !== undefined) flow.latest.current.onReread(session)
    },
    refused: (message) => {
      settled()
      flow.set(unread(flow.current.current, message))
    },
    // Kept editing: the panes keep what was typed since, at the version before the run, and the region the keyboard.
    back: () => {
      settled()
      flow.regionRef.current?.focus({ preventScroll: true })
    },
    dropped: settled,
  })
  if (target.action.refresh.includes('children')) drill.levels.reloadUnder(record)
}

/** Check whether an unknown run ran: one read of each of its records, and a second press while they read sends nothing. */
function checkRun(flow: FlowState): void {
  const now = flow.current.current
  const unreadNow = now.state === 'checked' && now.found.kind === 'unread'
  if (!(now.state === 'unknown' && !now.checking) && !unreadNow) return
  const started = checking(now)
  if (started.state !== 'unknown') return
  flow.set(started)
  const { unknown } = started
  const { client, entry } = flow.latest.current
  void Promise.all(unknown.records.map(({ record }) => client.read(entry.id, record))).then((found) => {
    const at = flow.current.current
    // Discarded, or another run's since: this check is not what the page shows.
    if (at.state !== 'unknown' || at.unknown !== unknown) return
    flow.set(checked(at, found))
  })
}
