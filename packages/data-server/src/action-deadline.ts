/*
 * How long a run of an action may take before the database stops it
 * (0160, 0161): `FORMANCY_DATA_ACTION_DEADLINE_MS`, read by the
 * composition root (main.ts) and parsed here, so the rule is tested
 * without starting a process; `createDataServer` holds its
 * `runtime.actionDeadlineMs` to the same rule. One value for the server,
 * as the lookup and save deadlines are (0061, 0155): what it should be
 * depends on what the deployment's routines do, not on a form.
 *
 * On PostgreSQL it is the statement timeout set before each of a run's
 * statements, to what remains of it; on SQL Server mssql's per-request
 * timeout for the run's one batch, with half of it the lock's own bound
 * (0160). A run that passes it is rolled back on PostgreSQL and may have
 * committed on SQL Server, where it is answered "It may have run".
 */

export type ActionDeadlineSetting = { ok: true; ms: number } | { ok: false; problem: string }

/**
 * The deadline of a run where the deployment names none: 15 s, the
 * deadline every SQL Server write already has from mssql's default
 * request timeout (mssql 12.7.4's lib/base/request.js, read for 0061), so
 * a run waits no longer than a save beside it may. Chosen, not measured:
 * no action of any deployment was timed for it (0161, 2026-11-17).
 */
export const DEFAULT_ACTION_DEADLINE_MS = 15_000

/** The longest a Node timer holds, as the lookup and save deadlines are bounded by. */
const MAX_ACTION_DEADLINE_MS = 2_147_483_647

/** What is wrong with `ms` as an action deadline, said of `name`, or undefined: a whole number of milliseconds from 1 to the longest a Node timer holds. */
export function actionDeadlineProblem(name: string, ms: number, written: string = String(ms)): string | undefined {
  if (Number.isSafeInteger(ms) && ms >= 1 && ms <= MAX_ACTION_DEADLINE_MS) return undefined
  return `${name} is a whole number of milliseconds from 1 to ${String(MAX_ACTION_DEADLINE_MS)}; it is ${written}.`
}

/**
 * `FORMANCY_DATA_ACTION_DEADLINE_MS` as written: unset is the default
 * (`DEFAULT_ACTION_DEADLINE_MS`); otherwise decimal digits only, no sign,
 * fraction, exponent or space. The refusal quotes what was written, which
 * is a number of milliseconds and never a secret.
 */
export function actionDeadlineSetting(text: string | undefined): ActionDeadlineSetting {
  if (text === undefined) return { ok: true, ms: DEFAULT_ACTION_DEADLINE_MS }
  const ms = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN
  const problem = actionDeadlineProblem('FORMANCY_DATA_ACTION_DEADLINE_MS', ms, JSON.stringify(text))
  return problem === undefined ? { ok: true, ms } : { ok: false, problem }
}
