import { describe, expect, test } from 'vitest'
import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { ActionOutcome, FormAction, UnknownAction } from '@formancy/data-client'
import type { FormSchema } from '@formancy/spec'
import type { PaneWork } from './leave.js'
import { again, answer, answered, ask, checked, checkedText, close, doneText, heading, IDLE, runWork, send, words } from './running.js'
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
const TARGET: RunTarget = { action: CLOSE, label: 'Close the order', noun: 'Order', records: [{ record: 'k1:7', version: '3' }] }
const engine = (): FormEngine => createFormEngine({ schema: DIALOG, formId: 'running-test' })

/** The run out, from its dialog's answers, at `version`. */
function sending(version = '3', dialog: FormEngine | null = engine()): Run {
  const asked = dialog === null ? ask(IDLE, TARGET, null, []) : answered(ask(IDLE, TARGET, dialog, []), { note: 'closed' }, [])
  return send(asked, [{ record: 'k1:7', version }])
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
    expect(out).toMatchObject({ state: 'sending', target: { records: [{ record: 'k1:7', version: '4' }] }, answers: { note: 'closed' } })
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
    expect(send(confirming, [{ record: 'k1:7', version: '3' }])).toMatchObject({ state: 'sending', discards: listed })
    const unknown = answer(send(confirming, [{ record: 'k1:7', version: '3' }]), LOST, 'Done.').next
    const unchanged = checked(unknown, [{ ok: true, value: { record: 'k1:7', version: '3', answers: {} } }])
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
    const at = (version: string): Run => checked({ ...unknown, checking: true } as Run, [{ ok: true, value: { record: 'k1:7', version, answers: {} } }])
    expect(at('3')).toMatchObject({ state: 'checked', found: { kind: 'unchanged' } })
    expect(again(at('3'))).toMatchObject({ state: 'sending', target: { records: [{ record: 'k1:7', version: '3' }] }, answers: { note: 'closed' } })
    const moved = at('4')
    expect(moved).toMatchObject({ found: { kind: 'changed' } })
    expect(again(moved)).toBe(moved)
    const gone = checked(unknown, [{ ok: false, status: 404, code: 'not-found', message: 'No such record.' }])
    expect(gone).toMatchObject({ found: { kind: 'absent' } })
    const unread = checked(unknown, [{ ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached.' }])
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

describe('a run of an action over the records chosen (0166)', () => {
  const CLOSE_ALL: FormAction = { ...CLOSE, name: 'close-all', label: 'Close the chosen orders', scope: 'selection' }
  const CHOSEN: RunTarget = {
    action: CLOSE_ALL,
    label: 'Close the chosen orders',
    noun: 'Order',
    records: [
      { record: 'k1:7', version: '3' },
      { record: 'k1:9', version: '5' },
    ],
  }
  const lost: UnknownAction = { ...LOST, action: 'close-all', records: [...CHOSEN.records] }
  const read = (record: string, version: string) => ({ ok: true as const, value: { record, version, answers: {} } })
  const out = (): Run => send(answered(ask(IDLE, CHOSEN, engine(), []), { note: 'closed' }, []), CHOSEN.records)

  // Its region counts the records rather than naming one, and once it is
  // done says how many it ran over after the administrator's sentence or
  // the page's own (watched failing with the open record's heading for
  // every run: "expected [ …(2) ] to deeply equal [ Array(1) ]").
  test('is headed by how many records it is over, and done says how many it ran over', () => {
    expect(heading(CHOSEN)).toEqual(['Close the chosen orders: 2 records'])
    expect(heading({ ...CHOSEN, records: [{ record: 'k1:7', version: '3' }] })).toEqual(['Close the chosen orders: 1 record'])
    expect(doneText(CHOSEN, 'Done.')).toBe('Done. It ran over 2 records.')
    expect(doneText(TARGET, 'Done.')).toBe('Done.')
  })

  // A refusal about some of the records keeps the ones the server named,
  // which the page names to the person and reads again; a refusal about
  // none names none (watched failing with the refusal's records left
  // unread: "expected { state: 'refused', …(6) } to match object { state:
  // 'refused', stale: true, …(1) }").
  test('refused, keeps the records the server named', () => {
    const stale: ActionOutcome = { ok: false, status: 409, code: 'stale', message: 'The record changed since it was read.', records: ['k1:9'] }
    expect(answer(out(), stale, 'Done.').next).toMatchObject({ state: 'refused', stale: true, named: ['k1:9'] })
    const declined: ActionOutcome = { ok: false, status: 422, code: 'declined', message: 'This order cannot be closed now.' }
    expect(answer(out(), declined, 'Done.').next).toMatchObject({ state: 'refused', named: [] })
  })

  // A lost run over the records chosen is checked by a read of each: every
  // one at the version sent, it has not run, and Run it again sends every
  // version sent; every one moved, it ran or each was changed; some of
  // each, it did not run -- a run moves every record or none -- and it is
  // never run again from there; every one gone, none is there; one read
  // refused, it is still unknown (watched failing with the first record
  // alone read: "expected { state: 'checked', …(5) } to match object {
  // found: { kind: 'mixed' } }").
  test('lost, is checked by a read of each record, and run again only when none moved', () => {
    const unknown = answer(out(), lost, 'Done.').next
    const unchanged = checked(unknown, [read('k1:7', '3'), read('k1:9', '5')])
    expect(unchanged).toMatchObject({ found: { kind: 'unchanged' } })
    expect(again(unchanged)).toMatchObject({ state: 'sending', target: { records: CHOSEN.records } })
    expect(checked(unknown, [read('k1:7', '4'), read('k1:9', '6')])).toMatchObject({ found: { kind: 'changed' } })
    const mixed = checked(unknown, [read('k1:7', '3'), read('k1:9', '6')])
    expect(mixed).toMatchObject({ found: { kind: 'mixed' } })
    expect(again(mixed)).toBe(mixed)
    const absent = { ok: false as const, status: 404, code: 'not-found', message: 'No such record.' }
    expect(checked(unknown, [absent, absent])).toMatchObject({ found: { kind: 'absent' } })
    expect(checked(unknown, [read('k1:7', '3'), absent])).toMatchObject({ found: { kind: 'mixed' } })
    const refused = { ok: false as const, status: 503, code: 'unavailable', message: 'The database cannot be reached.' }
    expect(checked(unknown, [read('k1:7', '3'), refused])).toMatchObject({ found: { kind: 'unread' } })
    expect(checkedText({ kind: 'unchanged' }, true)).toBe('The database shows it has not run: every record is still at the version you read.')
  })
})
