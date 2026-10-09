import type { CheckMeta } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'

interface CheckRow {
  oid: number
  name: string
  expression: string
  enforced: boolean
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
 * NOT VALID only skips the rows that were there when a check was added,
 * which is what `convalidated` says and nothing more: such a check is still
 * enforced for every new or changed row. PostgreSQL 18 adds NOT ENFORCED
 * checks, `pg_constraint.conenforced` false, a column 17 does not have. It is
 * read through the row as JSON so that one query runs on both: absent on 17,
 * where every check is enforced, it reads true; on 18 it is the catalog's.
 * Named as a column, the query would fail on 17; not read, an unenforced
 * check on 18 was reported enforced (discovery-pg18.integration.test.ts).
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
      coalesce((pg_catalog.to_jsonb(k) operator(pg_catalog.->>) 'conenforced')::pg_catalog.bool, true) as enforced,
      k.convalidated as validated
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas})
      and k.contype = 'c'`

  const byObject = new Map<number, CheckMeta[]>()
  for (const row of rows) {
    const checks = byObject.get(row.oid) ?? []
    checks.push({ name: row.name, expression: row.expression, enforced: row.enforced, validated: row.validated })
    byObject.set(row.oid, checks)
  }
  return byObject
}
