import { describe, expect, test } from 'vitest'
import { READER_ACCESS, WRITER_ACCESS } from './access.js'
import { CASCADE_PARITY } from './cascades.js'
import type { CascadeCase } from './cascades.js'
import {
  cascadeCase,
  covers,
  deleteCase,
  displayCase,
  driftingCase,
  edgeCase,
  exportCase,
  filterCase,
  listCase,
  MODEL_CASES,
  refusalCase,
  sharedCases,
  shipmentCase,
  temporalCase,
  THROUGH_CASES,
  throughCase,
  UPDATE_RECREATED_CASE,
  uuidCase,
} from './cases.js'
import { DELETE_PARITY, UPDATE_RECREATED } from './deletes.js'
import type { DeleteCase } from './deletes.js'
import { sharedDrifting } from './drifting.js'
import { EXPORT_PARITY } from './exports.js'
import type { ExportCase } from './exports.js'
import * as fixtures from './index.js'
import { LIST_PARITY } from './lists.js'
import type { ListCase } from './lists.js'
import { FIXTURE_MODEL } from './model.js'
import { DISPLAY_PARITY, FILTER_PARITY, REFUSAL_PARITY, TEMPORAL_PARITY } from './parity.js'
import type { RefusalParityCase } from './parity.js'
import { UUID_PARITY } from './uuid.js'
import type { UuidCase } from './uuid.js'
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
  LIST_PARITY: (Object.keys(LIST_PARITY) as ListCase[]).map(listCase),
  DELETE_PARITY: (Object.keys(DELETE_PARITY) as DeleteCase[]).map(deleteCase),
  UPDATE_RECREATED: [UPDATE_RECREATED_CASE],
  CASCADE_PARITY: (Object.keys(CASCADE_PARITY) as CascadeCase[]).map(cascadeCase),
  UUID_PARITY: (Object.keys(UUID_PARITY) as UuidCase[]).map(uuidCase),
  EXPORT_PARITY: (Object.keys(EXPORT_PARITY) as ExportCase[]).map(exportCase),
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
  MATRIX_IMAGES: 'the images the adapter suites run on, a CI leg each (0067), which the report holds the run to',
  IMAGES_VARIABLE: 'the variable a run is told its images by',
  VERSION_FACTS: 'what the versions of one engine disagree on, each asserted on every leg by the test it names (0067)',
  FIXTURE_SCOPE: 'a discovery scope',
  PARITY_SCOPE: 'a discovery scope',
  MODEL_CASES: 'the ids themselves',
  UPDATE_RECREATED_CASE: "the id of UPDATE_RECREATED's case",
  SIZED_CUSTOMERS: "what the sized table is generated from (0034); what a lookup on it reads is sizedRowsRead()'s, a function",
  FIXTURE_CUSTOMERS: "the fixture's own customers, which the sized table holds beside the generated ones",
  SIZED_CHUNK_ROWS: 'how many rows one statement of the sized load carries',
  LIST_ROWS: "the rows the list suites insert; what a list shows of them is LIST_PARITY's",
  UUID_ROWS: "the rows the uuid suites insert; what the suites show of them is UUID_PARITY's",
  EXPORT_ROWS: "the customers the server's export suite inserts, each with the cell a file writes for its name; a file's text is data-core's, the same on both engines once EXPORT_PARITY's values are",
  DELIVERIES: "the fixture's delivery keys, which UUID_PARITY's cases name",
  PARITY_CASCADES: "the keys CASCADE_PARITY's policy names; what a delete does through them is CASCADE_PARITY's",
  REACH_PRIVILEGE_LOSSES: "the grants reach-privilege takes away, each on both engines; what a delete answers then is CASCADE_PARITY's",
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

/**
 * This file declares shared cases to test covers() itself, and holds none:
 * it starts no database. So each test that read a declaration takes it back
 * once read, and the report, which reads a test's meta, counts none of them
 * -- on main before 0067 it counted three cases as held by a unit test, and
 * 0067's rule that a declaration needs a server its leg recorded refused
 * them in CI (run 38945745676).
 */
function takeBack(task: { meta: { engine?: unknown; covers?: unknown } }): void {
  delete task.meta.engine
  delete task.meta.covers
}

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
    test('refuses a declaration inside it', ({ task }) => {
      expect(nested).toMatch(/already declares edge: orderDate, shipment: first/)
      takeBack(task)
    })

    // What the report reads is the test's meta, through the JSON reporter's
    // filter; a suite's declaration must reach the tests inside it.
    test('gives each test inside it the engine and the cases', ({ task }) => {
      expect(task.meta).toMatchObject({ engine: 'postgres', covers: [edgeCase('orderDate'), shipmentCase('first')] })
      takeBack(task)
    })
  })

  // A test's own declaration is its own meta.
  test('declared on a test, is that test’s meta', covers('sqlserver', refusalCase('deadlockVictim')), ({ task }) => {
    expect(task.meta).toMatchObject({ engine: 'sqlserver', covers: [refusalCase('deadlockVictim')] })
    takeBack(task)
  })
})
