import type { CheckMeta } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'

interface CheckRow {
  oid: number
  name: string
  expression: string
  validated: boolean
}

/**
 * Check constraints, by the oid of their table.
 *
 * The expression is `pg_get_expr(conbin)`: the expression alone, as the
 * server deparses it. `pg_get_constraintdef` would wrap it in `CHECK (...)`
 * and append ` NOT VALID` to an unvalidated one, which is DDL, not an
 * expression, and would be the first thing a translator tripped on. The
 * expression is readable by every role, so it is never `null` here.
 *
 * On PostgreSQL 17 a NOT NULL is a column property (`attnotnull`), not a
 * pg_constraint row, so none is reported as a check. PostgreSQL 18 adds them
 * as constraints of type `n`, which `contype = 'c'` leaves out.
 */
export async function readChecks(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, CheckMeta[]>> {
  const rows = await sql<CheckRow[]>`
    select
      k.conrelid as oid,
      k.conname as name,
      pg_catalog.pg_get_expr(k.conbin, k.conrelid) as expression,
      k.convalidated as validated
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas})
      and k.contype = 'c'`

  const byObject = new Map<number, CheckMeta[]>()
  for (const row of rows) {
    const checks = byObject.get(row.oid) ?? []
    checks.push({ name: row.name, expression: row.expression, validated: row.validated })
    byObject.set(row.oid, checks)
  }
  return byObject
}
