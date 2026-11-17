import { createSnapshot } from '@formancy/data-core'
import type { ColumnMeta, MetadataSnapshot } from '@formancy/data-core'
import { SQLSERVER_SNAPSHOT } from './test-server.js'

/** The connection a suite adds to the plane for `TOGETHER_SNAPSHOT`, before signing in, so the Connect step lists it. */
export const TOGETHER_CONNECTION = 'fixture-together'

/** How many columns `TOGETHER_SNAPSHOT` adds to a line: enough that one change of a line binds more than 2,100 parameters over 49 lines (0155). */
export const EXTRA_LINE_COLUMNS = 45

/**
 * SQL Server's owner, with what a form whose rows are saved with their
 * record is refused over (0155), each made here because the captured
 * fixture has none of it: `sales.delivery` under row-level security, which
 * would hide rows from every count; `sales.order_line` with
 * `EXTRA_LINE_COLUMNS` more decimals, so that one change of a line binds
 * more parameters than one batch holds at the cap; and
 * `sales.employee.manager_id` NOT NULL, a key onto its own table that
 * nothing else stops being saved with its record. Made the one way a
 * snapshot is made, as `SECTIONS_SNAPSHOT` is.
 */
export const TOGETHER_SNAPSHOT: MetadataSnapshot = (() => {
  const { fingerprint: _fingerprint, ...contents } = SQLSERVER_SNAPSHOT
  const objects = structuredClone(contents.objects)
  const table = (name: string) => {
    const found = objects.find((object) => object.ref.schema === 'sales' && object.ref.name === name)
    if (found === undefined) throw new Error(`the SQL Server snapshot has no sales.${name}`)
    return found
  }
  table('delivery').rowSecurity = 'applies'
  const lines = table('order_line')
  const price = lines.columns.find((column) => column.name === 'unit_price') as ColumnMeta
  for (let index = 1; index <= EXTRA_LINE_COLUMNS; index += 1) {
    lines.columns.push({ ...structuredClone(price), name: `extra_${String(index)}`, ordinal: lines.columns.length + 1, nullable: true })
  }
  const manager = table('employee').columns.find((column) => column.name === 'manager_id') as ColumnMeta
  manager.nullable = false
  return createSnapshot({ ...contents, objects })
})()
