import { isUnknownChosen, isUnknownWrite } from '@formancy/data-client'
import type { ChosenRecordOutcome, DeleteChosenOutcome, Deleting, Reconciliation, UnknownChosen } from '@formancy/data-client'
import { chosenText } from './chosen-rows.js'
import { checkedOf, checkedText, lead as leadOne, NOT_FOUND } from './deletion.js'
import { listed } from './grid-datasource.js'
import type { PaneWork, Said, Work } from './leave.js'
import { counted } from './running.js'
import type { RunRecord } from './running.js'
import { DECLINED_BY } from './words.js'

/*
 * One deletion of the records chosen of a page (0173, 0174), decided here
 * and only shown by the page: a confirmation in place under the bar above
 * the grid, then what became of each record.
 *
 *   idle → confirming → sending → answered | refused
 *   answered, with a record whose answer was lost → checking → answered
 *
 * - **Confirming** counts the records and says what deleting them does
 *   and also does, from the form's `deleting` (0050, 0051), as a delete of
 *   one says it (0053): each on its own, at the version this page read it
 *   at, one that cannot be named and the others deleted -- never a table's
 *   name, never a cascade the form has not. One record chosen is a delete
 *   of it alone, in that delete's words.
 * - **Answered** is each record's fate, in the order sent: deleted; not
 *   found, never called deleted (0031); refused, in the server's words;
 *   not sent, the request having stopped before it; or unknown, its answer
 *   lost. A request whose own answer was lost is answered with every
 *   record unknown (`lost`).
 * - **Refused** is the request refused whole, in the server's words:
 *   nothing was deleted.
 * - **A check** reads each record whose fate is unknown (data-client's
 *   `reconcileChosen`): at the version sent or changed since, it was not
 *   deleted; gone, it was deleted -- by this request or by somebody
 *   else's, which the page cannot tell apart and says; none gone, it says
 *   only what it read. The open record it finds gone, where its forms
 *   hold work, is left open until Close the record (`keepOpen`). Nothing
 *   is sent again from an outcome: a delete of what is left is a new
 *   question.
 *
 * `n` counts the states that take the keyboard: each is a new region to
 * focus, even when it looks like the last one.
 */

/** The records a deletion is over: the form's title, which names each, and the records chosen of the page shown, in its order, each at the version this page knows. */
export interface ChosenTarget {
  noun: string
  records: readonly RunRecord[]
}

/** What became of one chosen record, as far as this page knows. */
export type Fate =
  /** Answered 200 for it: deleted by this request. */
  | { kind: 'deleted' }
  /** Answered 404: gone, or no longer one the person may see; never "deleted" (0031). */
  | { kind: 'not-found' }
  /** Any other refusal of it, in the server's words: changed since, referred to, declined (0156). */
  | { kind: 'refused'; message: string; declined: boolean }
  /** The request stopped before it (0173): nothing was sent for it. */
  | { kind: 'not-sent' }
  /** Its own answer lost: it may have been deleted. `said`: what the page knows of it. */
  | { kind: 'unknown'; said: string }
  /** The request's answer lost, so this record's with it: said once, for the request, until a check reads it. */
  | { kind: 'lost' }
  /** A check found it stored: at the version sent, or changed since -- not deleted either way. */
  | { kind: 'kept'; changed: boolean }
  /** A check found it gone: deleted, by this request or by somebody else's. */
  | { kind: 'gone' }

export interface Fated extends RunRecord {
  fate: Fate
}

export type ChosenDeletion =
  | { state: 'idle' }
  /** `discards`: the forms that hold work which the deletion drops with the records they hold. */
  | { state: 'confirming'; target: ChosenTarget; discards: readonly PaneWork[]; n: number }
  | { state: 'sending'; target: ChosenTarget; n: number }
  /**
   * `unknown`: what a check reads the records of whose fate is not known -- the request's, where its answer was lost; `checking`, while it
   * reads. `open`: the open record a check found gone, left open since its forms hold work, until Close the record (`keepOpen`). `said`:
   * the number of the state the server's answer made, which a check and a record closed leave as it was: what the count's teal is said
   * by (0146), once for the answer.
   */
  | {
      state: 'answered'
      target: ChosenTarget
      each: readonly Fated[]
      lost: boolean
      unknown: UnknownChosen | null
      checking: boolean
      open: string | null
      said: number
      n: number
    }
  | { state: 'refused'; target: ChosenTarget; message: string; declined: boolean; n: number }

