import { describe, expect, test } from 'vitest'
import type { FormPolicy } from '../policy/types.js'
import { planUpdate } from './plan.js'
import type { FormRecord } from './plan-types.js'
import { actor, CLERK, CLERK_RW, col, CUSTOMER_POLICY, customerForm, described, snapshot } from './test-support.js'

/*
 * An instant and a time on update, decided once, in the planner (0040). Both
 * adapters read an instant cut to the second and a time to the minute, so a
 * form that sends back what it read sends a value shorter than the stored
 * one; set, it replaces the stored fraction or seconds with nothing anybody
 * chose. Only the record as read can tell that echo from a change, so
 * `planUpdate` takes it, removes the echo, and refuses to plan such an update
 * without it: any caller of the planner and an adapter, the data server or
 * not, is held to the same rule.
 */

/** The customer table with a rowversion, so it offers update, and a time with seconds beside its defaulted instant. */
const SOURCE = snapshot('sqlserver', (objects) => {
  const customer = objects.find((object) => object.ref.name === 'customer')
  customer?.columns.push(col('row_version', 8, { kind: 'rowversion' }, { generated: 'rowversion' }), col('at_time', 9, { kind: 'time', precision: 7 }, { nullable: true }))
})
const { bindings: BINDINGS } = customerForm(SOURCE)

const TOKEN = 'k1:1,1001'
const VERSION = '00000000000007d1'
const NEWER = '00000000000007d2'

/** The clerk reads and writes the name and both temporal fields. */
const POLICY: FormPolicy = { ...CUSTOMER_POLICY, fields: { ...CUSTOMER_POLICY.fields, created_at: CLERK_RW, at_time: CLERK_RW } }

/** The record as both adapters read it for the clerk: the instant to the second, the time to the minute. */
const AS_READ: FormRecord = {
  record: TOKEN,
  version: VERSION,
  answers: { tenant_id: 1, customer_no: 1001, name: 'Muster AG', country: null, credit_limit: null, active: true, created_at: '2026-10-08T10:34:56Z', at_time: '10:34' },
}

/** The columns a planned update sets, by name, with the values it carries. */
function setBy(planned: ReturnType<typeof planUpdate>): Record<string, unknown> {
  if (!planned.ok) throw new Error(`${planned.code}: ${planned.message}`)
  return Object.fromEntries(planned.request.set.map((entry) => [entry.name, entry.value]))
}

