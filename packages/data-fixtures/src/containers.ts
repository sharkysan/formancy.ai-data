import type { DatabaseKind, DiscoveryAccount } from '@formancy/data-core'
import { MSSQLServerContainer } from '@testcontainers/mssqlserver'
import type { StartedMSSQLServerContainer } from '@testcontainers/mssqlserver'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import mssql from 'mssql'
import postgres from 'postgres'
import { readFixture, splitBatches } from './load.js'
import type { ServerAnswer, ServerRecord } from './servers.js'
import { captureCaller, recordServer } from './servers.js'

/**
 * The images the suites run against. The supported matrix is exactly these
 * until a test names another (0003): passing on 17 says nothing about 14.
 */
export const POSTGRES_IMAGE = 'postgres:17-alpine'
export const SQLSERVER_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest'

/**
 * The image each engine's tests run on unless a file names another. The
 * supported matrix is exactly these until a test names another (0003), and
 * the release report lists every image a test started, these first (0035).
 * A record, so a third engine without an image is a compile error here.
 */
export const DEFAULT_IMAGES: Readonly<Record<DatabaseKind, string>> = { postgres: POSTGRES_IMAGE, sqlserver: SQLSERVER_IMAGE }

/** The restricted principal both fixture files create. */
export const READER = {
  user: 'formancy_reader',
  postgresPassword: 'reader-fixture-password',
  // SQL Server's policy wants three character classes even with
  // CHECK_POLICY off on some builds, so this one has them.
  sqlServerPassword: 'Reader-Fixture-Password-1',
} as const

/**
 * The order form's account, which holds its grants through the role
 * formancy_forms and which the fixture's row-level security shows tenant 1
 * only (0027). Passwords as for the reader.
 */
export const WRITER = {
  user: 'formancy_writer',
  postgresPassword: 'writer-fixture-password',
  sqlServerPassword: 'Writer-Fixture-Password-1',
} as const

/** The database the SQL Server fixture is loaded into, rather than `master`. */
export const SQLSERVER_DATABASE = 'formancy_fixture'

export interface PostgresFixture {
  /** A connection URI for the container's owner, who loaded the fixture. */
  admin: string
  /** The same database as `formancy_reader`, who may read sales."order" only. */
  reader: string
  /** The same database as `formancy_writer`, the order form's account. */
  writer: string
  /** Who `admin` discovers as: the container's superuser, as both principal and login. */
  owner: DiscoveryAccount
  /** What the server said about itself, as recorded for the release report. */
  server: ServerRecord
  /** The container's id, so the performance harness can read its CPU and limits from Docker (0034). */
  containerId: string
  stop(): Promise<void>
}

export interface SqlServerFixture {
  admin: mssql.config
  reader: mssql.config
  writer: mssql.config
  /** Who `admin` discovers as: `sa` connects, and in a database it does not own by name is `dbo`. */
  owner: DiscoveryAccount
  /** What the server said about itself, as recorded for the release report. */
  server: ServerRecord
  /** The container's id, as for PostgreSQL. */
  containerId: string
  stop(): Promise<void>
}

/** A started container and what its server said about itself, recorded. */
export interface StartedServer<Container> {
  container: Container
  server: ServerRecord
}

/** What PostgreSQL says it is: `server_version`, the setting the adapter's ping reads too, and `version()`. */
async function askPostgres(uri: string): Promise<ServerAnswer> {
  const sql = postgres(uri, { onnotice: () => {} })
  try {
    const [row] = await sql<{ version: string; description: string }[]>`select current_setting('server_version') as version, version() as description`
    if (row === undefined) throw new Error('PostgreSQL answered the version query with no row')
    return { version: row.version, updateLevel: null, edition: null, description: row.description }
  } finally {
    await sql.end()
  }
}

/**
 * A PostgreSQL container, empty, and a record of the server that answered in
 * it (0035): every container a suite or a gate starts comes through here or
 * `startSqlServerContainer`, so the release report can say what each test
 * ran on. `image` is for a test that names another; the default is the one
 * every other test runs.
 */
export async function startPostgresContainer(image: string = POSTGRES_IMAGE): Promise<StartedServer<StartedPostgreSqlContainer>> {
  // Before the first await, while whoever asked is on the synchronous stack (servers.ts, callerOf).
  const caller = captureCaller()
  const container = await new PostgreSqlContainer(image).start()
  try {
    const answer = await askPostgres(container.getConnectionUri())
    return { container, server: recordServer({ engine: 'postgres', image, caller, ...answer }) }
  } catch (error) {
    await container.stop()
    throw error
  }
}

/**
 * A PostgreSQL container with the fixture loaded, the restricted principals
 * created, and the parity schema (0028) beside it.
 *
 * One harness for every suite, so the two adapters, the codecs and anything
 * later all start from byte-identical databases. A suite that built its own
 * would drift from this one the first time somebody added a table to it.
 */
export async function startPostgresFixture(): Promise<PostgresFixture> {
  const { container, server } = await startPostgresContainer()
  const admin = container.getConnectionUri()
  const sql = postgres(admin, { onnotice: () => {} })
  try {
    // Simple-query protocol: the file is several statements and has no parameters.
    await sql.unsafe(readFixture('postgres.sql'))
    await sql.unsafe(readFixture('postgres.restricted.sql'))
    // The parity schema (0028), outside FIXTURE_SCOPE: last, so nothing above can depend on it.
    await sql.unsafe(readFixture('postgres.parity.sql'))
  } finally {
    await sql.end()
  }

  const as = (user: string, password: string): string => {
    const url = new URL(admin)
    url.username = user
    url.password = password
    return url.toString()
  }
  const owner = container.getUsername()

  return {
    admin,
    reader: as(READER.user, READER.postgresPassword),
    writer: as(WRITER.user, WRITER.postgresPassword),
    owner: { user: owner, login: owner },
    server,
    containerId: container.getId(),
    stop: async () => {
      await container.stop()
    },
  }
}

