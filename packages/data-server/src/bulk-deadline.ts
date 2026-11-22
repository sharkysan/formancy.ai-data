import { lookupDeadlineProblem } from './lookup-deadline.js'

/*
 * How long a request that deletes the chosen records of a page (0173) may
 * go on sending them: `FORMANCY_DATA_BULK_DEADLINE_MS`, read by the
 * composition root (main.ts) and parsed here by the lookup deadline's rule
 * (`lookupDeadlineProblem`), so the rule is one and tested without starting
 * a process; `createDataServer` holds its `runtime.bulkDeadlineMs` to the
 * same rule. One value for the server, as every deadline here is: what it
 * should be depends on the deployment's hardware, data and triggers, not on
 * a form.
 *
 * It is checked before each record, never during one: a record whose
 * delete has started runs to its answer, bounded as a delete alone is, and
 * every record after the deadline is answered not sent. So a request takes
 * at most the deadline and one record more.
 */

export type BulkDeadlineSetting = { ok: true; ms: number } | { ok: false; problem: string }

/**
 * The deadline where the deployment names none: 20 s. Chosen, not
 * measured (0173, 2026-11-22): a request answers within the deadline and
 * one record more, and a record on SQL Server is two statements -- the
 * root's description and the delete -- each bounded by mssql's request
 * timeout of 15 s (`SQLSERVER_REQUEST_TIMEOUT_MS`); 20 s and those 30 s
 * end before nginx's default `proxy_read_timeout` of 60 s, which the
 * composed stack's deploy/web/nginx.conf leaves as it is, so the proxy in
 * front does not cut an answer the server is still writing. On PostgreSQL
 * nothing bounds a statement's wait for a lock, as for a delete alone.
 * What a page of deletes takes is measured by
 * `bulk-sized.integration.test.ts` on the default images, in CI, which
 * holds a page done within this default; its report is where the figure
 * comes from, and this number is set again from it.
 */
export const DEFAULT_BULK_DEADLINE_MS = 20_000

/**
 * `FORMANCY_DATA_BULK_DEADLINE_MS` as written: unset is the default
 * (`DEFAULT_BULK_DEADLINE_MS`); otherwise decimal digits only, no sign,
 * fraction, exponent or space, from 1 to the longest a Node timer holds.
 * The refusal quotes what was written, which is a number of milliseconds
 * and never a secret.
 */
export function bulkDeadlineSetting(text: string | undefined): BulkDeadlineSetting {
  if (text === undefined) return { ok: true, ms: DEFAULT_BULK_DEADLINE_MS }
  const ms = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN
  const problem = lookupDeadlineProblem('FORMANCY_DATA_BULK_DEADLINE_MS', ms, JSON.stringify(text))
  return problem === undefined ? { ok: true, ms } : { ok: false, problem }
}
