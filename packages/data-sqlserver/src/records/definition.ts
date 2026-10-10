import { createHash } from 'node:crypto'
import { inSnapshotOrder } from '@formancy/data-core'
import type { DescribedTable } from '@formancy/data-core'
import { DESCRIBED_OBJECT } from '../discovery/catalog.js'
import { COLUMN_DEFINITION, COLUMN_SOURCE, describedColumn } from '../discovery/columns.js'
import type { ColumnDefinitionRow } from '../discovery/columns.js'
import { FOREIGN_KEYS_SQL, foreignKeysOf } from '../discovery/foreign-keys.js'
import type { ForeignKeyRow } from '../discovery/foreign-keys.js'
import { keysOf } from '../discovery/keys.js'
import type { KeyRow } from '../discovery/keys.js'
import { KEYS_SQL } from '../discovery/keys.js'
import { OBJECT_KIND } from '../discovery/objects.js'

/*
 * The root's definition on SQL Server (0041): the facts one statement reads
 * of a table's catalog, as one FOR JSON text, and its SHA-256 by HASHBYTES,
 * which a write's batch checks after its statement, under the statement's
 * locks, and again in CATCH.
 *
 * Every fact is read by discovery's own query for its concern -- the column
 * definition list, the keys, the foreign keys, the object's kind and filter
 * (`discovery/*.ts`) -- scoped to the one object, and becomes metadata
 * through discovery's own row functions, so a fact discovery adds is the
 * definition's too. Measured on mssql/server:2022-latest (the probes before
 * this record, 2026-10-10): with an ORDER BY in every nested FOR JSON the
 * text was byte-stable over 2,250 executions across sessions, accounts and
 * every language, date and ANSI setting tried, and Node's SHA-256 of its
 * UTF-16LE was HASHBYTES' every time. One setting cuts it: under a small
 * TEXTSIZE the text the client receives is cut while HASHBYTES covers it
 * whole, which `describedFrom` refuses as `unavailable`.
 *
 * Nothing here reads a privilege or a comment: a grant to another account,
 * or a description added, is not a new definition.
 */

/**
 * The facts of the object whose quoted name the parameter `table` holds, as
 * one JSON text; NULL when the catalog shows no such object as discovery
 * would describe it.
 */
export function factsOf(table: string): string {
  const scoped = '(o.object_id)'
  return `(select ${OBJECT_KIND} as [kind], o.object_id as [object],
    (select ${COLUMN_DEFINITION} from ${COLUMN_SOURCE} where c.object_id = o.object_id order by c.column_id for json path, include_null_values) as [columns],
    (${KEYS_SQL(scoped)} for json path, include_null_values) as [keys],
    (${FOREIGN_KEYS_SQL(scoped)} for json path, include_null_values) as [foreignKeys]
  from sys.objects o
  where o.object_id = object_id(${table}) and ${DESCRIBED_OBJECT}
  for json path, without_array_wrapper, include_null_values)`
}

/** The SHA-256 of a facts text, as varbinary(32); NULL for NULL. */
export function digestOf(facts: string): string {
  return `hashbytes('SHA2_256', ${facts})`
}

/** A definition this adapter made: a SHA-256 in hex. */
const DEFINITION = /^[0-9a-f]{64}$/

/** The definition's bytes, to bind as varbinary(32); a definition this adapter did not make is a programming error. */
export function definitionBytes(token: string): Buffer {
  if (typeof token !== 'string' || !DEFINITION.test(token)) throw new Error('A write carries the definition this adapter described the table with: a SHA-256 in hex.')
  return Buffer.from(token, 'hex')
}

interface Facts {
  kind: 'table' | 'view'
  columns: ColumnDefinitionRow[] | null
  keys: KeyRow[] | null
  foreignKeys: ForeignKeyRow[] | null
}

/**
 * The description, from the facts text and the digest the same statement
 * computed: `undefined` when there are no facts, `cut` when the text that
 * arrived is not the text that was hashed -- a TEXTSIZE shorter than it.
 */
export function describedFrom(facts: string | null, digest: Buffer | null): DescribedTable | 'cut' | undefined {
  if (facts === null || digest === null) return undefined
  if (!createHash('sha256').update(Buffer.from(facts, 'utf16le')).digest().equals(digest)) return 'cut'
  const parsed = JSON.parse(facts) as Facts
  const keys = keysOf(parsed.keys ?? [])
  return inSnapshotOrder({
    kind: parsed.kind,
    columns: (parsed.columns ?? []).map(describedColumn),
    primaryKey: keys.primaryKey,
    uniqueKeys: keys.uniqueKeys,
    // A target hidden from the account is a gap discovery reports; the description keeps none.
    foreignKeys: foreignKeysOf(parsed.foreignKeys ?? [], []),
    definition: digest.toString('hex'),
  })
}
