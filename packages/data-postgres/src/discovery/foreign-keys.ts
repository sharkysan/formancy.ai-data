import type { ForeignKeyMeta, ForeignKeyTarget, ReferentialAction } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { op } from '../sql/catalog.js'

interface ForeignKeyRow {
  oid: number
  name: string
  on_update: string
  on_delete: string
  validated: boolean
  triggers_enabled: boolean
  target_schema: string
  target_name: string
  column: string
  target_column: string
}

/** A key being assembled, whose target is always known on PostgreSQL. */
interface KnownTargetKey extends ForeignKeyMeta {
  references: ForeignKeyTarget
}

/** pg_constraint's `confupdtype` and `confdeltype` codes, which are the same five for both. */
const ACTIONS = new Map<string, ReferentialAction>([
  ['a', 'no-action'],
  ['r', 'restrict'],
  ['c', 'cascade'],
  ['n', 'set-null'],
  ['d', 'set-default'],
])

export function action(code: string, constraint: string): ReferentialAction {
  const found = ACTIONS.get(code)
  // Never reached on PostgreSQL 17, whose catalog has exactly the five codes
  // above. Kept so that a sixth, in some later release, fails discovery with
  // the constraint's name instead of reporting an action nobody declared.
  if (found === undefined) throw new Error(`foreign key ${constraint} has a referential action PostgreSQL code ${JSON.stringify(code)} this adapter does not know`)
  return found
}

/**
 * Foreign keys, by the oid of the referencing table.
 *
 * `conkey` and `confkey` are parallel arrays: the n-th referencing column
 * pairs with the n-th referenced one. They are unnested together, WITH
 * ORDINALITY, so the pairing is the catalog's and not a sort's. The target is
 * whatever the key references -- a primary key, a unique constraint or a
 * unique index -- and its name is always readable: pg_class is not filtered
 * by privilege, so `references` is never `null` on PostgreSQL (0006).
 *
 * `conparentid <> 0` marks a constraint PostgreSQL made itself: a foreign key
 * that references a partitioned table gets one such clone per partition, on
 * the same referencing table, and a partitioned referencing table gives each
 * of its partitions a clone of its own. They are the partitions' plumbing,
 * not keys anyone declared, and reporting them would triple a relationship.
 * They are also where the triggers are, which is why enforcement is read
 * over the declared constraint and every clone descended from it.
 */
/** A foreign key somebody declared, of pg_constraint `k`, not one of the clones PostgreSQL makes for partitions. Shared with the root's definition (0041). */
export const DECLARED_FOREIGN_KEY = `k.contype ${op('=')} 'f' and k.conparentid ${op('=')} 0::pg_catalog.oid`

/**
 * Whether the foreign key `k` is checked in an ordinary session. A trigger
 * fires in an ordinary session when it is enabled for origin (O) or always
 * (A). Disabled (D) or replica-only (R), it does not. The triggers of a
 * partitioned side belong to each partition's clone, and a sub-partition's
 * clone is a clone's clone, so the family is walked down conparentid to the
 * leaves. Shared with the root's definition (0041).
 */
export const TRIGGERS_ENABLED = `not exists (
        with recursive family(oid) as (
          select k.oid
          union all
          select clone.oid
          from pg_catalog.pg_constraint clone
          join family on clone.conparentid ${op('=')} family.oid
        )
        select from pg_catalog.pg_trigger t
        join family on t.tgconstraint ${op('=')} family.oid
        where not (t.tgenabled ${op('=')} any ('{O,A}'::pg_catalog."char"[]))
      )`

export async function readForeignKeys(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, ForeignKeyMeta[]>> {
  const rows = await sql<ForeignKeyRow[]>`
    select
      k.conrelid as oid,
      k.conname as name,
      k.confupdtype as on_update,
      k.confdeltype as on_delete,
      k.convalidated as validated,
      ${sql.unsafe(TRIGGERS_ENABLED)} as triggers_enabled,
      tn.nspname as target_schema,
      tc.relname as target_name,
      a.attname as column,
      ta.attname as target_column
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_class tc on tc.oid = k.confrelid
    join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
    cross join lateral unnest(k.conkey, k.confkey) with ordinality as pair(attnum, target_attnum, position)
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = pair.attnum
    join pg_catalog.pg_attribute ta on ta.attrelid = k.confrelid and ta.attnum = pair.target_attnum
    where n.nspname = any(${schemas})
      and ${sql.unsafe(DECLARED_FOREIGN_KEY)}
    order by k.conrelid, k.conname, pair.position`

  const byObject = new Map<number, KnownTargetKey[]>()
  for (const row of rows) {
    const keys = byObject.get(row.oid) ?? []
    let key = keys.find((candidate) => candidate.name === row.name)
    if (key === undefined) {
      key = {
        name: row.name,
        columns: [],
        references: { table: { schema: row.target_schema, name: row.target_name }, columns: [] },
        onUpdate: action(row.on_update, row.name),
        onDelete: action(row.on_delete, row.name),
        // PostgreSQL 17 has no NOT ENFORCED foreign keys (18 adds them, with
        // pg_constraint.conenforced). On 17 a key stops being checked only
        // when its triggers are disabled -- ALTER TABLE ... DISABLE TRIGGER
        // ALL, as a bulk load does, on the table or on one partition -- and
        // pg_constraint does not change when that happens, so enforcement is
        // read from pg_trigger. A key that one partition, on either side, no
        // longer checks or acts on is not enforced: some writes get past it.
        enforced: row.triggers_enabled,
        validated: row.validated,
      }
      keys.push(key)
    }
    key.columns.push(row.column)
    key.references.columns.push(row.target_column)
    byObject.set(row.oid, keys)
  }
  return byObject
}
