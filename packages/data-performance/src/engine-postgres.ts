import postgres from 'postgres'
import type { EngineFacts, SizeFacts } from './results.js'

/*
 * PostgreSQL as the measurement records it, read by the database's owner on
 * a connection of its own, between blocks and never inside a timed window:
 * its version and the settings 0034 names, its text behaviour as observed,
 * sizes, what autovacuum did on any table, and the writer's sessions.
 */

export interface Observer {
  facts(): Promise<Pick<EngineFacts, 'version' | 'settings' | 'text'>>
  sizes(): Promise<SizeFacts>
  /** An opaque reading of the disturbance counters, compared by `disturbances`. */
  disturbance(): Promise<Record<string, number | string>>
  disturbances(before: Record<string, number | string>, after: Record<string, number | string>): Record<string, number>
  /** Distinct customers the orders the run created reference: notes 'performance'. */
  createdCustomers(): Promise<number>
  /** The writer's sessions, each named so that a reconnect is a new name. */
  writerSessions(): Promise<Set<string>>
  close(): Promise<void>
}

const SETTINGS = ['shared_buffers', 'work_mem', 'max_parallel_workers_per_gather', 'max_worker_processes', 'jit'] as const

export function observePostgres(admin: string): Observer {
  const sql = postgres(admin, { onnotice: () => {}, max: 1 })
  return {
    async facts() {
      const [version] = await sql<Array<{ v: string }>>`select version() as v`
      const settings: Record<string, string> = {}
      for (const name of SETTINGS) {
        const [row] = await sql<Array<{ value: string }>>`select current_setting(${name}) as value`
        settings[name] = row?.value ?? ''
      }
      const [more] = await sql<Array<{ jit: boolean; collate: string; ctype: string }>>`
        select pg_jit_available() as jit, datcollate as collate, datctype as ctype from pg_database where datname = current_database()`
      settings['pg_jit_available'] = String(more?.jit)
      settings['datcollate'] = more?.collate ?? ''
      settings['datctype'] = more?.ctype ?? ''
      // Observed, not named: on musl the default collation orders by code
      // point, so 'B' sorts before 'a', and lower() folds no umlaut.
      const [text] = await sql<Array<{ cp: boolean; fold: boolean }>>`select 'B' < 'a' as cp, lower('Ä') = 'ä' as fold`
      return { version: version?.v ?? '', settings, text: { codePointOrder: text?.cp === true, lowerFoldsUmlaut: text?.fold === true } }
    },
    async sizes() {
      const [row] = await sql<Array<Record<string, string>>>`
        select pg_table_size('sales.customer')::text as customer_table, pg_indexes_size('sales.customer')::text as customer_indexes,
               pg_total_relation_size('sales.customer')::text as customer_total,
               pg_table_size('sales."order"')::text as order_table, pg_indexes_size('sales."order"')::text as order_indexes,
               pg_total_relation_size('sales."order"')::text as order_total,
               (select count(*) from sales."order")::text as orders, pg_database_size(current_database())::text as database`
      const tenants = await sql<Array<{ tenant: number; rows: string }>>`select tenant_id as tenant, count(*)::text as rows from sales.customer group by tenant_id order by tenant_id`
      const value = (name: string): number => Number(row?.[name] ?? Number.NaN)
      const perTenant = Object.fromEntries(tenants.map((tenant) => [String(tenant.tenant), Number(tenant.rows)]))
      return {
        customerRows: { total: Object.values(perTenant).reduce((sum, rows) => sum + rows, 0), perTenant },
        customerDataBytes: value('customer_table'),
        customerIndexBytes: value('customer_indexes'),
        orderRows: value('orders'),
        databaseBytes: value('database'),
        detail: { customerTotalBytes: value('customer_total'), orderTableBytes: value('order_table'), orderIndexBytes: value('order_indexes'), orderTotalBytes: value('order_total') },
      }
    },
    async disturbance() {
      // Every table of the database, the catalog's and TOAST's included, not
      // only the two the run writes: the engine's own work on any of them is
      // CPU in the container that a block is charged.
      const rows = await sql<Array<{ autovacuum: string; autoanalyze: string }>>`
        select coalesce(sum(autovacuum_count), 0)::text as autovacuum, coalesce(sum(autoanalyze_count), 0)::text as autoanalyze
        from pg_stat_all_tables`
      return { autovacuum: Number(rows[0]?.autovacuum), autoanalyze: Number(rows[0]?.autoanalyze) }
    },
    disturbances(before, after) {
      return { autovacuum: Number(after['autovacuum']) - Number(before['autovacuum']), autoanalyze: Number(after['autoanalyze']) - Number(before['autoanalyze']) }
    },
    async createdCustomers() {
      const [row] = await sql<Array<{ n: number }>>`select count(distinct (tenant_id, customer_no))::int as n from sales."order" where notes = 'performance'`
      return row?.n ?? 0
    },
    async writerSessions() {
      const rows = await sql<Array<{ pid: number; started: string }>>`select pid, backend_start::text as started from pg_stat_activity where usename = 'formancy_writer'`
      return new Set(rows.map((row) => `${String(row.pid)}@${row.started}`))
    },
    close: () => sql.end({ timeout: 5 }),
  }
}
