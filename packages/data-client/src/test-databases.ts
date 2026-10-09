import { startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { TestProject } from 'vitest/node'

/*
 * Both databases, once for the whole run (0003): the shared fixture on real
 * PostgreSQL 17 and SQL Server 2022, started by the harness every adapter is
 * tested against. Each suite file builds its own server over them, so a file
 * is a fresh server and a fresh configuration store, and only the database --
 * which is the thing under test -- is shared.
 *
 * What is provided is how to connect, not a connection: a worker cannot be
 * handed a socket, and the server under test opens its own through the real
 * drivers anyway.
 */

/** How the server under test reaches one database: what an allowlist entry holds, with the password itself. */
export interface DatabaseDetails {
  host: string
  port: number
  database: string
  user: string
  password: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    databases: { pg: DatabaseDetails; ms: DatabaseDetails }
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const pgUrl = new URL(pg.admin)
  project.provide('databases', {
    pg: {
      host: pgUrl.hostname,
      port: Number(pgUrl.port),
      database: pgUrl.pathname.slice(1),
      user: decodeURIComponent(pgUrl.username),
      password: decodeURIComponent(pgUrl.password),
    },
    ms: {
      host: String(ms.admin.server),
      port: Number(ms.admin.port),
      database: String(ms.admin.database),
      user: String(ms.admin.user),
      password: String(ms.admin.password),
    },
  })
  return async () => {
    await Promise.all([pg.stop(), ms.stop()])
  }
}
