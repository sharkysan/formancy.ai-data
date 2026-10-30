import type { Deleting, DeleteOutcome, Reconciliation, UnknownWrite } from '@formancy/data-client'
import type { PaneWork, Said, Work } from './leave.js'

/*
 * One deletion on the host page (0053), decided here and only shown by the
 * page: a confirmation in place, then what the server answered.
 *
 *   idle → confirming → sending → deleted (idle again) | not-found | refused | unknown
 *   unknown → checked → (unchanged) confirming again
 *
 * - **Confirming** names the record and says what the delete does, and also
 *   does, from the form's `deleting` (0050, 0051): never a table's name or a
 *   count. Asked again while a deletion is out or unknown, it is the same
 *   question, asked again: nothing is replaced that holds work.
 * - **Deleted** is a 200 with the deletion's shape (0050), and nothing else.
 * - **Not found** is a 404: the record may be gone, deleted by somebody
 *   else or by an earlier delete whose answer was lost, or be one the
 *   person may no longer see. It is never called deleted (0031).
 * - **Refused** is any other answer of the server's, in its words; stale
 *   offers the saved record.
 * - **Unknown** is a deletion whose answer was lost. A check reads the
 *   record and says what the read showed; still at the version sent, the
 *   person may delete it again -- which asks again, and never sends.
 *
 * `n` counts the states that take the keyboard: each is a new region to
 * focus, even when it looks like the last one.
 */

/** Where a delete was asked for: the record's detail, or its row in a grid, which its token finds again to give the keyboard back. */
export type DeleteFrom = { kind: 'detail' } | { kind: 'row' }

/** The record a delete names: its form's title, its token, the version the page read it at, and whether it is the record open in the detail. */
export interface DeleteTarget {
  noun: string
  record: string
  version: string
  from: DeleteFrom
  open: boolean
}

/** What a check of an unknown deletion found: only what one read of the record showed. */
export type Checked = { kind: 'absent' } | { kind: 'unchanged' } | { kind: 'changed' } | { kind: 'unread'; message: string }

export type Deletion =
  | { state: 'idle' }
  /** `discards`: the forms of the record that hold work, which the delete drops with it. */
  | { state: 'confirming'; target: DeleteTarget; discards: readonly PaneWork[]; n: number }
  | { state: 'sending'; target: DeleteTarget; n: number }
  | { state: 'not-found'; target: DeleteTarget; n: number }
  | { state: 'refused'; target: DeleteTarget; message: string; stale: boolean; n: number }
  | { state: 'unknown'; target: DeleteTarget; unknown: UnknownWrite; checking: boolean; n: number }
  | { state: 'checked'; target: DeleteTarget; unknown: UnknownWrite; found: Checked; n: number }

export const IDLE: Deletion = { state: 'idle' }

/** Every confirmation starts with this: a delete is for everybody, and for good. */
export const REMOVED = 'It is removed from the database for everyone who can see it. This page cannot bring it back.'
/** The policy accepts a foreign key that deletes other rows with it (0051). */
export const CASCADES = 'Other records that refer to it are deleted with it.'
/** The policy accepts a foreign key that sets other rows' reference to NULL or its default (0051). */
export const CLEARS = 'Other records that refer to it keep their place and lose that reference.'
/** A key refuses the delete while another row refers to the record (0050). */
export const RESTRICTED = 'If other records still refer to it, the database keeps it and nothing is deleted.'
/** Before the forms of the record that hold work, in leave.ts's words. */
export const DISCARDED_WITH_IT = 'Unsaved changes in these forms are discarded with it:'
/** In the region while the deletion is out. */
export const DELETING = 'Deleting…'
/** A 404, and a check that found the record gone: never "deleted". */
export const NOT_FOUND = 'This form cannot find the record any more: it was deleted, or is no longer one you may see.'
/** A press of Save while the record's deletion is out. */
export const HELD = 'A deletion of this record has not been answered yet; nothing was sent.'
/** The detail's Delete while a save of the record is out: the delete would name a version the save is moving past. */
export const SAVE_OUT = 'A save of this record has not been answered yet.'

/**
 * What the open record's Delete names (0053): the newest version the detail
 * heard of it -- read with it, answered to a save of any of its panes, or
 * opened by a pane's own Load the saved record -- and again as it is when
 * Delete it is pressed (delete-flow.ts).
 */
export function detailTarget(noun: string, record: string, heard: string | null): DeleteTarget {
  return { noun, record, version: heard ?? '', from: { kind: 'detail' }, open: true }
}

/**
 * What a grid row's Delete names (0053): the version the row was listed
 * with, which is what the page read of it (0044) -- or, for the open
 * record's row, the newest the detail heard, which a save may have moved
 * past the row. Nothing for a row no token addresses.
 */
