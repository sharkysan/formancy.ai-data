import type { CoverageGap, ObjectMeta, ObjectRef, RowSecurity } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { op } from '../sql/catalog.js'

/** A table or view this snapshot describes, with the oid every other concern is keyed by. */
export interface DescribedObject {
  oid: number
  ref: ObjectRef
  kind: ObjectMeta['kind']
  rowSecurity: RowSecurity
}

export interface ObjectsInScope {
  described: DescribedObject[]
  gaps: CoverageGap[]
}

interface ObjectRow {
  oid: number
  schema: string
  name: string
  relkind: string
  row_security: boolean
}

/**
 * The tables and views in scope, and whether row-level security applies to
 * this account on each.
 *
 * pg_class is readable by every role: unlike information_schema, it lists
 * every relation whatever the account's privileges (0006). Every one is
 * described, the ones this account may not use included, with what it may do
 * column by column (`readAccess`, 0027): "not yours" is then an answer the
 * snapshot gives, not a gap it leaves.
 *
 * `row_security_active` answers for the account, from the table's flags and
 * the role's: true when RLS is enabled and the account is neither a
 * superuser, nor a BYPASSRLS role, nor the owner of a table without FORCE ROW
 * LEVEL SECURITY. It needs no privilege on the table and is established for
 * every relation, so this adapter never reports `unknown`; and setting
 * `row_security = off` does not make it false -- the read then fails instead
 * (B1, B1+). A view has no policies of its own and answers false; what its
 * tables' policies do through it is not followed (0027). Like the privilege
 * functions, it reads live catalog state, not this transaction's snapshot:
 * measured in review on postgres:17-alpine, 2026-10-09, an `alter table …
 * disable row level security` committed by
 * another session mid-transaction makes it answer false while this
 * transaction's own pg_class row still says relrowsecurity (discover.ts).
 *
 * Kinds: `r` a table, `p` a partitioned table, `v` a view, `m` a materialized
 * view, `f` a foreign table. A partition (`relispartition`) is storage for
 * its parent and is described through it. Indexes, sequences and composite
 * types are pg_class rows too, and are not objects.
 */
/**
 * The relations discovery describes, of a relation `c`: tables, partitioned
 * tables, views and materialized views -- and no partition, which is storage
 * for its parent and described through it. The root's definition (0041)
 * describes exactly these, so a relation discovery would not describe is not
 * described there either: a foreign table, a partition.
 */
export const DESCRIBED_RELATION = `c.relkind ${op('=')} any ('{r,p,v,m}'::pg_catalog."char"[]) and not c.relispartition`

/**
 * What a described relation is, by its relkind: a view or a materialized
 * view is a view, a table or a partitioned table a table. One function, so
 * the root's definition (0041) maps its facts to the kind review saw.
 */
export function kindOf(relkind: string): ObjectMeta['kind'] {
  return relkind === 'v' || relkind === 'm' ? 'view' : 'table'
}

/** A foreign table: in scope, and a gap rather than an object. */
const FOREIGN_TABLE = `c.relkind ${op('=')} 'f' and not c.relispartition`

export async function readObjects(sql: TransactionSql, schemas: readonly string[]): Promise<ObjectsInScope> {
  const rows = await sql<ObjectRow[]>`
    select
      c.oid,
      n.nspname as schema,
      c.relname as name,
      c.relkind,
      pg_catalog.row_security_active(c.oid) as row_security
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas})
      and ((${sql.unsafe(DESCRIBED_RELATION)}) or (${sql.unsafe(FOREIGN_TABLE)}))`

  const described: DescribedObject[] = []
  const gaps: CoverageGap[] = []
  for (const row of rows) {
    const ref = { schema: row.schema, name: row.name }
    // Not described is not the same as not reported: "there is no such
    // table" and "this release cannot describe it" stay different answers.
    if (row.relkind === 'f') {
      gaps.push({
        subject: { kind: 'object', object: ref },
        aspect: 'objects',
        detail: 'a foreign table: its rows live on another server, behind a wrapper this release does not describe',
      })
      continue
    }
    described.push({
      oid: row.oid,
      ref,
      kind: kindOf(row.relkind),
      rowSecurity: row.row_security ? 'applies' : 'none',
    })
  }
  return { described, gaps }
}
