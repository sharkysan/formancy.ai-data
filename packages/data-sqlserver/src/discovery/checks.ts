import type { CheckMeta } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import type { Found, ObjectGap } from './catalog.js'
import { byObjectId, groupBy, queryScope } from './catalog.js'

interface CheckRow {
  object_id: number
  name: string
  definition: string | null
  is_not_trusted: boolean
}

/**
 * Check constraints, with the expression as SQL Server stored it -- which is
 * not as it was written: `status in ('draft', 'placed', 'shipped')` comes back
 * as `([status]='shipped' OR [status]='placed' OR [status]='draft')`.
 *
 * A disabled check is reported `validated: false`, because SQL Server marks it
 * untrusted. The contract has no `enforced` for checks, so a disabled one and
 * a WITH NOCHECK one read the same; 0007 says so.
 */
const SQL = (scoped: string): string => `
  select cc.parent_object_id as object_id, cc.name, cc.definition, cc.is_not_trusted
  from sys.check_constraints cc
  where cc.parent_object_id in ${scoped}`

export async function readChecks(pool: ConnectionPool, schemas: readonly string[]): Promise<Found<CheckMeta[]>> {
  const rows = await queryScope<CheckRow>(pool, schemas, SQL)
  const gaps: ObjectGap[] = []
  const byObject = new Map<number, CheckMeta[]>()
  for (const [objectId, group] of groupBy(rows, byObjectId)) {
    byObject.set(
      objectId,
      group.map((row) => {
        // A check always has an expression. NULL is SQL Server declining to
        // show it to an account without VIEW DEFINITION.
        if (row.definition === null) {
          gaps.push({ objectId, aspect: 'checks', detail: `${row.name}: the expression is hidden without VIEW DEFINITION` })
        }
        return { name: row.name, expression: row.definition, validated: !row.is_not_trusted }
      }),
    )
  }
  return { byObject, gaps }
}
