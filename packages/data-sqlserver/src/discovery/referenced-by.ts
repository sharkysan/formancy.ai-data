import type { CoverageGap, InboundKey, ReferentialAction } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import type { Found, ObjectGap } from './catalog.js'
import { byObjectId, groupBy, queryScope } from './catalog.js'
import { action } from './foreign-keys.js'
import type { Visibility } from './visibility.js'
import { unseenDefinitions } from './visibility.js'

interface InboundRow {
  /** The referenced object: a table in scope. */
  object_id: number
  key_id: number
  name: string
  referring_schema: string
  referring_name: string
  is_disabled: boolean
  delete_referential_action: number
  update_referential_action: number
  column_name: string
  referenced_column: string
}

/**
 * Every foreign key the catalog shows that refers to a table in scope, from a
 * table in any schema, one row per column pair in constraint_column_id order
 * (0049). Joined, not LEFT joined: a key is listed to an account exactly when
 * it may see the table the key is on, and then it sees that table's columns,
 * and the referenced table is one in scope; what the account cannot see is
 * the whole key, which the gap below says.
 */
const INBOUND_SQL = (scoped: string): string => `
  select fk.referenced_object_id as object_id, fk.object_id as key_id, fk.name,
    schema_name(po.schema_id) as referring_schema, po.name as referring_name,
    fk.is_disabled, fk.delete_referential_action, fk.update_referential_action,
    pc.name as column_name, rc.name as referenced_column
  from sys.foreign_keys fk
  join sys.objects po on po.object_id = fk.parent_object_id
  join sys.foreign_key_columns fkc on fkc.constraint_object_id = fk.object_id
  join sys.columns pc on pc.object_id = fkc.parent_object_id and pc.column_id = fkc.parent_column_id
  join sys.columns rc on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
  where fk.referenced_object_id in ${scoped}
  order by fk.referenced_object_id, fk.object_id, fkc.constraint_column_id`

function toInbound(rows: readonly InboundRow[]): InboundKey {
  const [first] = rows as [InboundRow, ...InboundRow[]]
  const actionOf = (code: number): ReferentialAction => action(code, first.name)
  return {
    table: { schema: first.referring_schema, name: first.referring_name },
    name: first.name,
    columns: rows.map((row) => row.column_name),
    referencedColumns: rows.map((row) => row.referenced_column),
    onDelete: actionOf(first.delete_referential_action),
    onUpdate: actionOf(first.update_referential_action),
    // As on the referring side (foreign-keys.ts): a disabled key is neither checked nor acted on.
    enforced: !first.is_disabled,
  }
}

interface EdgeRow {
  /** The node table in scope that a clause of the constraint connects. */
  object_id: number
  name: string
  edge_schema: string
  edge_name: string
  delete_action: string
}

/**
 * Every edge constraint that connects a node table in scope, from an edge
 * table in any schema: one row per constraint and node table, whichever end
 * of a clause the node is.
 *
 * An edge constraint is not a foreign key -- sys.foreign_keys does not list
 * it -- yet a delete of a node acts through it. Measured on 16.0.4295.3,
 * 2026-10-11 (`discovery.integration.test.ts`): ON DELETE CASCADE removes
 * the edges that connect the node, from either end, and NO ACTION refuses
 * the delete with 547 while one does. This release describes neither the
 * edge nor its constraint, so each is a `referenced-by` gap on the node.
 * sys.edge_constraints is filtered as sys.foreign_keys is: measured the same
 * day, a constraint on an edge table in another schema is listed under VIEW
 * DEFINITION on the database and not under VIEW DEFINITION on the node's
 * schema alone -- where `referencedByGaps` already gives its scope gap.
 */
const EDGES_SQL = (scoped: string): string => `
  select distinct n.object_id, ec.name, schema_name(e.schema_id) as edge_schema, e.name as edge_name,
    ec.delete_referential_action_desc as delete_action
  from sys.edge_constraints ec
  join sys.edge_constraint_clauses cl on cl.object_id = ec.object_id
  join sys.objects e on e.object_id = ec.parent_object_id
  join sys.objects n on n.object_id in (cl.from_object_id, cl.to_object_id)
  where n.object_id in ${scoped}`

function edgeGap(row: EdgeRow): ObjectGap {
  return {
    objectId: row.object_id,
    aspect: 'referenced-by',
    detail: `edge constraint ${row.name} of ${row.edge_schema}.${row.edge_name} connects this node table, ON DELETE ${row.delete_action}, so a delete of its rows acts on that table's edges or is refused by them; this release lists foreign keys, not edge constraints`,
  }
}

/**
 * Every key the catalog shows that refers to each table in scope, by the
 * referenced table's object_id, and a gap on each node table an edge
 * constraint connects.
 */
export async function readReferencedBy(pool: ConnectionPool, schemas: readonly string[]): Promise<Found<InboundKey[]>> {
  const [rows, edges] = await Promise.all([queryScope<InboundRow>(pool, schemas, INBOUND_SQL), queryScope<EdgeRow>(pool, schemas, EDGES_SQL)])
  const byObject = new Map<number, InboundKey[]>()
  for (const [objectId, group] of groupBy(rows, byObjectId)) byObject.set(objectId, [...groupBy(group, (row) => row.key_id).values()].map(toInbound))
  return { byObject, gaps: edges.map(edgeGap) }
}

/**
 * The gap that says what refers to a table may be short, or none (0049).
 *
 * SQL Server lists a foreign key only to an account that may see the table
 * the key is on, and that table may be in any schema. Measured on
 * 16.0.4295.3, 2026-10-11 (P2), with a key from another schema onto
 * sales.order: the owner and a database VIEW DEFINITION grantee see it; a
 * grantee of VIEW DEFINITION on sales alone, the reader, and a database
 * grantee denied VIEW DEFINITION on the other schema or on its table do
 * not -- the reader sees not even fk_order_line_order. So the lists are
 * complete exactly where row security is established, by the one rule
 * `unseenDefinitions` holds, and otherwise ONE gap on the scope says why: a
 * key the account cannot see may refer to any table in scope. The gap is
 * there only when some object is described, as row security's is: it
 * explains an answer, and an account that sees nothing gave none.
 */
export function referencedByGaps(described: number, visibility: Visibility): CoverageGap[] {
  const reasons = unseenDefinitions(visibility, 'foreign key on a table in any schema')
  if (reasons.length === 0 || described === 0) return []
  return [
    { subject: { kind: 'scope' }, aspect: 'referenced-by', detail: `${reasons.join('; ')}, so a key on a table it cannot see may refer to any table in scope` },
  ]
}
