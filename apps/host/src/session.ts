import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import { fieldProblems, isUnknownWrite, lookupSources } from '@formancy/data-client'
import type { DataClient, FormRecord, LookupOperation, PublishedForm, Reconciliation, UnknownWrite, WriteOutcome } from '@formancy/data-client'
import type { Work } from './leave.js'
import { disableFields, drawLookupsAsTypeaheads } from './widgets.js'

/*
 * One pane's session: the engine that holds a person's answers, the record
 * and version it was read at, and what a save does with the server's answer
 * (0029). Framework-neutral, so the React pane and the Angular pane show one
 * set of decisions rather than each making its own:
 *
 * - **created / saved**: the same engine is kept, and each stored answer is
 *   set back into it, so the stored spelling shows (`12.5` is `12.5000` in a
 *   numeric(18,4)). The session takes the record and the new version. The
 *   form stays editable while a save is in flight -- neither renderer holds
 *   input, at 0.3.0, 0.4.0 or 0.5.0 -- so an answer the person changed since
 *   pressing Save is newer than the stored one: it is left as it is, and the
 *   result says that changes are not saved yet.
 * - **stale** (409): nothing is touched. The person's draft stays in the
 *   form; `reload()` is the one way to the saved record, and it discards the
 *   draft. Nothing merges.
 * - **invalid**: the server named fields, and its sentences go onto them
 *   through `applyServerErrors` -- sentences, because the renderers print an
 *   entry verbatim, at 0.3.0, 0.4.0 and 0.5.0 (`fieldProblems`).
 * - **refused**: anything else is the server's sentence, verbatim, and is not
 *   sent again (0015).
 * - **unknown**: the answer was lost -- by the database, said in the server's
 *   502, or between this page and the server -- and the write may have been
 *   stored (0031). Nothing is applied and nothing is sent again. An update
 *   keeps the version it sent: saving again with it is stored at most once.
 *   A create holds the form: a press sends nothing (**held**) until `check()`
 *   finds it absent or the person says to enter it again (`allowAgain()`),
 *   because the renderer owns the Save button and a second create is a
 *   second record. The hold is the form's: Load and New clear it. An update
 *   sent again at the same version and answered stale stays unknown: the
 *   record moved on, most likely by the save whose answer was lost.
 *
 * What a pane holds that leaving it would lose (`work()`, 0047): answers
 * changed since it was opened or last saved, a save still out, or a save
 * whose outcome is unknown. The workspace asks before anything drops a form
 * that holds work; `discard()` drops it, and opens the form again as it was
 * opened or last saved.
 *
 * A submit the engine refused sends nothing: the renderer already says why.
 * So does a press while the record's deletion is out (`hold`, 0053): the
 * update would race the delete.
 * A press while a save is unanswered sends nothing either, and says so
 * (**busy**): the guard is the form's that set it, so a replaced form's save
 * settling late cannot lift it. And an answer that arrives after Load or New
 * replaced the form is not applied to the new one but still said
 * (**replaced**): a record created, or a 502's "may have been saved", is
 * something the person needs to hear about the form they left (0015).
 */

export type Renderer = 'react' | 'angular'

export type SaveResult =
  | { kind: 'saved' | 'created' | 'stale' | 'invalid' | 'refused' | 'busy' | 'replaced' | 'held'; message: string }
  | { kind: 'unknown'; message: string; unknown: UnknownWrite }

/** What a press says while the previous save is unanswered. */
export const BUSY = 'The previous save has not been answered yet. This press sent nothing: press Save again once it has.'

/** What a save adds when the person changed an answer while it was in flight. */
export const NEWER = 'Changes made while it was saving are still in the form, not saved.'

/** How an answer for a form Load or New has since replaced begins. */
export const REPLACED = 'The save sent before this form was replaced:'

/** What a press says while a create whose outcome is unknown holds the form. */
export const HELD = 'Nothing was sent: the last save may have been stored. Check whether it was saved first.'

/**
 * What an update says when it is stale against the very version this form's
 * unknown update sent: the record moved on, and the likeliest mover is that
 * earlier save. Not "Not saved" alone, which would let the person believe
 * nothing of theirs is stored.
 */
