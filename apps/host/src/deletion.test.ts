import { describe, expect, test } from 'vitest'
import type { DeleteOutcome, UnknownWrite } from '@formancy/data-client'
import {
  again,
  answer,
  CASCADES,
  checked,
  checkedText,
  checking,
  CLEARS,
  close,
  confirm,
  deletionWork,
  detailTarget,
  gone,
  heading,
  IDLE,
  lead,
  NOT_FOUND,
  REMOVED,
  RESTRICTED,
  rowTarget,
  send,
} from './deletion.js'
import type { DeleteTarget, Deletion } from './deletion.js'
import type { Said } from './leave.js'

/*
 * One deletion on the host page (0053), as a table of states: confirming,
 * sending, then deleted, not found, refused or unknown, and an unknown one
 * checked -- and what each says. Pure, so the page only shows what this
 * decides; delete.test.tsx and unknown-delete.test.tsx drive the same states
 * through the page against the real server.
 */

const ORDER: DeleteTarget = { noun: 'Order', record: 'k1:1003', version: '7', from: { kind: 'detail' }, open: true }

/** `said` as text, a token in backticks: what a person reads. */
const text = (said: Said): string => said.map((part) => (typeof part === 'string' ? part : `\`${part.code}\``)).join('')

const LOST: UnknownWrite = {
  ok: false,
  status: 0,
  code: 'unknown-outcome',
  message: 'The answer to this deletion was lost between this page and the data server. It may have been deleted.',
  operation: 'delete',
  record: 'k1:1003',
  version: '7',
  origin: 'transport',
}

/** A deletion sent for ORDER, answered `outcome`. */
function answered(outcome: DeleteOutcome): { next: Deletion; gone: boolean } {
  return answer(send(confirm(IDLE, ORDER, [])), outcome)
}

describe('what a confirmation says', () => {
  // The words come from what the server says a delete also does, never
  // from table names: "deleted with it" for a cascade the policy accepts,
  // "lose that reference" for one it clears, and that the database may
  // keep it when another row refers to it (0050, 0051). A lead that left
  // out the cascade would let a person delete an order's lines unawares.
  test('says what the delete does, and what it also does, one sentence each', () => {
    expect(lead({ cascades: false, clears: false, restricted: false })).toEqual([REMOVED])
    expect(lead({ cascades: true, clears: false, restricted: false })).toEqual([REMOVED, CASCADES])
    expect(lead({ cascades: true, clears: true, restricted: true })).toEqual([REMOVED, CASCADES, CLEARS, RESTRICTED])
    expect(REMOVED).toBe('It is removed from the database for everyone who can see it. This page cannot bring it back.')
    expect(CASCADES).toBe('Other records that refer to it are deleted with it.')
    expect(CLEARS).toBe('Other records that refer to it keep their place and lose that reference.')
    expect(RESTRICTED).toBe('If other records still refer to it, the database keeps it and nothing is deleted.')
  })

  // The question names the record, so a confirmation reached from a grid
  // row says which row; and what the grid says afterwards tells a delete
  // from a record that was merely not found, which is never "Deleted"
  // (0031): it may be one the person can no longer see.
  test('names the record it asks about, and says Deleted or Closed after', () => {
    expect(text(heading(ORDER))).toBe('Delete Order `k1:1003`?')
    expect(text(gone(ORDER, 'Deleted'))).toBe('Deleted Order `k1:1003`.')
    expect(text(gone(ORDER, 'Closed'))).toBe('Closed Order `k1:1003`.')
  })
})

describe('what a delete names', () => {
  // A row's delete names the version the row was listed with -- 0044's rows
  // carry it, and it is what the page read of the row -- so nothing is read
  // first; the open record's row, and its header, name the newest version
  // the detail heard, which a save may have moved past the listed row
  // (watched failing with the row's version used for the open record). A
  // row no token addresses names nothing.
  test("names a row's listed version, and the detail's for the open record", () => {
    const row = { record: 'k1:1004', version: '3' }
    expect(rowTarget('Order', row, null)).toEqual({ noun: 'Order', record: 'k1:1004', version: '3', from: { kind: 'row' }, open: false })
    expect(rowTarget('Order', row, { record: 'k1:1003', heard: '9' })).toMatchObject({ version: '3', open: false })
    expect(rowTarget('Order', row, { record: 'k1:1004', heard: '5' })).toMatchObject({ version: '5', open: true })
    expect(rowTarget('Order', row, { record: 'k1:1004', heard: null })).toMatchObject({ version: '3', open: true })
    expect(rowTarget('Order', { record: null, version: null }, null)).toBeNull()
    expect(detailTarget('Order', 'k1:1003', '7')).toEqual(ORDER)
  })
})

