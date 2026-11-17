import { describe, expect, test } from 'vitest'
import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { ActionOutcome, FormAction, UnknownAction } from '@formancy/data-client'
import type { FormSchema } from '@formancy/spec'
import type { PaneWork } from './leave.js'
import { again, answer, answered, ask, checked, checkedText, close, IDLE, runWork, send, words } from './running.js'
import type { Run, RunTarget } from './running.js'

/*
 * One run of an action on the host page (0162), as a table of states: its
 * dialog, its confirmation, the run out, and each answer -- done, refused,
 * refused by a dialog field, unknown and then checked. Pure, so the page
 * only shows what this decides; page.test.tsx, in-flight.test.tsx and
 * actions.test.tsx drive the same states through the page against the
 * real server, which answers no dialog's field here: close's note is text
 * any answer fits.
 */

const DIALOG: FormSchema = {
  specVersion: '5',
  id: 'pg-action-order.close',
  title: 'Close the order',
  model: { fields: [{ key: 'note', label: 'Note', type: 'text', required: true }] },
}

const CLOSE: FormAction = { name: 'close', label: 'Close the order', scope: 'record', confirm: null, done: null, dialog: DIALOG, refresh: [] }
const TARGET: RunTarget = { action: CLOSE, label: 'Close the order', noun: 'Order', record: 'k1:7', version: '3' }
const engine = (): FormEngine => createFormEngine({ schema: DIALOG, formId: 'running-test' })

/** The run out, from its dialog's answers, at `version`. */
function sending(version = '3', dialog: FormEngine | null = engine()): Run {
  const asked = dialog === null ? ask(IDLE, TARGET, null, []) : answered(ask(IDLE, TARGET, dialog, []), { note: 'closed' }, [])
  return send(asked, version)
}

const LOST: UnknownAction = {
  ok: false,
  status: 502,
  code: 'unknown-outcome',
  message: 'It may have run.',
  operation: 'action',
  action: 'close',
  records: [{ record: 'k1:7', version: '3' }],
  origin: 'database',
}

