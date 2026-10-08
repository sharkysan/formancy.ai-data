import type { CoverageGap } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { queryScope } from './catalog.js'

interface SchemaRow {
  name: string
  can_view_definitions: number | null
}

/**
 * Whether this account can see every object in each schema of the scope.
 *
 * SQL Server lists in sys.objects only the securables an account holds some
 * permission on, so a table the reader may not touch is simply not there.
 * VIEW DEFINITION on the schema is what lifts that filter -- on its own,
 * without any data access -- so a schema where the account lacks it gets a
 * gap: the object list may be short, and nothing in it says by how much.
 *
 * sys.schemas itself is not filtered: an account sees every schema, including
 * ones it holds nothing in. A scope name with no schema behind it is therefore
 * established as absent and needs no gap.
 *
 * HAS_PERMS_BY_NAME parses the name it is given, so it gets QUOTENAME's
 * output: given `it's [odd]` raw it returns NULL, which would read as "may not
 * see" for a schema the account can see perfectly well.
 */
const SCHEMAS_SQL = (_scoped: string, schemaList: string): string => `
  select s.name, has_perms_by_name(quotename(s.name), 'SCHEMA', 'VIEW DEFINITION') as can_view_definitions
  from sys.schemas s
  where s.name in (${schemaList})`

/**
 * Objects this account is denied VIEW DEFINITION on, which therefore vanish
 * from sys.objects even under a schema-level grant that HAS_PERMS_BY_NAME
 * still reports. The account can read its own DENY rows -- made to it or to a
 * role it is in -- but not the denied object's name or schema, so they are
 * counted rather than placed: any of them may be in scope. CONTROL is counted
 * too, because denying it denies everything it implies.
 */
const DENIED_SQL = `
  select count(*) as hidden
  from sys.database_permissions p
  where p.class = 1 and p.state = 'D' and p.permission_name in ('VIEW DEFINITION', 'CONTROL')
    and (p.grantee_principal_id = database_principal_id() or is_member(user_name(p.grantee_principal_id)) = 1)
    and object_name(p.major_id) is null`

export async function readObjectVisibility(pool: ConnectionPool, schemas: readonly string[]): Promise<CoverageGap[]> {
  const [rows, denied] = await Promise.all([
    queryScope<SchemaRow>(pool, schemas, SCHEMAS_SQL),
    pool.request().query<{ hidden: number }>(DENIED_SQL),
  ])
  const gaps: CoverageGap[] = rows
    .filter((row) => row.can_view_definitions !== 1)
    .map((row) => ({
      object: null,
      aspect: 'objects',
      detail: `schema ${row.name}: without VIEW DEFINITION on it, the catalog lists only the tables and views this account holds a permission on, so one it cannot see is absent without trace`,
    }))
  const hidden = denied.recordset[0]?.hidden ?? 0
  if (hidden > 0) {
    gaps.push({
      object: null,
      aspect: 'objects',
      detail: `this account is denied VIEW DEFINITION on ${String(hidden)} object(s) it therefore cannot see, and the catalog does not say which schema they are in: any of them may be in scope`,
    })
  }
  return gaps
}
