import type { DiscoveryAccount } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'

/**
 * Whose snapshot this is (0027).
 *
 * USER_NAME() is the database principal every permission and every security
 * predicate is evaluated for, and so the one the fingerprint carries.
 * ORIGINAL_LOGIN() is who connected, for a person reading the report: a login
 * mapped to a user of another name reports both (B13), and `sa` -- or any
 * member of sysadmin, or the database's owner -- is `dbo` in the database.
 * ORIGINAL_LOGIN rather than SUSER_SNAME, which an EXECUTE AS would change.
 */
const SQL = 'select user_name() as [user], original_login() as login'

export async function readAccount(pool: ConnectionPool): Promise<DiscoveryAccount> {
  const result = await pool.request().query<{ user: string | null; login: string | null }>(SQL)
  const row = result.recordset[0]
  // A NULL is not reached on a connection with a database context; it is
  // passed on as empty, and createSnapshot refuses an account without a name.
  return { user: row?.user ?? '', login: row?.login ?? '' }
}
