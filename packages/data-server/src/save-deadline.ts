import { DEFAULT_SAVE_DEADLINE_MS } from '@formancy/data-core'
import type { DatabaseKind } from '@formancy/data-core'

/*
 * How long a save of a record with its rows may wait for a lock, and after
 * which none of its steps starts (0155): `FORMANCY_DATA_SAVE_DEADLINE_MS`,
 * read by the composition root (main.ts) and parsed here, so the rule is
 * tested without starting a process; `createDataServer` holds its
 * `runtime.saveDeadlineMs` to the same rule. One value for the server, as
 * the lookup deadline is (0061): what it should be depends on the
 * deployment's hardware, data and triggers, not on a form.
 */

export type SaveDeadlineSetting = { ok: true; ms: number } | { ok: false; problem: string }

/**
 * mssql's default request timeout, 15 s, which it hands tedious for every
 * request and which nothing here sets (`data-sqlserver`'s
 * `sql/statement.ts`): the one bound on a SQL Server save's statement that
 * is slow for another reason than a lock, past which the save is
 * `unknown-outcome` rather than rolled back. Taken from mssql's own
 * default, named here because the composition root checks the deadline
 * against it.
 */
export const SQLSERVER_REQUEST_TIMEOUT_MS = 15_000

/** The longest a Node timer holds, as the lookup deadline is bounded by. */
const MAX_SAVE_DEADLINE_MS = 2_147_483_647

/** What is wrong with `ms` as a save deadline, said of `name`, or undefined: a whole number of milliseconds from 1 to the longest a Node timer holds. */
export function saveDeadlineProblem(name: string, ms: number, written: string = String(ms)): string | undefined {
  if (Number.isSafeInteger(ms) && ms >= 1 && ms <= MAX_SAVE_DEADLINE_MS) return undefined
  return `${name} is a whole number of milliseconds from 1 to ${String(MAX_SAVE_DEADLINE_MS)}; it is ${written}.`
}

/**
 * `FORMANCY_DATA_SAVE_DEADLINE_MS` as written: unset is the measured
 * default (`DEFAULT_SAVE_DEADLINE_MS`); otherwise decimal digits only, no
 * sign, fraction, exponent or space. The refusal quotes what was written,
 * which is a number of milliseconds and never a secret.
 */
export function saveDeadlineSetting(text: string | undefined): SaveDeadlineSetting {
  if (text === undefined) return { ok: true, ms: DEFAULT_SAVE_DEADLINE_MS }
  const ms = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN
  const problem = saveDeadlineProblem('FORMANCY_DATA_SAVE_DEADLINE_MS', ms, JSON.stringify(text))
  return problem === undefined ? { ok: true, ms } : { ok: false, problem }
}

/**
 * Why a save deadline of `ms` cannot serve an allowlist whose connections
 * are of `kinds`, or undefined -- the start-up check (0155). A save's step
 * may start just before the deadline and then wait for a lock for as long
 * as the deadline again, so a save can run for nearly twice it before it
 * is rolled back. On SQL Server that has to end before mssql's request
 * timeout: past it the driver gives up on a batch that may still commit,
 * and the save is `unknown-outcome` where the deadline would have rolled it
 * back. So twice the deadline must be below the timeout wherever a SQL
 * Server connection is allowed. PostgreSQL sets no request timeout, and an
 * allowlist without SQL Server is held to nothing here. An engine
 * difference, written down where it is checked.
 */
export function saveDeadlineFit(ms: number, kinds: readonly DatabaseKind[]): string | undefined {
  if (!kinds.includes('sqlserver') || 2 * ms < SQLSERVER_REQUEST_TIMEOUT_MS) return undefined
  return `FORMANCY_DATA_SAVE_DEADLINE_MS is ${String(ms)}, and with a SQL Server connection allowed twice it must be below mssql's request timeout of ${String(SQLSERVER_REQUEST_TIMEOUT_MS)} ms: at most ${String(Math.ceil(SQLSERVER_REQUEST_TIMEOUT_MS / 2) - 1)}.`
}
