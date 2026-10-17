import { serverName, SQLSERVER_RELEASES } from '@formancy/data-core'
import type { ServerIdentity, ServerProduct } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'

/** What a SQL Server says it is, and whether its catalog has what discovery reads, as the server query answers. */
export interface SqlServerAnswer {
  /** `ProductVersion`: the build, "16.0.4205.1". For a person. */
  version: string
  /** `EngineEdition`: which product this is, read before anything else. Null when the server answered none. */
  engineEdition: number | null
  /** `ProductMajorVersion`: "16", which is what the major is read from. */
  majorVersion: string | null
  /** The `compatibility_level` of the database the connection is in. */
  compatibility: number | null
  /** Whether `sys.edge_constraints` exists, which discovery and every delete read. */
  edgeConstraints: boolean
}

/** The server's identity, and the one catalog fact a version decides that discovery needs. */
export interface SqlServerRead {
  identity: ServerIdentity
  edgeConstraints: boolean
}

/**
 * The product each `EngineEdition` is (0068): 2 Standard, 3 Enterprise and
 * Developer, 4 Express are SQL Server; 5 is Azure SQL Database and 8 Azure
 * SQL Managed Instance. Anything else -- Synapse, SQL Edge, an edition named
 * later -- is `other`.
 */
const EDITIONS: Readonly<Record<number, ServerProduct>> = { 2: 'sqlserver', 3: 'sqlserver', 4: 'sqlserver', 5: 'azure-sql-database', 8: 'azure-sql-managed-instance' }

/**
 * The server's identity, translated from what it answered (0068): data-core
 * decides from it whether this release was tested on the server.
 *
 * EngineEdition is read first, because the major means a release only on a
 * boxed server: Azure SQL Database's version is 12, which a boxed server
 * answers as 2014, and Managed Instance's update policy aligns it with 2022
 * or 2025. The major is `ProductMajorVersion`, the server's own number,
 * which Microsoft documents for SQL Server alone, and none when it states
 * none. The compatibility
 * level is the connected database's, which a database restored from an
 * older server keeps, and is left out when the server answered none.
 */
export function sqlServerRead(answer: SqlServerAnswer): SqlServerRead {
  const product = (answer.engineEdition === null ? undefined : EDITIONS[answer.engineEdition]) ?? 'other'
  const major = answer.majorVersion !== null && /^\d+$/.test(answer.majorVersion) ? Number(answer.majorVersion) : null
  const identity: ServerIdentity = { kind: 'sqlserver', version: answer.version, product, major }
  if (answer.compatibility !== null) identity.compatibility = answer.compatibility
  return { identity, edgeConstraints: answer.edgeConstraints }
}

/** The major from which SQL Server has `sys.edge_constraints`: 2019. */
const EDGE_CONSTRAINTS_FROM = 15

/**
 * Why discovery cannot read this server, or undefined when it can: the one
 * refusal a version meets (0068). Discovery's referenced-by query and every
 * delete name `sys.edge_constraints`, which SQL Server has from 2019 (15);
 * without it, discovery failed as "Invalid object name" and said nothing of
 * the version. Decided by the view and not by the major, because Azure SQL
 * Database answers 12 and has it.
 */
export function discoveryRefusal(read: SqlServerRead): string | undefined {
  if (read.edgeConstraints) return undefined
  const name = serverName('sqlserver', read.identity)
  const from = `${String(SQLSERVER_RELEASES[EDGE_CONSTRAINTS_FROM])} (${String(EDGE_CONSTRAINTS_FROM)})`
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} cannot be discovered: this adapter reads sys.edge_constraints, which SQL Server has from ${from}.`
}

/**
 * What the server says it is, translated, with whether its catalog has
 * `sys.edge_constraints`: one query, shared by `ping` and by discovery, so
 * the facts a snapshot records and those a ping reports cannot differ -- and
 * so discovery does not import the adapter that imports it.
 *
 * `ProductVersion` rather than `@@VERSION`, which adds the edition, the OS
 * and a paragraph of text; `SERVERPROPERTY` returns `sql_variant`, so each is
 * cast. The level is read from sys.databases for `db_id()`, the row of the
 * database the connection is in, which any account can see.
 */
export async function readServer(pool: ConnectionPool): Promise<SqlServerRead> {
  const result = await pool.request().query<SqlServerAnswer>(
    `select cast(serverproperty('ProductVersion') as nvarchar(128)) as version,
      cast(serverproperty('EngineEdition') as int) as engineEdition,
      cast(serverproperty('ProductMajorVersion') as nvarchar(128)) as majorVersion,
      (select d.compatibility_level from sys.databases as d where d.database_id = db_id()) as compatibility,
      cast(case when object_id(N'sys.edge_constraints') is null then 0 else 1 end as bit) as edgeConstraints`,
  )
  const row = result.recordset[0]
  // Never reached against a real server — a SELECT of one row of expressions
  // returns one row — and kept because `recordset[0]` is `T | undefined` under
  // noUncheckedIndexedAccess. The coverage report shows it uncovered, honestly.
  if (row === undefined) throw new Error('SQL Server answered the server query with no row')
  return sqlServerRead(row)
}
