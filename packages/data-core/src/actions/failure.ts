import type { RecordFailure } from '../records/types.js'
import type { ActionFailure } from './types.js'

/**
 * A record failure as a run's (0160): what both adapters answer a run with
 * when a statement of it fails as a write's would, so the two cannot read
 * one refusal two ways. The codes the action port has keep their meaning;
 * a constraint's or a value's -- a unique key, a check, a column too short
 * -- is `refused`: a run writes nothing of its own but the version, so such
 * a refusal is the deployment's, raised through what its routine or a
 * trigger did, and the same run would be refused again. `declined` keeps
 * the deployment's reason and the column it names, for the person alone
 * (0156).
 */
export function runFailure(failure: RecordFailure): ActionFailure {
  switch (failure.code) {
    case 'not-found':
    case 'stale':
    case 'version-ended':
    case 'schema-changed':
    case 'permission-denied':
    case 'refused':
    case 'unavailable':
    case 'unknown-outcome':
      return { ok: false, code: failure.code, message: failure.message }
    case 'declined':
      return {
        ok: false,
        code: 'declined',
        message: failure.message,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
        ...(failure.column === undefined ? {} : { column: failure.column }),
      }
    case 'chain-exists':
    case 'unique-violation':
    case 'foreign-key-violation':
    case 'not-null-violation':
    case 'check-violation':
    case 'too-long':
    case 'out-of-range':
      return { ok: false, code: 'refused', message: `${failure.message} The run was rolled back (${failure.code}).` }
  }
}

/** The codes about a record rather than the run, in the order one names a run that met several: gone or out of reach first, then ended, then changed. */
const ABOUT_A_RECORD = ['not-found', 'version-ended', 'stale'] as const

/** What a run is answered with when a read after told none of its unmoved records apart: never done, and nothing kept. */
const UNTOLD: ActionFailure = {
  ok: false,
  code: 'refused',
  message: 'The run locked fewer records than it addressed, and the read after it told none of them apart; it was rolled back.',
}

/**
 * A run that locked fewer records than it addressed (0165), rolled back
 * and nothing called, from what a read after the rollback told of each:
 * `explained[i]` for the record at position `i` of the request, `undefined`
 * for one the run had locked. Both adapters ask this, so a selection that
 * met two refusals is answered one way on both engines.
 *
 * A refusal about the run -- the table moved, the read itself refused, a
 * write the database declined -- is the answer as `runFailure` maps it,
 * the first in the request's order. Otherwise the records' own: `not-found`
 * where any is, then `version-ended`, then `stale`, naming every record
 * with that code by its position, so a page knows which to read again.
 */
export function unmovedFailure(explained: ReadonlyArray<RecordFailure | undefined>): ActionFailure {
  const about = (code: string): code is (typeof ABOUT_A_RECORD)[number] => (ABOUT_A_RECORD as readonly string[]).includes(code)
  const run = explained.find((failure) => failure !== undefined && !about(failure.code))
  if (run !== undefined) return runFailure(run)
  for (const code of ABOUT_A_RECORD) {
    const records = explained.flatMap((failure, index) => (failure?.code === code ? [index] : []))
    const first = explained[records[0] ?? -1]
    if (first === undefined) continue
    const counted = explained.length === 1 ? '' : ` (${String(records.length)} of the ${String(explained.length)} records addressed; the run was rolled back)`
    return { ok: false, code, message: `${first.message}${counted}`, records }
  }
  return UNTOLD
}
