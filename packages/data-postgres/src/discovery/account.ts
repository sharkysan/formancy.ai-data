import type { DiscoveryAccount } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'

/**
 * Whose snapshot this is (0027).
 *
 * `current_user` is the principal the privilege functions and every policy
 * are evaluated for; `session_user` is who logged in. They differ under a
 * session role -- postgres.js `connection: { role }`, or SET ROLE -- and then
 * a policy that compares current_user reads other rows through the same
 * login (B5). Read inside discovery's transaction, so the account is the one
 * every privilege in the snapshot was asked for.
 */
export async function readAccount(sql: TransactionSql): Promise<DiscoveryAccount> {
  const [row] = await sql<DiscoveryAccount[]>`select current_user as "user", session_user as login`
  // Never reached: a SELECT of one row of expressions returns one row. Kept
  // because `row` is `T | undefined` under noUncheckedIndexedAccess.
  if (row === undefined) throw new Error('PostgreSQL answered the account query with no row')
  return row
}
