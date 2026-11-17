import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createFormEngine } from '@formancy/core'
import type { DataClient, FormAction, FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { useHeard, useSaving } from './delete-flow.js'
import { formsAtRisk, useGuardContext, useRegistered } from './guard.js'
import type { PaneEntry } from './guard.js'
import type { PaneWork } from './leave.js'
import type { Opening } from './opening.js'
import type { RendererChoice } from './prefs.js'
import type { RecordGridHandle } from './record-grid.js'
import { again, answer, answered, ask, checked, checking, close, DONE, IDLE, READING_AGAIN, RUN_HELD, runWork, send, unread, words } from './running.js'
import type { Run, RunTarget } from './running.js'
import type { Renderer, Session, Submitted } from './session.js'
import type { HeldLevels } from './use-drill.js'

/*
 * The open record's actions on the page (0162), run through running.ts's
 * states against the server, with the guard. The detail's header offers
 * each action the form serves this person (`PublishedForm.actions`, 0161);
 * the region under it asks, confirms and says what the server answered.
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
  /** The actions the detail's header offers, in the form's order. */
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
  /** The open record's sections, whose grids a run that names `children` lists again (0161). */
  drill: { levels: Pick<HeldLevels, 'reloadUnder'> }
  /** The record was read again into its panes after a run: what the page shows of it besides follows `session`. */
  onReread(session: Session): void
  /** Load the saved record, once its row is listed again: the run moved its version. */
  onLoad(record: string): void
  /** The detail shown, where a layout hides it: true when it was hidden, and is drawn on the next render. */
  onShow(half: 'record'): boolean
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

const release = (flow: FlowState): void => {
  for (const session of flow.latest.current.sessions) session.release('action')
}

/** The record the detail's panes hold, by its token: the one its actions run over. */
const openRecord = (flow: FlowState): string | null => flow.latest.current.sessions[0]?.state().record ?? null

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
  const saving = useSaving(options.sessions)
  const entry = useRunEntry(flow)
  useRunFocus(
    run,
    regionRef,
    () => latest.current.onShow('record'),
    () => guard.waiting(),
  )
  const { definition } = options
  const renderer: Renderer = options.renderer === 'angular' ? 'angular' : 'react'

  /** The forms that hold work which reading the record again drops, as the guard would list them. */
  const atStake = (target: RunTarget): PaneWork[] => formsAtRisk(registry, { kind: 'ran', record: target.record, label: target.label })
  const label = (action: FormAction): string => words(definition.form, action.label) ?? action.name

  return {
    run,
    actions: definition.actions,
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
      if (record === null) return
      for (const other of registry.entries()) if (other !== entry) other.close?.()
      const { id, title } = latest.current.entry
      const target: RunTarget = { action, label: label(action), noun: title, record, version: heard(record) ?? '' }
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

/** The answers that end what the region shows, each only in the state it is drawn in: the keyboard back, or the record read again. */
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
      const offered =
        (now.state === 'refused' && now.stale) || (now.state === 'done' && now.reread !== null) || (now.state === 'checked' && now.found.kind === 'changed')
      if (!offered) return
      flow.set(IDLE)
      latest.current.grid.current?.reload()
      latest.current.onLoad(now.target.record)
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
      owner: 'master',
      renderer: null,
      name: () => {
        const now = flow.current.current
        return now.state === 'idle' ? [] : [`${now.target.label}: ${now.target.noun} `, { code: now.target.record }]
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
 * Each new state that asks something of the person takes the keyboard,
 * once the detail is shown where a layout hid it -- but while the guard
 * asks the person something, which keeps it: they are answering that. The
 * run out from Run it keeps the confirmation's number, so the keyboard
 * stays on Run it; a run again, or the action asked again while it is out,
 * is a new one. Not scrolled sideways: a region scrolled into view
 * horizontally moves the whole page by the scrollbar's gutter
 * (unsaved-notice.tsx).
 */
function useRunFocus(run: Run, regionRef: RefObject<HTMLDivElement | null>, show: () => boolean, waiting: () => boolean): void {
  const after = useAfterRender()
  const n = run.state === 'idle' ? 0 : run.n
  useEffect(() => {
    if (run.state === 'idle' || waiting()) return
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

/** Run it: sent, unless a save of the record is out or a form the reread drops was typed into since it asked. */
function confirmRun(flow: FlowState, atStake: (target: RunTarget) => PaneWork[], heard: (record: string) => string | null): void {
  const now = flow.current.current
  if (now.state !== 'confirming') return
  // A save out moves the version the run would name: Run it waits for its answer, and says so.
  if (flow.latest.current.sessions.some((session) => session.isSaving())) return
  // Typed into since the question was asked: named before anything is sent.
  const risky = atStake(now.target)
  if (risky.some((pane) => !now.discards.some((listed) => named(listed) === named(pane)))) {
    flow.set({ ...now, discards: risky, n: now.n + 1 })
    return
  }
  // The record's newest version as of now: a save answered while it asked moved it.
  dispatch(flow, send(now, heard(now.target.record) ?? now.target.version))
}

/** The run out: its forms held, sent once, and what the server answered drawn -- unless a discard dropped it meanwhile. */
function dispatch(flow: FlowState, out: Run): void {
  if (out.state !== 'sending') return
  const { target, answers, discards } = out
  const { client, entry, sessions } = flow.latest.current
  flow.set(out)
  flow.sent.current += 1
  const mine = flow.sent.current
  for (const session of sessions) session.hold(RUN_HELD, 'action')
  void client.runAction(entry.id, target.action.name, { records: [{ record: target.record, version: target.version }], answers }).then((outcome) => {
    if (flow.sent.current !== mine) return
    const said = words(flow.latest.current.definition.form, target.action.done) ?? DONE
    const { next, done, problems } = answer(flow.current.current, outcome, said)
    if (problems !== undefined && next.state === 'asking') next.dialog.applyServerErrors(problems)
    flow.set(next)
    if (done) reread(flow, target, discards, mine)
    else release(flow)
  })
}

/**
 * After a run: its row listed again, the record read again into its
 * panes, through the guard, and the sections' grids where the action names
 * them; a read refused is said in the region. The record's forms stay held
 * until the read has opened, been refused, been kept from or had its
 * question replaced -- a Save before would name the version from before
 * the run -- and the forms its confirmation listed (`discards`) drop
 * without asking again. Nothing of the record when the detail holds
 * another by then.
 */
function reread(flow: FlowState, target: RunTarget, discards: readonly PaneWork[], mine: number): void {
  const { opening, grid, drill, sessions } = flow.latest.current
  grid.current?.reload()
  // Held for this run alone: a run sent since holds the forms itself.
  const settled = (): void => {
    if (flow.sent.current === mine) release(flow)
  }
  if (openRecord(flow) !== target.record) {
    settled()
    return
  }
  for (const session of sessions) session.hold(READING_AGAIN, 'action')
  const agreed = discards.flatMap((pane) => (pane.renderer === null ? [] : [pane.renderer]))
  opening.readAgain({ kind: 'ran', record: target.record, label: target.label, agreed }, target.record, {
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
  if (target.action.refresh.includes('children')) drill.levels.reloadUnder(target.record)
}

/** Check whether an unknown run ran: one read of its record, and a second press while it reads sends nothing. */
function checkRun(flow: FlowState): void {
  const now = flow.current.current
  const unreadNow = now.state === 'checked' && now.found.kind === 'unread'
  if (!(now.state === 'unknown' && !now.checking) && !unreadNow) return
  const started = checking(now)
  if (started.state !== 'unknown') return
  flow.set(started)
  const { unknown } = started
  const { client, entry } = flow.latest.current
  void client.read(entry.id, unknown.records[0]?.record ?? started.target.record).then((found) => {
    const at = flow.current.current
    // Discarded, or another run's since: this check is not what the page shows.
    if (at.state !== 'unknown' || at.unknown !== unknown) return
    flow.set(checked(at, found))
  })
}
