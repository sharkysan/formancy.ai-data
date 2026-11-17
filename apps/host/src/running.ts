import type { FormEngine } from '@formancy/core'
import { fieldProblems, isUnknownAction } from '@formancy/data-client'
import type { ActionOutcome, FormAction, Outcome, FormRecord, UnknownAction } from '@formancy/data-client'
import { resolveText } from '@formancy/spec'
import type { FormSchema, Text } from '@formancy/spec'
import { NOT_FOUND } from './deletion.js'
import type { PaneWork, Said, Work } from './leave.js'

/*
 * One run of an action over the open record on the host page (0162),
 * decided here and only shown by the page: the dialog the action asks,
 * a confirmation in place, then what the server answered.
 *
 *   idle → asking (its dialog) → confirming → sending → done | refused | unknown
 *   sending → asking again, when the server refused an answer by its field
 *   unknown → checked → (unchanged) sending again, from the version sent
 *
 * - **Asking** draws the dialog the form serves (0159), on the paper, and
 *   Continue on it moves to the confirmation; an action with no dialog
 *   starts there. Nothing is kept between the steps but on this page: the
 *   server keeps no conversation (0161).
 * - **Confirming** names the action and the record, says the sentence the
 *   administrator wrote or the page's own, and lists the forms of the
 *   record that hold work, which reading it again after the run drops.
 *   Asked again while a run is out or unknown, it is that one asked again.
 * - **Done** is a token for the record, and nothing else; the page reads
 *   the record again, since the run moved its version.
 * - **Refused** is any other answer of the server's, in its words; stale
 *   offers the saved record, and a reason the deployment worded is said as
 *   its own (0156).
 * - **Unknown** is a run whose answer was lost (0031). A check reads the
 *   record: still at the version sent, it has not run, and Run it again
 *   sends that version again, never the one read since -- if the first
 *   committed after all, the second is stale.
 *
 * `n` counts the states that take the keyboard: each is a new region to
 * focus, even when it looks like the last one.
 */

/** A dialog's answers, by field key, as the renderer submitted them. */
export type Answers = Record<string, unknown>

/** The run a person asked for: the action as the form offers it, its label in words, the form's title, and the record with the version the page read it at. */
export interface RunTarget {
  action: FormAction
  label: string
  noun: string
  record: string
  version: string
}

/** What a check of an unknown run found: only what one read of the record showed. */
export type RunChecked = { kind: 'unchanged' } | { kind: 'changed' } | { kind: 'absent' } | { kind: 'unread'; message: string }

export type Run =
  | { state: 'idle' }
  /** `dialog`: the engine of the action's dialog, which keeps what was answered while the run is out. */
  | { state: 'asking'; target: RunTarget; dialog: FormEngine; n: number }
  /** `discards`: the forms of the record that hold work, which reading it again after the run drops. */
  | { state: 'confirming'; target: RunTarget; dialog: FormEngine | null; answers: Answers; discards: readonly PaneWork[]; n: number }
  /** `discards`: what its confirmation listed, which the person agreed to drop when they ran it -- none for a run again. */
  | { state: 'sending'; target: RunTarget; dialog: FormEngine | null; answers: Answers; discards: readonly PaneWork[]; n: number }
  /** `reread`: the server's sentence where the record could not be read again after the run. */
  | { state: 'done'; target: RunTarget; said: string; reread: string | null; n: number }
  | { state: 'refused'; target: RunTarget; message: string; stale: boolean; declined: boolean; n: number }
  | { state: 'unknown'; target: RunTarget; answers: Answers; unknown: UnknownAction; checking: boolean; n: number }
  | { state: 'checked'; target: RunTarget; answers: Answers; unknown: UnknownAction; found: RunChecked; n: number }

export const IDLE: Run = { state: 'idle' }

/** The dialog's submit: what follows it is the confirmation, never the run. */
export const CONTINUE = 'Continue'
/** The confirmation's lead where the administrator wrote no sentence of their own. */
export const RUNS_ON = 'It runs in the database, over this record. This page cannot take it back.'
/** Before the forms of the record that hold work, which the record read again after the run replaces. */
export const READ_AGAIN = 'The record is read again once it has run, which discards the unsaved changes in these forms:'
/** In the region while the run is out. */
export const RUNNING = 'Running…'
/** A press of Save while the record's run is out: the run moves the version the save would name. */
export const RUN_HELD = 'An action on this record has not been answered yet; nothing was sent.'
/** A press of Save once the run is done and before the record is read again: it would name the version from before the run. */
export const READING_AGAIN = 'The record is being read again after an action ran on it; nothing was sent.'
/** What a run says once it is done, where the administrator wrote no sentence of their own. */
export const DONE = 'Done.'

/**
 * A text the form serves -- an action's label, its confirmation or done
 * sentence -- in the words a person reads: itself, or the message it names
 * in the form's catalogue; `null` where it names nothing there.
 */
export function words(form: Pick<FormSchema, 'i18n'>, text: Text | null): string | null {
  if (text === null) return null
  return typeof text === 'string' ? text : (resolveText(form, text, form.i18n?.defaultLocale ?? '') ?? null)
}

/** The region's question and title: "Close the order: Order `k1:7`". */
export function heading(target: RunTarget): Said {
  return [`${target.label}: ${target.noun} `, { code: target.record }]
}

