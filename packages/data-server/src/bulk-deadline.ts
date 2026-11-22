import { lookupDeadlineProblem } from './lookup-deadline.js'

/*
 * How long a request that deletes (0173) or changes (0175) the chosen
 * records of a page may go on sending them -- one setting for both, since
 * each is a page of single writes sent one after another under the same
 * proxy: `FORMANCY_DATA_BULK_DEADLINE_MS`, read by the
 * composition root (main.ts) and parsed here by the lookup deadline's rule
 * (`lookupDeadlineProblem`), so the rule is one and tested without starting
 * a process; `createDataServer` holds its `runtime.bulkDeadlineMs` to the
 * same rule. One value for the server, as every deadline here is: what it
 * should be depends on the deployment's hardware, data and triggers, not on
 * a form.
 *
 * It is counted from when the request's sending starts and checked before
 * each record, never during one: a record whose write has started runs to
 * its answer, bounded as a write alone is, and every record after the
 * deadline is answered not sent. A change's membership checks, once for
 * the request before its first record (0175), are counted in it but run
 * one after another without reading it, each bounded by the lookup
 * deadline alone; checks that outlast it leave every record not sent. So a
 * request takes at most the deadline and one record more, or every check it
 * makes, whichever ends later.
 */

export type BulkDeadlineSetting = { ok: true; ms: number } | { ok: false; problem: string }

/**
 * The deadline where the deployment names none: 14 s, chosen by what
 * bounds it (0173, 2026-11-22): a request answers within the deadline and
 * one record more, or once its checks are done where those end later, and
 * a record on SQL Server is up to three statements --
 * the root's description, the delete, and, where it deleted nothing, the
 * read that says why; a change is three too (0175) -- the read that carries
 * the root's description, the update, and where it changed nothing the read
 * that says why -- each bounded by mssql's request timeout of 15 s
 * (`SQLSERVER_REQUEST_TIMEOUT_MS`); 14 s and those 45 s end before
 * nginx's default `proxy_read_timeout` of 60 s, which the composed stack's
 * deploy/web/nginx.conf leaves as it is, so the proxy in front does not
 * cut an answer the server is still writing. A page cut short by the
 * deadline costs a second request for the records not sent; an answer cut
 * by the proxy, a read of every record. On PostgreSQL nothing bounds a
 * statement's wait for a lock, as for a write alone. A change whose read
 * failed describes the root in a statement of its own before it updates,
 * as an update alone does: four statements, and four of mssql's timeouts
 * reach the proxy's 60 s by themselves, so no deadline holds that record's
 * answer from it (0175 accepts that, for a record whose read has already
 * failed). What a page of deletes and of changes takes is measured by
 * `bulk-sized.integration.test.ts` on the
 * default images, which holds a page done within this default and prints
 * its timings to the data-server test job's log in CI, one line per engine
 * starting `bulk-sized`. Its first run (CI run 45017277480, 2026-11-22)
 * deleted 50 records in at most 1,088 ms on PostgreSQL and 296 ms on SQL
 * Server, so 14 s is left where the proxy bounds it, about thirteen times
 * the slowest page measured, rather than set from those figures.
 */
export const DEFAULT_BULK_DEADLINE_MS = 14_000

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