export const IDLE: ChosenDeletion = { state: 'idle' }

/** The bar's button, which asks. */
export const DELETE_CHOSEN = 'Delete the chosen…'
/** First in a confirmation over more than one record: how a page of deletes goes (0173). */
export const EACH_ON_ITS_OWN =
  'Each is deleted on its own, at the version this page read it at: one that cannot be deleted is named, and the others are deleted.'
/** Then: a delete is for everybody, and for good. */
export const REMOVED_CHOSEN = 'They are removed from the database for everyone who can see them. This page cannot bring them back.'
/** The policy accepts a foreign key that deletes other rows with a record (0051). */
export const CASCADES_CHOSEN = 'Other records that refer to one of them are deleted with it.'
/** The policy accepts a foreign key that sets other rows' reference to NULL or its default (0051). */
export const CLEARS_CHOSEN = 'Other records that refer to one of them keep their place and lose that reference.'
/** A key refuses a delete while another row refers to the record (0050). */
export const RESTRICTED_CHOSEN = 'One that other records still refer to is kept, and named.'
/** Before the forms that hold work: the open record's, where it is chosen, and the Drill down levels that hold one (0094). */
export const DISCARDED_WITH_THEM = 'Unsaved changes in these forms are discarded with the record they hold:'
/** After the server's sentence, where it refused the request whole. */
export const NONE_DELETED = 'None of the chosen records was deleted.'
/** A record a check found gone: the page cannot tell this deletion from another's. */
export const GONE = 'It is not there any more: this deletion, or somebody else’s, deleted it.'
/** A record whose own answer was lost. */
export const MAY_HAVE = 'It may have been deleted.'
/** After the open record's name, where a check found it gone and its forms hold work: it is not closed by itself (0053). */
export const STILL_OPEN = 'is still open in the detail, with work in its forms: Close the record discards it.'
/** Before the records the request stopped before. */
export const NOT_SENT = 'Not sent, so not deleted:'
/** One of them, on its box. */
export const NOT_SENT_ONE = 'Not sent, so not deleted.'

/** "3 chosen Order records", "1 chosen Order record". */
const chosenOf = (target: ChosenTarget): string => {
  const n = target.records.length
  return `${String(n)} chosen ${target.noun} ${n === 1 ? 'record' : 'records'}`
}

/** The confirmation's question: "Delete 3 chosen Order records?" -- and without its question mark, the title of what the server answered. */
export function heading(target: ChosenTarget, asking: boolean): string {
  return `Delete ${chosenOf(target)}${asking ? '?' : ''}`
}

/** What deleting the records does, and also does, one sentence each, from the form's `deleting`: of one record, a delete of it alone's words (0053). */
export function lead(deleting: Deleting, n: number): string[] {
  if (n === 1) return leadOne(deleting)
  return [
    EACH_ON_ITS_OWN,
    REMOVED_CHOSEN,
    ...(deleting.cascades ? [CASCADES_CHOSEN] : []),
    ...(deleting.clears ? [CLEARS_CHOSEN] : []),
    ...(deleting.restricted ? [RESTRICTED_CHOSEN] : []),
  ]
}

/** "Deleted 2 of 3 records." */
export const deletedText = (deleted: number, n: number): string => `Deleted ${String(deleted)} of ${counted(n)}.`

const numbered = (now: ChosenDeletion): number => (now.state === 'idle' ? 0 : now.n) + 1

/**
 * Ask whether to delete `target`'s records. A deletion out, or one whose
 * outcome is not known yet, is asked again instead -- the same region,
 * focused again -- so nothing that holds work is replaced by a second
 * question.
 */
