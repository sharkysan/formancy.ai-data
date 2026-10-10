import mssql from 'mssql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { PostgresFixture, SqlServerFixture } from './containers.js'
import { startPostgresFixture, startSqlServerFixture } from './containers.js'
import { loadSizedCustomers, verifySizedCustomers } from './sized-load.js'
import type { SizedLoad } from './sized-load.js'
import { sizedCustomer, SIZED_CUSTOMERS } from './sized.js'

/**
 * The sized `sales.customer` (0034) loads into both engines and reads back as
 * exactly what the generator says, and the read-back is a real check: one
 * changed name fails it, naming the key.
 *
 * In containers of this file's own, so no other suite ever sees a million
 * customers (fileParallelism is off, and each integration file starts its
 * own). The load's seconds are printed for 0034's P6.
 */
let pg: PostgresFixture
let ms: SqlServerFixture
const loads: Partial<Record<'postgres' | 'sqlserver', SizedLoad>> = {}

/** The row the mutation changes: tenant 1's 50,000th generated customer, the one `unique` names. */
const CHANGED = sizedCustomer(50_000)

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  // One after the other, so each load's seconds are its own and not a share of two.
  loads.postgres = await loadSizedCustomers({ kind: 'postgres', admin: pg.admin })
  loads.sqlserver = await loadSizedCustomers({ kind: 'sqlserver', admin: ms.admin })
  console.log(`sized load, ${new Date().toISOString()}: ${JSON.stringify(loads)}`)
})

afterAll(async () => {
  await Promise.all([pg?.stop(), ms?.stop()])
})

describe.each(['postgres', 'sqlserver'] as const)('the sized customers on %s', (kind) => {
  // The counts 0034 states: the generated rows and the fixture's own two, a
  // tenth of them in the measured tenant. A loader that skipped a chunk, or
  // ran one twice, would be refused here by count and by the row-by-row
  // read-back before it.
  test('load, read back and count as the generator says', () => {
    const load = loads[kind]
    expect(load).toMatchObject({ rows: SIZED_CUSTOMERS.rows + 2, perTenant: { 1: 100_001, 2: 900_001 } })
    expect(load?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  // A read-back that compared counts, or a digest it never compared, would
  // pass a table with one name changed; the measurement would then expect
  // a page the database cannot answer. The owner changes one name and the
  // verifier must refuse, naming that key; then the name is put back.
  test('refuses a table with one name changed, naming its key', async () => {
    const changed = `${CHANGED.name} Changed`
    if (kind === 'postgres') {
      const sql = postgres(pg.admin, { onnotice: () => {}, max: 1 })
      try {
        await sql`update sales.customer set name = ${changed} where tenant_id = ${CHANGED.tenantId} and customer_no = ${CHANGED.customerNo}`
        await expect(verifySizedCustomers({ kind, admin: pg.admin })).rejects.toThrow(`sales.customer (1, ${String(CHANGED.customerNo)}) is named "${changed}"`)
        await sql`update sales.customer set name = ${CHANGED.name} where tenant_id = ${CHANGED.tenantId} and customer_no = ${CHANGED.customerNo}`
      } finally {
        await sql.end()
      }
    } else {
      const pool = await new mssql.ConnectionPool(ms.admin).connect()
      const rename = (name: string) =>
        pool
          .request()
          .input('name', mssql.NVarChar(200), name)
          .input('t', mssql.Int, CHANGED.tenantId)
          .input('n', mssql.Int, CHANGED.customerNo)
          .query('update sales.customer set name = @name where tenant_id = @t and customer_no = @n')
      try {
        await rename(changed)
        await expect(verifySizedCustomers({ kind, admin: ms.admin })).rejects.toThrow(`sales.customer (1, ${String(CHANGED.customerNo)}) is named "${changed}"`)
        await rename(CHANGED.name)
      } finally {
        await pool.close()
      }
    }
    // Put back, it verifies again: the refusal was the change's, not the verifier's.
    expect((await verifySizedCustomers(kind === 'postgres' ? { kind, admin: pg.admin } : { kind, admin: ms.admin })).digest).toBe(loads[kind]?.digest)
  })
})
