import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import { fieldProblems, lookupSources } from '@formancy/data-client'
import type { DataClient, FormRecord, LookupOperation, Outcome, PublishedForm } from '@formancy/data-client'
import { drawLookupsAsTypeaheads } from './widgets.js'

/*
 * One pane's session: the engine that holds a person's answers, the record
 * and version it was read at, and what a save does with the server's answer
 * (0029). Framework-neutral, so the React pane and the Angular pane show one
 * set of decisions rather than each making its own:
 *
 * - **created / saved**: the same engine is kept, and each stored answer is
 *   set back into it, so the stored spelling shows (`12.5` is `12.5000` in a
 *   numeric(18,4)). The session takes the record and the new version. The
 *   form stays editable while a save is in flight -- neither 0.3.0 renderer
 *   holds input -- so an answer the person changed since pressing Save is
 *   newer than the stored one: it is left as it is, and the result says that
 *   changes are not saved yet.
 * - **stale** (409): nothing is touched. The person's draft stays in the
 *   form; `reload()` is the one way to the saved record, and it discards the
 *   draft. Nothing merges.
 * - **invalid**: the server named fields, and its sentences go onto them
 *   through `applyServerErrors` -- sentences, because the 0.3.0 renderers print
 *   an entry verbatim (`fieldProblems`).
 * - **refused**: anything else is the server's sentence, verbatim, and is not
 *   sent again (0015).
 *
 * A submit the engine refused sends nothing: the renderer already says why.
 * A press while a save is unanswered sends nothing either, and says so
 * (**busy**): the guard is the form's that set it, so a replaced form's save
 * settling late cannot lift it. And an answer that arrives after Load or New
 * replaced the form is not applied to the new one but still said
 * (**replaced**): a record created, or a 502's "may have been saved", is
 * something the person needs to hear about the form they left (0015).
 */

export type Renderer = 'react' | 'angular'

export type SaveResult = { kind: 'saved' | 'created' | 'stale' | 'invalid' | 'refused' | 'busy' | 'replaced'; message: string }

/** What a press says while the previous save is unanswered. */
export const BUSY = 'The previous save has not been answered yet. This press sent nothing: press Save again once it has.'

/** What a save adds when the person changed an answer while it was in flight. */
export const NEWER = 'Changes made while it was saving are still in the form, not saved.'

/** How an answer for a form Load or New has since replaced begins. */
export const REPLACED = 'The save sent before this form was replaced:'


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
function said(outcome: Outcome<FormRecord>, created: boolean): string {
  if (!outcome.ok) return outcome.message
  if (!created) return 'Saved.'
  return outcome.value.record === null ? 'Created.' : `Created record ${outcome.value.record}.`
}

export function createSession({ client, formId, definition, renderer }: SessionOptions) {
  // The host's copy of the form: the published one, with its lookups drawn as typeaheads.
  const form = drawLookupsAsTypeaheads(definition.form)
  const allows = (operation: LookupOperation): boolean => definition.operations.includes(operation)
  const operationFor = (record: string | undefined): LookupOperation =>
    record !== undefined ? (allows('update') ? 'update' : 'read') : allows('create') ? 'create' : 'read'
  const keys = new Set(definition.form.model.fields.map((field) => field.key))
  const listeners = new Set<() => void>()

  let state: SessionState = { record: undefined, version: undefined, operation: operationFor(undefined) }
  let opened: Opened | undefined
  /** The save in flight, and the generation of the form that sent it. */
  let saving: { promise: Promise<SaveResult | null>; generation: number } | undefined

  /** Read through a getter, so moving from create to update needs no new map -- in Angular, no new application. */
  const sources = lookupSources(client, formId, form, () => state.operation)

  function open(record?: FormRecord): FormEngine {
    const engine = createFormEngine({
      schema: form,
      // One id namespace per renderer: two renderers of one document on one
      // page would otherwise mint every element id twice (formancy.ai 0095).
      formId: `${form.id}-${renderer}`,
      ...(record === undefined ? {} : { initialValue: record.answers }),
      capabilities: CAPABILITIES,
    })
    const token = record?.record ?? undefined
    state = { record: token, version: record?.version ?? undefined, operation: operationFor(token) }
    opened = { engine, generation: (opened?.generation ?? 0) + 1 }
    for (const listener of listeners) listener()
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
  function settle(engine: FormEngine, sent: Record<string, unknown>, outcome: Outcome<FormRecord>, created: boolean): SaveResult {
    if (!outcome.ok) {
      if (outcome.status === 409 && outcome.code === 'stale') return { kind: 'stale', message: outcome.message }
      const problems = Object.fromEntries(Object.entries(fieldProblems(outcome)).filter(([field]) => keys.has(field)))
      if (Object.keys(problems).length === 0) return { kind: 'refused', message: outcome.message }
      engine.applyServerErrors(problems)
      return { kind: 'invalid', message: outcome.message }
    }
    const now = engine.value() as Record<string, unknown>
    let newer = false
    for (const [key, value] of Object.entries(outcome.value.answers)) {
      if (!keys.has(key)) continue
      if (same(now[key], sent[key])) engine.setValue([key], value)
      else newer = true
    }
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
    return settle(engine, sent, outcome, record === undefined)
  }

  return {
    formId,
    definition,
    renderer,
    sources,
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
      const promise: Promise<SaveResult | null> = send(engine, generation, submitted.data).finally(() => {
        // Only its own: a later form's save may hold the guard by now.
        if (saving?.promise === promise) saving = undefined
      })
      saving = { promise, generation }
      return promise
    },
  }
}

export type Session = ReturnType<typeof createSession>
