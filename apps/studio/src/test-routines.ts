import { createSnapshot } from '@formancy/data-core'
import type { CoverageGap, MetadataSnapshot, RoutineMeta } from '@formancy/data-core'
import routineFacts from './fixtures/routines.json'

/*
 * The routines the suite's discovery reports when its scope asks for them
 * (0158, 0163), made from `fixtures/routines.json` over the captured
 * snapshots `test-server.ts` reads. The browser gate's
 * `scripts/browser/plane.mjs` makes them the same way in JavaScript, from
 * the same file: that its copy says what this one says is held by review
 * alone.
 */

/** A captured file, by its name, which `fixtures/routines.json` keys what its account's discovery reports of the routines by. */
export type CapturedFile = keyof typeof routineFacts

/**
 * A captured snapshot as its account's discovery reports it when its scope
 * asks for the routines too (0158): the fixture's `ship_order`, and on SQL
 * Server the security policy's predicate, each with whether the account
 * may execute it, and the gap where the account cannot see one. Made here,
 * from `fixtures/routines.json`, never captured: the captures were taken
 * before discovery read routines, and taking them again starts both
 * engines. fixtures.test.ts holds every fact `routineDisagreements` reads
 * -- the comparator both adapters' discovery suites answer to -- to the
 * shared model, and that without its routines each is the captured file
 * to the byte; the type ids, which it does not read, are each engine's
 * own for its built-in types.
 */
export function withRoutines(base: MetadataSnapshot, file: CapturedFile): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const facts = structuredClone(routineFacts[file]) as { routines: RoutineMeta[]; gaps: CoverageGap[] }
  return createSnapshot({ ...contents, scope: { ...contents.scope, routines: true }, routines: facts.routines, gaps: [...contents.gaps, ...facts.gaps] })
}

/** `base` as a discovery whose scope does not ask for routines makes it (0158): no routine, and no gap about them. */
export function withoutRoutines(base: MetadataSnapshot): MetadataSnapshot {
  const { fingerprint: _, routines: _routines, scope, gaps, ...contents } = structuredClone(base)
  const { routines: _asked, ...plain } = scope
  return createSnapshot({ ...contents, scope: plain, gaps: gaps.filter((gap) => gap.aspect !== 'routines') })
}
