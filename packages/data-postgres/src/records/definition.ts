import { inSnapshotOrder } from '@formancy/data-core'
import type { DescribedTable, ForeignKeyMeta, ObjectRef } from '@formancy/data-core'
import { columnOf, DECLARED_COLUMN, DEFAULT_EXPRESSION, textUnitOf } from '../discovery/columns.js'
import { action, DECLARED_FOREIGN_KEY, TRIGGERS_ENABLED } from '../discovery/foreign-keys.js'
import { addKeyColumn, INDEX_KEY_COLUMN, KEY_CONSTRAINT, UNIQUE_INDEX_KEY } from '../discovery/keys.js'
import type { ObjectKeys } from '../discovery/keys.js'
import { DESCRIBED_RELATION, kindOf } from '../discovery/objects.js'
import { op } from '../sql/catalog.js'
import type { Statement } from '../sql/statement.js'

/*
 * The root's definition on PostgreSQL (0041): what one statement reads of a
 * table's catalog -- the facts -- and the digest of them a write is guarded
 * by.
 *
 * The facts hold only what no session setting changes: oids, typmods, names,
 * flags, and a default's stored node tree (`adbin`), which carries oids and
 * raw constants, never a spelling. The relation's own oid is one of them: no
 * ALTER changes it, a rewrite included, and a table dropped and created again
 * under the same definition has another, as SQL Server's object_id does --
 * without it, attnums, constraint names and defaults all start again alike,
 * and a write decided before the drop was sent to the new table (the
 * `recreated-same-definition` case). Measured on postgres:17-alpine
 * (2026-10-10, the probes before this record): the digest of these facts was
 * the same over thirty sessions under every setting 0016's suites vary, as
 * owner, reader and writer, while `pg_get_expr` respelled date, timestamptz
 * and interval defaults and `format_type` qualified a type by `search_path`.
 * So those spellings travel beside the facts, for the description alone, and
 * are never digested: a setting can change what the verdict reads -- exactly
 * as it changes what drift review reads -- and never whether a guard passes.
 *
 * Every condition that decides which relation, column, key and foreign key
 * counts is discovery's own constant (`discovery/*.ts`), and each row becomes
 * metadata through discovery's own function, so a fact discovery adds or a
 * relation it stops describing is the description's too. Every name is
 * bound, as text: compared with a `name` column, `operator(pg_catalog.=)`
 * resolves to `=(name, text)`, while a parameter cast to `name` is cut to 63
 * bytes and could match another relation (measured, the same probes).
 */

/**
 * The facts of the relation `c` (in namespace `n`), as one jsonb. Each list
 * is ordered by what discovery orders it by, so the parse below reads them
 * in discovery's order.
 */
const FACTS = `pg_catalog.jsonb_build_object(
  'kind', c.relkind,
  'relation', c.oid,
  'columns', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      a.attnum, a.attname, a.atttypid, a.atttypmod, t.typname, tn.nspname, a.attnotnull, a.attidentity, a.attgenerated,
      case when a.attgenerated ${op('=')} '' then d.adbin::pg_catalog.text end
    ) order by a.attnum)
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_type t on t.oid ${op('=')} a.atttypid
    join pg_catalog.pg_namespace tn on tn.oid ${op('=')} t.typnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid ${op('=')} a.attrelid and d.adnum ${op('=')} a.attnum
    where a.attrelid ${op('=')} c.oid and ${DECLARED_COLUMN}
  ), '[]'::pg_catalog.jsonb),
  'keys', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(found.name, found.is_primary, found.columns) order by found.name)
    from (
      select k.conname as name, k.contype ${op('=')} 'p' as is_primary,
        (select pg_catalog.jsonb_agg(a.attname order by key.position)
          from pg_catalog.unnest(k.conkey) with ordinality as key(attnum, position)
          join pg_catalog.pg_attribute a on a.attrelid ${op('=')} k.conrelid and a.attnum ${op('=')} key.attnum) as columns
      from pg_catalog.pg_constraint k
      where k.conrelid ${op('=')} c.oid and ${KEY_CONSTRAINT}
      union all
      select x.relname, false,
        (select pg_catalog.jsonb_agg(a.attname order by key.position)
          from pg_catalog.unnest(i.indkey::pg_catalog.int2[]) with ordinality as key(attnum, position)
          join pg_catalog.pg_attribute a on a.attrelid ${op('=')} i.indrelid and a.attnum ${op('=')} key.attnum
          where ${INDEX_KEY_COLUMN})
      from pg_catalog.pg_index i
      join pg_catalog.pg_class x on x.oid ${op('=')} i.indexrelid
      where i.indrelid ${op('=')} c.oid and ${UNIQUE_INDEX_KEY}
    ) as found
  ), '[]'::pg_catalog.jsonb),
  'foreignKeys', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      k.conname, k.confupdtype, k.confdeltype, k.convalidated, ${TRIGGERS_ENABLED}, tn.nspname, tc.relname,
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, ta.attname) order by pair.position)
        from rows from (pg_catalog.unnest(k.conkey), pg_catalog.unnest(k.confkey)) with ordinality as pair(attnum, target_attnum, position)
        join pg_catalog.pg_attribute a on a.attrelid ${op('=')} k.conrelid and a.attnum ${op('=')} pair.attnum
        join pg_catalog.pg_attribute ta on ta.attrelid ${op('=')} k.confrelid and ta.attnum ${op('=')} pair.target_attnum)
    ) order by k.conname)
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class tc on tc.oid ${op('=')} k.confrelid
    join pg_catalog.pg_namespace tn on tn.oid ${op('=')} tc.relnamespace
    where k.conrelid ${op('=')} c.oid and ${DECLARED_FOREIGN_KEY}
  ), '[]'::pg_catalog.jsonb)
)`

