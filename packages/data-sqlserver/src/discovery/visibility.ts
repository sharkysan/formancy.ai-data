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
 * established as absent and needs no gap. The gap names the schema as the
 * catalog spells it, which on a case-insensitive database may not be how the
 * scope does: `SALES` finds `sales`, and the gap is about `sales` (0027).
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
 * Who a DENY row binds: the account itself, or a role it is in -- which is how
 * a DBA usually denies, and a row that names the role.
 */
const BINDS_ME = `(p.grantee_principal_id = database_principal_id() or is_member(user_name(p.grantee_principal_id)) = 1)`

/**
 * Objects this account is denied VIEW DEFINITION on, which therefore vanish
 * from sys.objects even under a schema-level grant that HAS_PERMS_BY_NAME
 * still reports. The account can read its own DENY rows -- made to it or to a
 * role it is in -- but not the denied object's name or schema, so they are
 * counted rather than placed: any of them may be in scope. CONTROL is counted
 * too, because denying it denies everything it implies.
 */
const DENIED_OBJECTS_SQL = `
  select count(*) as hidden
  from sys.database_permissions p
  where p.class = 1 and p.state = 'D' and p.permission_name in ('VIEW DEFINITION', 'CONTROL')
    and ${BINDS_ME}
    and object_name(p.major_id) is null`

/**
 * Schemas this account is denied VIEW DEFINITION or CONTROL on (class 3).
 * A schema in scope already answers for itself through HAS_PERMS_BY_NAME
 * above; this count is for row security, because a security policy lives in
 * a schema of its own and may filter a table in any other. Measured (B10f):
 * with VIEW DEFINITION on the database and a deny on the policy's schema, the
 * database check still says yes, the policy is not listed, and the object
 * count above is 0 -- so without this count, a policy that applies would read
 * as none.
 *
 * Only a deny the server applies is counted. A DENY binds no sysadmin and no
 * dbo, yet one made to `public` matches BINDS_ME for them through IS_MEMBER,
 * and the owner, who sees every policy, would be told it is denied a schema.
 * HAS_PERMS_BY_NAME applies the exemption and the deny's precedence, so a
 * schema whose definitions the account can still see is not counted.
 */
const DENIED_SCHEMAS_SQL = `
  select count(*) as hidden
  from sys.database_permissions p
  where p.class = 3 and p.state = 'D' and p.permission_name in ('VIEW DEFINITION', 'CONTROL')
    and ${BINDS_ME}
    and has_perms_by_name(quotename(schema_name(p.major_id)), N'SCHEMA', N'VIEW DEFINITION') = 0`

/** VIEW DEFINITION or CONTROL denies that bind this account, by securable class. */
export interface Denials {
  objects: number
  schemas: number
}

export interface Visibility {
  gaps: CoverageGap[]
  denied: Denials
}

export async function readObjectVisibility(pool: ConnectionPool, schemas: readonly string[]): Promise<Visibility> {
  const [rows, deniedObjects, deniedSchemas] = await Promise.all([
    queryScope<SchemaRow>(pool, schemas, SCHEMAS_SQL),
    pool.request().query<{ hidden: number }>(DENIED_OBJECTS_SQL),
    pool.request().query<{ hidden: number }>(DENIED_SCHEMAS_SQL),
  ])
  const gaps: CoverageGap[] = rows
    .filter((row) => row.can_view_definitions !== 1)
    .map((row) => ({
      subject: { kind: 'schema', schema: row.name },
      aspect: 'objects',
      detail: `without VIEW DEFINITION on schema ${row.name}, the catalog lists only the tables and views this account holds a permission on, so one it cannot see is absent without trace`,
    }))
  const denied: Denials = { objects: deniedObjects.recordset[0]?.hidden ?? 0, schemas: deniedSchemas.recordset[0]?.hidden ?? 0 }
  if (denied.objects > 0) {
    gaps.push({
      subject: { kind: 'scope' },
      aspect: 'objects',
      detail: `this account is denied VIEW DEFINITION on ${String(denied.objects)} object(s) it therefore cannot see, and the catalog does not say which schema they are in: any of them may be in scope`,
    })
  }
  return { gaps, denied }
}
