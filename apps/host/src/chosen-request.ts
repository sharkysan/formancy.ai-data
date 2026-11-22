import type { FormEngine } from '@formancy/core'
import { isUnknownChosen, isUnknownWrite } from '@formancy/data-client'
import type { ChangedRecordOutcome, ChosenRecordOutcome, DeleteChosenOutcome, Reconciliation, UnknownChosen, UpdateChosenOutcome } from '@formancy/data-client'
import { CHANGE_WORDS } from './chosen-change.js'
import { DELETE_WORDS, STILL_OPEN } from './chosen-deletion.js'
import { chosenText, holdsAsked } from './chosen-rows.js'
import { checkedOf, NOT_FOUND } from './deletion.js'
import { listed } from './grid-datasource.js'
import type { PaneWork, Said, Work } from './leave.js'
import { counted } from './running.js'
import type { RunRecord } from './running.js'
import { DECLINED_BY } from './words.js'

/*
 * One request over the records chosen of a page, decided here and only
 * shown by the page: their deletion (0173, 0174) or their change to the
 * values given (0175, 0176). A question in place under the bar above the
 * grid, then what became of each record. Each record is a write of its
 * own on the server, so both are one rule here, and only their words and
 * a change's fields differ (chosen-deletion.ts, chosen-change.ts):
 *
 *   idle → (a change) asking → confirming → sending → answered | refused
 *   answered, with a record whose answer was lost → checking → answered
 *
 * - **Asking**, a change's alone: which of the fields offered it sets,
 *   their values on paper, then Continue (chosen-change.ts).
 * - **Confirming** counts the records and says what the request does,
 *   each on its own, at the version this page read it at, one that cannot
 *   be named and the others done; a change says each field and its value.
 * - **Answered** is each record's fate, in the order sent: done; not
 *   found, never called done (0031); refused, in the server's words; not
 *   sent, the request having stopped before it; or unknown, its answer
 *   lost. A request whose own answer was lost is answered with every
 *   record unknown (`lost`).
 * - **Refused** is the request refused whole, in the server's words:
 *   nothing was done to any record.
 * - **A check** reads each record whose fate is unknown (data-client's
 *   `reconcileChosen`, as a delete's or an update's of it alone reads
 *   it): found as the request leaves it -- a deleted record gone, a
 *   changed one moved on -- it was done, by this request or by somebody
 *   else's, which the page cannot tell apart and says; at the version sent
 *   it was not; none found so, it says only what it read. Nothing is sent
 *   again from an outcome: a request over what is left is a new question.
 *
 * `n` counts the states that take the keyboard: each is a new region to
 * focus, even when it looks like the last one.
 */

/** What a request over the chosen records does to each: deletes it (0174), or changes it to the values given (0176). */
export type ChosenKind = 'delete' | 'change'

/** The records a request is over: the form's title, which names each, and the records chosen of the page shown, in its order, each at the version this page knows. */
export interface ChosenTarget {
  noun: string
  records: readonly RunRecord[]
}

/**
 * A change's question before its confirmation (chosen-change.ts): the
 * fields ticked, in the order offered, and the engine their values are
 * drawn on paper with, none while nothing is ticked. `reading`: Continue
 * pressed, and the labels of the lookups it sets being read, so a second
 * press sends nothing.
 */
export interface ChangeAsked {
  ticked: readonly string[]
  engine: FormEngine | null
  reading: boolean
}

/** A change's values: each field ticked and its answer as sent, `null` clearing it, each as the confirmation says it, and what the confirmation says the change does. */
export interface ChangeSet {
  answers: Readonly<Record<string, unknown>>
  said: readonly Said[]
  lead: readonly string[]
}

