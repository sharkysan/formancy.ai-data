import type { CheckMeta } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import type { Found, ObjectGap } from './catalog.js'
import { byObjectId, groupBy, queryScope } from './catalog.js'

interface CheckRow {
  object_id: number
  name: string
  definition: string | null
  is_disabled: boolean
  is_not_trusted: boolean
}

/**
 * Check constraints, with the expression as SQL Server stored it -- which is
 * not as it was written: `status in ('draft', 'placed', 'shipped')` comes back
 * as `([status]='shipped' OR [status]='placed' OR [status]='draft')`.
 *
 * `enforced` is not `is_disabled`: ALTER TABLE … NOCHECK CONSTRAINT stops the
 * check for new rows. `validated` is not `is_not_trusted`, which WITH NOCHECK
 * sets and which disabling sets too, so a disabled check is never validated;
 * a WITH NOCHECK one is enforced and not validated, and only `is_disabled`
 * tells the two apart (0026). `is_not_for_replication` is not read: it exempts
 * a replication agent's writes, which are not a form's.
 */
const SQL = (scoped: string): string => `
  select cc.parent_object_id as object_id, cc.name, cc.definition, cc.is_disabled, cc.is_not_trusted
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
        return { name: row.name, expression: row.definition, enforced: !row.is_disabled, validated: !row.is_not_trusted }
      }),
    )
  }
  return { byObject, gaps }
}