export const CHANGED_SINCE_UNKNOWN =
  'This save was not stored: the record has changed since it was read, perhaps by the save before it, which may have been stored. Check whether it was saved.'

/** What `check()` answers when this form has no save whose outcome is unknown. */
const NOTHING_TO_CHECK: Reconciliation = { ok: false, status: 0, code: 'nothing-to-check', message: 'This form has no save whose outcome is unknown.' }


export interface SessionState {
  /** The record's token, once there is one: read, or created here. */
  record: string | undefined
  /** The version the record was read or saved at, which an update sends back. */
  version: string | undefined
  /** What the form is open for, which decides the policy's lookup filter. */
  operation: LookupOperation
}

/** The engine on screen, and how many times the session has opened one: a new number is a new form. */
export interface Opened {
  engine: FormEngine
  generation: number
}

/** What a renderer's submit hands over, read structurally: both renderers' `SubmitOutcome` fit. */
export interface Submitted {
  ok: boolean
  data?: unknown
}

export interface SessionOptions {
  client: DataClient
  formId: string
  definition: PublishedForm
  renderer: Renderer
  /**
   * What the engine's element ids start with, before the renderer: the
   * form's id for a record's panes, `<child form>~<field>` for a child
   * section's, so two sections of one form -- or a form that is its own
   * child -- never mint one id twice (0047). `~` is in neither a form id nor
   * a field key.
   */
  namespace?: string
  /**
   * Fields drawn disabled on the host's copy: a child's field that names its
   * parent, which the page fills in. Presentation only -- the renderers still
   * submit a disabled field, and the server checks only that the parent is
   * one the person may reference (0043).
   */
  fixed?: readonly string[]
}

/**
 * The browser's clock, as a host supplies it: a generated form carries logic
 * rules, and the engine never reads an ambient clock.
 */
const CAPABILITIES = {
  now: () => Date.now(),
  today: () => new Date().toISOString().slice(0, 10),
  random: () => Math.random(),
}

