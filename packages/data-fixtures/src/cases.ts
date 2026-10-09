import type { DatabaseKind } from '@formancy/data-core'
import { DATABASE_KINDS } from '@formancy/data-core'
import type { TestOptions } from 'vitest'
import { TestRunner } from 'vitest'
import type { FilterParityCase, RefusalParityCase } from './parity.js'
import { DISPLAY_PARITY, FILTER_PARITY, REFUSAL_PARITY } from './parity.js'
import { EDGE_VALUES } from './values.js'

declare module 'vitest' {
  interface TaskMeta {
    /** The engine a shared case ran on (0035). */
    engine?: DatabaseKind
    /** The shared cases this test asserts through an adapter, by id (0035). */
    covers?: string[]
  }
}

/*
 * The shared cases, by id: every expectation this package writes once for
 * both adapters (0005, 0028), named so a test can say which it asserts and
 * the release report can show each on both engines (0035).
 *
 * The ids are derived from the shared data, so no test types one: a filter
 * case is its column and value, a label its column, a refusal its name, an
 * edge value its name. The adapters' tests title the same case differently
 * on each engine, so a join on titles would match wording; a join on these
 * matches the case.
 */

/** The model's comparators, by what they hold an adapter's snapshot to: FIXTURE_MODEL, READER_ACCESS, WRITER_ACCESS. */
export const MODEL_CASES = {
  owner: 'model: the owner discovers the fixture',
  structure: 'model: a reader of the catalog discovers its structure',
  restricted: 'model: the restricted reader discovers what it may use',
  readerAccess: "access: the reader's privileges",
  writerAccess: "access: the order form's account's privileges",
} as const

export const filterCase = (entry: FilterParityCase): string => `filter: ${entry.column} = ${JSON.stringify(entry.value)}`
export const displayCase = (column: keyof typeof DISPLAY_PARITY): string => `display: ${column}`
export const refusalCase = (name: RefusalParityCase): string => `refusal: ${name}`
export const edgeCase = (name: keyof typeof EDGE_VALUES): string => `edge: ${name}`
export const shipmentCase = (which: 'first' | 'second'): string => `shipment: ${which}`

/**
 * Every case both adapters answer to, in a fixed order: the model's, then
 * every filter, label, refusal and edge value, then the two shipments.
 * Throws on a duplicate id, which would be two cases the report could not
 * tell apart -- two filter entries with one column and value, say.
 */
export function sharedCases(): string[] {
  const ids = [
    ...Object.values(MODEL_CASES),
    ...FILTER_PARITY.map(filterCase),
    ...Object.keys(DISPLAY_PARITY).map(displayCase),
    ...(Object.keys(REFUSAL_PARITY) as RefusalParityCase[]).map(refusalCase),
    ...(Object.keys(EDGE_VALUES) as (keyof typeof EDGE_VALUES)[]).map(edgeCase),
    shipmentCase('first'),
    shipmentCase('second'),
  ]
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`the shared case "${id}" is declared twice, so the report could not tell its two tests apart`)
    seen.add(id)
  }
  return ids
}

/**
 * Test options naming the engine a test runs on and the shared cases it
 * asserts through that engine's adapter: `test(title, covers('postgres',
 * filterCase(entry)), async () => ...)`, or the same on a `describe`, whose
 * tests inherit it.
 *
 * Throws while the file is collected -- which fails the file -- on an id
 * `sharedCases()` lacks, on an engine that is not one, on no case at all,
 * and inside a suite that already declares cases: vitest merges `meta`
 * shallowly, so a nested declaration would replace the outer one rather than
 * add to it, and the outer cases would silently stop being covered.
 *
 * It is the test author's claim. Nothing here shows that the test asserts
 * what it declares; review does (0035).
 */
export function covers(engine: DatabaseKind, ...cases: string[]): TestOptions {
  if (!(DATABASE_KINDS as readonly string[]).includes(engine)) throw new Error(`covers(): ${String(engine)} is not an engine this release speaks`)
  if (cases.length === 0) throw new Error('covers(): name at least one shared case, or leave covers() off')
  const known = new Set(sharedCases())
  const unknown = cases.filter((id) => !known.has(id))
  if (unknown.length > 0) throw new Error(`covers(): ${unknown.map((id) => `"${id}"`).join(', ')} is not a shared case; derive the id from the shared data with filterCase(), displayCase() and the rest`)
  const outer = TestRunner.getCurrentSuite().options?.meta?.covers
  if (outer !== undefined) {
    throw new Error(`covers(): this suite already declares ${outer.join(', ')}; vitest would replace it with ${cases.join(', ')} rather than add to it, so declare every case in one place`)
  }
  return { meta: { engine, covers: [...cases] } }
}