/** What became of one chosen record, as far as this page knows. */
export type Fate =
  /** Answered 200 for it: done by this request -- deleted, or changed. */
  | { kind: 'done' }
  /** Answered 404: gone, or no longer one the person may see; never "done" (0031). */
  | { kind: 'not-found' }
  /** Any other refusal of it, in the server's words: changed since, referred to, a move refused, declined (0156). */
  | { kind: 'refused'; message: string; declined: boolean }
  /** The request stopped before it (0173): nothing was sent for it. */
  | { kind: 'not-sent' }
  /** Its own answer lost: it may have been done. `said`: what the page knows of it. */
  | { kind: 'unknown'; said: string }
  /** The request's answer lost, so this record's with it: said once, for the request, until a check reads it. */
  | { kind: 'lost' }
  /** A check found it not done: stored still -- at the version sent, or for a deletion changed since. */
  | { kind: 'kept'; changed: boolean }
  /** A check found it as the request leaves it -- gone, or moved on -- by this request or by somebody else's. */
  | { kind: 'found' }

export interface Fated extends RunRecord {
  fate: Fate
}

export type ChosenRequest =
  | { state: 'idle' }
  | { state: 'asking'; kind: 'change'; target: ChosenTarget; asked: ChangeAsked; n: number }
  /** `discards`: the forms that hold work which the request drops -- with a record deleted, or the open record read again once changed. `change`: a change's values, null for a deletion. */
  | { state: 'confirming'; kind: ChosenKind; target: ChosenTarget; change: ChangeSet | null; discards: readonly PaneWork[]; n: number }
  /** `discards`: what its confirmation listed, which the person agreed to drop when they sent it. */
  | { state: 'sending'; kind: ChosenKind; target: ChosenTarget; change: ChangeSet | null; discards: readonly PaneWork[]; n: number }
  /**
   * `unknown`: what a check reads the records of whose fate is not known -- the request's, where its answer was lost; `checking`, while it
   * reads. `open`: the open record a check of a deletion found gone, left open since its forms hold work, until Close the record
   * (`keepOpen`). `said`: the number of the state the server's answer made, which a check and a record closed leave as it was: what the
   * count's teal is said by (0146), once for the answer.
   */
  | {
      state: 'answered'
      kind: ChosenKind
      target: ChosenTarget
      each: readonly Fated[]
      lost: boolean
      unknown: UnknownChosen | null
      checking: boolean
      open: string | null
      said: number
      n: number
    }
  | { state: 'refused'; kind: ChosenKind; target: ChosenTarget; message: string; declined: boolean; n: number }

export const IDLE: ChosenRequest = { state: 'idle' }

/** How the page says what became of the records, in each request's words, which only differ in what they name. */
interface OutcomeWords {
  verb: string
  done: string
  past: string
  request: string
  refused: string
  none: string
  mayHave: string
  notSent: string
  notSentOne: string
  found: string
  foundCount: (found: number) => string
  keptCount: (kept: number) => string
  kept: (changed: boolean) => string
  unread: (message: string) => string
  sending: string
  held: string
  work: { out: Work; unknown: Work }
}

const WORDS: Readonly<Record<ChosenKind, OutcomeWords>> = { delete: DELETE_WORDS, change: CHANGE_WORDS }

/** A request's words, by its kind. */
export const wordsOf = (kind: ChosenKind): OutcomeWords => WORDS[kind]

/** "3 chosen Order records", "1 chosen Order record". */
const chosenOf = (target: ChosenTarget): string => {
  const n = target.records.length
  return `${String(n)} chosen ${target.noun} ${n === 1 ? 'record' : 'records'}`
}

/** The confirmation's question -- "Delete 3 chosen Order records?", "Change 3 chosen Order records?" -- and without its question mark, the title of what it asks first and what the server answered. */
export function heading(kind: ChosenKind, target: ChosenTarget, asking: boolean): string {
  return `${WORDS[kind].verb} ${chosenOf(target)}${asking ? '?' : ''}`
}

/** "Deleted 2 of 3 records.", "Changed 11 of 12 records." */
export const doneText = (kind: ChosenKind, done: number, n: number): string => `${WORDS[kind].done} ${String(done)} of ${counted(n)}.`

