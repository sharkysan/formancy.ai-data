import { describe, expect, test } from 'vitest'
import type { ChosenRecordOutcome, DeleteChosenOutcome, Reconciliation, UnknownChosen } from '@formancy/data-client'
import {
  answer,
  ask,
  CASCADES_CHOSEN,
  checked,
  checking,
  chosenWork,
  CLEARS_CHOSEN,
  close,
  EACH_ON_ITS_OWN,
  frameOf,
  GONE,
  goneOf,
  heading,
  IDLE,
  keepOpen,
  lead,
  lines,
  MAY_HAVE,
  marksOf,
  NONE_DELETED,
  NOT_SENT_ONE,
  notSent,
  recordClosed,
  REMOVED_CHOSEN,
  RESTRICTED_CHOSEN,
  saysDone,
  send,
  settledText,
  STILL_OPEN,
  stillOpenText,
  summary,
  toCheck,
} from './chosen-deletion.js'
import type { ChosenDeletion, ChosenTarget } from './chosen-deletion.js'
import { CASCADES, NOT_FOUND, REMOVED, RESTRICTED } from './deletion.js'
import type { Said } from './leave.js'
import { DECLINED_BY } from './words.js'

/*
 * A deletion of the records chosen of a page (0174), as a table of what
 * each answer the client can give makes of each record: its fate, what
 * the region says of it, what its box is marked with, which records leave
 * the choice and what the guard counts. Pure: the region and the bar are
 * drawn against the real server on both engines by bulk-delete.test.tsx,
 * and what the client reads off the wire is data-client's chosen.test.ts.
 */

const at = (record: string, version = '1') => ({ record, version })
const target = (...records: string[]): ChosenTarget => ({ noun: 'Order', records: records.map((record) => at(record)) })
const sending = (records: readonly string[]): ChosenDeletion =>
  send(
    ask(IDLE, target(...records), []),
    records.map((record) => at(record)),
  )
const answered = (now: ChosenDeletion): ChosenDeletion & { state: 'answered' } => {
  if (now.state !== 'answered') throw new Error(`the deletion is ${now.state}, not answered`)
  return now
}

/** A Said as the page reads it aloud: the code set as plain text. */
const text = (said: Said): string => said.map((part) => (typeof part === 'string' ? part : part.code)).join('')

const deleted = (record: string): ChosenRecordOutcome => ({ ok: true, value: { record, deleted: true } })
const refused = (status: number, code: string, message: string): ChosenRecordOutcome => ({ ok: false, status, code, message })
const STALE = 'The record changed since it was read. Reload it and review the changes before deleting it.'
const REFERENCED = 'Other records still refer to this one, so the database keeps it. Nothing was deleted.'
const lostOne = (record: string): ChosenRecordOutcome => ({
  ok: false,
  status: 502,
  code: 'unknown-outcome',
  message: 'The connection to the database closed before the answer arrived.',
  operation: 'delete',
  record,
  version: '1',
  origin: 'database',
})
const notSentOne = (record: string): ChosenRecordOutcome => ({ ok: false, status: 0, code: 'not-sent', message: 'not sent', record, version: '1' })

describe('the confirmation', () => {
  // What deleting them also does is the form's, never the page's guess:
  // a cascade, a reference cleared or a key that keeps a record is said
  // only where `deleting` says the policy and the snapshot have one, and
  // one record chosen is a delete of it alone, in 0053's words (watched
  // failing with the cascade said on every form: "expected [ …(3) ] to
  // deeply equal [ …(2) ]").
  test('says what deleting them does from the form’s deleting, and of one record a delete’s own words', () => {
    expect(lead({ cascades: false, clears: false, restricted: false }, 3)).toEqual([EACH_ON_ITS_OWN, REMOVED_CHOSEN])
    expect(lead({ cascades: true, clears: false, restricted: false }, 3)).toEqual([EACH_ON_ITS_OWN, REMOVED_CHOSEN, CASCADES_CHOSEN])
    expect(lead({ cascades: false, clears: true, restricted: true }, 2)).toEqual([EACH_ON_ITS_OWN, REMOVED_CHOSEN, CLEARS_CHOSEN, RESTRICTED_CHOSEN])
    expect(lead({ cascades: true, clears: false, restricted: true }, 1)).toEqual([REMOVED, CASCADES, RESTRICTED])
    expect(heading(target('k1:7', 'k1:8', 'k1:10'), true)).toBe('Delete 3 chosen Order records?')
    expect(heading(target('k1:7'), false)).toBe('Delete 1 chosen Order record')
  })

  // A deletion out, or one whose fate is not known yet, is asked again --
  // the same region, focused again -- never replaced by a new question
  // over another choice, which would lose what is out; and Delete them
  // sends the records at the versions the choice gives as it is pressed
  // (watched failing with a second ask replacing the deletion out:
  // "expected { state: 'confirming', …(3) } to match object { state:
  // 'sending', n: 2, …(1) }").
  test('asked again while out is the same deletion, focused again, and sends the versions given', () => {
    const out = send(ask(IDLE, target('k1:1', 'k1:2'), []), [at('k1:1', '4'), at('k1:2')])
    expect(out).toMatchObject({ state: 'sending', target: { records: [at('k1:1', '4'), at('k1:2')] } })
    const again = ask(out, target('k1:3'), [])
    expect(again).toMatchObject({ state: 'sending', n: out.state === 'idle' ? 0 : out.n + 1, target: { records: [at('k1:1', '4'), at('k1:2')] } })
    expect(chosenWork(again)).toBe('deleting')
    expect(close(again)).toBe(again)
  })
})

