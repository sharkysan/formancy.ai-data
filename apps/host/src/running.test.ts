import { describe, expect, test } from 'vitest'
import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { ActionOutcome, FormAction, UnknownAction } from '@formancy/data-client'
import type { FormSchema } from '@formancy/spec'
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
  // confirmation; Run it sends the version heard as it is pressed, which a
  // save answered meanwhile may have moved.
  test('asks its dialog, then confirms, then sends the version heard as Run it is pressed', () => {
    const asking = ask(IDLE, TARGET, engine(), [])
    expect(asking.state).toBe('asking')
    expect(ask(IDLE, TARGET, null, []).state).toBe('confirming')
    const out = sending('4')
    expect(out).toMatchObject({ state: 'sending', target: { version: '4' }, answers: { note: 'closed' } })
    expect(runWork(out)).toBe('running')
    expect(close(out)).toBe(out)
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
