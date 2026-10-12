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
 *
 * A condition on `sys.database_permissions p`, exported, as `DENIED_SCHEMAS`
 * and `VIEWS_DATABASE` are, for the delete's guard (0050): the batch that
 * refuses a delete its account can no longer see every key of, and the
 * snapshot's `referenced-by` gap, read the one condition.
 */
export const DENIED_OBJECTS = `p.class = 1 and p.state = 'D' and p.permission_name in ('VIEW DEFINITION', 'CONTROL')
    and ${BINDS_ME}
    and object_name(p.major_id) is null`

const DENIED_OBJECTS_SQL = `
  select count(*) as hidden
  from sys.database_permissions p
  where ${DENIED_OBJECTS}`

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
export const DENIED_SCHEMAS = `p.class = 3 and p.state = 'D' and p.permission_name in ('VIEW DEFINITION', 'CONTROL')
    and ${BINDS_ME}
    and has_perms_by_name(quotename(schema_name(p.major_id)), N'SCHEMA', N'VIEW DEFINITION') = 0`

const DENIED_SCHEMAS_SQL = `
  select count(*) as hidden
  from sys.database_permissions p
  where ${DENIED_SCHEMAS}`

/**
 * Whether the account may view every definition in the database, which is
 * what lists to it every object of every schema -- and so every security
 * policy, which lives in a schema of its own and filters a table in any
 * other (0027, B10b), and every foreign key, which is on a table in any
 * schema and refers to one in scope (0049, P2). VIEW SECURITY DEFINITION
 * shows no policy at all (B10d). The database is QUOTENAME'd:
 * HAS_PERMS_BY_NAME parses it, and in a database named `it's [odd] db` the
 * raw name answers NULL (B9).
 */
export const VIEWS_DATABASE = `has_perms_by_name(quotename(db_name()), N'DATABASE', N'VIEW DEFINITION')`

const DATABASE_SQL = `select ${VIEWS_DATABASE} as can_view_definitions`

/** VIEW DEFINITION or CONTROL denies that bind this account, by securable class. */
export interface Denials {
  objects: number
  schemas: number
}

export interface Visibility {
  gaps: CoverageGap[]
  denied: Denials
  /** VIEW DEFINITION on the database. */
  canViewDatabase: boolean
}

/**
 * Why this account may not see every definition in the database, or nothing
 * when it may: what row security (0027) and what refers to a table (0049)
 * are established by, because a security policy and a foreign key each live
 * on an object of any schema. Established takes VIEW DEFINITION on the
 * database and no VIEW DEFINITION or CONTROL deny on an object or a schema
 * binding the account -- a denied object, or an object in a denied schema,
 * is not listed even under the database grant (B10e, B10f; for a key, P2).
 * `lists` names what the database grant lists, for the sentence.
 */
export function unseenDefinitions(visibility: Visibility, lists: string): string[] {
  const reasons: string[] = []
  if (!visibility.canViewDatabase) reasons.push(`this account lacks VIEW DEFINITION on the database, which is what lists every ${lists}`)
  if (visibility.denied.objects > 0) reasons.push(`this account is denied VIEW DEFINITION or CONTROL on ${String(visibility.denied.objects)} object(s)`)
  if (visibility.denied.schemas > 0) reasons.push(`this account is denied VIEW DEFINITION or CONTROL on ${String(visibility.denied.schemas)} schema(s)`)
  return reasons
}

export async function readObjectVisibility(pool: ConnectionPool, schemas: readonly string[]): Promise<Visibility> {
  const [rows, deniedObjects, deniedSchemas, database] = await Promise.all([
    queryScope<SchemaRow>(pool, schemas, SCHEMAS_SQL),
    pool.request().query<{ hidden: number }>(DENIED_OBJECTS_SQL),
    pool.request().query<{ hidden: number }>(DENIED_SCHEMAS_SQL),
    pool.request().query<{ can_view_definitions: number | null }>(DATABASE_SQL),
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
  return { gaps, denied, canViewDatabase: database.recordset[0]?.can_view_definitions === 1 }
}