export function rowTarget(
  noun: string,
  row: { record: string | null; version: string | null },
  open: { record: string; heard: string | null } | null,
): DeleteTarget | null {
  if (row.record === null) return null
  const isOpen = open !== null && open.record === row.record
  const version = isOpen ? (open.heard ?? row.version) : row.version
  return { noun, record: row.record, version: version ?? '', from: { kind: 'row' }, open: isOpen }
}

/** What the delete does, and what it also does, one sentence each, from the form's `deleting`. */
export function lead(deleting: Deleting): string[] {
  return [REMOVED, ...(deleting.cascades ? [CASCADES] : []), ...(deleting.clears ? [CLEARS] : []), ...(deleting.restricted ? [RESTRICTED] : [])]
}

/** The confirmation's question: "Delete Order `k1:1003`?". */
export function heading(target: DeleteTarget): Said {
  return [`Delete ${target.noun} `, { code: target.record }, '?']
}

/** What the grid says first once the record has gone from it: deleted, or closed after a 404. */
export function gone(target: DeleteTarget, word: 'Deleted' | 'Closed'): Said {
  return [`${word} ${target.noun} `, { code: target.record }, '.']
}

/** What a check found, in words: only what the read showed. */
export function checkedText(found: Checked): string {
  switch (found.kind) {
    case 'absent':
      return NOT_FOUND
    case 'unchanged':
      return 'It is still stored, at the version you saw.'
    case 'changed':
      return 'It is still stored, and has changed since you saw it.'
    case 'unread':
      return `${found.message} Whether it was deleted is still unknown.`
  }
}

const numbered = (now: Deletion): number => (now.state === 'idle' ? 0 : now.n) + 1

/**
 * Ask whether to delete `target`. A deletion out, or one that may have been
 * done, is asked again instead -- the same region, focused again -- so
 * nothing that holds work is replaced by a second question.
 */
export function confirm(now: Deletion, target: DeleteTarget, discards: readonly PaneWork[]): Deletion {
  if (deletionWork(now) !== null) return { ...now, n: numbered(now) } as Deletion
  return { state: 'confirming', target, discards, n: numbered(now) }
}

/** "Delete it": the confirmation becomes the deletion out, in the same region. */
export function send(now: Deletion): Deletion {
  return now.state === 'confirming' ? { state: 'sending', target: now.target, n: now.n } : now
}

/** What the server's answer makes of the deletion out; `gone` when it was deleted. */
export function answer(now: Deletion, outcome: DeleteOutcome): { next: Deletion; gone: boolean } {
  if (now.state !== 'sending') return { next: now, gone: false }
  const { target } = now
  const n = numbered(now)
  if (outcome.ok) return { next: IDLE, gone: true }
  if (outcome.code === 'unknown-outcome' && 'operation' in outcome)
    return { next: { state: 'unknown', target, unknown: outcome, checking: false, n }, gone: false }
  if (outcome.status === 404 && outcome.code === 'not-found') return { next: { state: 'not-found', target, n }, gone: false }
  return { next: { state: 'refused', target, message: outcome.message, stale: outcome.status === 409 && outcome.code === 'stale', n }, gone: false }
}

/** "Check whether it was deleted" pressed: a second press while it reads sends nothing. */
export function checking(now: Deletion): Deletion {
  if (now.state === 'unknown') return { ...now, checking: true }
  if (now.state === 'checked' && now.found.kind === 'unread') return { state: 'unknown', target: now.target, unknown: now.unknown, checking: true, n: now.n }
  return now
}

/** What the check's read showed (0031): its own state, which takes the keyboard. */
export function checked(now: Deletion, found: Reconciliation): Deletion {
  if (now.state !== 'unknown' && now.state !== 'checked') return now
  const result: Checked = !found.ok
    ? { kind: 'unread', message: found.message }
    : found.state === 'absent'
      ? { kind: 'absent' }
      : found.state === 'unchanged'
        ? { kind: 'unchanged' }
        : found.state === 'changed'
          ? { kind: 'changed' }
          : { kind: 'unread', message: 'The check could not tell.' }
  return { state: 'checked', target: now.target, unknown: now.unknown, found: result, n: numbered(now) }
}

/** "Delete it again", after a check found it still at the version sent: the confirmation again, never the delete. */
export function again(now: Deletion): Deletion {
  if (now.state !== 'checked' || now.found.kind !== 'unchanged') return now
  return { state: 'confirming', target: { ...now.target, version: now.unknown.version ?? now.target.version }, discards: [], n: numbered(now) }
}

/** Closed by another request, Keep it, or Close: only what holds no work closes. */
export function close(now: Deletion): Deletion {
  return deletionWork(now) === null ? IDLE : now
}

/** What the guard counts (0047): a deletion out, and one that may have been done and is not checked. */
export function deletionWork(now: Deletion): Work | null {
  if (now.state === 'sending') return 'deleting'
  if (now.state === 'unknown') return 'delete-unknown'
  if (now.state === 'checked' && now.found.kind === 'unread') return 'delete-unknown'
  return null
}
