import postgres from 'postgres'
import type { Sql } from 'postgres'

export interface PostgresConnectOptions {
  host: string
  port: number
  database: string
  user: string
  password: string
  /** TLS, and whether the server's certificate is checked. The composition root decides. */
  tls: { enabled: boolean; rejectUnauthorized: boolean }
}

/**
 * A client, from this package's own copy of postgres.js.
 *
 * The adapter package opens its connections for the reason
 * `@formancy/data-sqlserver`'s `connectSqlServer` gives: a driver object built
 * by one copy of a driver and used by another is a defect no unit test sees.
 * postgres.js keeps no identity-checked types today, so this is the same rule
 * applied before it is needed rather than after.
 */
export function connectPostgres(options: PostgresConnectOptions): Sql {
  return postgres({
    host: options.host,
    port: options.port,
    database: options.database,
    username: options.user,
    password: options.password,
    ssl: options.tls.enabled ? { rejectUnauthorized: options.tls.rejectUnauthorized } : false,
    // The adapters read every value as text converted in SQL (0016); notices
    // are the server talking to a console nobody reads.
    onnotice: () => {},
  })
}
