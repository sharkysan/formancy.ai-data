import type { DatabaseAdapter, DatabaseKind } from '@formancy/data-core'
import { connectPostgres, createPostgresActions, createPostgresAdapter, createPostgresLookups, createPostgresRecords } from '@formancy/data-postgres'
import { connectSqlServer, createSqlServerActions, createSqlServerAdapter, createSqlServerLookups, createSqlServerRecords } from '@formancy/data-sqlserver'
import type { EntraLogin } from '@formancy/data-sqlserver'
import type { ConnectionConfig, ConnectionFactory, ConnectionLogin } from './connections.js'

/** TLS unless the operator turned it off, and certificates checked unless the operator trusts the server's. */
function tls(config: ConnectionConfig): { enabled: boolean; trust: boolean } {
  return { enabled: config.tls?.enabled ?? true, trust: config.tls?.trustServerCertificate ?? false }
}

/** A SQL login's user and resolved password, which a connection with no `login` must have. */
function sqlLogin(config: ConnectionConfig, password: string | undefined): { user: string; password: string } {
  if (config.user === undefined || password === undefined) throw new Error(`connection ${config.id} names no user and password to log in with`)
  return { user: config.user, password }
}

/** The application name the lookups' client gives PostgreSQL, so a DBA tells it from the records' in pg_stat_activity (0061). */
export const POSTGRES_LOOKUPS_APPLICATION = 'formancy-data lookups'

/** The application name the actions' client gives PostgreSQL, so a DBA tells a run's connection from the records' and the lookups' (0160). */
export const POSTGRES_ACTIONS_APPLICATION = 'formancy-data actions'

/** The application name the actions' pool gives SQL Server, `program_name` in sys.dm_exec_sessions, as PostgreSQL's client is named (0160). */
export const SQLSERVER_ACTIONS_APPLICATION = 'formancy-data actions'

/**
 * How many connections an action's pool opens on SQL Server (0160): mssql's
 * own default, read in its source (lib/base/connection-pool.js, mssql
 * 12.7.4: `max: 10`) and set here explicitly, because no public property of
 * a pool reports its bound -- `size` is how many it holds now -- where
 * postgres.js reports its own as `options.max` (measured,
 * actions.integration.test.ts in each adapter). The runtime plane counts
 * the runs in flight against it (0161).
 */
export const SQLSERVER_ACTION_POOL = 10

/**
 * PostgreSQL. Pinged before it is handed out, so an allowlisted connection that
 * cannot be reached fails here, where the registry retries it next time,
 * rather than on the first record a person saves.
 *
 * Two clients (0061). Lookups run on one of their own, because PostgreSQL
 * delivers a cancel on a connection of its own, and a cancel that arrives
 * after its statement finished stops whatever that backend runs next: in the
 * 2026-10-14 probe a lookup's late cancel stopped the statement pipelined
 * behind it on a shared pool of one. On their own client a late cancel can
 * stop only another lookup -- which the adapter runs once more -- and never a
 * record read or write, which 0015 never retries. The cost is up to twice the
 * connections per allowlisted database, each pool at the driver's default.
 *
 * And actions on a third (0160): a run holds its connection and row locks
 * for up to its deadline, which on the records' client would stall every
 * read and write of every form on the database. The ping runs on the
 * records' client; a failure ends all three. Closing the adapter closes
 * all three, each as the adapter closes its own.
 */