const UNEDITED = { name: 'Muster AG, edited', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' }

describe('planUpdate and the record as read (0040)', () => {
  // The defect for any caller but the data server: the planner, given what
  // the adapter read and an edited name, planned the cut instant and time
  // into `set`, and the adapter stored them over the fraction and seconds.
  // Refused instead, the caller learns that it must pass the read; an update
  // that carries neither field needs none, so nothing else is refused.
  test('an update carrying an instant or a time the actor may read is refused without the record as read', () => {
    expect(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, UNEDITED, undefined, described(SOURCE, BINDINGS))).toEqual({
      ok: false,
      code: 'record-not-read',
      message: 'created_at, at_time are read cut to the shape, so only the record as read tells an unedited one from a change: plan the update with it.',
    })
    expect(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, { at_time: '11:22' }, undefined, described(SOURCE, BINDINGS))).toMatchObject({ ok: false, code: 'record-not-read' })
    expect(setBy(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, { name: 'Muster AG, edited' }, undefined, described(SOURCE, BINDINGS)))).toEqual({ name: 'Muster AG, edited' })
  })

  // The rule itself: equal to the record as read, at the version the update
  // is guarded by, an instant or a time is an echo and is not set.
  test('an unedited instant and time are removed against the record as read, and the rest is set', () => {
    expect(setBy(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, UNEDITED, AS_READ, described(SOURCE, BINDINGS)))).toEqual({ name: 'Muster AG, edited' })
  })

  // Removing every instant and time, equal or not, passes the case above and
  // silently drops what a person entered.
  test('a changed instant or time is set as sent', () => {
    const changed = { ...UNEDITED, created_at: '2026-01-02T03:04:05Z', at_time: '11:22' }
    expect(setBy(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, changed, AS_READ, described(SOURCE, BINDINGS)))).toEqual(changed)
    expect(setBy(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, { ...UNEDITED, at_time: null }, AS_READ, described(SOURCE, BINDINGS)))).toEqual({ name: 'Muster AG, edited', at_time: null })
  })

  // Read at another version, an equal value is still the person's older read:
  // it is planned, and the update's version guard answers it as stale.
  // Proved against whatever the read found, an unedited form would be told
  // "nothing to update" about a record that has changed.
  test('against a record as read at another version, nothing is removed', () => {
    const newer = { ...AS_READ, version: NEWER }
    expect(setBy(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, UNEDITED, newer, described(SOURCE, BINDINGS)))).toEqual(UNEDITED)
  })

  // Compared with another record's read, or with one that does not hold the
  // field, an edited value could be taken for an echo and dropped, or an
  // echo kept and the cut value written. Neither is guessed at.
  test('a record as read of another record, or without a field the actor may read, is refused', () => {
    expect(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, UNEDITED, { ...AS_READ, record: 'k1:1,1002' }, described(SOURCE, BINDINGS))).toEqual({
      ok: false,
      code: 'record-not-read',
      message: 'The record as read is not the record this update addresses.',
    })
    const { at_time: _dropped, ...partial } = AS_READ.answers
    expect(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, UNEDITED, { ...AS_READ, answers: partial }, described(SOURCE, BINDINGS))).toEqual({
      ok: false,
      code: 'record-not-read',
      message: 'The record as read does not hold at_time, which this actor may read.',
    })
  })

  // A field the actor may write and not read has no value of theirs to
  // echo. Compared with the stored value all the same, the save would tell
  // them whether they had guessed what the policy keeps from them. So it is
  // set as sent, and needs no read -- nor does any field of an actor who may
  // update and not read the record.
  test('a field the actor may write and not read is never compared, and needs no read', () => {
    const blind: FormPolicy = { ...POLICY, fields: { ...POLICY.fields, created_at: { read: [], write: ['clerk'] }, at_time: { read: [], write: ['clerk'] } } }
    expect(setBy(planUpdate(SOURCE, BINDINGS, blind, CLERK, TOKEN, VERSION, UNEDITED, AS_READ, described(SOURCE, BINDINGS)))).toEqual(UNEDITED)
    expect(setBy(planUpdate(SOURCE, BINDINGS, blind, CLERK, TOKEN, VERSION, UNEDITED, undefined, described(SOURCE, BINDINGS)))).toEqual(UNEDITED)
    const unread: FormPolicy = { ...POLICY, operations: { ...POLICY.operations, read: [] } }
    const writer = actor(['clerk'])
    expect(setBy(planUpdate(SOURCE, BINDINGS, unread, writer, TOKEN, VERSION, UNEDITED, undefined, described(SOURCE, BINDINGS)))).toEqual(UNEDITED)
  })

  // A form whose only change was an unedited instant and time has nothing
  // left to set, and is refused as every empty patch is, once, here.
  test('an update whose only change was an unedited instant and time is nothing-to-update', () => {
    const { name: _name, ...temporal } = UNEDITED
    expect(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, temporal, AS_READ, described(SOURCE, BINDINGS))).toEqual({ ok: false, code: 'nothing-to-update', message: 'These answers change no column.' })
  })

  // What no shape names -- PostgreSQL's `infinity` and `24:00` -- is read in a
  // spelling the codec refuses (0016). Sent back unedited it is an echo, and
  // is removed before any codec sees it, so the value is kept; changed to
  // another such spelling it is the person's, and the codec refuses it.
  test('an unedited value no shape names is removed before the codec; one entered is refused by it', () => {
    const odd: FormRecord = { ...AS_READ, answers: { ...AS_READ.answers, created_at: 'infinity', at_time: '24:00' } }
    expect(setBy(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, { ...UNEDITED, created_at: 'infinity', at_time: '24:00' }, odd, described(SOURCE, BINDINGS)))).toEqual({ name: 'Muster AG, edited' })
    expect(planUpdate(SOURCE, BINDINGS, POLICY, CLERK, TOKEN, VERSION, { ...UNEDITED, created_at: 'infinity', at_time: '24:00' }, AS_READ, described(SOURCE, BINDINGS))).toMatchObject({
      ok: false,
      code: 'invalid-values',
      fieldErrors: [
        { field: 'created_at', code: 'not-an-instant' },
        { field: 'at_time', code: 'not-a-time' },
      ],
    })
  })
})