/** What a check found, in words: only what the read showed. */
export function checkedText(found: RunChecked): string {
  switch (found.kind) {
    case 'unchanged':
      return 'The database shows it has not run: the record is still at the version you read.'
    case 'changed':
      return 'It ran, or the record was changed since you read it.'
    case 'absent':
      return NOT_FOUND
    case 'unread':
      return `${found.message} Whether it ran is still unknown.`
  }
}

const numbered = (now: Run): number => (now.state === 'idle' ? 0 : now.n) + 1

/**
 * Ask to run `target`'s action: its dialog first where it has one, its
 * confirmation otherwise. A run out, or one that may have run, is asked
 * again instead -- the same region, focused again -- so nothing that holds
 * work is replaced by a second question; and so is the same action's
 * dialog over the same record, which keeps what was typed into it.
 */
export function ask(now: Run, target: RunTarget, dialog: FormEngine | null, discards: readonly PaneWork[]): Run {
  if (runWork(now) !== null) return { ...now, n: numbered(now) } as Run
  if (now.state === 'asking' && now.target.action.name === target.action.name && now.target.record === target.record) return { ...now, n: numbered(now) }
  if (dialog !== null) return { state: 'asking', target, dialog, n: numbered(now) }
  return { state: 'confirming', target, dialog: null, answers: {}, discards, n: numbered(now) }
}

/** Continue on the dialog: its answers, and the confirmation. */
export function answered(now: Run, answers: Answers, discards: readonly PaneWork[]): Run {
  if (now.state !== 'asking') return now
  return { state: 'confirming', target: now.target, dialog: now.dialog, answers, discards, n: numbered(now) }
}

/** Run it: the confirmation becomes the run out, in the same region, at the version given. */
export function send(now: Run, version: string): Run {
  if (now.state !== 'confirming') return now
  return { state: 'sending', target: { ...now.target, version }, dialog: now.dialog, answers: now.answers, discards: now.discards, n: now.n }
}

/**
 * What the server's answer makes of the run out: `done` when it ran, and
 * the problems to put on the dialog's fields when the server refused an
 * answer by its field, which asks again.
 */
export function answer(now: Run, outcome: ActionOutcome, said: string): { next: Run; done: boolean; problems?: Record<string, string[]> } {
  if (now.state !== 'sending') return { next: now, done: false }
  const { target } = now
  const n = numbered(now)
  if (outcome.ok) return { next: { state: 'done', target, said, reread: null, n }, done: true }
  if (isUnknownAction(outcome)) return { next: { state: 'unknown', target, answers: now.answers, unknown: outcome, checking: false, n }, done: false }
  const problems = fieldProblems(outcome)
  if (now.dialog !== null && Object.keys(problems).length > 0) return { next: { state: 'asking', target, dialog: now.dialog, n }, done: false, problems }
  const stale = outcome.status === 409 && outcome.code === 'stale'
  return { next: { state: 'refused', target, message: outcome.message, stale, declined: outcome.code === 'declined', n }, done: false }
}

/** The record could not be read again after the run: said in the region, which keeps the keyboard. */
export function unread(now: Run, message: string): Run {
  return now.state === 'done' ? { ...now, reread: message } : now
}

/** "Check whether it ran" pressed: a second press while it reads sends nothing. */
export function checking(now: Run): Run {
  if (now.state === 'unknown') return { ...now, checking: true }
  if (now.state === 'checked' && now.found.kind === 'unread')
    return { state: 'unknown', target: now.target, answers: now.answers, unknown: now.unknown, checking: true, n: now.n }
  return now
}

/** What the check's read of the record showed, against the version the run sent: its own state, which takes the keyboard. */
export function checked(now: Run, found: Outcome<FormRecord>): Run {
  if (now.state !== 'unknown') return now
  const sent = now.unknown.records[0]?.version
  const result: RunChecked = found.ok
    ? { kind: found.value.version === sent ? 'unchanged' : 'changed' }
    : found.status === 404 && found.code === 'not-found'
      ? { kind: 'absent' }
      : { kind: 'unread', message: found.message }
  return { state: 'checked', target: now.target, answers: now.answers, unknown: now.unknown, found: result, n: numbered(now) }
}

/**
 * Run it again, after a check found the record still at the version sent:
 * the run out once more with that version and the same answers -- never a
 * version read since, which would run it a second time over a first that
 * committed after the check. No second confirmation: the version is the
 * guard.
 */
export function again(now: Run): Run {
  if (now.state !== 'checked' || now.found.kind !== 'unchanged') return now
  const version = now.unknown.records[0]?.version ?? now.target.version
  return { state: 'sending', target: { ...now.target, version }, dialog: null, answers: now.answers, discards: [], n: numbered(now) }
}

/** Closed by another request, Keep it, or Close: only what holds no work closes. */
export function close(now: Run): Run {
  return runWork(now) === null ? IDLE : now
}

/** What the guard counts (0047): a run out, and one that may have run and is not checked. */
export function runWork(now: Run): Work | null {
  if (now.state === 'sending') return 'running'
  if (now.state === 'unknown') return 'run-unknown'
  if (now.state === 'checked' && now.found.kind === 'unread') return 'run-unknown'
  return null
}
