import type { DiscoveryAccount } from '@formancy/data-core'
import { MSSQLServerContainer } from '@testcontainers/mssqlserver'
import type { StartedMSSQLServerContainer } from '@testcontainers/mssqlserver'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import mssql from 'mssql'
import postgres from 'postgres'
import { Wait } from 'testcontainers'
import { selectedImage } from './images.js'
import { readFixture, splitBatches } from './load.js'
import type { ServerAnswer, ServerRecord } from './servers.js'
import { captureCaller, recordServer } from './servers.js'
import { reportingUnready } from './unready.js'

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

/**
 * The label every container a starter here starts carries, naming the file
 * that asked for it: the session label testcontainers sets is shared by
 * every process on the daemon that found the same Ryuk (0082).
 */
export const CALLER_LABEL = 'ai.formancy.data.caller'

/** The labels a container started for `caller` carries: none when no frame named a file. */
const labelled = (caller: string | null): Record<string, string> => (caller === null ? {} : { [CALLER_LABEL]: caller })

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
  /** The certificate the server presents, PEM, when the fixture was started with one (`SqlServerStart`). */
  certificate: string | undefined
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
 * ran on. `image` is for a test that names another; without one, the image
 * FORMANCY_IMAGES chooses, which unset is the default (0067). So a bare call
 * -- each adapter's ping file makes one -- runs on its leg's image: on the
 * default, a leg's ping would be the default's test reported as the leg's.
 */
export async function startPostgresContainer(image: string = selectedImage('postgres')): Promise<StartedServer<StartedPostgreSqlContainer>> {
  // Before the first await, while whoever asked is on the synchronous stack (servers.ts, callerOf).
  const caller = captureCaller()
  const container = await new PostgreSqlContainer(image).withLabels(labelled(caller)).start()
  try {
    const answer = await askPostgres(container.getConnectionUri())
    return { container, server: recordServer({ engine: 'postgres', image, caller, compatibility: null, ...answer }) }
  } catch (error) {
    await container.stop()
    throw error
  }
}

/**
 * A PostgreSQL container with the fixture loaded, the restricted principals
 * created, and the parity schema (0028) beside it, on `image`: the one
 * FORMANCY_IMAGES chooses, unless the caller names another.
 *
 * One harness for every suite, so the two adapters, the codecs and anything
 * later all start from byte-identical databases. A suite that built its own
 * would drift from this one the first time somebody added a table to it.
 */
