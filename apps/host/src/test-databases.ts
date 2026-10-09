import { EDGE_VALUES, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { SECOND_CUSTOMER } from './test-values.js'

/*
 * Both databases, once for the whole run (0003): the shared fixture on real
 * PostgreSQL 17 and SQL Server 2022, started by the harness every adapter is
 * tested against. Each suite file builds its own server over them -- a fresh
 * server and a fresh configuration store -- and only the databases, which are
 * the thing under test, are shared.
 *
 * One row is added to the fixture on both engines: a second customer of
 * tenant 1, so a person can change an order's customer to another one they
 * may pick. Added here, in the host's run, rather than to the shared fixture,
 * whose two customers every other suite counts.
 *
 * What is provided is how to connect, not a connection: a worker cannot be
 * handed a socket.
 */

/** How the server under test reaches one database: what an allowlist entry holds, with the password itself. */
export interface DatabaseDetails {
  host: string
  port: number
  database: string
  user: string
  password: string
}

/**
 * The fixture's own values the suites type into the page, provided rather than
 * imported: `@formancy/data-fixtures` brings testcontainers, whose HTTP client
 * needs Node globals a jsdom worker does not have. So the suites read
 * `EDGE_VALUES` from here, and never retype fourteen nines.
 */
export interface Edges {
  orderDate: string
  largestAmount: string
  /** Tenant 1's seeded order, by the token the server gives its key: 2^53 + 1. */
  seededOrder: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    databases: { pg: DatabaseDetails; ms: DatabaseDetails }
    edges: Edges
  }
}


export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const pgUrl = new URL(pg.admin)
  const details = {
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
  }

  const sql = postgres(pg.admin, { onnotice: () => {} })
  try {
    await sql`insert into sales.customer (tenant_id, customer_no, name) values (1, ${SECOND_CUSTOMER.no}, ${SECOND_CUSTOMER.name})`
  } finally {
    await sql.end()
  }
  const pool = await new mssql.ConnectionPool(ms.admin).connect()
  try {
    await pool
      .request()
      .input('no', mssql.Int, SECOND_CUSTOMER.no)
      .input('name', mssql.NVarChar(200), SECOND_CUSTOMER.name)
      .query('insert into sales.customer (tenant_id, customer_no, name) values (1, @no, @name)')
  } finally {
    await pool.close()
  }

  project.provide('databases', details)
  project.provide('edges', { orderDate: EDGE_VALUES.orderDate, largestAmount: EDGE_VALUES.largestAmount, seededOrder: `k1:${EDGE_VALUES.beyondSafeInteger}` })
  return async () => {
    await Promise.all([pg.stop(), ms.stop()])
  }
}
