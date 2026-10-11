import mssql from 'mssql'
import type { Observer } from './engine-postgres.js'

/*
 * SQL Server as the measurement records it, read as the owner on a pool of
 * this package's own copy of mssql -- the types it binds come from the same
 * copy as the pool -- between blocks and never inside a timed window.
 */

/** Pages are 8 KiB; partition stats and database files count in pages. */
const PAGE = 8192

export async function observeSqlServer(admin: mssql.config): Promise<Observer> {
  const pool = await new mssql.ConnectionPool(admin).connect()
  const query = async <T>(text: string): Promise<T[]> => (await pool.request().query<T>(text)).recordset
  return {
    async facts() {
      const [server] = await query<{ version: string; edition: string; level: string | null; collation: string; memory: number }>(
        `select convert(nvarchar(128), serverproperty('ProductVersion')) as version, convert(nvarchar(128), serverproperty('Edition')) as edition,
                convert(nvarchar(128), serverproperty('ProductUpdateLevel')) as level,
                convert(nvarchar(128), databasepropertyex(db_name(), 'Collation')) as collation,
                (select physical_memory_kb from sys.dm_os_sys_info) as memory`,
      )
      const configured = await query<{ name: string; value: number }>(
        `select name, convert(bigint, value_in_use) as value from sys.configurations
         where name in ('max degree of parallelism', 'cost threshold for parallelism', 'max server memory (MB)')`,
      )
      const settings: Record<string, string> = Object.fromEntries(configured.map((row) => [row.name, String(row.value)]))
      settings['database collation'] = server?.collation ?? ''
      settings['physical_memory_kb'] = String(server?.memory ?? '')
      return { version: `${server?.version ?? ''} ${server?.edition ?? ''}${server?.level === null || server?.level === undefined ? '' : ` ${server.level}`}`, settings, text: null }
    },
    async sizes() {
      const pages = await query<{ tbl: string; index_id: number; used: number }>(
        `select object_name(object_id) as tbl, index_id, sum(used_page_count) as used from sys.dm_db_partition_stats
         where object_id in (object_id('sales.customer'), object_id('sales.[order]')) group by object_id, index_id`,
      )
      const files = await query<{ allocated: number; used: number }>(
        `select sum(convert(bigint, size)) as allocated, sum(convert(bigint, fileproperty(name, 'SpaceUsed'))) as used from sys.database_files`,
      )
      const tenants = await query<{ tenant: number; n: number }>(`select tenant_id as tenant, count(*) as n from sales.customer group by tenant_id order by tenant_id`)
      const [orders] = await query<{ n: number }>(`select count(*) as n from sales.[order]`)
      // The heap or the clustered index is the table's data; every other index is an index.
      const bytesOf = (table: string, data: boolean): number => pages.filter((row) => row.tbl === table && (row.index_id <= 1) === data).reduce((sum, row) => sum + row.used * PAGE, 0)
      const perTenant = Object.fromEntries(tenants.map((row) => [String(row.tenant), row.n]))
      return {
        customerRows: { total: Object.values(perTenant).reduce((sum, rows) => sum + rows, 0), perTenant },
        customerDataBytes: bytesOf('customer', true),
        customerIndexBytes: bytesOf('customer', false),
        orderRows: orders?.n ?? Number.NaN,
        databaseBytes: (files[0]?.allocated ?? Number.NaN) * PAGE,
        detail: { databaseUsedBytes: (files[0]?.used ?? Number.NaN) * PAGE, orderDataBytes: bytesOf('order', true), orderIndexBytes: bytesOf('order', false) },
      }
    },
    async disturbance() {
      // The counter is cumulative since the server started, whatever "/sec" says.
      const [recompiles] = await query<{ value: number }>(`select cntr_value as value from sys.dm_os_performance_counters where counter_name = 'SQL Re-Compilations/sec'`)
      // Every user table's statistics, not only the two the run writes: an
      // update on any of them is the engine's own work in the container.
      const stats = await query<{ name: string; updated: string | null }>(
        `select object_schema_name(s.object_id) + '.' + object_name(s.object_id) + '.' + s.name as name, convert(varchar(30), p.last_updated, 126) as updated
         from sys.stats s cross apply sys.dm_db_stats_properties(s.object_id, s.stats_id) p
         where objectproperty(s.object_id, 'IsUserTable') = 1`,
      )
      const reading: Record<string, number | string> = { recompiles: recompiles?.value ?? 0 }
      for (const row of stats) reading[`stat:${row.name}`] = row.updated ?? ''
      return reading
    },
    disturbances(before, after) {
      const updated = Object.keys(after).filter((key) => key.startsWith('stat:') && after[key] !== before[key]).length
      return { recompiles: Number(after['recompiles']) - Number(before['recompiles']), statisticsUpdated: updated }
    },
    async createdCustomers() {
      const [row] = await query<{ n: number }>(`select count(*) as n from (select distinct tenant_id, customer_no from sales.[order] where notes = N'performance') as created`)
      return row?.n ?? 0
    },
    async writerSessions() {
      const rows = await query<{ id: number; login: string }>(
        `select session_id as id, convert(varchar(30), login_time, 126) as login from sys.dm_exec_sessions where login_name = 'formancy_writer'`,
      )
      return new Set(rows.map((row) => `${String(row.id)}@${row.login}`))
    },
    close: () => pool.close(),
  }
}
