import type { DiscoveryAccount } from '@formancy/data-core'
import { MSSQLServerContainer } from '@testcontainers/mssqlserver'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import mssql from 'mssql'
import postgres from 'postgres'
import { readFixture, splitBatches } from './load.js'

/**
 * The images the suites run against. The supported matrix is exactly these
 * until a test names another (0003): passing on 17 says nothing about 14.
 */
export const POSTGRES_IMAGE = 'postgres:17-alpine'
export const SQLSERVER_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest'

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
  stop(): Promise<void>
}

export interface SqlServerFixture {
  admin: mssql.config
  reader: mssql.config
  writer: mssql.config
  /** Who `admin` discovers as: `sa` connects, and in a database it does not own by name is `dbo`. */
  owner: DiscoveryAccount
  stop(): Promise<void>
}

/**
 * A PostgreSQL container with the fixture loaded and the reader created.
 *
 * One harness for every suite, so the two adapters, the codecs and anything
 * later all start from byte-identical databases. A suite that built its own
 * would drift from this one the first time somebody added a table to it.
 */
export async function startPostgresFixture(): Promise<PostgresFixture> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const admin = container.getConnectionUri()
  const sql = postgres(admin, { onnotice: () => {} })
  try {
    // Simple-query protocol: the file is several statements and has no parameters.
    await sql.unsafe(readFixture('postgres.sql'))
    await sql.unsafe(readFixture('postgres.restricted.sql'))
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
    stop: async () => {
      await container.stop()
    },
  }
}

/**
 * A SQL Server container with the fixture loaded into its own database and the
 * reader created.
 *
 * The container's certificate is self-signed, so `trustServerCertificate` is
 * set here, in the test harness, and nowhere in a package a customer runs.
 */
export async function startSqlServerFixture(): Promise<SqlServerFixture> {
  const container = await new MSSQLServerContainer(SQLSERVER_IMAGE).acceptLicense().start()
  const base = {
    server: container.getHost(),
    port: container.getPort(),
    options: { encrypt: false, trustServerCertificate: true },
  }
  const owner = { ...base, user: container.getUsername(), password: container.getPassword() }

  // Server-level work happens in master: the database and the login. Both are
  // constants of this module, not input, which is why they can be spliced in.
  const master = await new mssql.ConnectionPool({ ...owner, database: 'master' }).connect()
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
  } finally {
    await pool.close()
  }

  return {
    admin,
    reader: { ...base, user: READER.user, password: READER.sqlServerPassword, database: SQLSERVER_DATABASE },
    writer: { ...base, user: WRITER.user, password: WRITER.sqlServerPassword, database: SQLSERVER_DATABASE },
    owner: { user: 'dbo', login: owner.user },
    stop: async () => {
      await container.stop()
    },
  }
}