export async function startPostgresFixture(image: string = selectedImage('postgres')): Promise<PostgresFixture> {
  const { container, server } = await startPostgresContainer(image)
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

/** How a SQL Server container is started, beyond its image. */
export interface SqlServerStart {
  /**
   * The server presents a certificate made for it as the container starts,
   * for `localhost` and 127.0.0.1, rather than SQL Server's self-signed
   * fallback, and the certificate is answered, PEM, for the client to
   * trust. A connection that opens with TLS (TDS 8.0, `encrypt: 'strict'`)
   * needs one: without it SQL Server 2025 resets such a connection, and
   * SQL Server 2019 and 2022 on Linux reset it either way (measured
   * 2026-10-17, data-sqlserver's entra.integration.test.ts).
   */
  certificate?: boolean
}

/** Where a container started with a certificate keeps it, and its key: the server's own directory, which its user owns. */
const CERTIFICATE_FILE = '/var/opt/mssql/formancy-tls.pem'
const CERTIFICATE_KEY_FILE = '/var/opt/mssql/formancy-tls.key'

/**
 * The command such a container starts with, in place of the image's: the
 * image's own openssl makes a key and a certificate valid for a day, which
 * outlives any run, mssql.conf names them, and the server starts as the
 * image would start it. The images' entrypoints run the command they are
 * given (permissions_check.sh's `exec "$@"`).
 */
const WITH_CERTIFICATE = [
  '/bin/bash',
  '-c',
  [
    `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout ${CERTIFICATE_KEY_FILE} -out ${CERTIFICATE_FILE}`,
    `printf '[network]\\ntlscert = ${CERTIFICATE_FILE}\\ntlskey = ${CERTIFICATE_KEY_FILE}\\n' > /var/opt/mssql/mssql.conf`,
    'exec /opt/mssql/bin/sqlservr',
  ].join(' && '),
]

/**
 * A SQL Server container, accepting logins, what its server said about
 * itself, and the certificate it presents when it was started with one:
 * recorded by whoever started it, who knows what it loaded. Accepting the
 * EULA is the operator's act; in a test it is this call, the decision
 * compose.yaml makes a developer spell out.
 *
 * Ready is the module's own sign, "Recovery is complete" logged once, under
 * the module's 120-second timeout; a start that never logs it fails with
 * how Docker says the container ended and the last lines it wrote (0082).
 */
async function launchSqlServer(image: string, start: SqlServerStart, caller: string | null): Promise<{ container: StartedMSSQLServerContainer; answer: ServerAnswer; certificate: string | undefined }> {
  const container = await (start.certificate === true ? new MSSQLServerContainer(image).withCommand(WITH_CERTIFICATE) : new MSSQLServerContainer(image))
    .withWaitStrategy(reportingUnready(Wait.forLogMessage(/.*Recovery is complete.*/, 1)))
    .withLabels(labelled(caller))
    .acceptLicense()
    .start()
  try {
    const answer = await askSqlServer(ownerOf(container, 'master'))
    if (start.certificate !== true) return { container, answer, certificate: undefined }
    const read = await container.exec(['cat', CERTIFICATE_FILE])
    if (read.exitCode !== 0 || !read.stdout.includes('BEGIN CERTIFICATE')) throw new Error(`the container's certificate could not be read: ${read.stderr}`)
    return { container, answer, certificate: read.stdout }
  } catch (error) {
    await container.stop()
    throw error
  }
}

/**
 * A SQL Server container, empty, accepting logins, and a record of the
 * server that answered in it (0035), as `startPostgresContainer`. It loads
 * no database, so its record names no compatibility level. Started with a
 * certificate, it answers the certificate too.
 */
export async function startSqlServerContainer(
  image: string = selectedImage('sqlserver'),
  start: SqlServerStart = {},
): Promise<StartedServer<StartedMSSQLServerContainer> & { certificate: string | undefined }> {
  // Before the first await, while whoever asked is on the synchronous stack (servers.ts, callerOf).
  const caller = captureCaller()
  const { container, answer, certificate } = await launchSqlServer(image, start, caller)
  return { container, server: recordServer({ engine: 'sqlserver', image, caller, compatibility: null, ...answer }), certificate }
}

/**
 * Creates the fixture's database and principals, loads the fixture into it,
 * and answers that database's compatibility level: the one it took from the
 * server's `model` when it was created, which data-core's floor is held to
 * (0068), asked of the database itself rather than of `master`.
 */
async function loadSqlServerFixture(owner: mssql.config): Promise<number> {
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

  const pool = await new mssql.ConnectionPool({ ...owner, database: SQLSERVER_DATABASE }).connect()
  try {
    for (const batch of splitBatches(readFixture('sqlserver.sql'))) await pool.request().batch(batch)
    for (const batch of splitBatches(readFixture('sqlserver.restricted.sql'))) await pool.request().batch(batch)
    for (const batch of splitBatches(readFixture('sqlserver.parity.sql'))) await pool.request().batch(batch)
    const result = await pool.request().query<{ level: number }>('select compatibility_level as level from sys.databases where database_id = db_id()')
    const level = result.recordset[0]?.level
    if (level === undefined) throw new Error('SQL Server answered the compatibility query with no row')
    return level
  } finally {
    await pool.close()
  }
}

/**
 * A SQL Server container with the fixture loaded into its own database, the
 * restricted principals created, and the parity schema (0028) beside it, on
 * `image`, as `startPostgresFixture`. Its record names the compatibility
 * level of the database the fixture was loaded into. Started with a
 * certificate, it answers the certificate too.
 */
export async function startSqlServerFixture(image: string = selectedImage('sqlserver'), start: SqlServerStart = {}): Promise<SqlServerFixture> {
  // Before the first await, while whoever asked is on the synchronous stack (servers.ts, callerOf).
  const caller = captureCaller()
  const { container, answer, certificate } = await launchSqlServer(image, start, caller)
  const owner = ownerOf(container, 'master')
  const base = { server: owner.server, port: owner.port, options: owner.options }

  let compatibility: number
  try {
    compatibility = await loadSqlServerFixture(owner)
  } catch (error) {
    // The server answered, and a file asked for it: recorded as it was
    // before the fixture's database had a level to record.
    recordServer({ engine: 'sqlserver', image, caller, compatibility: null, ...answer })
    throw error
  }
  const server = recordServer({ engine: 'sqlserver', image, caller, compatibility, ...answer })

  return {
    admin: { ...owner, database: SQLSERVER_DATABASE },
    reader: { ...base, user: READER.user, password: READER.sqlServerPassword, database: SQLSERVER_DATABASE },
    writer: { ...base, user: WRITER.user, password: WRITER.sqlServerPassword, database: SQLSERVER_DATABASE },
    owner: { user: 'dbo', login: String(owner.user) },
    server,
    containerId: container.getId(),
    certificate,
    stop: async () => {
      await container.stop()
    },
  }
}