const numbered = (now: ChosenRequest): number => (now.state === 'idle' ? 0 : now.n) + 1

/** A request out, or one whose outcome is not known yet, asked again: the same region, focused again, so nothing that holds work is replaced by a second question. */
const again = (now: ChosenRequest): ChosenRequest => ({ ...now, n: numbered(now) }) as ChosenRequest

/** Ask whether to delete `target`'s records: the confirmation, or what holds work asked again. */
export function askDelete(now: ChosenRequest, target: ChosenTarget, discards: readonly PaneWork[]): ChosenRequest {
  if (chosenWork(now) !== null) return again(now)
  return { state: 'confirming', kind: 'delete', target, change: null, discards, n: numbered(now) }
}

/**
 * Ask to change `target`'s records: which fields first, none ticked -- or
 * what holds work asked again; and a change asking over the same records
 * asked again keeps what was ticked and typed, as an action's dialog does
 * (0162).
 */
export function askChange(now: ChosenRequest, target: ChosenTarget): ChosenRequest {
  if (chosenWork(now) !== null) return again(now)
  if (now.state === 'asking' && holdsAsked(target.records, now.target.records)) return again(now)
  return { state: 'asking', kind: 'change', target, asked: { ticked: [], engine: null, reading: false }, n: numbered(now) }
}

/** A box ticked or unticked, or Continue pressed: the change's question as it is now, the keyboard where it is -- no new state. */
export function asking(now: ChosenRequest, asked: ChangeAsked): ChosenRequest {
  return now.state === 'asking' ? { ...now, asked } : now
}

/** Continue's values, the labels of its lookups read: the confirmation, over the records it asked over. */
export function answered(now: ChosenRequest, change: ChangeSet, discards: readonly PaneWork[]): ChosenRequest {
  if (now.state !== 'asking') return now
  return { state: 'confirming', kind: 'change', target: now.target, change, discards, n: numbered(now) }
}

/** Delete them, or Change them: the confirmation becomes the request out, in the same region, over the records at the versions given. */
export function send(now: ChosenRequest, records: readonly RunRecord[]): ChosenRequest {
  if (now.state !== 'confirming') return now
  return { state: 'sending', kind: now.kind, target: { ...now.target, records }, change: now.change, discards: now.discards, n: now.n }
}

/** One record's outcome as a write of it alone would be read (0173, 0175): its fate. */
export function fateOf(kind: ChosenKind, outcome: ChosenRecordOutcome | ChangedRecordOutcome): Fate {
  if (outcome.ok) return { kind: 'done' }
  if (outcome.code === 'not-sent') return { kind: 'not-sent' }
  if (isUnknownWrite(outcome)) return { kind: 'unknown', said: `${outcome.message} ${WORDS[kind].mayHave}` }
  if (outcome.status === 404 && outcome.code === 'not-found') return { kind: 'not-found' }
  return { kind: 'refused', message: outcome.message, declined: outcome.code === 'declined' }
}

/**
 * What the server's answer makes of the request out: each record's fate
 * in the order sent; every record's fate unknown where the request's
 * answer was lost; or the request refused whole.
 */
export function answer(now: ChosenRequest, outcome: DeleteChosenOutcome | UpdateChosenOutcome): ChosenRequest {
  if (now.state !== 'sending') return now
  const { kind, target } = now
  const n = numbered(now)
  const shown = { state: 'answered', kind, target, checking: false, open: null, said: n, n } as const
  if (outcome.ok) {
    // The client takes a 200 only with an entry for every record sent, in the order sent (0173).
    const value: ReadonlyArray<ChosenRecordOutcome | ChangedRecordOutcome> = outcome.value
    const each = target.records.map((sent, index): Fated => ({ ...sent, fate: fateOf(kind, value[index] as ChosenRecordOutcome) }))
    return { ...shown, each, lost: false, unknown: unknownOf(kind, value, target) }
  }
  if (isUnknownChosen(outcome)) {
    const each = outcome.records.map(({ record, version }): Fated => ({ record, version, fate: { kind: 'lost' } }))
    return { ...shown, each, lost: true, unknown: outcome }
  }
  return { state: 'refused', kind, target, message: outcome.message, declined: outcome.code === 'declined', n }
}

