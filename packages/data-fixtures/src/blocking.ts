import type { ObjectRef } from '@formancy/data-core'
import mssql from 'mssql'
import postgres from 'postgres'

/*
 * A table held behind an exclusive lock, so a statement that reads it waits
 * in the database for as long as a suite wants it to (0061). A cancelled
 * lookup is proved gone by the count of waiters falling to 0 while the lock
 * is still held: a statement that waits is one the database is still
 * running, and one that stopped waiting before the lock went was stopped by
 * its cancel. A sleep would prove the same of a statement the suite wrote,
 * not of the adapter's own.
 *
 * As the owner, on a connection of its own, never the account under test.
 */

export interface BlockedTable {
  /** How many statements wait for the lock now. */
  waiting(): Promise<number>
  /** Rolls the holding transaction back, which lets every waiter through, and closes the helper's connections. */
  release(): Promise<void>
}

export type BlockingDatabase = { kind: 'postgres'; admin: string } | { kind: 'sqlserver'; admin: mssql.config }

const pgName = (name: string): string => `"${name.replaceAll('"', '""')}"`
const msName = (name: string): string => `[${name.replaceAll(']', ']]')}]`

/** Locks `table` in its own transaction until `release()`: PostgreSQL's access exclusive mode, SQL Server's exclusive table lock held to the end. */
export async function blockTable(database: BlockingDatabase, table: ObjectRef): Promise<BlockedTable> {
  return database.kind === 'postgres' ? blockPostgres(database.admin, table) : blockSqlServer(database.admin, table)
}

async function blockPostgres(admin: string, table: ObjectRef): Promise<BlockedTable> {
  // Two connections: one holds the lock, the other asks pg_locks who waits for it.
  const sql = postgres(admin, { max: 2, onnotice: () => {} })
  const qualified = `${pgName(table.schema)}.${pgName(table.name)}`
  const holder = await sql.reserve()
  try {
    await holder.unsafe('begin')
    await holder.unsafe(`lock table ${qualified} in access exclusive mode`)
  } catch (error) {
    holder.release()
    await sql.end({ timeout: 5 })
    throw error
  }
  return {
    async waiting() {
      const [row] = await sql.unsafe<Array<{ n: number }>>('select count(*)::int as n from pg_catalog.pg_locks where not granted and relation = $1::regclass', [
        qualified,
      ])
      return row?.n ?? 0
    },
    async release() {
      try {
        await holder.unsafe('rollback')
      } finally {
        holder.release()
        await sql.end({ timeout: 5 })
      }
    },
  }
}

async function blockSqlServer(admin: mssql.config, table: ObjectRef): Promise<BlockedTable> {
  const pool = await new mssql.ConnectionPool({ ...admin, pool: { min: 0, max: 2 } }).connect()
  const transaction = new mssql.Transaction(pool)
  try {
    // A reader waits behind the lock only under locking read committed; under
    // row versioning it would read the last committed version and never wait,
    // and every "the statement is gone" assertion would pass for nothing.
    const versioned = await pool.request().query<{ on: boolean }>('select is_read_committed_snapshot_on as [on] from sys.databases where database_id = db_id()')
    if (versioned.recordset[0]?.on !== false)
      throw new Error('blockTable needs locking read committed; this database reads row versions (is_read_committed_snapshot_on = 1)')
    await transaction.begin()
    const held = await new mssql.Request(transaction).query<{ spid: number }>(
      `select @@spid as spid; select top (0) 1 as locked from ${msName(table.schema)}.${msName(table.name)} with (tablockx, holdlock)`,
    )
    const spid = held.recordset[0]?.spid
    if (spid === undefined) throw new Error('the lock holder did not say which session it is')
    return {
      async waiting() {
        const result = await pool
          .request()
          .input('spid', mssql.SmallInt, spid)
          .query<{ n: number }>('select count(*) as n from sys.dm_exec_requests where blocking_session_id = @spid')
        return result.recordset[0]?.n ?? 0
      },
      async release() {
        try {
          await transaction.rollback()
        } finally {
          await pool.close()
        }
      },
    }
  } catch (error) {
    await pool.close()
    throw error
  }
}
