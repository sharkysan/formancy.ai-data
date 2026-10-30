import type { DatabaseKind } from '@formancy/data-core'
import { DATABASE_KINDS } from '@formancy/data-core'
import type { TestOptions } from 'vitest'
import { TestRunner } from 'vitest'
import { BROWSE_PARITY } from './browse.js'
import type { BrowseCase } from './browse.js'
import { CASCADE_PARITY } from './cascades.js'
import type { CascadeCase } from './cascades.js'
import { COLUMN_FILTER_PARITY } from './column-filters.js'
import type { ColumnFilterCase } from './column-filters.js'
import { DELETE_PARITY } from './deletes.js'
import type { DeleteCase } from './deletes.js'
import { sharedDrifting } from './drifting.js'
import { EXPORT_PARITY } from './exports.js'
import type { ExportCase } from './exports.js'
import { LIST_PARITY } from './lists.js'
import type { ListCase } from './lists.js'
import type { FilterParityCase, RefusalParityCase } from './parity.js'
import { DISPLAY_PARITY, FILTER_PARITY, REFUSAL_PARITY, TEMPORAL_PARITY } from './parity.js'
import { UUID_PARITY } from './uuid.js'
import type { UuidCase } from './uuid.js'
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
  described: 'model: describe reads each fixture table as discovery does',
} as const

export const filterCase = (entry: FilterParityCase): string => `filter: ${entry.column} = ${JSON.stringify(entry.value)}`
export const displayCase = (column: keyof typeof DISPLAY_PARITY): string => `display: ${column}`
export const temporalCase = (column: keyof typeof TEMPORAL_PARITY): string => `read: ${column}`
export const refusalCase = (name: RefusalParityCase): string => `refusal: ${name}`
export const edgeCase = (name: keyof typeof EDGE_VALUES): string => `edge: ${name}`
export const shipmentCase = (which: 'first' | 'second'): string => `shipment: ${which}`
export const driftingCase = (name: string): string => `drifting: ${name}`

/**
 * What a form scoped through a parent shows on each engine (0043), through
 * the statements that decide it: `read` -- another tenant's parent's row is
 * not found, and this tenant's is; `update` -- it is not found whatever
 * version is sent, and nothing is written, and this tenant's is updated;
 * `self-reference` -- a table scoped through a key onto itself is scoped by
 * the row referenced, never the row read; `composite` -- a key of two
 * columns compares each with the one its foreign key pairs it with;
 * `moved-parent` -- what an update that waited for its row answers when
 * another transaction moved the row's parent out of the scope meanwhile,
 * where the engines differ: PostgreSQL writes it, SQL Server answers
 * not-found, and both answer not-found for a row filter on the row itself.
 */
export const THROUGH_CASES = ['read', 'update', 'self-reference', 'composite', 'moved-parent'] as const
export type ThroughCase = (typeof THROUGH_CASES)[number]
export const throughCase = (name: ThroughCase): string => `through: ${name}`

/** What a list of a form's records shows on each engine (0044), by the name of its entry in LIST_PARITY. */
export const listCase = (name: ListCase): string => `list: ${name}`

/** What a delete of one record does on each engine (0050), by the name of its entry in DELETE_PARITY. */
export const deleteCase = (name: DeleteCase): string => `delete: ${name}`

/** What a delete does past its record on each engine (0051), by the name of its entry in CASCADE_PARITY. */
export const cascadeCase = (name: CascadeCase): string => `cascade: ${name}`

/** An update that lands on a record created again under a deleted one's typed key (0050): characterised on both engines. */
export const UPDATE_RECREATED_CASE = 'update: recreated'

/** What a uuid key does end to end on each engine (0056), by the name of its entry in UUID_PARITY. */
export const uuidCase = (name: UuidCase): string => `uuid: ${name}`

/** What a file of a form's records holds on each engine (0079), by the name of its entry in EXPORT_PARITY. */
export const exportCase = (name: ExportCase): string => `export: ${name}`

/** What a browse of a table or view shows on each engine (0099), by the name of its entry in BROWSE_PARITY. */
export const browseCase = (name: BrowseCase): string => `browse: ${name}`

/** What a person's conditions on a list's or a browse's columns narrow it to on each engine (0104), by the name of its entry in COLUMN_FILTER_PARITY. */
export const columnFilterCase = (name: ColumnFilterCase): string => `column filter: ${name}`

/**
 * Every case both adapters answer to, in a fixed order: the model's, then
 * every filter, label, temporal read, refusal and edge value, then the two
 * shipments, then every change to a form's own table both engines run (0041),
 * then what a form scoped through a parent shows (0043), then what a list of
 * a form's records shows (0044), then what a delete does (0050) and what it
 * does past its record (0051), then what a uuid key does (0056), then what a
 * file of a form's records holds (0079), then what a browse shows (0099),
 * then what a person's conditions on its columns narrow a list to (0104).
 * Throws on a duplicate id, which would be two cases the report could not
 * tell apart -- two filter entries with one column and value, say.
 */
export function sharedCases(): string[] {
  const ids = [
    ...Object.values(MODEL_CASES),
    ...FILTER_PARITY.map(filterCase),
    ...Object.keys(DISPLAY_PARITY).map(displayCase),
    ...(Object.keys(TEMPORAL_PARITY) as (keyof typeof TEMPORAL_PARITY)[]).map(temporalCase),
    ...(Object.keys(REFUSAL_PARITY) as RefusalParityCase[]).map(refusalCase),
    ...(Object.keys(EDGE_VALUES) as (keyof typeof EDGE_VALUES)[]).map(edgeCase),
    shipmentCase('first'),
    shipmentCase('second'),
    ...sharedDrifting().map((entry) => driftingCase(entry.name)),
    ...THROUGH_CASES.map(throughCase),
    ...(Object.keys(LIST_PARITY) as ListCase[]).map(listCase),
    ...(Object.keys(DELETE_PARITY) as DeleteCase[]).map(deleteCase),
    UPDATE_RECREATED_CASE,
    ...(Object.keys(CASCADE_PARITY) as CascadeCase[]).map(cascadeCase),
    ...(Object.keys(UUID_PARITY) as UuidCase[]).map(uuidCase),
    ...(Object.keys(EXPORT_PARITY) as ExportCase[]).map(exportCase),
    ...(Object.keys(BROWSE_PARITY) as BrowseCase[]).map(browseCase),
    ...(Object.keys(COLUMN_FILTER_PARITY) as ColumnFilterCase[]).map(columnFilterCase),
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
  if (unknown.length > 0)
    throw new Error(
      `covers(): ${unknown.map((id) => `"${id}"`).join(', ')} is not a shared case; derive the id from the shared data with filterCase(), displayCase() and the rest`,
    )
  const outer = TestRunner.getCurrentSuite().options?.meta?.covers
  if (outer !== undefined) {
    throw new Error(
      `covers(): this suite already declares ${outer.join(', ')}; vitest would replace it with ${cases.join(', ')} rather than add to it, so declare every case in one place`,
    )
  }
  return { meta: { engine, covers: [...cases] } }
}
