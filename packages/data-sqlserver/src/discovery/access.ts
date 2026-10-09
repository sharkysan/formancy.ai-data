import type { ColumnAccess } from '@formancy/data-core'

/**
 * The object a column belongs to, as HAS_PERMS_BY_NAME must be given it:
 * QUOTENAME'd, schema and name each. The function PARSES the name, so a raw
 * `it's [odd]` answers NULL (measured, B7), and a name that parses as a
 * different object would answer for that one.
 */
const OBJECT = `quotename(object_schema_name(c.object_id)) + N'.' + quotename(object_name(c.object_id))`

/**
 * What the account may do with each column, as the server's own privilege
 * check answers it (0027): spliced into the columns query, so every column
 * the list holds has an answer -- never a column without one, which
 * `createSnapshot` would refuse as taken before 0027. That is all one read
 * buys. HAS_PERMS_BY_NAME looks the column up by name when it runs, and a
 * name that does not exist answers 0, not NULL: a concurrent rename can
 * therefore report a granted column as not granted (measured in review on
 * mssql/server:2022-latest, 2026-10-09: 4 wrong of 394 checks run against
 * 400 sp_rename round trips). That fails closed -- the
 * form leaves out or does not write a column it could have -- and drift
 * review sees the column's access come back at the next snapshot.
 *
 * SELECT and UPDATE are asked per column, because SQL Server grants and
 * denies both per column, and HAS_PERMS_BY_NAME applies the precedence the
 * server applies: a column DENY under a table GRANT is a no, a column GRANT
 * under a table DENY a yes, and a later table GRANT removes an earlier column
 * DENY (each measured against a real read, B8). INSERT is asked of the object:
 * the server refuses a column list on an INSERT grant or deny (1020), so every
 * column of an object the account may insert into is insertable.
 *
 * The column is QUOTENAME'd too. HAS_PERMS_BY_NAME parses the sub-securable
 * as an identifier: `group` happens to answer either way, `it's [odd]` raw is
 * NULL and quoted is the right answer (B7). A misparse is not always NULL --
 * a column that does not exist answers 0 -- so quoting is the defence, and
 * the NULL check below catches only the misparse that shows.
 */
export const ACCESS_COLUMNS = `${OBJECT} as access_object,
    has_perms_by_name(${OBJECT}, N'OBJECT', N'SELECT', quotename(c.name), N'COLUMN') as can_select,
    has_perms_by_name(${OBJECT}, N'OBJECT', N'INSERT') as can_insert,
    has_perms_by_name(${OBJECT}, N'OBJECT', N'UPDATE', quotename(c.name), N'COLUMN') as can_update`

export interface AccessRow {
  /** The securable name the checks were given, for an error that has to name it. */
  access_object: string | null
  name: string
  can_select: number | null
  can_insert: number | null
  can_update: number | null
}

function held(row: AccessRow, capability: keyof ColumnAccess, answer: number | null): boolean {
  // NULL is HAS_PERMS_BY_NAME saying it could not resolve what it was asked
  // about. Read as "no", it would be a privilege the snapshot denies for a
  // reason nobody can see; this adapter quotes every name, so a NULL is a
  // defect here, and it says which name.
  if (answer === null) {
    throw new Error(`HAS_PERMS_BY_NAME could not resolve column ${row.name} of ${row.access_object ?? '(unnamed object)'} for ${capability.toUpperCase()}`)
  }
  return answer === 1
}

/** One column's access from the row the columns query returned. */
export function toAccess(row: AccessRow): ColumnAccess {
  return {
    select: held(row, 'select', row.can_select),
    insert: held(row, 'insert', row.can_insert),
    update: held(row, 'update', row.can_update),
  }
}