/** What the facts are spelled as for this session, never digested: each column's type and default as discovery spells them. */
const SPELLINGS = `coalesce((
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod), ${DEFAULT_EXPRESSION}) order by a.attnum)
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d on d.adrelid ${op('=')} a.attrelid and d.adnum ${op('=')} a.attnum
  where a.attrelid ${op('=')} c.oid and ${DECLARED_COLUMN}
), '[]'::pg_catalog.jsonb)`

/** The relation `table` names, as discovery would describe it: a scalar subquery of `select`, NULL when there is none. */
function ofRelation(statement: Statement, table: ObjectRef, select: string): string {
  const schema = statement.text(table.schema)
  const name = statement.text(table.name)
  return `(select ${select}
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid ${op('=')} c.relnamespace
  where n.nspname ${op('=')} ${schema} and c.relname ${op('=')} ${name} and ${DESCRIBED_RELATION})`
}

/** The facts of `table`, as text, NULL when discovery would not describe it. */
export function factsOf(statement: Statement, table: ObjectRef): string {
  return `${ofRelation(statement, table, FACTS)}::pg_catalog.text`
}

/** The spellings of `table`'s facts for this session, as text. */
export function spellingsOf(statement: Statement, table: ObjectRef): string {
  return `${ofRelation(statement, table, SPELLINGS)}::pg_catalog.text`
}

/** The SHA-256 of a facts text's UTF-8, in hex, NULL for NULL: what a write is guarded by. */
export function digestOf(facts: string): string {
  return `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${facts}, 'UTF8')), 'hex')`
}

/** The isolation the statement runs under: what the definition says the description was read under. */
export const ISOLATION = `pg_catalog.current_setting('transaction_isolation')`

/** The text unit's source: the database's encoding, fixed when it was created. */
export const ENCODING = `pg_catalog.current_setting('server_encoding')`

/** The one isolation whose statements take their snapshot after the table's lock, without a lock taken first. */
export const READ_COMMITTED = 'read committed'

/**
 * A definition: the digest, and the isolation the description was read
 * under, which chooses how a write decided over it is run. The core passes
 * it through and never reads it.
 */
export interface Definition {
  digest: string
  isolation: string
}

const DEFINITION = /^([0-9a-f]{64})@([a-z ]+)$/

export function definitionToken(definition: Definition): string {
  return `${definition.digest}@${definition.isolation}`
}

/** A definition this adapter made, or a programming error: another adapter's, or one made by hand. */
export function parseDefinition(token: string): Definition {
  const found = typeof token === 'string' ? DEFINITION.exec(token) : null
  if (found === null) throw new Error('A write carries the definition this adapter described the table with: a SHA-256 in hex, "@", and an isolation.')
  return { digest: found[1] as string, isolation: found[2] as string }
}

type ColumnFact = [number, string, unknown, number, string, string, boolean, string, string, string | null]
type KeyFact = [string, boolean, string[]]
type ForeignKeyFact = [string, string, string, boolean, boolean, string, string, Array<[string, string]>]

interface Facts {
  kind: string
  columns: ColumnFact[]
  keys: KeyFact[]
  foreignKeys: ForeignKeyFact[]
}

/**
 * The description, from the facts and their spellings as one statement read
 * them, with discovery's own functions: the columns as `columnOf` makes them
 * from a catalog row, the keys as `addKeyColumn` assembles them, the
 * referential actions through `action`, the kind through `kindOf`. `undefined` when there were no facts:
 * a relation the catalog does not show as discovery would describe it.
 */
export function describedFrom(facts: string | null, spellings: string | null, encoding: string, definition: Definition): DescribedTable | undefined {
  if (facts === null) return undefined
  const parsed = JSON.parse(facts) as Facts
  const spelled = new Map((JSON.parse(spellings ?? '[]') as Array<[number, string, string | null]>).map(([attnum, type, expression]) => [attnum, { type, expression }]))
  const textUnit = textUnitOf(encoding)
  const columns = parsed.columns.map(([attnum, name, _typeOid, modifier, typeName, typeSchema, notNull, identity, generated]) => {
    const spelling = spelled.get(attnum)
    // Both lists are one statement's read of the same pg_attribute rows.
    if (spelling === undefined) throw new Error(`the facts and their spellings disagree about column ${String(attnum)}`)
    return columnOf(
      { name, ordinal: attnum, database_type: spelling.type, type_name: typeName, type_schema: typeSchema, type_modifier: modifier, not_null: notNull, identity, generated, default_expression: spelling.expression },
      textUnit,
    )
  })
  const keys: ObjectKeys = { primaryKey: null, uniqueKeys: [] }
  for (const [name, isPrimary, keyColumns] of parsed.keys) for (const column of keyColumns) addKeyColumn(keys, { name, is_primary: isPrimary, column })
  return inSnapshotOrder<DescribedTable>({
    kind: kindOf(parsed.kind),
    columns,
    primaryKey: keys.primaryKey,
    uniqueKeys: keys.uniqueKeys,
    foreignKeys: parsed.foreignKeys.map(([name, onUpdate, onDelete, validated, enforced, targetSchema, targetName, pairs]): ForeignKeyMeta => ({
      name,
      columns: pairs.map(([column]) => column),
      references: { table: { schema: targetSchema, name: targetName }, columns: pairs.map(([, target]) => target) },
      onUpdate: action(onUpdate, name),
      onDelete: action(onDelete, name),
      enforced,
      validated,
    })),
    definition: definitionToken(definition),
  })
}