export function ask(now: ChosenDeletion, target: ChosenTarget, discards: readonly PaneWork[]): ChosenDeletion {
  if (chosenWork(now) !== null) return { ...now, n: numbered(now) } as ChosenDeletion
  return { state: 'confirming', target, discards, n: numbered(now) }
}

/** Delete them: the confirmation becomes the deletion out, in the same region, over the records at the versions given. */
export function send(now: ChosenDeletion, records: readonly RunRecord[]): ChosenDeletion {
  if (now.state !== 'confirming') return now
  return { state: 'sending', target: { ...now.target, records }, n: now.n }
}

/** One record's outcome as a delete of it alone would be read (0173): its fate. */
export function fateOf(outcome: ChosenRecordOutcome): Fate {
  if (outcome.ok) return { kind: 'deleted' }
  if (outcome.code === 'not-sent') return { kind: 'not-sent' }
  if (isUnknownWrite(outcome)) return { kind: 'unknown', said: `${outcome.message} ${MAY_HAVE}` }
  if (outcome.status === 404 && outcome.code === 'not-found') return { kind: 'not-found' }
  return { kind: 'refused', message: outcome.message, declined: outcome.code === 'declined' }
}

/**
 * What the server's answer makes of the deletion out: each record's fate
 * in the order sent; every record's fate unknown where the request's
 * answer was lost; or the request refused whole.
 */
export function answer(now: ChosenDeletion, outcome: DeleteChosenOutcome): ChosenDeletion {
  if (now.state !== 'sending') return now
  const { target } = now
  const n = numbered(now)
  if (outcome.ok) {
    // The client takes a 200 only with an entry for every record sent, in the order sent (0173).
    const each = target.records.map((sent, index): Fated => ({ ...sent, fate: fateOf(outcome.value[index] as ChosenRecordOutcome) }))
    return { state: 'answered', target, each, lost: false, unknown: unknownOf(outcome.value, target), checking: false, open: null, said: n, n }
  }
  if (isUnknownChosen(outcome)) {
    const each = outcome.records.map(({ record, version }): Fated => ({ record, version, fate: { kind: 'lost' } }))
    return { state: 'answered', target, each, lost: true, unknown: outcome, checking: false, open: null, said: n, n }
  }
  return { state: 'refused', target, message: outcome.message, declined: outcome.code === 'declined', n }
}

/**
 * What a check of an answered request reads: where a record's own answer
 * was lost -- the request stops at the first such (0173) -- that record,
 * described as the server described it. Null where every fate is known.
 */
function unknownOf(outcomes: readonly ChosenRecordOutcome[], target: ChosenTarget): UnknownChosen | null {
  const index = outcomes.findIndex((one) => isUnknownWrite(one))
  const one = outcomes[index]
  const sent = target.records[index]
  if (one === undefined || sent === undefined || !isUnknownWrite(one)) return null
  return {
    ok: false,
    status: one.status,
    code: 'unknown-outcome',
    message: one.message,
    operation: 'delete-chosen',
    records: [{ ...sent }],
    origin: one.origin,
  }
}

/** Whether a record's fate is not known yet: what the guard counts, and a check reads. */
const unknownFate = (fate: Fate): boolean => fate.kind === 'unknown' || fate.kind === 'lost'

/** "Check them" pressed: a second press while they are read sends nothing. */
export function checking(now: ChosenDeletion): ChosenDeletion {
  if (now.state !== 'answered' || now.checking || now.unknown === null || !now.each.some((one) => unknownFate(one.fate))) return now
  return { ...now, checking: true }
}

/** The records a check reads: those whose fate is not known yet, described as the lost answer was. */
export function toCheck(now: ChosenDeletion): UnknownChosen | null {
  if (now.state !== 'answered' || now.unknown === null) return null
  const records = now.each.filter((one) => unknownFate(one.fate)).map(({ record, version }) => ({ record, version }))
  return records.length === 0 ? null : { ...now.unknown, records }
}

