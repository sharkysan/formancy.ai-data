import type { ConnectionPool } from 'mssql'

/**
 * The build the server runs, as it states it ("16.0.4205.1").
 *
 * One query, shared by `ping` and by discovery, so the version a snapshot
 * records and the version a ping reports cannot differ — and so discovery
 * does not import the adapter that imports it. `ProductVersion` rather than
 * `@@VERSION`, which adds the edition, the OS and a paragraph of text. Cast,
 * because `SERVERPROPERTY` returns `sql_variant` and the driver would hand that
 * back as something other than a string.
 */
export async function readServerVersion(pool: ConnectionPool): Promise<string> {
  const result = await pool
    .request()
    .query<{ version: string }>("select cast(serverproperty('ProductVersion') as nvarchar(128)) as version")
  const row = result.recordset[0]
  // Never reached against a real server — a SELECT of one expression returns
  // one row — and kept because `recordset[0]` is `T | undefined` under
  // noUncheckedIndexedAccess. The coverage report shows it uncovered, honestly.
  if (row === undefined) throw new Error('SQL Server answered the version query with no row')
  return row.version
}
