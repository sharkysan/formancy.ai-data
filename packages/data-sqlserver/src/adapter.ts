import type { DatabaseAdapter, ServerIdentity } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'

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

    async ping(): Promise<ServerIdentity> {
      // ProductVersion is the build the server runs ("16.0.4205.1"). @@VERSION
      // adds the edition, the OS and a paragraph of text, which is not a
      // version. Cast, because SERVERPROPERTY returns sql_variant and the
      // driver would hand that back as something other than a string.
      const result = await pool
        .request()
        .query<{ version: string }>("select cast(serverproperty('ProductVersion') as nvarchar(128)) as version")
      const row = result.recordset[0]
      // Never reached against a real server -- a SELECT of one expression
      // returns one row -- and kept because `recordset[0]` is `T | undefined`
      // under noUncheckedIndexedAccess. A non-null assertion would be the same
      // claim without the check, so the coverage report shows this line
      // uncovered and that is the honest reading of it.
      if (row === undefined) throw new Error('SQL Server answered the ping with no row')
      return { kind: 'sqlserver', version: row.version }
    },

    async close(): Promise<void> {
      // A closed pool closes again without complaint, which is what lets a
      // shutdown path and an error path both call this.
      await pool.close()
    },
  }
}