describe('a run of an action over the open record', () => {
  // An action with a dialog asks it first, and one without starts at its
  // confirmation; Run it sends the version it is given -- which version
  // that is, the newest the detail heard, is action-flow.ts's, and
  // in-flight.test.tsx holds it through a save answered meanwhile.
  test('asks its dialog, then confirms, then sends the version it is given', () => {
    const asking = ask(IDLE, TARGET, engine(), [])
    expect(asking.state).toBe('asking')
    expect(ask(IDLE, TARGET, null, []).state).toBe('confirming')
    const out = sending('4')
    expect(out).toMatchObject({ state: 'sending', target: { version: '4' }, answers: { note: 'closed' } })
    expect(runWork(out)).toBe('running')
    expect(close(out)).toBe(out)
  })

  // The action asked again while its dialog asks keeps that dialog, and
  // what was typed into it, as a new state the keyboard goes to; and a run
  // out asked again is that run, never a second question that would drop
  // it (watched failing with a dialog asked again built anew: "expected {
  // schema: [Function schema], …(27) } to be { schema: [Function schema],
  // …(27) } // Object.is equality"). Another action asks its own.
  test('asked again, its dialog keeps what was typed and a run out stays out, each focused again', () => {
    const dialog = engine()
    const asking = ask(IDLE, TARGET, dialog, [])
    const reasked = ask(asking, TARGET, engine(), [])
    expect(reasked).toMatchObject({ state: 'asking', n: 2 })
    expect(reasked.state === 'asking' ? reasked.dialog : null).toBe(dialog)
    const other: RunTarget = { ...TARGET, action: { ...CLOSE, name: 'reopen' }, label: 'Reopen the order' }
    expect(ask(asking, other, null, [])).toMatchObject({ state: 'confirming', target: { label: 'Reopen the order' } })
    const out = sending()
    expect(ask(out, other, null, [])).toMatchObject({ state: 'sending', target: { label: 'Close the order' }, n: out.state === 'idle' ? 0 : out.n + 1 })
  })

  // The forms the confirmation listed go with the run out: they are what
  // the person agreed to drop when the record is read again after it, and
  // the read asks about no other (leave.ts); a run again was confirmed by
  // nobody, so it carries none (watched failing with the run out carrying
  // nothing: "expected { state: 'sending', …(5) } to match object { state:
  // 'sending', …(1) }"). A press of Run it again once the run is out is
  // nothing: no second run, which action-flow.ts sends only from the check.
  test('the run out carries what its confirmation listed, a run again none, and Run it again on a run out is nothing', () => {
    const listed: PaneWork[] = [{ owner: 'master', renderer: 'react', name: ['Order ', { code: 'k1:7' }], work: 'changed' }]
    const confirming = answered(ask(IDLE, TARGET, engine(), listed), { note: 'closed' }, listed)
    expect(send(confirming, '3')).toMatchObject({ state: 'sending', discards: listed })
    const unknown = answer(send(confirming, '3'), LOST, 'Done.').next
    const unchanged = checked(unknown, { ok: true, value: { record: 'k1:7', version: '3', answers: {} } })
    const out = again(unchanged)
    expect(out).toMatchObject({ state: 'sending', discards: [] })
    expect(again(out)).toBe(out)
  })

  // A refusal by a dialog field goes back to the dialog with the field's
  // sentence, the answers kept in its engine, rather than ending the run as
  // "Not run" with a sentence that names no field (watched failing with
  // every refusal answered as refused: the state was "refused").
  test('a refusal by a dialog field asks the dialog again with its problem; another refusal is Not run', () => {
    const invalid: ActionOutcome = {
      ok: false,
      status: 422,
      code: 'invalid-values',
      message: 'Some answers cannot be used.',
      fieldErrors: [{ field: 'note', code: 'too-long', message: 'Too long.' }],
    }
    expect(answer(sending(), invalid, 'Done.')).toMatchObject({ next: { state: 'asking' }, done: false, problems: { note: ['Too long.'] } })
    expect(answer(sending('3', null), invalid, 'Done.').next.state).toBe('refused')
    const stale: ActionOutcome = { ok: false, status: 409, code: 'stale', message: 'The record changed since it was read.' }
    expect(answer(sending(), stale, 'Done.').next).toMatchObject({ state: 'refused', stale: true, declined: false })
    const declined: ActionOutcome = { ok: false, status: 422, code: 'declined', message: 'This order cannot be closed now.' }
    expect(answer(sending(), declined, 'Done.').next).toMatchObject({ state: 'refused', stale: false, declined: true })
    expect(answer(sending(), { ok: true, value: { records: ['k1:7'] } }, 'The order is closed.')).toMatchObject({
      next: { state: 'done', said: 'The order is closed.' },
      done: true,
    })
  })

  // A lost run is the record's work until it is checked; a check that finds
  // the record at the version sent offers Run it again, which sends that
  // version and never one read since; one that finds it moved does not.
  test('a lost run is checked by its record, and run again only from the version it sent', () => {
    const unknown = answer(sending('3'), LOST, 'Done.').next
    expect(runWork(unknown)).toBe('run-unknown')
    const at = (version: string): Run => checked({ ...unknown, checking: true } as Run, { ok: true, value: { record: 'k1:7', version, answers: {} } })
    expect(at('3')).toMatchObject({ state: 'checked', found: { kind: 'unchanged' } })
    expect(again(at('3'))).toMatchObject({ state: 'sending', target: { version: '3' }, answers: { note: 'closed' } })
    const moved = at('4')
    expect(moved).toMatchObject({ found: { kind: 'changed' } })
    expect(again(moved)).toBe(moved)
    const gone = checked(unknown, { ok: false, status: 404, code: 'not-found', message: 'No such record.' })
    expect(gone).toMatchObject({ found: { kind: 'absent' } })
    const unread = checked(unknown, { ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached.' })
    expect(unread).toMatchObject({ found: { kind: 'unread' } })
    expect(runWork(unread)).toBe('run-unknown')
    expect(checkedText({ kind: 'unread', message: 'The database cannot be reached.' })).toBe('The database cannot be reached. Whether it ran is still unknown.')
  })

  // A text the form serves is itself, or the message it names in the
  // form's catalogue, so a translated label is not shown as its id.
  test('says a served text as itself, or as the message it names', () => {
    const form = { i18n: { defaultLocale: 'de', messages: { de: { 'close.label': 'Bestellung schliessen' } } } }
    expect(words(form, 'Close the order')).toBe('Close the order')
    expect(words(form, { $t: 'close.label' })).toBe('Bestellung schliessen')
    expect(words(form, null)).toBeNull()
  })
})