/**
 * What a check of an answered request reads: where a record's own answer
 * was lost -- the request stops at the first such (0173) -- that record,
 * described as the server described it. Null where every fate is known.
 */
function unknownOf(kind: ChosenKind, outcomes: ReadonlyArray<ChosenRecordOutcome | ChangedRecordOutcome>, target: ChosenTarget): UnknownChosen | null {
  const index = outcomes.findIndex((one) => isUnknownWrite(one))
  const one = outcomes[index]
  const sent = target.records[index]
  if (one === undefined || sent === undefined || !isUnknownWrite(one)) return null
  return {
    ok: false,
    status: one.status,
    code: 'unknown-outcome',
    message: one.message,
    operation: kind === 'delete' ? 'delete-chosen' : 'update-chosen',
    records: [{ ...sent }],
    origin: one.origin,
  }
}

/** Whether a record's fate is not known yet: what the guard counts, and a check reads. */
const unknownFate = (fate: Fate): boolean => fate.kind === 'unknown' || fate.kind === 'lost'

/** "Check them" pressed: a second press while they are read sends nothing. */
export function checking(now: ChosenRequest): ChosenRequest {
  if (now.state !== 'answered' || now.checking || now.unknown === null || !now.each.some((one) => unknownFate(one.fate))) return now
  return { ...now, checking: true }
}

/** The records a check reads: those whose fate is not known yet, described as the lost answer was. */
export function toCheck(now: ChosenRequest): UnknownChosen | null {
  if (now.state !== 'answered' || now.unknown === null) return null
  const records = now.each.filter((one) => unknownFate(one.fate)).map(({ record, version }) => ({ record, version }))
  return records.length === 0 ? null : { ...now.unknown, records }
}

/**
 * What one read of a record shows about whether the request did it, read
 * as a write of it alone's check reads it (0031): a deletion's as a
 * delete's (0053, `checkedOf`) -- gone, or still stored; a change's as an
 * update's -- moved on, at the version sent, or, its record gone, not
 * found, the read's own refusal, since a change deletes nothing.
 */
function fateRead(kind: ChosenKind, read: Reconciliation): Fate {
  if (kind === 'change') {
    if (!read.ok) return read.status === 404 && read.code === 'not-found' ? { kind: 'not-found' } : { kind: 'unknown', said: CHANGE_WORDS.unread(read.message) }
    if (read.state === 'changed') return { kind: 'found' }
    if (read.state === 'unchanged') return { kind: 'kept', changed: false }
    return { kind: 'unknown', said: CHANGE_WORDS.unread('The check could not tell.') }
  }
  const found = checkedOf(read)
  switch (found.kind) {
    case 'absent':
      return { kind: 'found' }
    case 'unchanged':
    case 'changed':
      return { kind: 'kept', changed: found.kind === 'changed' }
    case 'unread':
      return { kind: 'unknown', said: DELETE_WORDS.unread(found.message) }
  }
}

/** What the check's reads showed, each record by its token: its own state, which takes the keyboard. */
export function checked(now: ChosenRequest, found: ReadonlyArray<{ record: string; reconciliation: Reconciliation }>): ChosenRequest {
  if (now.state !== 'answered' || !now.checking) return now
  const read = new Map(found.map(({ record, reconciliation }) => [record, reconciliation]))
  const each = now.each.map((one): Fated => {
    const shown = read.get(one.record)
    return shown === undefined || !unknownFate(one.fate) ? one : { ...one, fate: fateRead(now.kind, shown) }
  })
  return { ...now, each, checking: false, n: numbered(now) }
}

