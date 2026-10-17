/*
 * How long an export may take (0079). The file's size budget,
 * `EXPORT_MAX_BYTES`, is data-core's, so the client compiles against it
 * too; the time is the server's alone.
 */

/**
 * How long one export may take, counted from when its request reaches the
 * route, before it is refused `503 export-timeout`. Checked before every
 * page and every resolve of labels, and a resolve's signal aborts at it.
 *
 * Derived, not measured. Nothing of the file leaves before it is whole, so
 * the proxy in front waits all of it for a first byte, and
 * `deploy/web/nginx.conf` sets no `proxy_read_timeout`: nginx's default is
 * 60 s. A list statement takes no signal (0044), so one in flight at the
 * deadline runs on -- on SQL Server to at most mssql's default request
 * timeout, 15 000 ms, so the answer leaves by 45 s, and 30 s keeps 15 s
 * more, a margin chosen 2026-10-17. On PostgreSQL nothing bounds that
 * statement, and a page past 60 s gets the person nginx's 504 while this
 * server makes a file for nobody. `export-limits.test.ts` fails when the
 * deadline and that statement are not below every forwarding location's
 * read timeout in nginx.conf. Not a measurement of what an export of a
 * given size finishes in: nothing has timed one.
 */
export const EXPORT_DEADLINE_MS = 30_000