describe('the states of one deletion', () => {
  // The server's answer decides the state, and only its own: a 200 with
  // the deletion's shape is deleted, a 404 not found -- not "Not deleted",
  // for it may be gone -- 409 stale keeps its sentence and offers the saved
  // record, any other refusal is said verbatim, and a lost answer is
  // unknown, never a refusal (0031) (watched failing with a 404 read as a
  // refusal: "Not deleted" over a record that may be gone).
  test('goes from confirming to sending, and to what the server answered', () => {
    const asked = confirm(IDLE, ORDER, [])
    expect(asked).toMatchObject({ state: 'confirming', target: ORDER })
    const out = send(asked)
    expect(out).toMatchObject({ state: 'sending', target: ORDER, n: asked.state === 'idle' ? -1 : asked.n })
    expect(answered({ ok: true, value: { record: 'k1:1003', deleted: true } })).toEqual({ next: IDLE, gone: true })
    expect(answered({ ok: false, status: 404, code: 'not-found', message: 'No such record.' }).next).toMatchObject({ state: 'not-found', target: ORDER })
    expect(
      answered({ ok: false, status: 409, code: 'stale', message: 'The record changed since it was read. Reload it and review the changes before deleting it.' })
        .next,
    ).toMatchObject({
      state: 'refused',
      stale: true,
      message: 'The record changed since it was read. Reload it and review the changes before deleting it.',
    })
    expect(
      answered({ ok: false, status: 422, code: 'referenced', message: 'Other records still refer to this one, so the database keeps it. Nothing was deleted.' })
        .next,
    ).toMatchObject({
      state: 'refused',
      stale: false,
      message: 'Other records still refer to this one, so the database keeps it. Nothing was deleted.',
    })
    expect(answered(LOST)).toEqual({ next: expect.objectContaining({ state: 'unknown', unknown: LOST, checking: false }), gone: false })
  })

  // A check reads the record, and says only what the read showed: gone is
  // the not-found wording, still at the version sent offers to delete it
  // again -- which asks again, never sends -- and a read that failed leaves
  // it unknown. "Delete it again" sending at once would be one stray key
  // press from a second delete (watched failing with it sending).
  test('checks an unknown deletion, and "Delete it again" asks again with the version sent', () => {
    const lost = answered(LOST).next
    expect(checking(lost)).toMatchObject({ state: 'unknown', checking: true })
    const absent = checked(checking(lost), { ok: true, state: 'absent' })
    expect(absent).toMatchObject({ state: 'checked', found: { kind: 'absent' } })
    const unchanged = checked(checking(lost), { ok: true, state: 'unchanged', current: { record: 'k1:1003', version: '7', answers: {} } })
    expect(unchanged).toMatchObject({ state: 'checked', found: { kind: 'unchanged' } })
    expect(checked(lost, { ok: true, state: 'changed', current: { record: 'k1:1003', version: '8', answers: {} } })).toMatchObject({
      state: 'checked',
      found: { kind: 'changed' },
    })
    expect(checked(lost, { ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' })).toMatchObject({
      state: 'checked',
      found: { kind: 'unread', message: 'The database cannot be reached. Nothing was saved.' },
    })
    // A create's answers, which a deletion's read never gives, are no answer about a deletion either.
    expect(checked(lost, { ok: true, state: 'unverifiable' })).toMatchObject({ state: 'checked', found: { kind: 'unread' } })
    // A check that could not read may be pressed again; nothing else is a check's to start.
    const unread = checked(lost, { ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' })
    expect(checking(unread)).toMatchObject({ state: 'unknown', checking: true, unknown: LOST })
    expect(checking(absent)).toBe(absent)
    expect(checking(IDLE)).toBe(IDLE)
    const asked = again(unchanged)
    expect(asked).toMatchObject({ state: 'confirming', target: { ...ORDER, version: '7' } })
    expect(again(absent)).toBe(absent)
    // Each state that takes the keyboard is a new one, so the region is focused again.
    const numbers = [lost, absent, asked].map((state) => (state.state === 'idle' ? -1 : state.n))
    expect(new Set(numbers).size).toBe(3)
  })

  // What a check found, in words: the not-found wording for absent, never
  // "deleted", and an unread check says that the outcome is still unknown.
  test('says what a check found in its own words', () => {
    expect(checkedText({ kind: 'absent' })).toBe(NOT_FOUND)
    expect(NOT_FOUND).toBe('This form cannot find the record any more: it was deleted, or is no longer one you may see.')
    expect(checkedText({ kind: 'unchanged' })).toBe('It is still stored, at the version you saw.')
    expect(checkedText({ kind: 'changed' })).toBe('It is still stored, and has changed since you saw it.')
    expect(checkedText({ kind: 'unread', message: 'The database cannot be reached. Nothing was saved.' })).toBe(
      'The database cannot be reached. Nothing was saved. Whether it was deleted is still unknown.',
    )
  })

  // A deletion out, or one that may have been done and is not yet checked,
  // is work the guard asks about before anything drops it (0047); a
  // confirmation or a notice that holds nothing is not, and another
  // request closes it. A second press while one is out asks nothing new.
  test('is work while it is out or unknown, and closes only when it holds nothing', () => {
    const asked = confirm(IDLE, ORDER, [])
    const out = send(asked)
    const lost = answered(LOST).next
    const unread = checked(lost, { ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' })
    const known = checked(lost, { ok: true, state: 'absent' })
    expect([IDLE, asked, out, lost, unread, known].map(deletionWork)).toEqual([null, null, 'deleting', 'delete-unknown', 'delete-unknown', null])
    expect([asked, known, answered({ ok: false, status: 404, code: 'not-found', message: 'No such record.' }).next].map(close)).toEqual([IDLE, IDLE, IDLE])
    expect(close(out)).toBe(out)
    expect(close(lost)).toBe(lost)
    const other: DeleteTarget = { ...ORDER, record: 'k1:1004' }
    for (const busy of [out, lost]) {
      const pressed = confirm(busy, other, [])
      expect(pressed).toMatchObject({ state: busy.state, target: ORDER })
      expect(pressed.state === 'idle' || busy.state === 'idle' ? null : pressed.n).not.toBe(busy.state === 'idle' ? null : busy.n)
    }
  })
})