/**
 * Whether `now` -- the server's answer, or a check of it -- is what found
 * `record` done: done by the answer, or found done by this check where
 * its fate was not known before it; never one an earlier answer or check
 * found, which the page has acted on already -- a change's open record is
 * read again once (0176).
 */
export function foundNow(before: ChosenRequest, now: ChosenRequest, record: string): boolean {
  if (now.state !== 'answered') return false
  const fate = now.each.find((one) => one.record === record)?.fate
  if (fate === undefined) return false
  if (before.state !== 'answered') return fate.kind === 'done'
  const was = before.each.find((one) => one.record === record)?.fate
  return fate.kind === 'found' && was !== undefined && unknownFate(was)
}

/**
 * A check of a deletion found the open record gone, and its forms hold
 * work -- typed once the lost answer gave the person their Save back,
 * which the confirmation never listed: it is left open, and the region
 * says so, until Close the record, as after a delete's check (0053).
 */
export function keepOpen(now: ChosenRequest, record: string): ChosenRequest {
  return now.state === 'answered' ? { ...now, open: record } : now
}

/** Close the record pressed: its line goes, and the region takes the keyboard again, a new state. */
export function recordClosed(now: ChosenRequest): ChosenRequest {
  return now.state === 'answered' && now.open !== null ? { ...now, open: null, n: numbered(now) } : now
}

/** "Order `k1:3` is still open in the detail, …": what the region says of the open record a check found gone, left open. */
export function stillOpenText(noun: string, record: string): Said {
  return [`${noun} `, { code: record }, ` ${STILL_OPEN}`]
}

/** Closed by another request, Keep them, or Close: only what holds no work closes. */
export function close(now: ChosenRequest): ChosenRequest {
  return chosenWork(now) === null ? IDLE : now
}

/** What the guard counts (0047, 0166): a request out, and one whose outcome for some record is not known and not checked. */
export function chosenWork(now: ChosenRequest): Work | null {
  if (now.state === 'sending') return WORDS[now.kind].work.out
  if (now.state === 'answered' && now.each.some((one) => unknownFate(one.fate))) return WORDS[now.kind].work.unknown
  return null
}

/**
 * The records that leave the choice, as far as this page knows: done, not
 * found, or found as the request leaves them. A deletion's leave the page
 * too, and the open one is closed; a change's are read again.
 */
export function leftOf(now: ChosenRequest): ReadonlySet<string> {
  if (now.state !== 'answered') return new Set()
  return new Set(now.each.filter(({ fate }) => fate.kind === 'done' || fate.kind === 'not-found' || fate.kind === 'found').map(({ record }) => record))
}

/** What the page says of a record not done, after its name: the server's words, the page's, or what a check found. */
function words(kind: ChosenKind, fate: Fate): string {
  const said = WORDS[kind]
  switch (fate.kind) {
    case 'refused':
      return fate.declined ? `${fate.message} ${DECLINED_BY}` : fate.message
    case 'not-found':
      return NOT_FOUND
    case 'unknown':
      return fate.said
    case 'kept':
      return said.kept(fate.changed)
    case 'found':
      return said.found
    case 'lost':
      return said.mayHave
    case 'not-sent':
      return said.notSentOne
    case 'done':
      return ''
  }
}

/**
 * Why each record still chosen was not done, by its token: its box's
 * description until the choice changes (chosen-rows.ts) -- "Not deleted. …",
 * "Not changed. …". A record whose fate is not known yet may have been,
 * and says so.
 */
export function marksOf(now: ChosenRequest): ReadonlyMap<string, string> {
  if (now.state !== 'answered') return new Map()
  const left = leftOf(now)
  const not = WORDS[now.kind].refused
  return new Map(
    now.each
      .filter(({ record }) => !left.has(record))
      .map(({ record, fate }) => [record, unknownFate(fate) || fate.kind === 'not-sent' ? words(now.kind, fate) : `${not}. ${words(now.kind, fate)}`]),
  )
}

