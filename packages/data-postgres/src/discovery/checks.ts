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
 * Whether column `a`'s type is a row type: a composite, or a domain over one
 * at any depth, which is what PostgreSQL asks (`type_is_rowtype`) before it
 * reads `col IS NOT NULL` as "every field of col is non-null" rather than
 * "col is not the NULL value". A domain's `typbasetype` is the type it was
 * declared over, which may be another domain, so the chain is walked to its
 * end. An array of a composite is not a row type: IS NOT NULL asks only
 * whether the array is NULL. Measured on 18.6 on 2026-10-17: a NOT NULL took
 * row(null, null) in a column of a composite, of a domain over it and of a
 * domain over that domain, and CHECK (col IS NOT NULL) refused it in each;
 * pg_get_expr spells CHECK (col IS DISTINCT FROM NULL) as
 * `(col IS DISTINCT FROM NULL)` (discovery-pg18.integration.test.ts holds the
 * NOT NULL taking it and the two spellings alike).
 */
const ROW_TYPED = `exists (
        with recursive base(typtype, typbasetype) as (
          select t.typtype, t.typbasetype from pg_catalog.pg_type t where t.oid = a.atttypid
          union all
          select t.typtype, t.typbasetype
          from pg_catalog.pg_type t
          join base on t.oid = base.typbasetype
          where base.typtype = 'd'
        )
        select from base where base.typtype = 'c'
      )`

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
 * On PostgreSQL 15 to 17 a NOT NULL is a column property (`attnotnull`),
 * not a pg_constraint row, so none is reported as a check. PostgreSQL 18
 * files each as a constraint of type `n` too (VERSION_FACTS.notNullConstraints),
 * which is not read as a check once it is validated: such a NOT NULL is the
 * column's (columns.ts), and the shared model's cases hold the checks to the
 * same list on every leg. One added NOT VALID, which only 18 has, has proved
 * nothing of the rows that were already there, and is read as the same rule
 * spelled CHECK (column IS NOT NULL) NOT VALID is on every version (0077):
 * the column nullable (`NOT_NULL`), and a check, not validated, whose
 * expression is the one the server deparses that check to, the column's
 * name quoted as `pg_get_expr` quotes it (`format`'s `%I` is the same
 * `quote_identifier`). A type-`n` row has no `conbin`, so the expression is
 * spelled here; `pg_get_constraintdef` would give DDL, `NOT NULL amount NOT
 * VALID`. Over a row type (`ROW_TYPED`) that check is spelled IS DISTINCT
 * FROM NULL, the rule a NOT NULL keeps there, where IS NOT NULL would refuse
 * a value whose every field is NULL, which the column takes. Its `enforced`
 * is read as a check's is, from `conenforced`
 * (discovery-pg18.integration.test.ts).
 */
export async function readChecks(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, CheckMeta[]>> {
  const rows = await sql<CheckRow[]>`
    select
      k.conrelid as oid,
      k.conname as name,
      case
        when k.contype = 'n' and ${sql.unsafe(ROW_TYPED)} then pg_catalog.format('(%I IS DISTINCT FROM NULL)', a.attname)
        when k.contype = 'n' then pg_catalog.format('(%I IS NOT NULL)', a.attname)
        else pg_catalog.pg_get_expr(k.conbin, k.conrelid)
      end as expression,
      coalesce((pg_catalog.to_jsonb(k) operator(pg_catalog.->>) 'conenforced')::pg_catalog.bool, true) as enforced,
      k.convalidated as validated
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attribute a on k.contype = 'n' and a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where n.nspname = any(${schemas})
      and (k.contype = 'c' or (k.contype = 'n' and not k.convalidated))`

  const byObject = new Map<number, CheckMeta[]>()
  for (const row of rows) {
    const checks = byObject.get(row.oid) ?? []
    checks.push({ name: row.name, expression: row.expression, enforced: row.enforced, validated: row.validated })
    byObject.set(row.oid, checks)
  }
  return byObject
}
