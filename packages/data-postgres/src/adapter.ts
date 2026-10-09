import type { DatabaseAdapter, ServerIdentity } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { discoverPostgres } from './discovery/discover.js'

/**
 * Seconds close() gives a statement still running before it destroys the
 * connections (0031). postgres.js 3.4.9 keeps a statement that failed with its
 * connection as that connection's current one, and `end()` with no timeout
 * waits for it forever: after one lost answer, a server's shutdown never
 * returned (measured 2026-10-09, still waiting after 15 s in the server's e2e
 * suite and after 10 s in this package's). Five is a choice, not a
 * measurement: half of `docker stop`'s default grace of ten, so a container
 * still exits on its own terms. A statement still running past it is
 * destroyed, and its caller is told CONNECTION_DESTROYED — `unknown-outcome`
 * for a write, never a claim that nothing was written. data-server's shutdown
 * finishes every request before it closes, so there it only ever ends the
 * stuck ones.
 */
const CLOSE_GRACE = 5

/**
 * PostgreSQL, through a driver the composition root connected.
 *
 * The driver rather than a connection string: opening the connection is where a
 * secret is handled, and that happens once, in the composition root, where the
 * secret resolver lives. Nothing in this package reads configuration, and the
 * tests hand it a driver pointed at a container.
 */
export function createPostgresAdapter(sql: Sql): DatabaseAdapter {
  return {
    kind: 'postgres',

    async ping(): Promise<ServerIdentity> {
      // `server_version` is the setting the server reports about itself
      // ("17.6"). `version()` adds the platform and the compiler, which is not
      // a version, and `server_version_num` is an integer a human cannot read.
      const rows = await sql<{ version: string }[]>`select current_setting('server_version') as version`
      const row = rows[0]
      // Never reached against a real server -- a SELECT of one expression
      // returns one row -- and kept because `rows[0]` is `T | undefined` under
      // noUncheckedIndexedAccess. A non-null assertion would be the same claim
      // without the check, so the coverage report shows this line uncovered
      // and that is the honest reading of it.
      if (row === undefined) throw new Error('PostgreSQL answered the ping with no row')
      return { kind: 'postgres', version: row.version }
    },

    discover: (scope) => discoverPostgres(sql, scope),

    async close(): Promise<void> {
      // `end()` resolves at once on a driver that has already ended, which is
      // what lets a shutdown path and an error path both call this.
      await sql.end({ timeout: CLOSE_GRACE })
    },
  }
}
