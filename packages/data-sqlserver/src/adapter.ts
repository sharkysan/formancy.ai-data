import type { DatabaseAdapter } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { discoverSqlServer } from './discovery/discover.js'
import { readServer } from './server.js'

/**
 * SQL Server, through a pool the composition root connected.
 *
 * The pool rather than a connection string: opening the connection is where a
 * secret is handled, and that happens once, in the composition root, where the
 * secret resolver lives. Nothing in this package reads configuration, and the
 * tests hand it a pool pointed at a container.
 *
 * `ConnectionPool` is in this signature, which is why `@types/mssql` is a
 * dependency of this package and not a devDependency: a consumer type-checking
 * against the published declarations needs it, and `skipLibCheck` would not
 * save them, since the import is in OUR declaration file. The install gate
 * runs with `skipLibCheck` off for exactly this.
 */
export function createSqlServerAdapter(pool: ConnectionPool): DatabaseAdapter {
  return {
    kind: 'sqlserver',

    // What the server is (0068), from the query discovery runs too. A ping
    // refuses nothing: a server discovery cannot read still answers it.
    async ping() {
      return (await readServer(pool)).identity
    },

    discover: (scope) => discoverSqlServer(pool, scope),

    async close(): Promise<void> {
      // A closed pool closes again without complaint, which is what lets a
      // shutdown path and an error path both call this.
      await pool.close()
    },
  }
}