/** What one read of a record shows about whether this deletion deleted it, read as a delete's check reads it (0031, 0053). */
function fateRead(read: Reconciliation): Fate {
  const found = checkedOf(read)
  switch (found.kind) {
    case 'absent':
      return { kind: 'gone' }
    case 'unchanged':
    case 'changed':
      return { kind: 'kept', changed: found.kind === 'changed' }
    case 'unread':
      return { kind: 'unknown', said: checkedText(found) }
  }
}

/** What the check's reads showed, each record by its token: its own state, which takes the keyboard. */
export function checked(now: ChosenDeletion, found: ReadonlyArray<{ record: string; reconciliation: Reconciliation }>): ChosenDeletion {
  if (now.state !== 'answered' || !now.checking) return now
  const read = new Map(found.map(({ record, reconciliation }) => [record, reconciliation]))
  const each = now.each.map((one): Fated => {
    const shown = read.get(one.record)
    return shown === undefined || !unknownFate(one.fate) ? one : { ...one, fate: fateRead(shown) }
  })
  return { ...now, each, checking: false, n: numbered(now) }
}

/**
 * A check found the open record gone, and its forms hold work -- typed
 * once the lost answer gave the person their Save back, which the
 * confirmation never listed: it is left open, and the region says so,
 * until Close the record, as after a delete's check (0053).
 */
export function keepOpen(now: ChosenDeletion, record: string): ChosenDeletion {
  return now.state === 'answered' ? { ...now, open: record } : now
}

/** Close the record pressed: its line goes, and the region takes the keyboard again, a new state. */
export function recordClosed(now: ChosenDeletion): ChosenDeletion {
  return now.state === 'answered' && now.open !== null ? { ...now, open: null, n: numbered(now) } : now
}

/** "Order `k1:3` is still open in the detail, …": what the region says of the open record a check found gone, left open. */
export function stillOpenText(noun: string, record: string): Said {
  return [`${noun} `, { code: record }, ` ${STILL_OPEN}`]
}

/** Closed by another request, Keep them, or Close: only what holds no work closes. */
export function close(now: ChosenDeletion): ChosenDeletion {
  return chosenWork(now) === null ? IDLE : now
}

/** What the guard counts (0047, 0166): a deletion out, and one whose outcome for some record is not known and not checked. */
export function chosenWork(now: ChosenDeletion): Work | null {
  if (now.state === 'sending') return 'deleting'
  if (now.state === 'answered' && now.each.some((one) => unknownFate(one.fate))) return 'delete-unknown'
  return null
}

/** The records that have left the page, as far as this page knows: deleted, not found, or found gone. They leave the choice, and the open one is closed. */
export function goneOf(now: ChosenDeletion): ReadonlySet<string> {
  if (now.state !== 'answered') return new Set()
  return new Set(now.each.filter(({ fate }) => fate.kind === 'deleted' || fate.kind === 'not-found' || fate.kind === 'gone').map(({ record }) => record))
}

/** What the page says of a record not deleted, after its name: the server's words, the page's, or what a check found. */
function words(fate: Fate): string {
  switch (fate.kind) {
    case 'refused':
      return fate.declined ? `${fate.message} ${DECLINED_BY}` : fate.message
    case 'not-found':
      return NOT_FOUND
    case 'unknown':
      return fate.said
    case 'kept':
      return checkedText({ kind: fate.changed ? 'changed' : 'unchanged' })
    case 'gone':
      return GONE
    case 'lost':
      return MAY_HAVE
    case 'not-sent':
      return NOT_SENT_ONE
    case 'deleted':
      return ''
  }
}

/**
 * Why each record still chosen was not deleted, by its token: its box's
 * description until the choice changes (chosen-rows.ts). A record whose
 * fate is not known yet may have been, and says so.
 */
export function marksOf(now: ChosenDeletion): ReadonlyMap<string, string> {
  if (now.state !== 'answered') return new Map()
  const gone = goneOf(now)
  return new Map(
    now.each
      .filter(({ record }) => !gone.has(record))
      .map(({ record, fate }) => [record, unknownFate(fate) || fate.kind === 'not-sent' ? words(fate) : `Not deleted. ${words(fate)}`]),
  )
}