/** What the bar's line says once the choice has settled on `left`: how many are chosen, and which of them this request did not do, by name. */
export function settledText(now: ChosenRequest, left: readonly string[], name: (token: string) => string): string {
  if (now.state !== 'answered') return chosenText(left.length)
  const kept = now.each.filter(({ record }) => left.includes(record)).map(({ record }) => name(record))
  return kept.length === 0 ? chosenText(left.length) : `${chosenText(left.length)} Still chosen after the ${WORDS[now.kind].request}: ${listed(kept)}.`
}

/**
 * What the answered region says first: how many of the records this
 * request did; where its answer was lost, the client's sentence until a
 * check has read the records, and then only what it read -- how many are
 * found done, by whoever's request; none found so, how many are still as
 * they were, the rest still unknown; or none done, every one found so.
 */
export function summary(now: ChosenRequest & { state: 'answered' }): string {
  const said = WORDS[now.kind]
  const n = now.each.length
  const counting = (kind: Fate['kind']): number => now.each.filter(({ fate }) => fate.kind === kind).length
  if (!now.lost) return doneText(now.kind, counting('done'), n)
  if (counting('lost') > 0 || now.unknown === null) return now.unknown?.message ?? said.mayHave
  const found = counting('found')
  if (found > 0) return `${String(found)} of ${counted(n)} ${said.foundCount(found)}`
  const kept = counting('kept')
  if (kept === n) return said.none
  // Nothing read yet: every record still may have been done, as the client said.
  if (kept === 0) return now.unknown.message
  const others = n - kept === 1 ? 'the other was' : 'the others were'
  return `${String(kept)} of ${counted(n)} ${said.keptCount(kept)}; whether ${others} ${said.past} is still unknown.`
}

/** Whether the count is said in the room's teal, as what the server did (0146): only where this request's answer says it did some. */
export function saysDone(now: ChosenRequest & { state: 'answered' }): boolean {
  return !now.lost && now.each.some(({ fate }) => fate.kind === 'done')
}

/**
 * How the answered region is framed: as a save that may have been stored
 * is, while a fate is not known; in teal where some were done -- by this
 * request, or found so by a check; and in a refusal's warm colour where
 * none was.
 */
export function frameOf(now: ChosenRequest & { state: 'answered' }): 'unknown' | 'done' | 'refused' {
  if (now.each.some(({ fate }) => unknownFate(fate))) return 'unknown'
  return now.each.some(({ fate }) => fate.kind === 'done' || fate.kind === 'found') ? 'done' : 'refused'
}

/**
 * Each record the region names, in the order sent, as a row's Delete names
 * it -- "Order `k1:8`: Other records still refer to this one…" -- every
 * record not done but those the request stopped before, which `notSent`
 * names together; where the request's answer was lost, those a check has
 * read and did not find done, which the summary counts.
 */
export function lines(now: ChosenRequest & { state: 'answered' }): Array<{ record: string; said: Said }> {
  const named = now.each.filter(({ fate }) => fate.kind !== 'done' && fate.kind !== 'not-sent' && fate.kind !== 'lost' && !(now.lost && fate.kind === 'found'))
  return named.map(({ record, fate }) => ({ record, said: [`${now.target.noun} `, { code: record }, `: ${words(now.kind, fate)}`] }))
}

/** "Not sent, so not deleted: Order `k1:11` and Order `k1:12`.", or nothing where the request sent every record. */
export function notSent(now: ChosenRequest & { state: 'answered' }): Said | null {
  const left = now.each.filter(({ fate }) => fate.kind === 'not-sent')
  if (left.length === 0) return null
  const each = left.flatMap(({ record }, index): Said => [
    index === 0 ? ' ' : index === left.length - 1 ? ' and ' : ', ',
    `${now.target.noun} `,
    { code: record },
  ])
  return [WORDS[now.kind].notSent, ...each, '.']
}
