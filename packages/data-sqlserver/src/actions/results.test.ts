import { describe, expect, test } from 'vitest'
import { BatchResults, FAILED_COLUMNS, keyColumns } from './results.js'

/*
 * What a run keeps of its batch's result sets as mssql streams them
 * (results.ts, 0160), without a server: the events are the ones mssql emits
 * in stream mode, a `recordset` with each result set's columns and a `row`
 * for each row. That a run over a procedure returning 20,000 rows is
 * answered as any other, and that mssql in query mode would hold them all,
 * is actions.integration.test.ts's, against a real server.
 */

describe("a run's result sets, as they stream", () => {
  const keys = keyColumns([{ name: 'id' }])

  // A procedure's result set is anybody's size, and the batch is answered
  // from its own two alone: a collector that kept every row would hold a
  // procedure's 20,000 for as long as the batch ran, which is what
  // streaming is for. Watched failing with every row kept: "expected 20001
  // to be 1".
  test("drop every row of a procedure's result set, and keep the batch's own", () => {
    const results = new BatchResults(keys)
    results.recordset(['filler'])
    for (let index = 0; index < 20_000; index += 1) results.row({ filler: 'x'.repeat(500) })
    results.recordset(FAILED_COLUMNS)
    results.recordset(keys)
    results.row({ k0: '42' })
    expect(results.held).toBe(1)
    expect(results.dropped).toBe(20_000)
    expect(results.answer()).toEqual({ failed: [], moved: [{ k0: '42' }] })
  })

  // What CATCH recorded is the answer when there is one, whatever came
  // before it. Watched failing with the first result set's rows taken for
  // `@failed`: "expected { failed: [], moved: [] } to deeply equal {
  // failed: [ { step: 4, …(4) } ], …(1) }".
  test("keep what CATCH recorded, after a procedure's rows", () => {
    const results = new BatchResults(keys)
    results.recordset(['echo'])
    results.row({ echo: 'lost' })
    results.recordset(FAILED_COLUMNS)
    const failed = { step: 4, number: 50002, message: 'an error not worded for the person', severity: 16, procedure: 'actions.close_order' }
    results.row(failed)
    results.recordset(keys)
    expect(results.answer()).toEqual({ failed: [failed], moved: [] })
  })

  // A batch that ended without the two it selects last -- cut short by an
  // error CATCH could not catch, or one that ran something else -- says
  // nothing of what it did, and a run never reads a procedure's result set
  // that happens to name the same columns as one of them in their place.
  // Watched failing with the last two taken whatever their columns:
  // "expected { failed: [], moved: [] } to be 'unanswered'".
  test('are unanswered without the batch’s own two last', () => {
    const results = new BatchResults(keys)
    results.recordset(FAILED_COLUMNS)
    results.recordset(['filler'])
    expect(results.answer()).toBe('unanswered')
    const none = new BatchResults(keys)
    expect(none.answer()).toBe('unanswered')
  })
})