describe('what the server answered', () => {
  // Each record as a delete of it alone is read (0173): deleted; changed
  // since and referred to, in the server's words; declined, with whose
  // words those are (0156); not found, which is never called deleted
  // (0031) and leaves the page as a deleted one does; a record whose own
  // answer was lost, which may have been; and those the request stopped
  // before. The region counts what this request deleted and names every
  // other record, those not sent together; the records gone leave the
  // choice and the rest are marked with why; the guard counts the one not
  // known (watched failing with a 404 read as a refusal, Order k1:3 named
  // in the server's words and kept chosen: "expected [ …(5) ] to deeply
  // equal [ …(5) ]"; and with a check reading every record: "expected {
  // ok: false, status: 502, …(5) } to match object { code:
  // 'unknown-outcome', …(4) }").
  test('is each record’s fate in the order sent, said, marked and counted', () => {
    const value = [
      deleted('k1:1'),
      refused(409, 'stale', STALE),
      refused(404, 'not-found', 'No such record.'),
      refused(409, 'referenced', REFERENCED),
      refused(422, 'declined', 'Closed orders are kept.'),
      lostOne('k1:6'),
      notSentOne('k1:7'),
      notSentOne('k1:8'),
    ]
    const records = ['k1:1', 'k1:2', 'k1:3', 'k1:4', 'k1:5', 'k1:6', 'k1:7', 'k1:8']
    const now = answered(answer(sending(records), { ok: true, value }))
    expect(summary(now)).toBe('Deleted 1 of 8 records.')
    expect(lines(now).map(({ said }) => text(said))).toEqual([
      `Order k1:2: ${STALE}`,
      `Order k1:3: ${NOT_FOUND}`,
      `Order k1:4: ${REFERENCED}`,
      `Order k1:5: Closed orders are kept. ${DECLINED_BY}`,
      `Order k1:6: The connection to the database closed before the answer arrived. ${MAY_HAVE}`,
    ])
    expect(text(notSent(now) ?? [])).toBe('Not sent, so not deleted: Order k1:7 and Order k1:8.')
    expect([...goneOf(now)]).toEqual(['k1:1', 'k1:3'])
    expect(Object.fromEntries(marksOf(now))).toEqual({
      'k1:2': `Not deleted. ${STALE}`,
      'k1:4': `Not deleted. ${REFERENCED}`,
      'k1:5': `Not deleted. Closed orders are kept. ${DECLINED_BY}`,
      'k1:6': `The connection to the database closed before the answer arrived. ${MAY_HAVE}`,
      'k1:7': NOT_SENT_ONE,
      'k1:8': NOT_SENT_ONE,
    })
    expect(chosenWork(now)).toBe('delete-unknown')
    expect(close(now)).toBe(now)
    // The check reads the one record not known, described as the server described its loss.
    expect(toCheck(now)).toMatchObject({ code: 'unknown-outcome', operation: 'delete-chosen', status: 502, origin: 'database', records: [at('k1:6')] })
    expect(settledText(now, ['k1:2', 'k1:4'], (token) => `Order ${token}`)).toBe('2 chosen. Still chosen after the deletion: Order k1:2 and Order k1:4.')
  })

  // Every record deleted, nothing is named and nothing is left to count:
  // Close closes it (watched failing with Close kept from a done region:
  // "expected { state: 'answered', …(6) } to be { state: 'idle' }").
  test('done for every record says so, names none and closes', () => {
    const now = answered(answer(sending(['k1:1', 'k1:2']), { ok: true, value: [deleted('k1:1'), deleted('k1:2')] }))
    expect([summary(now), lines(now), notSent(now), chosenWork(now)]).toEqual(['Deleted 2 of 2 records.', [], null, null])
    expect(close(now)).toBe(IDLE)
    expect(settledText(now, [], (token) => token)).toBe('Nothing chosen.')
  })

  // The count is said in the room's teal only as what the server did
  // (0146): where this request deleted some, once for its answer -- a
  // check, which says nothing new of what it deleted, leaves the number
  // the teal is said by as it was -- and never "Deleted 0 of 2 records.",
  // framed as a refusal is, nor the page's own sentence after a lost
  // answer (watched failing with the teal said wherever the request was
  // answered: "expected [ true, true, true ] to deeply equal [ true,
  // false, false ]").
  test('says the count in teal only where this request deleted some, once for its answer', () => {
    const some = answered(answer(sending(['k1:1', 'k1:2']), { ok: true, value: [deleted('k1:1'), lostOne('k1:2')] }))
    const none = answered(answer(sending(['k1:1', 'k1:2']), { ok: true, value: [refused(409, 'stale', STALE), refused(409, 'referenced', REFERENCED)] }))
    const lost = answered(
      answer(sending(['k1:1']), {
        ok: false,
        status: 0,
        code: 'unknown-outcome',
        message: 'lost',
        operation: 'delete-chosen',
        records: [at('k1:1')],
        origin: 'transport',
      }),
    )
    expect([saysDone(some), saysDone(none), saysDone(lost)]).toEqual([true, false, false])
    expect([frameOf(some), frameOf(none), frameOf(lost)]).toEqual(['unknown', 'refused', 'unknown'])
    const read = answered(checked(checking(some), [{ record: 'k1:2', reconciliation: { ok: true, state: 'absent' } }]))
    expect([read.said, read.n, frameOf(read)]).toEqual([some.said, some.n + 1, 'done'])
  })

  // Refused whole -- a drift, a connection the database will not let
  // delete, the deadline at the first record -- is nothing deleted, in the
  // server's words, and holds nothing (watched failing with the refusal
  // dropped as nothing to say: "expected 'idle' to be 'refused'").
  test('refused whole is the server’s sentence, nothing deleted', () => {
    const outcome: DeleteChosenOutcome = { ok: false, status: 409, code: 'drift', message: 'The form no longer matches its table.' }
    const now = answer(sending(['k1:1']), outcome)
    expect(now.state).toBe('refused')
    expect(now).toMatchObject({ message: 'The form no longer matches its table.', declined: false })
    expect(chosenWork(now)).toBeNull()
    expect([...goneOf(now)]).toEqual([])
  })
})

