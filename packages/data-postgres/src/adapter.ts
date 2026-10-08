import type { DatabaseAdapter, ServerIdentity } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { discoverPostgres } from './discovery/discover.js'

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
      await sql.end()
    },
  }
}