/**
 * The first connection to a SQL Server container, retried while it refuses
 * logins after saying it is ready.
 *
 * testcontainers reports the container started on "Recovery is complete",
 * which SQL Server 2022 logs before its upgrade scripts have run; until they
 * have, every login is refused with "Login failed" (ELOGIN). On a workstation
 * the window is too short to meet. On CI's runner, with five SQL Server
 * containers starting beside each other once the client and host suites
 * joined (PR #29, 2026-10-09), the end-to-end suite's fixture met it. Only
 * that refusal is retried, once a second; any other error, or a refusal still
 * there after two minutes -- the module's own startup timeout -- fails the
 * suite. It cannot be provoked on demand, so the CI run is its test.
 */
async function connectWhenAcceptingLogins(config: mssql.config): Promise<mssql.ConnectionPool> {
  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      return await new mssql.ConnectionPool(config).connect()
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ELOGIN' || Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

/**
 * The container's owner, in `database`. Its certificate is self-signed, so
 * `trustServerCertificate` is set here, in the test harness, and nowhere in a
 * package a customer runs.
 */
function ownerOf(container: StartedMSSQLServerContainer, database: string): mssql.config {
  return {
    server: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database,
    options: { encrypt: false, trustServerCertificate: true },
  }
}

/**
 * What SQL Server says it is: `ProductVersion`, the property the adapter's
 * ping reads too, its update level and edition, and `@@version`. Cast,
 * because `SERVERPROPERTY` returns `sql_variant`. Asked through the first
 * connection's retry, so whoever connects next does so after the window in
 * which logins are refused.
 */
async function askSqlServer(config: mssql.config): Promise<ServerAnswer> {
  const pool = await connectWhenAcceptingLogins(config)
  try {
    const result = await pool.request().query<{ version: string; update_level: string | null; edition: string | null; description: string | null }>(
      `select cast(serverproperty('ProductVersion') as nvarchar(128)) as version,
        cast(serverproperty('ProductUpdateLevel') as nvarchar(128)) as update_level,
        cast(serverproperty('Edition') as nvarchar(128)) as edition,
        @@version as description`,
    )
    const row = result.recordset[0]
    if (row === undefined) throw new Error('SQL Server answered the version query with no row')
    return { version: row.version, updateLevel: row.update_level, edition: row.edition, description: row.description }
  } finally {
    await pool.close()
  }
}

/**
 * A SQL Server container, empty, accepting logins, and a record of the
 * server that answered in it (0035), as `startPostgresContainer`. Accepting
 * the EULA is the operator's act; in a test it is this call, the decision
 * compose.yaml makes a developer spell out.
 */
export async function startSqlServerContainer(image: string = SQLSERVER_IMAGE): Promise<StartedServer<StartedMSSQLServerContainer>> {
  // Before the first await, while whoever asked is on the synchronous stack (servers.ts, callerOf).
  const caller = captureCaller()
  const container = await new MSSQLServerContainer(image).acceptLicense().start()
  try {
    const answer = await askSqlServer(ownerOf(container, 'master'))
    return { container, server: recordServer({ engine: 'sqlserver', image, caller, ...answer }) }
  } catch (error) {
    await container.stop()
    throw error
  }
}

/**
 * A SQL Server container with the fixture loaded into its own database, the
 * restricted principals created, and the parity schema (0028) beside it.
 */
export async function startSqlServerFixture(): Promise<SqlServerFixture> {
  const { container, server } = await startSqlServerContainer()
  const owner = ownerOf(container, 'master')
  const base = { server: owner.server, port: owner.port, options: owner.options }

  // Server-level work happens in master: the database and the login. Both are
  // constants of this module, not input, which is why they can be spliced in.
  const master = await connectWhenAcceptingLogins(owner)
  try {
    await master.request().batch(`create database ${SQLSERVER_DATABASE}`)
    for (const login of [READER, WRITER]) {
      await master.request().batch(`create login ${login.user} with password = '${login.sqlServerPassword}', check_policy = off`)
    }
  } finally {
    await master.close()
  }

  const admin: mssql.config = { ...owner, database: SQLSERVER_DATABASE }
  const pool = await new mssql.ConnectionPool(admin).connect()
  try {
    for (const batch of splitBatches(readFixture('sqlserver.sql'))) await pool.request().batch(batch)
    for (const batch of splitBatches(readFixture('sqlserver.restricted.sql'))) await pool.request().batch(batch)
    for (const batch of splitBatches(readFixture('sqlserver.parity.sql'))) await pool.request().batch(batch)
  } finally {
    await pool.close()
  }

  return {
    admin,
    reader: { ...base, user: READER.user, password: READER.sqlServerPassword, database: SQLSERVER_DATABASE },
    writer: { ...base, user: WRITER.user, password: WRITER.sqlServerPassword, database: SQLSERVER_DATABASE },
    owner: { user: 'dbo', login: String(owner.user) },
    server,
    containerId: container.getId(),
    stop: async () => {
      await container.stop()
    },
  }
}