const openPostgres: ConnectionFactory = async (config, secret) => {
  const { enabled, trust } = tls(config)
  if (config.login !== undefined) throw new Error(`connection ${config.id} names a login, which only a SQL Server connection takes`)
  const options = {
    host: config.host,
    port: config.port,
    database: config.database,
    ...sqlLogin(config, secret),
    tls: { enabled, rejectUnauthorized: !trust },
  }
  const sql = connectPostgres(options)
  const lookupSql = connectPostgres({ ...options, applicationName: POSTGRES_LOOKUPS_APPLICATION })
  const actionSql = connectPostgres({ ...options, applicationName: POSTGRES_ACTIONS_APPLICATION })
  const records = createPostgresAdapter(sql)
  const lookups = createPostgresAdapter(lookupSql)
  const actions = createPostgresAdapter(actionSql)
  const adapter: DatabaseAdapter = {
    ...records,
    close: async () => {
      await Promise.all([records.close(), lookups.close(), actions.close()])
    },
  }
  try {
    await adapter.ping()
  } catch (error) {
    await Promise.all([sql.end({ timeout: 1 }), lookupSql.end({ timeout: 1 }), actionSql.end({ timeout: 1 })])
    throw error
  }
  return {
    adapter,
    lookups: createPostgresLookups(lookupSql),
    records: createPostgresRecords(sql),
    actions: createPostgresActions(actionSql),
    // postgres.js's own bound, which it reports (0160): the runs the runtime plane lets be in flight on it (0161).
    actionPool: actionSql.options.max,
  }
}

/** The adapter's login for each allowlist login, kept so that a connection opened again is given the same object. */
const entraLogins = new WeakMap<ConnectionLogin, EntraLogin>()

/**
 * The Entra principal an allowlist login names, for the adapter (0074): a
 * service principal with its resolved client secret, a managed identity by
 * its client id or none. One object for each allowlist login while its
 * secret is the same: the adapter keeps a credential, and its token cache,
 * for each login object, and the registry opens a connection again after a
 * failed open with its secret resolved again. A secret that changed is a
 * new object, so the corrected or rotated secret is the one logged in with.
 */
export function entraLogin(login: ConnectionLogin, secret: string | undefined): EntraLogin {
  const kept = entraLogins.get(login)
  if (kept !== undefined && (kept.type === 'managed-identity' || kept.clientSecret === secret)) return kept
  let made: EntraLogin
  if (login.type === 'entra-managed-identity')
    made = login.client === undefined ? { type: 'managed-identity' } : { type: 'managed-identity', clientId: login.client }
  else if (secret === undefined) throw new Error('a service principal logs in with its client secret, and none was resolved')
  else made = { type: 'service-principal', tenantId: login.tenant, clientId: login.client, clientSecret: secret }
  entraLogins.set(login, made)
  return made
}

/**
 * SQL Server: no native module, no ODBC. A SQL login, or an Entra
 * principal, which no test of this release logs in as (0074). One pool for
 * records and lookups, whose cancel is in-band (0061), and one of its own
 * for actions, at SQLSERVER_ACTION_POOL connections, its sessions named
 * SQLSERVER_ACTIONS_APPLICATION (0160). Closing the adapter closes both.
 */
const openSqlServer: ConnectionFactory = async (config, secret) => {
  const { enabled, trust } = tls(config)
  const address = { host: config.host, port: config.port, database: config.database, encrypt: enabled, trustServerCertificate: trust }
  const login = config.login === undefined ? { ...address, ...sqlLogin(config, secret) } : { ...address, entra: entraLogin(config.login, secret) }
  const pool = await connectSqlServer(login)
  let actionPool: Awaited<ReturnType<typeof connectSqlServer>>
  try {
    actionPool = await connectSqlServer({ ...login, poolMax: SQLSERVER_ACTION_POOL, applicationName: SQLSERVER_ACTIONS_APPLICATION })
  } catch (error) {
    await pool.close()
    throw error
  }
  const records = createSqlServerAdapter(pool)
  const adapter: DatabaseAdapter = {
    ...records,
    close: async () => {
      await Promise.all([records.close(), actionPool.close()])
    },
  }
  return {
    adapter,
    lookups: createSqlServerLookups(pool),
    records: createSqlServerRecords(pool),
    actions: createSqlServerActions(actionPool),
    actionPool: SQLSERVER_ACTION_POOL,
  }
}

/**
 * The drivers, one factory per engine. Each adapter package opens its own
 * connections (`connectPostgres`, `connectSqlServer`), so a connection and the
 * code that binds values on it always come from one copy of the driver — the
 * server imports no driver at all, and the end-to-end suite is what found why
 * that matters.
 */
export const DRIVER_FACTORIES: Readonly<Record<DatabaseKind, ConnectionFactory>> = {
  postgres: openPostgres,
  sqlserver: openSqlServer,
}
