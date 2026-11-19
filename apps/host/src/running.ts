import type { FormEngine } from '@formancy/core'
import { fieldProblems, isUnknownAction } from '@formancy/data-client'
import type { ActionOutcome, FormAction, Outcome, FormRecord, UnknownAction } from '@formancy/data-client'
import { resolveText } from '@formancy/spec'
import type { FormSchema, Text } from '@formancy/spec'
import { NOT_FOUND } from './deletion.js'
import type { PaneWork, Said, Work } from './leave.js'

/*
 * One run of an action on the host page, decided here and only shown by
 * the page: over the open record, from its header (0162), or over the
 * records a person chose of the page a grid shows, from above it (0166).
 * The dialog the action asks, a confirmation in place, then what the
 * server answered.
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
 * - **Done** is a token for each record, and nothing else; the page reads
 *   the records again, since the run moved their versions.
 * - **Refused** is any other answer of the server's, in its words; stale
 *   offers the saved record, and a reason the deployment worded is said as
 *   its own (0156). A selection's refusal keeps the records the server
 *   named (0165), which the page names to the person: nothing was done to
 *   any of them, all or nothing.
 * - **Unknown** is a run whose answer was lost (0031). A check reads each
 *   record: every one still at the version sent, it has not run, and Run
 *   it again sends those versions again, never ones read since -- if the
 *   first committed after all, the second is stale. Some moved and some
 *   not, it did not run -- a run moves every record or none -- and some
 *   were changed since: the page is read again, never run again.
 *
 * `n` counts the states that take the keyboard: each is a new region to
 * focus, even when it looks like the last one.
 */

/** A dialog's answers, by field key, as the renderer submitted them. */
export type Answers = Record<string, unknown>

/** A record a run is over, by its token, at the version the page read it. */
export interface RunRecord {
  record: string
  version: string
}

/**
 * The run a person asked for: the action as the form offers it, its label
 * in words, the form's title, and the records it is over -- the open
 * record alone (0162), or the records chosen of the page shown, in its
 * order (0166) -- each with the version the page read it at.
 */
export interface RunTarget {
  action: FormAction
  label: string
  noun: string
  records: readonly RunRecord[]
}

/**
 * What a check of an unknown run found: only what one read of each record
 * showed -- every one at the version sent, every one moved, none there,
 * the reads refused, or, of a selection, some moved and some not.
 */
export type RunChecked = { kind: 'unchanged' } | { kind: 'changed' } | { kind: 'mixed' } | { kind: 'absent' } | { kind: 'unread'; message: string }

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
  /** `named`: the records the server said its refusal is about (0165), each a token the run addressed. */
  | { state: 'refused'; target: RunTarget; message: string; stale: boolean; declined: boolean; named: readonly string[]; n: number }
  | { state: 'unknown'; target: RunTarget; answers: Answers; unknown: UnknownAction; checking: boolean; n: number }
  | { state: 'checked'; target: RunTarget; answers: Answers; unknown: UnknownAction; found: RunChecked; n: number }

export const IDLE: Run = { state: 'idle' }

/** The dialog's submit: what follows it is the confirmation, never the run. */
export const CONTINUE = 'Continue'
/** The confirmation's lead where the administrator wrote no sentence of their own. */
export const RUNS_ON = 'It runs in the database, over this record. This page cannot take it back.'
/** The same, over the records chosen: one transaction, all or nothing (0165). */
export const RUNS_OVER_CHOSEN =
  'It runs in the database, over each of these records, in one transaction: if one is refused, none of them is changed. This page cannot take it back.'
/** After the server's sentence, where it refused a run over the records chosen: what all or nothing means for them (0165). */
export const NONE_CHANGED = 'Nothing was done to any of the chosen records: a run over them changes every one or none.'
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

/** Whether a run is over the records chosen of a page (0166), rather than the open record. */
export const isSelection = (target: RunTarget): boolean => target.action.scope === 'selection'

/** "1 record", "3 records". */
export const counted = (n: number): string => `${String(n)} ${n === 1 ? 'record' : 'records'}`

/** The region's question and title: "Close the order: Order `k1:7`", or over the records chosen, "Close the chosen orders: 3 records". */
export function heading(target: RunTarget): Said {
  if (isSelection(target)) return [`${target.label}: ${counted(target.records.length)}`]
  return [`${target.label}: ${target.noun} `, { code: target.records[0]?.record ?? '' }]
}

/** What a run says once it is done: the administrator's sentence, or "Done.", and over the records chosen, how many it ran over. */
export function doneText(target: RunTarget, said: string): string {
  return isSelection(target) ? `${said} It ran over ${counted(target.records.length)}.` : said
}