/** What the bar's line says once the choice has settled on `left`: how many are chosen, and which of them this deletion did not delete, by name. */
export function settledText(now: ChosenDeletion, left: readonly string[], name: (token: string) => string): string {
  const kept = now.state === 'answered' ? now.each.filter(({ record }) => left.includes(record)).map(({ record }) => name(record)) : []
  return kept.length === 0 ? chosenText(left.length) : `${chosenText(left.length)} Still chosen after the deletion: ${listed(kept)}.`
}

/**
 * What the answered region says first: how many of the records this
 * request deleted; where its answer was lost, the client's sentence until
 * a check has read the records, and then only what it read -- how many
 * are gone, by whoever's deletion; none gone, how many are still stored,
 * the rest still unknown; or none deleted, every one found stored.
 */
export function summary(now: ChosenDeletion & { state: 'answered' }): string {
  const n = now.each.length
  const counting = (kind: Fate['kind']): number => now.each.filter(({ fate }) => fate.kind === kind).length
  if (!now.lost) return deletedText(counting('deleted'), n)
  if (counting('lost') > 0 || now.unknown === null) return now.unknown?.message ?? MAY_HAVE
  const gone = counting('gone')
  if (gone > 0)
    return `${String(gone)} of ${counted(n)} ${gone === 1 ? 'is' : 'are'} not there any more: this deletion, or somebody else’s, deleted ${gone === 1 ? 'it' : 'them'}.`
  const kept = counting('kept')
  if (kept === n) return NONE_DELETED
  // Nothing read yet: every record still may have been deleted, as the client said.
  if (kept === 0) return now.unknown.message
  const others = n - kept === 1 ? 'the other was' : 'the others were'
  return `${String(kept)} of ${counted(n)} ${kept === 1 ? 'is' : 'are'} still stored, not deleted; whether ${others} deleted is still unknown.`
}

/** Whether the count is said in the room's teal, as what the server did (0146): only where this request's answer says it deleted some. */
export function saysDone(now: ChosenDeletion & { state: 'answered' }): boolean {
  return !now.lost && now.each.some(({ fate }) => fate.kind === 'deleted')
}

/**
 * How the answered region is framed: as a save that may have been stored
 * is, while a fate is not known; in teal where some were deleted -- by this
 * request, or found gone by a check; and in a refusal's warm colour where
 * none was.
 */
export function frameOf(now: ChosenDeletion & { state: 'answered' }): 'unknown' | 'done' | 'refused' {
  if (now.each.some(({ fate }) => unknownFate(fate))) return 'unknown'
  return now.each.some(({ fate }) => fate.kind === 'deleted' || fate.kind === 'gone') ? 'done' : 'refused'
}

/**
 * Each record the region names, in the order sent, as a row's Delete names
 * it -- "Order `k1:8`: Other records still refer to this one…" -- every
 * record not deleted but those the request stopped before, which
 * `notSent` names together; where the request's answer was lost, those a
 * check has read and did not find gone, which the summary counts.
 */
export function lines(now: ChosenDeletion & { state: 'answered' }): Array<{ record: string; said: Said }> {
  const named = now.each.filter(
    ({ fate }) => fate.kind !== 'deleted' && fate.kind !== 'not-sent' && fate.kind !== 'lost' && !(now.lost && fate.kind === 'gone'),
  )
  return named.map(({ record, fate }) => ({ record, said: [`${now.target.noun} `, { code: record }, `: ${words(fate)}`] }))
}

/** "Not sent, so not deleted: Order `k1:11` and Order `k1:12`.", or nothing where the request sent every record. */
export function notSent(now: ChosenDeletion & { state: 'answered' }): Said | null {
  const left = now.each.filter(({ fate }) => fate.kind === 'not-sent')
  if (left.length === 0) return null
  const each = left.flatMap(({ record }, index): Said => [
    index === 0 ? ' ' : index === left.length - 1 ? ' and ' : ', ',
    `${now.target.noun} `,
    { code: record },
  ])
  return [NOT_SENT, ...each, '.']
}
