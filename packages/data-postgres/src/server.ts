import type { ServerIdentity } from '@formancy/data-core'
import type { Sql, TransactionSql } from 'postgres'

/** What a PostgreSQL server says it is, as three settings it reports about itself. */
export interface PostgresServerAnswer {
  /** `server_version`: "17.6", or a packager's "16.4 (Debian 16.4-1.pgdg120+1)". For a person. */
  version: string
  /** `server_version_num`: "170006", the version as an integer, which is what the major is read from. */
  versionNum: string
  /** `version()`: "PostgreSQL 17.6 on …", which is what says the server is PostgreSQL. */
  description: string
}

/**
 * The server's identity, translated from what it answered (0068): data-core
 * decides from it whether this release was tested on the server.
 *
 * The major is `server_version_num` divided by 10000 -- 17 from 170006, and
 * 9 from 9.6's 90624 -- because the number is stated as one, where the text
 * is whatever a packager or a development build made of it. A number that is
 * not an integer is no major. The product is `postgresql` only when
 * `version()` begins "PostgreSQL ": a database that speaks the protocol
 * answers the settings too, with a major of its own numbering. One that
 * copies `version()` as well -- a managed PostgreSQL, or anything else that
 * does -- reads as PostgreSQL, and no query here could tell it apart.
 */
export function postgresServer(answer: PostgresServerAnswer): ServerIdentity {
  const major = /^\d+$/.test(answer.versionNum) ? Math.floor(Number(answer.versionNum) / 10000) : null
  return { kind: 'postgres', version: answer.version, product: answer.description.startsWith('PostgreSQL ') ? 'postgresql' : 'other', major }
}

/**
 * What the server says it is, translated: one query, shared by the adapter's
 * ping and by discovery, so the version and the facts a snapshot records
 * and those a ping reports cannot differ. Schema-qualified, as discovery's
 * every query is (0057).
 */
export async function readServer(sql: Sql | TransactionSql): Promise<ServerIdentity> {
  const [row] = await sql<PostgresServerAnswer[]>`
    select pg_catalog.current_setting('server_version') as version,
      pg_catalog.current_setting('server_version_num') as "versionNum",
      pg_catalog.version() as description`
  // Never reached against a real server -- a SELECT of one row of
  // expressions returns one row -- and kept because `row` is `T | undefined`
  // under noUncheckedIndexedAccess; the coverage report shows it uncovered,
  // which is the honest reading of it.
  if (row === undefined) throw new Error('PostgreSQL answered the server query with no row')
  return postgresServer(row)
}