function isAnswers(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether two answers are the same value: answers are JSON, so their JSON is. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** What a save the server answered says, before anything is applied. */
function said(outcome: WriteOutcome, created: boolean): string {
  if (!outcome.ok) return outcome.message
  if (!created) return 'Saved.'
  return outcome.value.record === null ? 'Created.' : `Created record ${outcome.value.record}.`
}

export function createSession({ client, formId, definition, renderer, namespace, fixed = [] }: SessionOptions) {
  // The host's copy of the form: the published one, with its lookups drawn
  // as typeaheads and the fields the page fills in disabled.
  const form = disableFields(drawLookupsAsTypeaheads(definition.form), fixed)
  // A saved record this person may not update is drawn with every field
  // disabled, as the generator draws a field nothing may write: presentation
  // only, the server refuses the update (UX-SPEC D19).
  const readOnly = disableFields(form, form.model.fields.map((field) => field.key))
  const ids = namespace ?? form.id
  const allows = (operation: LookupOperation): boolean => definition.operations.includes(operation)
  const operationFor = (record: string | undefined): LookupOperation =>
    record !== undefined ? (allows('update') ? 'update' : 'read') : allows('create') ? 'create' : 'read'
  const keys = new Set(definition.form.model.fields.map((field) => field.key))
  const listeners = new Set<() => void>()

  let state: SessionState = { record: undefined, version: undefined, operation: operationFor(undefined) }
  let opened: Opened | undefined
  /** The answers as the form was opened or last saved: what "changed" is measured against. */
  let baseline: Record<string, unknown> = {}
  /** The save in flight, and the generation of the form that sent it. */
  let saving: { promise: Promise<SaveResult | null>; generation: number } | undefined
  /** The last save of a form whose outcome is unknown, and whether it holds that form. */
  let lost: { write: UnknownWrite; generation: number; held: boolean } | undefined
  const lostHere = () => (lost !== undefined && lost.generation === opened?.generation ? lost : undefined)
  /** What a press says while the record's deletion is out (0053): set by `hold`, lifted by `release`. */
  let deleting: string | undefined
  /** A form opened, a save sent or a save answered: each is a change `subscribe`'s listeners hear. */
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  /** Read through a getter, so moving from create to update needs no new map -- in Angular, no new application. */
  const sources = lookupSources(client, formId, form, () => state.operation)

  function open(record?: FormRecord): FormEngine {
    const token = record?.record ?? undefined
    const engine = createFormEngine({
      schema: token !== undefined && !allows('update') ? readOnly : form,
      // One id namespace per renderer: two renderers of one document on one
      // page would otherwise mint every element id twice (formancy.ai 0095).
      formId: `${ids}-${renderer}`,
      ...(record === undefined ? {} : { initialValue: record.answers }),
      capabilities: CAPABILITIES,
    })
    state = { record: token, version: record?.version ?? undefined, operation: operationFor(token) }
    baseline = structuredClone(engine.value()) as Record<string, unknown>
    opened = { engine, generation: (opened?.generation ?? 0) + 1 }
    notify()
    return engine
  }

  function current(): Opened {
    if (opened === undefined) open()
    return opened as Opened
  }

  /**
   * What the server answered, applied to the engine it was asked for. `sent`
   * is the answers as they went: a stored answer replaces only one still as
   * it was sent, never one the person has changed since.
   */
  function settle(engine: FormEngine, generation: number, sent: Record<string, unknown>, at: Pick<SessionState, 'record' | 'version'>, outcome: WriteOutcome, created: boolean): SaveResult {
    if (isUnknownWrite(outcome)) {
      // Nothing is applied: the record and the version stay what they were
      // when it was sent. Only a create holds -- an update protects itself.
      lost = { write: outcome, generation, held: outcome.operation === 'create' }
      return { kind: 'unknown', message: outcome.message, unknown: outcome }
    }
    // Stale against the version this form's unknown update sent: the record
    // moved on, most likely by that update. Still unknown, and still checkable.
    const here = lostHere()
    if (!outcome.ok && outcome.status === 409 && outcome.code === 'stale' && here?.write.operation === 'update' && here.write.record === at.record && here.write.version === at.version) {
      return { kind: 'unknown', message: CHANGED_SINCE_UNKNOWN, unknown: here.write }
    }
    // Answered: an earlier unknown save of this form is no longer the last one.
    if (here !== undefined) lost = undefined
    if (!outcome.ok) {
      if (outcome.status === 409 && outcome.code === 'stale') return { kind: 'stale', message: outcome.message }
      const problems = Object.fromEntries(Object.entries(fieldProblems(outcome)).filter(([field]) => keys.has(field)))
      if (Object.keys(problems).length === 0) return { kind: 'refused', message: outcome.message }
      engine.applyServerErrors(problems)
      return { kind: 'invalid', message: outcome.message }
    }
    const now = engine.value() as Record<string, unknown>
    let newer = false
    // What the record now holds, as the form would show it: what was sent,
    // in the stored spelling where the server says one.
    const held: Record<string, unknown> = { ...sent }
    for (const [key, value] of Object.entries(outcome.value.answers)) {
      if (!keys.has(key)) continue
      held[key] = value
      if (same(now[key], sent[key])) engine.setValue([key], value)
      else newer = true
    }
    baseline = held
    const record = outcome.value.record ?? undefined
    state = { record, version: outcome.value.version ?? undefined, operation: operationFor(record) }
    const message = said(outcome, created)
    return { kind: created ? 'created' : 'saved', message: newer ? `${message} ${NEWER}` : message }
  }

  async function send(engine: FormEngine, generation: number, answers: Record<string, unknown>): Promise<SaveResult> {
    // A copy: the answers as they went, whatever the engine holds by the time the server answers.
    const sent = structuredClone(answers)
    const { record, version } = state
    const outcome =
      record === undefined
        ? await client.create(formId, sent)
        : await client.update(formId, { record, version: version ?? '', answers: sent })
    // Load or New replaced the form while this was in flight: the answer must
    // not move the new form's record, and is still said, as the old form's.
    if (current().generation !== generation) return { kind: 'replaced', message: `${REPLACED} ${said(outcome, record === undefined)}` }
    return settle(engine, generation, sent, { record, version }, outcome, record === undefined)
  }

  /** The record as this form was opened or last saved: its token, its version, and the answers as stored. */
  function saved(): FormRecord {
    return { record: state.record ?? null, version: state.version ?? null, answers: structuredClone(baseline) as FormRecord['answers'] }
  }

  /** Whether the answers on screen differ from those the form was opened or last saved with. */
  function changed(): boolean {
    const now = (current().engine.value() ?? {}) as Record<string, unknown>
    return [...new Set([...Object.keys(now), ...Object.keys(baseline)])].some((key) => !same(now[key], baseline[key]))
  }

  return {
    formId,
    definition,
    renderer,
    sources,
    changed,
    /**
     * What this form holds that leaving it would lose: a save whose outcome
     * is unknown first, then a save still out, then changed answers; null
     * when nothing would be lost.
     */
    work(): Work | null {
      const { generation } = current()
      if (lostHere() !== undefined) return 'unknown'
      if (saving?.generation === generation) return 'saving'
      return changed() ? 'changed' : null
    },
    /**
     * Drop what this form holds: open it again as it was opened or last
     * saved. A save still out is then a replaced form's, said and not applied,
     * and an unknown write's hold goes, as Load and New clear it (0031).
     */
    discard(): void {
      open(saved())
    },
    /**
     * The record as opened or last saved, with nothing typed since: what
     * another pane opens once this one has created a record (0047).
     */
    saved,
    /** The engine on screen. The same object between opens, so `useSyncExternalStore` can read it. */
    opened: current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    state: (): SessionState => ({ ...state }),
    /** A new engine over `record`, or over nothing for a new record. The old one, and its draft, are dropped. */
    open,
    /**
     * Read the record again and open it: "Load the saved record" after a
     * stale save. Null when it opened; otherwise the server's sentence.
     */
    async reload(): Promise<string | null> {
      if (state.record === undefined) return 'There is no saved record to load: this form has not been saved yet.'
      const read = await client.read(formId, state.record)
      if (!read.ok) return read.message
      open(read.value)
      return null
    },
    /**
     * Save what the renderer submitted. Null when the engine refused it and
     * nothing was sent. A press while this form's save is unanswered sends
     * nothing and says so; a replaced form's save does not hold the new one.
     */
    async save(submitted: Submitted): Promise<SaveResult | null> {
      if (!submitted.ok || !isAnswers(submitted.data)) return null
      const { engine, generation } = current()
      if (saving?.generation === generation) return { kind: 'busy', message: BUSY }
      if (lostHere()?.held === true) return { kind: 'held', message: HELD }
      if (deleting !== undefined) return { kind: 'held', message: deleting }
      const promise: Promise<SaveResult | null> = send(engine, generation, submitted.data).finally(() => {
        // Only its own: a later form's save may hold the guard by now.
        if (saving?.promise === promise) saving = undefined
        notify()
      })
      saving = { promise, generation }
      notify()
      return promise
    },
    /** Whether this form's save is out, asked without opening a form: the detail's Delete waits for it (0053). */
    isSaving(): boolean {
      return saving !== undefined && saving.generation === opened?.generation
    },
    /**
     * While the record's deletion is out (0053), a press sends nothing and
     * says `message`; `release` lifts it, whatever the deletion came to.
     */
    hold(message: string): void {
      deleting = message
    },
    release(): void {
      deleting = undefined
    },
    /** This form's last save whose outcome is unknown, if any. */
    unknown: (): UnknownWrite | undefined => lostHere()?.write,
    /**
     * Read what that save addressed and say what it shows (0031). `absent`
     * lifts the hold: creating again is safe, the key stops a second row.
     * Nothing is sent again and nothing is opened: `present` and `changed`
     * carry the stored record for the person to choose to load.
     */
    async check(): Promise<Reconciliation> {
      const here = lostHere()
      if (here === undefined) return NOTHING_TO_CHECK
      const found = await client.reconcile(formId, here.write)
      if (found.ok && found.state === 'absent' && lostHere() === here) here.held = false
      return found
    },
    /** The person has checked by their own means and says to enter it again: the next press creates. */
    allowAgain(): void {
      const here = lostHere()
      if (here !== undefined) here.held = false
    },
  }
}

export type Session = ReturnType<typeof createSession>
