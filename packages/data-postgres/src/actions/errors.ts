import { runFailure } from '@formancy/data-core'
import type { ActionFailure } from '@formancy/data-core'
import { aroseInside, passing, recordFailure, sqlState } from '../records/errors.js'

/*
 * What PostgreSQL's errors mean for an action's run (0160): classified by
 * where they arose, which a single write's are not (records/errors.ts).
 *
 * - What the transaction did comes first, wherever the error arose: a
 *   statement stopped at the run's deadline (57014) is `action-timeout`,
 *   and what passes -- a deadlock, a serialization failure, a lock not
 *   granted, a connection gone (08, 40, 53, 57, 58, 28, 55P03 …) -- is
 *   `unavailable`. A connection lost after the run was sent is
 *   `unknown-outcome`.
 * - Inside the routine, or a trigger the run fired, everything else is the
 *   deployment's: `declined` under the prefix (0156), `refused` otherwise,
 *   a missing column of the routine's body included -- never
 *   `schema-changed`, since the body is not what the form was published
 *   over (0159), and never thrown.
 * - At the adapter's own statement a code means what it means for a write:
 *   a call that does not resolve (42883, 42725) is `schema-changed`,
 *   EXECUTE or UPDATE refused (42501) `permission-denied`, any other class
 *   42 this adapter's own SQL, thrown.
 *
 * Inside is the engine's own report, the error's context field, which the
 * server fills under a function's error context and leaves empty for the
 * statement sent (`aroseInside`), never a phrase in a message: measured on
 * every image for a PL/pgSQL and a SQL function, and for an error in the
 * statement itself (actions.integration.test.ts).
 */

/** A call that did not resolve: no function of the bound signature (42883), or more than one beside an overload with defaults (42725). */
const UNRESOLVED: ReadonlySet<string> = new Set(['42883', '42725'])

/**
 * The failure for what a statement of the run, or its COMMIT, met. `sent`
 * says whether the lock had been sent, which decides between
 * `unavailable` and `unknown-outcome` for a connection lost: once it has,
 * the run may have reached COMMIT. A programming error is thrown.
 */
export function actionFailure(error: unknown, sent: boolean): ActionFailure {
  const state = sqlState(error)
  if (state === undefined) return runFailure(recordFailure(error, sent ? 'write' : 'read'))
  if (state === '57014')
    return { ok: false, code: 'action-timeout', message: 'PostgreSQL stopped a statement of the run at its deadline (57014); it was rolled back.' }
  if (passing(state)) return { ok: false, code: 'unavailable', message: `PostgreSQL could not complete the run now (${state}); it was rolled back.` }
  if (aroseInside(error)) {
    // A RAISE worded for the person is declined with its reason, as a trigger's on a write is.
    if (state === 'P0001') return runFailure(recordFailure(error, 'write'))
    return {
      ok: false,
      code: 'refused',
      message: `PostgreSQL refused the run with SQLSTATE ${state}, which arose inside the routine or a trigger; it was rolled back.`,
    }
  }
  if (UNRESOLVED.has(state))
    return {
      ok: false,
      code: 'schema-changed',
      message: `The call did not resolve to the bound routine (${state}); nothing was called, and the run was rolled back.`,
    }
  return runFailure(recordFailure(error, 'write'))
}
