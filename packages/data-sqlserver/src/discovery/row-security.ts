import type { CoverageGap, RowSecurity } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { queryScope } from './catalog.js'
import type { Visibility } from './visibility.js'
import { unseenDefinitions } from './visibility.js'

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

/** The object_ids in scope that an enabled policy this account can see targets. */
export async function readPolicies(pool: ConnectionPool, schemas: readonly string[]): Promise<ReadonlySet<number>> {
  const policed = await queryScope<{ object_id: number }>(pool, schemas, POLICED_SQL)
  return new Set(policed.map((row) => row.object_id))
}

export interface RowSecurityFound {
  of(objectId: number): RowSecurity
  gaps: CoverageGap[]
}

/**
 * Each object's row security, and the gap that explains an `unknown` (0027).
 *
 * `applies` where a visible enabled policy targets the object. `none` only
 * where it is established that no policy is hidden, by the rule
 * `unseenDefinitions` holds: a denied policy, or a policy in a denied schema,
 * is not listed even under the database grant (B10e, B10f). Anything else is
 * `unknown`, with ONE gap on the scope: a hidden policy can filter any table,
 * so the doubt cannot be placed on an object. The gap is there only when some
 * object is unknown; it explains an answer, and an account that sees nothing
 * gave none.
 */
export function rowSecurityOf(objectIds: Iterable<number>, policed: ReadonlySet<number>, visibility: Visibility): RowSecurityFound {
  const reasons = unseenDefinitions(visibility, 'security policy')
  const established = reasons.length === 0

  const of = (objectId: number): RowSecurity => (policed.has(objectId) ? 'applies' : established ? 'none' : 'unknown')
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