describe('a request whose answer was lost', () => {
  const LOST: UnknownChosen = {
    ok: false,
    status: 0,
    code: 'unknown-outcome',
    message: 'The answer to this deletion of chosen records was lost between this page and the data server. Any of them may have been deleted.',
    operation: 'delete-chosen',
    records: [at('k1:1'), at('k1:2'), at('k1:3'), at('k1:4')],
    origin: 'transport',
  }
  const read = (record: string, reconciliation: Reconciliation) => ({ record, reconciliation })
  const stored = { record: 'k1:1', version: '1', answers: {}, labels: {} } as never

  // Every record unknown, said once in the client's words and named by
  // none, and counted by the guard; a check reads every one. What it read:
  // at the version sent, or changed since, not deleted, and kept chosen
  // with why; gone, deleted by this request or by somebody else's, which
  // the region counts and cannot tell apart; a read refused, still
  // unknown, which a second check reads alone (watched failing with the
  // second check reading every record again: "expected [ …(4) ] to deeply
  // equal [ …(1) ]").
  test('is checked record by record, and only what is still unknown is read again', () => {
    const lost = answered(answer(sending(['k1:1', 'k1:2', 'k1:3', 'k1:4']), LOST))
    expect([summary(lost), lines(lost), chosenWork(lost)]).toEqual([LOST.message, [], 'delete-unknown'])
    expect(toCheck(lost)?.records).toEqual(LOST.records)
    const reading = checking(lost)
    expect(checking(reading)).toBe(reading)
    const found = answered(
      checked(reading, [
        read('k1:1', { ok: true, state: 'unchanged', current: stored }),
        read('k1:2', { ok: true, state: 'changed', current: stored }),
        read('k1:3', { ok: true, state: 'absent' }),
        read('k1:4', { ok: false, status: 503, code: 'unavailable', message: 'The database is not answering.' }),
      ]),
    )
    expect(summary(found)).toBe(`1 of 4 records is not there any more: this deletion, or somebody else’s, deleted it.`)
    expect(lines(found).map(({ said }) => text(said))).toEqual([
      'Order k1:1: It is still stored, at the version you saw.',
      'Order k1:2: It is still stored, and has changed since you saw it.',
      'Order k1:4: The database is not answering. Whether it was deleted is still unknown.',
    ])
    expect([...goneOf(found)]).toEqual(['k1:3'])
    expect(marksOf(found).get('k1:1')).toBe('Not deleted. It is still stored, at the version you saw.')
    expect(chosenWork(found)).toBe('delete-unknown')
    expect(toCheck(found)?.records).toEqual([at('k1:4')])
    const all = answered(checked(checking(found), [read('k1:4', { ok: true, state: 'absent' })]))
    expect(summary(all)).toBe(`2 of 4 records are not there any more: this deletion, or somebody else’s, deleted them.`)
    expect(lines(all).map(({ record }) => record)).toEqual(['k1:1', 'k1:2'])
    expect(chosenWork(all)).toBeNull()
    expect(toCheck(all)).toBeNull()
    expect(GONE).toBe('It is not there any more: this deletion, or somebody else’s, deleted it.')
  })

  // A check that finds none gone says only what it read: every record
  // still stored is none deleted; some still stored and the rest unread
  // counts those it read and leaves the others unknown; none read is the
  // client's sentence still -- never "0 of 2 records are not there any
  // more: … deleted them", which says a deletion deleted something when
  // nothing was (watched failing with that sentence for every record
  // kept: "expected [ …(2) ] to deeply equal [ …(2) ]").
  test('found gone nowhere says what was read, never that a deletion deleted them', () => {
    const lost = answered(answer(sending(['k1:1', 'k1:2']), { ...LOST, records: [at('k1:1'), at('k1:2')] }))
    const kept = (record: string) => read(record, { ok: true, state: 'unchanged', current: stored })
    const unread = (record: string) => read(record, { ok: false, status: 503, code: 'unavailable', message: 'The database is not answering.' })
    const all = answered(checked(checking(lost), [kept('k1:1'), kept('k1:2')]))
    expect([summary(all), chosenWork(all)]).toEqual([NONE_DELETED, null])
    const some = answered(checked(checking(lost), [kept('k1:1'), unread('k1:2')]))
    expect(summary(some)).toBe('1 of 2 records is still stored, not deleted; whether the other was deleted is still unknown.')
    const none = answered(checked(checking(lost), [unread('k1:1'), unread('k1:2')]))
    expect(summary(none)).toBe(LOST.message)
  })

  // The open record a check found gone, where its forms hold work the
  // person typed once the lost answer gave them their Save back, is left
  // open: the region says so, kept through a later check, and Close the
  // record is its person's, as after a delete's check (0053) -- closed,
  // the line goes and the region takes the keyboard again, a new state
  // (watched failing with the record forgotten by the next check:
  // "expected null to be 'k1:1'").
  test('leaves the open record a check found gone open, until Close the record', () => {
    const lost = answered(answer(sending(['k1:1', 'k1:2']), { ...LOST, records: [at('k1:1'), at('k1:2')] }))
    const gone = answered(checked(checking(lost), [read('k1:1', { ok: true, state: 'absent' })]))
    const open = answered(keepOpen(gone, 'k1:1'))
    expect(open.open).toBe('k1:1')
    expect(open.n).toBe(gone.n)
    expect(text(stillOpenText(open.target.noun, 'k1:1'))).toBe(`Order k1:1 ${STILL_OPEN}`)
    const again = answered(checked(checking(open), [read('k1:2', { ok: true, state: 'unchanged', current: stored })]))
    expect(again.open).toBe('k1:1')
    const closed = answered(recordClosed(again))
    expect([closed.open, closed.n]).toEqual([null, again.n + 1])
    expect(recordClosed(closed)).toBe(closed)
    expect(keepOpen(IDLE, 'k1:1')).toBe(IDLE)
  })
})
