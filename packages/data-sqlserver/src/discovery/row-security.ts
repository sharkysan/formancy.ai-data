import type { CoverageGap, RowSecurity } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { queryScope } from './catalog.js'
import type { Denials } from './visibility.js'

/**
 * The objects in scope an enabled security policy has a predicate on, filter
 * or block. Positive evidence, and it needs nothing more: a policy this
 * account can see that targets a table applies to it, because SQL Server
 * exempts nobody from an enabled policy -- dbo and sysadmin included. A
 * disabled policy filters nothing and is not counted.
 */
const POLICED_SQL = (scoped: string): string => `
  select distinct pr.target_object_id as object_id
  from sys.security_predicates pr
  join sys.security_policies p on p.object_id = pr.object_id
  where p.is_enabled = 1 and pr.target_object_id in ${scoped}`

/**
 * Whether the account may view every definition in the database, which is
 * what lists every security policy to it: a policy lives in a schema of its
 * own and filters a table in any other, so VIEW DEFINITION on the table's
 * schema does not show it (B10b), and VIEW SECURITY DEFINITION shows nothing
 * at all (B10d). The database is QUOTENAME'd: HAS_PERMS_BY_NAME parses it,
 * and in a database named `it's [odd] db` the raw name answers NULL (B9).
 */
const DATABASE_SQL = `select has_perms_by_name(quotename(db_name()), N'DATABASE', N'VIEW DEFINITION') as can_view_definitions`

/** What the catalog shows this account about security policies. */
export interface PolicyFacts {
  /** object_ids in scope that an enabled policy this account can see targets. */
  policed: ReadonlySet<number>
  canViewDatabase: boolean
}

export async function readPolicies(pool: ConnectionPool, schemas: readonly string[]): Promise<PolicyFacts> {
  const [policed, database] = await Promise.all([
    queryScope<{ object_id: number }>(pool, schemas, POLICED_SQL),
    pool.request().query<{ can_view_definitions: number | null }>(DATABASE_SQL),
  ])
  return {
    policed: new Set(policed.map((row) => row.object_id)),
    canViewDatabase: database.recordset[0]?.can_view_definitions === 1,
  }
}

export interface RowSecurityFound {
  of(objectId: number): RowSecurity
  gaps: CoverageGap[]
}

/**
 * Each object's row security, and the gap that explains an `unknown` (0027).
 *
 * `applies` where a visible enabled policy targets the object. `none` only
 * where it is established that no policy is hidden: VIEW DEFINITION on the
 * database, and no VIEW DEFINITION or CONTROL deny on an object or a schema
 * binding the account -- a denied policy, or a policy in a denied schema, is
 * not listed even under the database grant (B10e, B10f). Anything else is
 * `unknown`, with ONE gap on the scope: a hidden policy can filter any table,
 * so the doubt cannot be placed on an object. The gap is there only when some
 * object is unknown; it explains an answer, and an account that sees nothing
 * gave none.
 */
export function rowSecurityOf(objectIds: Iterable<number>, facts: PolicyFacts, denied: Denials): RowSecurityFound {
  const reasons: string[] = []
  if (!facts.canViewDatabase) reasons.push('this account lacks VIEW DEFINITION on the database, which is what lists every security policy')
  if (denied.objects > 0) reasons.push(`this account is denied VIEW DEFINITION or CONTROL on ${String(denied.objects)} object(s)`)
  if (denied.schemas > 0) reasons.push(`this account is denied VIEW DEFINITION or CONTROL on ${String(denied.schemas)} schema(s)`)
  const established = reasons.length === 0

  const of = (objectId: number): RowSecurity => (facts.policed.has(objectId) ? 'applies' : established ? 'none' : 'unknown')
  const gaps: CoverageGap[] = [...objectIds].some((objectId) => of(objectId) === 'unknown')
    ? [
        {
          subject: { kind: 'scope' },
          aspect: 'row-security',
          detail: `${reasons.join('; ')}, so a security policy it cannot see may filter any table or view in scope`,
        },
      ]
    : []
  return { of, gaps }
}