/** What a check found, in words: only what the reads showed -- of the one record, or of every record chosen. */
export function checkedText(found: RunChecked, many = false): string {
  switch (found.kind) {
    case 'unchanged':
      return many
        ? 'The database shows it has not run: every record is still at the version you read.'
        : 'The database shows it has not run: the record is still at the version you read.'
    case 'changed':
      return many ? 'It ran, or every record was changed since you read it.' : 'It ran, or the record was changed since you read it.'
    case 'mixed':
      return 'It did not run, since a run changes every record or none; some of these records were changed or deleted since you read them.'
    case 'absent':
      return many ? 'None of these records is there any more.' : NOT_FOUND
    case 'unread':
      return `${found.message} Whether it ran is still unknown.`
  }
}

const numbered = (now: Run): number => (now.state === 'idle' ? 0 : now.n) + 1

/** Whether two runs are over the same records, in the same order. */
const sameRecords = (a: RunTarget, b: RunTarget): boolean =>
  a.records.length === b.records.length && a.records.every((each, index) => each.record === b.records[index]?.record)

/**
 * Ask to run `target`'s action: its dialog first where it has one, its
 * confirmation otherwise. A run out, or one that may have run, is asked
 * again instead -- the same region, focused again -- so nothing that holds
 * work is replaced by a second question; and so is the same action's
 * dialog over the same record, which keeps what was typed into it.
 */
export function ask(now: Run, target: RunTarget, dialog: FormEngine | null, discards: readonly PaneWork[]): Run {
  if (runWork(now) !== null) return { ...now, n: numbered(now) } as Run
  if (now.state === 'asking' && now.target.action.name === target.action.name && sameRecords(now.target, target)) return { ...now, n: numbered(now) }
  if (dialog !== null) return { state: 'asking', target, dialog, n: numbered(now) }
  return { state: 'confirming', target, dialog: null, answers: {}, discards, n: numbered(now) }
}

/** Continue on the dialog: its answers, and the confirmation. */
export function answered(now: Run, answers: Answers, discards: readonly PaneWork[]): Run {
  if (now.state !== 'asking') return now
  return { state: 'confirming', target: now.target, dialog: now.dialog, answers, discards, n: numbered(now) }
}

/** Run it: the confirmation becomes the run out, in the same region, over the records at the versions given. */
export function send(now: Run, records: readonly RunRecord[]): Run {
  if (now.state !== 'confirming') return now
  return { state: 'sending', target: { ...now.target, records }, dialog: now.dialog, answers: now.answers, discards: now.discards, n: now.n }
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
  const named = outcome.records ?? []
  return { next: { state: 'refused', target, message: outcome.message, stale, declined: outcome.code === 'declined', named, n }, done: false }
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

/**
 * What the check's reads of the records showed, each against the version
 * the run sent it at -- `found` in the order the run named them: its own
 * state, which takes the keyboard. A read refused leaves it unknown; every
 * record at the version sent, it has not run; every one gone, not found;
 * every one moved or gone, it ran, or each was changed since; some at the
 * version sent and some not, it did not run, since a run moves every
 * record or none (0165), and some were changed since.
 */
export function checked(now: Run, found: readonly Outcome<FormRecord>[]): Run {
  if (now.state !== 'unknown') return now
  const each = now.unknown.records.map((sent, index): RunChecked => {
    const read = found[index]
    if (read === undefined) return { kind: 'unread', message: 'The record was not read.' }
    if (read.ok) return { kind: read.value.version === sent.version ? 'unchanged' : 'changed' }
    return read.status === 404 && read.code === 'not-found' ? { kind: 'absent' } : { kind: 'unread', message: read.message }
  })
  const all = (kind: RunChecked['kind']): boolean => each.every((one) => one.kind === kind)
  const result: RunChecked =
    each.find((one) => one.kind === 'unread') ??
    (all('unchanged')
      ? { kind: 'unchanged' }
      : all('absent')
        ? { kind: 'absent' }
        : each.some((one) => one.kind === 'unchanged')
          ? { kind: 'mixed' }
          : { kind: 'changed' })
  return { state: 'checked', target: now.target, answers: now.answers, unknown: now.unknown, found: result, n: numbered(now) }
}

/**
 * Run it again, after a check found every record still at the version
 * sent: the run out once more with those versions and the same answers --
 * never a version read since, which would run it a second time over a
 * first that committed after the check. No second confirmation: the
 * versions are the guard.
 */
export function again(now: Run): Run {
  if (now.state !== 'checked' || now.found.kind !== 'unchanged') return now
  const records = now.unknown.records.map(({ record, version }) => ({ record, version }))
  return { state: 'sending', target: { ...now.target, records }, dialog: null, answers: now.answers, discards: [], n: numbered(now) }
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
