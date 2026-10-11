import { describe, expect, test } from 'vitest'
import { READER_ACCESS, WRITER_ACCESS } from './access.js'
import { covers, displayCase, driftingCase, edgeCase, filterCase, MODEL_CASES, refusalCase, sharedCases, shipmentCase, temporalCase, THROUGH_CASES, throughCase } from './cases.js'
import { sharedDrifting } from './drifting.js'
import * as fixtures from './index.js'
import { FIXTURE_MODEL } from './model.js'
import { DISPLAY_PARITY, FILTER_PARITY, REFUSAL_PARITY, TEMPORAL_PARITY } from './parity.js'
import type { RefusalParityCase } from './parity.js'
import { EDGE_VALUES, FIRST_SHIPMENT, SECOND_SHIPMENT } from './values.js'

/**
 * The universe of shared cases and the declaration a test makes with
 * `covers()` (0035). The release report shows every id `sharedCases()`
 * returns on both engines, and fails a run where one is missing or failed;
 * these hold the universe to the shared data and the declaration to the
 * universe.
 */

/**
 * Each table of shared expectations this package exports, and the ids it
 * contributes to `sharedCases()`: the cases are derived from these, so a
 * table that contributed none would be expectations no report shows.
 */
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  FILTER_PARITY: FILTER_PARITY.map(filterCase),
  DISPLAY_PARITY: Object.keys(DISPLAY_PARITY).map(displayCase),
  TEMPORAL_PARITY: (Object.keys(TEMPORAL_PARITY) as (keyof typeof TEMPORAL_PARITY)[]).map(temporalCase),
  REFUSAL_PARITY: (Object.keys(REFUSAL_PARITY) as RefusalParityCase[]).map(refusalCase),
  EDGE_VALUES: (Object.keys(EDGE_VALUES) as (keyof typeof EDGE_VALUES)[]).map(edgeCase),
  FIRST_SHIPMENT: [shipmentCase('first')],
  SECOND_SHIPMENT: [shipmentCase('second')],
  DRIFTING: sharedDrifting().map((entry) => driftingCase(entry.name)),
  THROUGH_CASES: THROUGH_CASES.map(throughCase),
  // The comparators' models, through the cases that hold an adapter to them.
  FIXTURE_MODEL: [MODEL_CASES.owner, MODEL_CASES.structure, MODEL_CASES.restricted, MODEL_CASES.described],
  READER_ACCESS: [MODEL_CASES.readerAccess],
  WRITER_ACCESS: [MODEL_CASES.writerAccess],
}

/** Exports that are not shared expectations, each with why. */
const NOT_CASES: Readonly<Record<string, string>> = {
  READER: 'a principal the fixture creates',
  WRITER: 'a principal the fixture creates',
  SQLSERVER_DATABASE: 'where the SQL Server fixture is loaded',
  POSTGRES_IMAGE: 'an image, which the report lists from the run',
  SQLSERVER_IMAGE: 'an image, which the report lists from the run',
  DEFAULT_IMAGES: 'the images, which the report lists from the run',
  FIXTURE_SCOPE: 'a discovery scope',
  PARITY_SCOPE: 'a discovery scope',
  MODEL_CASES: 'the ids themselves',
  SIZED_CUSTOMERS: "what the sized table is generated from (0034); what a lookup on it reads is sizedRowsRead()'s, a function",
  FIXTURE_CUSTOMERS: "the fixture's own customers, which the sized table holds beside the generated ones",
  SIZED_CHUNK_ROWS: 'how many rows one statement of the sized load carries',
}

/** What a call made while a file is collected gave: its options, or the sentence it threw. */
function attempt(call: () => unknown): unknown {
  try {
    return call()
  } catch (error) {
    return (error as Error).message
  }
}

// Called while this file is collected, as a test file calls covers().
const unknownCase = attempt(() => covers('postgres', 'filter: tenant_code = "nobody"'))
const noCase = attempt(() => covers('sqlserver'))
const noEngine = attempt(() => covers('oracle' as never, edgeCase('orderDate')))
let nested: unknown

describe('the shared cases', () => {
  // A new table of shared expectations exported here without a family would
  // be cases both adapters are held to that no report shows: this forces the
  // decision, a family or a reason it is not one.
  test('every runtime export is a function, a family of shared cases, or not a case for a reason', () => {
    const undecided = Object.entries(fixtures)
      .filter(([name, value]) => typeof value !== 'function' && FAMILIES[name] === undefined && NOT_CASES[name] === undefined)
      .map(([name]) => name)
    expect(undecided).toEqual([])
    // Each family is in the universe, and the comparators' tables are the ones exported.
    const universe = new Set(sharedCases())
    for (const [family, ids] of Object.entries(FAMILIES)) {
      expect(ids.length, family).toBeGreaterThan(0)
      expect(ids.filter((id) => !universe.has(id)), family).toEqual([])
      expect(Object.keys(fixtures), family).toContain(family)
    }
    expect([FIXTURE_MODEL, READER_ACCESS, WRITER_ACCESS, FIRST_SHIPMENT, SECOND_SHIPMENT]).not.toContain(undefined)
  })

  // Two filter entries with one column and value would be two cases with one
  // id, and the report could not say which of them a test asserted.
  test('has no id twice', () => {
    const ids = sharedCases()
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(Object.values(FAMILIES).flat().length)
  })
})

describe('covers()', () => {
  // An id typed by hand that matches no case would be a declaration the
  // report counts for nothing, and an empty one a test that declares and
  // covers nothing: both fail the file while it is collected.
  test('refuses an id no shared case has, no case at all, and an engine that is not one', () => {
    expect(unknownCase).toMatch(/is not a shared case/)
    expect(noCase).toMatch(/name at least one shared case/)
    expect(noEngine).toMatch(/is not an engine/)
  })

  describe('declared on a suite', covers('postgres', edgeCase('orderDate'), shipmentCase('first')), () => {
    nested = attempt(() => covers('sqlserver', edgeCase('largestAmount')))

    // vitest merges meta shallowly: a test inside declaring covers() of its
    // own would replace the suite's cases rather than add to them, and the
    // suite's would silently stop counting.
    test('refuses a declaration inside it', () => {
      expect(nested).toMatch(/already declares edge: orderDate, shipment: first/)
    })

    // What the report reads is the test's meta, through the JSON reporter's
    // filter; a suite's declaration must reach the tests inside it.
    test('gives each test inside it the engine and the cases', ({ task }) => {
      expect(task.meta).toMatchObject({ engine: 'postgres', covers: [edgeCase('orderDate'), shipmentCase('first')] })
    })
  })

  // A test's own declaration is its own meta.
  test('declared on a test, is that test’s meta', covers('sqlserver', refusalCase('deadlockVictim')), ({ task }) => {
    expect(task.meta).toMatchObject({ engine: 'sqlserver', covers: [refusalCase('deadlockVictim')] })
  })
})
