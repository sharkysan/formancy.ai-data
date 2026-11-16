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
