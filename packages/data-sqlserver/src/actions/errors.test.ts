import type { ActionRequest } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { batchFailure } from './errors.js'
import type { Failed } from './errors.js'
import { RUN_STEPS } from './statements.js'

/*
 * What a run's batch recorded in CATCH, answered by where it arose
 * (errors.ts, 0160), without a server: what ERROR_PROCEDURE() names for
 * each number at an EXEC is measured against a real one in
 * actions.integration.test.ts ("names the procedure an EXEC does not fit"),
 * and these rows are those measurements as the batch records them. No
 * shared case reaches an EXEC that does not resolve: the guard just before
 * it refuses a procedure that changed, and only one changed between the two
 * statements would.
 */

/** The run's request as `batchFailure` reads it: the bound procedure, and no argument. */
const request = { routine: { ref: { schema: 'actions', name: 'close_order', signature: '' }, arguments: [] } } as unknown as ActionRequest

const failed = (number: number, procedure: string | null, step: number = RUN_STEPS.call): Failed[] => [
  { step, number, message: 'as SQL Server words it', severity: 16, procedure },
]

const answer = (rows: Failed[]): string => {
  const failure = batchFailure(rows, request)
  return failure === 'unmoved' ? failure : failure.code
}

describe('an EXEC that did not resolve to the bound procedure', () => {
  // SQL Server raises a parameter the EXEC lacks, one it does not have, too
  // many and any to a procedure that takes none in the called procedure's
  // own context, so ERROR_PROCEDURE() names it as it names one an error
  // arose inside. Read as inside, a procedure altered between the guard and
  // the EXEC is "the deployment refused" when it is the schema that moved.
  // Watched failing with where the error arose asked first: "expected [
  // 'refused', 'refused', …(2) ] to deeply equal [ 'schema-changed', …(3)
  // ]".
  test('is schema-changed when the procedure called names itself for parameters it does not fit', () => {
    expect([201, 8145, 8144, 8146].map((number) => answer(failed(number, 'actions.close_order')))).toEqual([
      'schema-changed',
      'schema-changed',
      'schema-changed',
      'schema-changed',
    ])
  })

  // An EXEC of no such procedure is the batch's own statement, which
  // ERROR_PROCEDURE() names nothing for. Watched failing with 2812 left out:
  // "expected 'refused' to be 'schema-changed'".
  test('is schema-changed when no procedure of that name is there', () => {
    expect(answer(failed(2812, null))).toBe('schema-changed')
  })

  // The bound procedure calling another badly, or one that is not there,
  // is its body's error, the deployment's: ERROR_PROCEDURE() names the one
  // called badly, or the bound procedure for a 2812 inside it. And none of
  // these numbers outside the EXEC's step is the EXEC's. Watched failing
  // with every one of these numbers read as the EXEC's, whatever the step
  // and whatever ERROR_PROCEDURE() named: "expected [ 'schema-changed',
  // …(2) ] to deeply equal [ 'refused', 'refused', 'refused' ]".
  test('is the procedure’s own refusal when it arose calling another, or outside the EXEC', () => {
    expect([
      answer(failed(201, 'actions.reprice')),
      answer(failed(2812, 'actions.close_order')),
      answer(failed(8145, 'actions.close_order', RUN_STEPS.arguments)),
    ]).toEqual(['refused', 'refused', 'refused'])
  })
})

describe('two keys of a selection the database makes one row', () => {
  // The lock step THROWs its own number with the positions of the records
  // that name the row (0165), and the run is duplicate-record naming them,
  // rolled back before any call: read as any other error of the batch, a
  // person would be told the database refused the run when the selection
  // named one record twice. The same number with any other message is
  // somebody else's -- a procedure may THROW any number -- and never names
  // records. Watched failing on 2026-11-17 with the number read by itself
  // and no message asked: "expected 'duplicate-record' to be 'refused'".
  test('is duplicate-record naming their positions, by the number and the message both', () => {
    const own = batchFailure(
      [{ step: RUN_STEPS.lock, number: 51736, message: 'formancy: two keys of the selection name one row: 0,2', severity: 16, procedure: null }],
      request,
    )
    expect(own).toMatchObject({ ok: false, code: 'duplicate-record', records: [0, 2] })
    const theirs = failed(51736, 'actions.close_order')
    expect(answer(theirs)).toBe('refused')
  })
})
