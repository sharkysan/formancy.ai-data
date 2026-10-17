import { POSTGRES_IMAGE, readFixture, startPostgresContainer } from '@formancy/data-fixtures'
import type { StartedPostgreSqlContainer, StartedServer } from '@formancy/data-fixtures'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { generateDemoData } from './generate.js'
import { demoDataProblems } from './invariants.js'
import type { DemoData, OrderStatus, Tenant } from './model.js'
import { demoSql } from './render.js'
import { FIXTURE_COUNTRIES } from './words.js'

/**
 * The demo's SQL loaded as the image loads it -- the fixture's postgres.sql,
 * byte for byte as every suite loads it, then the demo's rows, in one
 * transaction -- into PostgreSQL 17, the image the demo's own is built from
 * (data-fixtures' POSTGRES_IMAGE, named, so FORMANCY_IMAGES never moves it,
 * and started through startPostgresContainer so the release report records
 * the server). Then the database is asked: the
 * rows it holds are exactly the ones generated, they hold every invariant
 * as it stores them, its own `line_total` adds up to each order's amount,
 * every foreign key is valid, each identity starts past its rows, and two
 * loads are alike to the last column.
 *
 * The beforeAll prints a "demo data" line on every run: rows per table, the
 * SQL's bytes, generating it, loading it with the fixture, and the
 * database's size loaded and empty. Measured on 2026-10-17, three runs, on
 * the Windows 11 workstation with Docker Desktop's engine 28.3.3, Node
 * 24.21.0, against postgres:17-alpine (PostgreSQL 17.11), once deliveries
 * shipped on weekdays alone and no shipped order said the customer
 * collects it: 7 countries added to the fixture's 2, 18 employees, 240
 * customers, 840 orders, 2,885 lines, 864 deliveries and 1,726 parcels;
 * 344,556 bytes of SQL; generated and rendered in 53-71 ms in process;
 * loaded with the fixture in one transaction in 403-431 ms;
 * `pg_database_size` 8,951,475 bytes after the load against 7,537,167 for
 * an empty database, so the load adds 1,414,308. On 2026-10-16, before
 * those two rules, the same rows were 344,490 bytes, generated in 44-46 ms
 * (`node dist/data/cli.mjs`, Node's start included, 194-234 ms) and loaded
 * in 371-388 ms. Those are this seed's rows; another seed or generator
 * gives others, and the line says which.
 */
let started: StartedServer<StartedPostgreSqlContainer>
const connections: postgres.Sql[] = []
const data = generateDemoData()
const sql = demoSql(data)

/** One load's database, as the image's is after its build. */
let first: postgres.Sql
/** Another, loaded the same way, to compare against. */
let second: postgres.Sql

/** What a query needs of a connection or a transaction: the reads here are constant text. */
type Db = Pick<postgres.Sql, 'unsafe'>

function connect(database: string): postgres.Sql {
  const url = new URL(started.container.getConnectionUri())
  url.pathname = `/${database}`
  const connection = postgres(url.toString(), { onnotice: () => {}, max: 1 })
  connections.push(connection)
  return connection
}

/** The fixture and the demo's rows in one transaction, as `psql -1` loads them in the image. */
async function load(db: postgres.Sql): Promise<void> {
  await db.begin(async (tx) => {
    // Simple-query protocol: each file is several statements and has no parameters.
    await tx.unsafe(readFixture('postgres.sql'))
    await tx.unsafe(sql)
  })
}

/** Whole cents from a numeric's text at its column's scale, refusing a digit past the cents. */
function cents(value: string, scale: number): number {
  const match = /^(\d+)\.(\d{2})(\d*)$/.exec(value)
  if (match === null || match[3]?.length !== scale - 2 || /[^0]/.test(match[3])) throw new Error(`${value} is not whole cents at a scale of ${String(scale)}`)
  return Number(match[1]) * 100 + Number(match[2])
}

/** Every row the demo's SQL wrote, read back into the generator's shape, each list in the generator's order. */
async function readBack(db: Db): Promise<DemoData> {
  const countries = await db.unsafe<Array<{ iso_code: string; name: string }>>('select iso_code, name from sales.country order by iso_code')
  const employees = await db.unsafe<Array<{ id: number; name: string; manager_id: number | null }>>('select id, name, manager_id from sales.employee order by id')
  const customers = await db.unsafe<Array<{ tenant_id: number; customer_no: number; name: string; country_code: string; credit_limit: string | null; active: boolean; created_at: Date }>>(
    'select tenant_id, customer_no, name, country_code, credit_limit::text as credit_limit, active, created_at from sales.customer order by tenant_id, customer_no',
  )
  const orders = await db.unsafe<
    Array<{ id: string; tenant_id: number; customer_no: number; order_date: string; status: string; amount: string; notes: string | null; group: string | null; created_by: number; approved_by: number | null }>
  >('select id::text as id, tenant_id, customer_no, order_date::text as order_date, status, amount::text as amount, notes, "group", created_by, approved_by from sales."order" o order by o.id')
  const lines = await db.unsafe<Array<{ order_id: string; line_no: number; quantity: number; unit_price: string }>>(
    // Sorted by the columns, not their text: order 10 after order 9.
    'select order_id::text as order_id, line_no, quantity, unit_price::text as unit_price from sales.order_line l order by l.order_id, l.line_no',
  )
  const deliveries = await db.unsafe<Array<{ id: string; tenant_id: number; order_id: string; carrier: string; shipped_at: Date }>>(
    'select id::text as id, tenant_id, order_id::text as order_id, carrier, shipped_at from sales.delivery d order by d.order_id, d.id',
  )
  const parcels = await db.unsafe<Array<{ id: number; delivery_id: string; label: string }>>('select id, delivery_id::text as delivery_id, label from sales.parcel order by id')
  // `group` is no field of the generator's: the demo leaves it empty, and a value there is a difference to see.
  const grouped = orders.filter((order) => order.group !== null).map((order) => order.id)
  if (grouped.length > 0) throw new Error(`orders ${grouped.join(', ')} have a group, which the demo leaves empty`)
  return {
    countries: countries.filter((country) => !FIXTURE_COUNTRIES.includes(country.iso_code)).map((country) => ({ isoCode: country.iso_code, name: country.name })),
    employees: employees.map((employee) => ({ id: employee.id, name: employee.name, managerId: employee.manager_id })),
    customers: customers.map((customer) => ({
      tenantId: customer.tenant_id as Tenant,
      customerNo: customer.customer_no,
      name: customer.name,
      countryCode: customer.country_code,
      creditLimitCents: customer.credit_limit === null ? null : cents(customer.credit_limit, 2),
      active: customer.active,
      createdAt: customer.created_at.getTime(),
    })),
    orders: orders.map((order) => ({
      id: Number(order.id),
      tenantId: order.tenant_id as Tenant,
      customerNo: order.customer_no,
      orderDate: order.order_date,
      status: order.status as OrderStatus,
      amountCents: cents(order.amount, 4),
      notes: order.notes,
      createdBy: order.created_by,
      approvedBy: order.approved_by,
    })),
    lines: lines.map((line) => ({ orderId: Number(line.order_id), lineNo: line.line_no, quantity: line.quantity, unitPriceCents: cents(line.unit_price, 2) })),
    deliveries: deliveries.map((delivery) => ({ id: delivery.id, tenantId: delivery.tenant_id as Tenant, orderId: Number(delivery.order_id), carrier: delivery.carrier, shippedAt: delivery.shipped_at.getTime() })),
    parcels: parcels.map((parcel) => ({ id: parcel.id, deliveryId: parcel.delivery_id, label: parcel.label })),
  }
}

/** The generated rows in the order readBack reads them: deliveries by order, then id. */
function asRead(rows: DemoData): DemoData {
  return { ...rows, deliveries: [...rows.deliveries].sort((a, b) => a.orderId - b.orderId || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }
}

/** Orders whose amount is not the sum of the database's own `line_total` over their lines. */
const AMOUNTS_OFF = `select o.id::text as id, o.amount::text as amount, coalesce(sum(l.line_total), 0)::text as total
  from sales."order" o left join sales.order_line l on l.order_id = o.id
  group by o.id, o.amount
  having o.amount <> coalesce(sum(l.line_total), 0)
  order by o.id`

/** Every table of sales, each row as the database writes it as text, in a fixed order: what two loads are compared by. */
async function dump(db: Db): Promise<Record<string, string[]>> {
  const tables = await db.unsafe<Array<{ name: string }>>(
    "select quote_ident(table_name) as name from information_schema.tables where table_schema = 'sales' and table_type = 'BASE TABLE' order by table_name",
  )
  const rows: Record<string, string[]> = {}
  // The names are the catalog's own, quoted by the database.
  for (const { name } of tables) rows[name] = (await db.unsafe<Array<{ text: string }>>(`select t::text as text from sales.${name} t order by 1`)).map((each) => each.text)
  return rows
}

/** Thrown to roll a transaction back once a test has read what it changed. */
class Rollback extends Error {}

async function inRolledBack<T>(db: postgres.Sql, work: (tx: Db) => Promise<T>): Promise<T> {
  let result: T | undefined
  await db
    .begin(async (tx) => {
      result = await work(tx)
      throw new Rollback()
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error
    })
  return result as T
}

beforeAll(async () => {
  const generation = performance.now()
  demoSql(generateDemoData())
  const generationMs = performance.now() - generation
  started = await startPostgresContainer(POSTGRES_IMAGE)
  const owner = postgres(started.container.getConnectionUri(), { onnotice: () => {}, max: 1 })
  try {
    await owner.unsafe('create database demo_first')
    await owner.unsafe('create database demo_second')
    // Never loaded: what an empty database weighs, so the load's own share can be read off.
    await owner.unsafe('create database demo_empty')
  } finally {
    await owner.end()
  }
  first = connect('demo_first')
  second = connect('demo_second')
  const loading = performance.now()
  await load(first)
  const loadMs = performance.now() - loading
  await load(second)
  const [size] = await first.unsafe<Array<{ loaded: string; empty: string }>>("select pg_database_size('demo_first')::text as loaded, pg_database_size('demo_empty')::text as empty")
  const counts = Object.fromEntries(Object.entries(await dump(first)).map(([table, rows]) => [table, rows.length]))
  console.log(
    `demo data, ${new Date().toISOString()}: ${JSON.stringify({
      server: started.server.version,
      rows: counts,
      sqlBytes: Buffer.byteLength(sql, 'utf8'),
      generationMs: Math.round(generationMs),
      loadMs: Math.round(loadMs),
      databaseBytes: Number(size?.loaded),
      emptyDatabaseBytes: Number(size?.empty),
    })}`,
  )
})

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.end()))
  await started?.container.stop()
})

describe('the demo data, loaded after the fixture', () => {
  // The rows the database holds are the rows generated, value for value: a
  // quote, a decimal, an instant or a uuid the SQL wrote differently from
  // what the generator meant would differ here, naming the field.
  test('reads back as exactly the rows generated', async () => {
    expect(await readBack(first)).toEqual(asRead(data))
  })

  // The invariants asked of the database's copy, not the generator's: what
  // a visitor's server will hold.
  test('holds every invariant as the database stores it', async () => {
    expect(demoDataProblems(await readBack(first))).toEqual([])
  })

  // `line_total` is the database's generated column, quantity × unit price;
  // the order's amount is written by the generator. The two agree to the
  // last decimal, in the database's arithmetic.
  test('gives each order an amount its lines’ line_total adds up to, by the database’s own sum', async () => {
    expect(await first.unsafe(AMOUNTS_OFF)).toEqual([])
  })

  // A check that read nothing, or read the generator's rows instead of the
  // database's, would pass anything. One line changed in a transaction that
  // is then rolled back must show in both, naming its order.
  test('sees a line changed in the database, in the sum and in the invariants', async () => {
    const seen = await inRolledBack(first, async (tx) => {
      await tx.unsafe('update sales.order_line set quantity = quantity + 1 where order_id = 1 and line_no = 1')
      return { off: await tx.unsafe(AMOUNTS_OFF), problems: demoDataProblems(await readBack(tx)) }
    })
    expect(seen.off).toEqual([expect.objectContaining({ id: '1' })])
    expect(seen.problems).toContainEqual(expect.stringMatching(new RegExp(`^order 1: amount [\\d.]+ is not its lines' sum`)))
    expect(await first.unsafe(AMOUNTS_OFF)).toEqual([])
  })

  // The fixture adds fk_employee_manager NOT VALID over an employee whose
  // manager does not exist; the demo validates it, which proves its
  // hierarchy. Every other key was checked as each row went in.
  test('leaves no foreign key unvalidated, fk_employee_manager among them', async () => {
    expect(await first.unsafe("select conname from pg_constraint where connamespace = 'sales'::regnamespace and contype = 'f' and not convalidated")).toEqual([])
    expect(await first.unsafe("select convalidated from pg_constraint where conname = 'fk_employee_manager'")).toEqual([{ convalidated: true }])
  })

  // The keys are written explicitly; an identity left where the fixture had
  // it would hand a visitor's first new order, or parcel, a key already
  // taken, and the insert would fail as a duplicate.
  test('starts each identity past its rows', async () => {
    const identities = await first.unsafe<Array<{ relation: string; attribute: string; sequence: string }>>(
      "select quote_ident(table_name) as relation, quote_ident(column_name) as attribute, pg_get_serial_sequence(format('sales.%I', table_name), column_name) as sequence from information_schema.columns where table_schema = 'sales' and is_identity = 'YES' order by table_name",
    )
    expect(identities.map((identity) => identity.relation)).toEqual(['country', '"order"', 'parcel', 'shipment'])
    // The names are the catalog's own, quoted by the database.
    for (const { relation: table, attribute: column, sequence } of identities) {
      const [{ highest } = { highest: null }] = await first.unsafe<Array<{ highest: string | null }>>(`select max(${column})::text as highest from sales.${table}`)
      const [state] = await first.unsafe<Array<{ last_value: string; is_called: boolean }>>(`select last_value::text as last_value, is_called from ${sequence}`)
      const next = Number(state?.last_value) + (state?.is_called === true ? 1 : 0)
      expect(next, `${table}'s next ${column}`).toBeGreaterThan(Number(highest ?? 0))
    }
  })

  // The fixture's edge rows -- the order numbered 2^53 + 1, the orphaned
  // employee, the two shipments -- are the adapter suites' and never the
  // demo's; its countries stay, the ones customers reference.
  test('replaces the fixture’s rows and keeps its two countries', async () => {
    expect(await first.unsafe("select count(*)::int as n from sales.\"order\" where id > 840 or tenant_id not in (1, 2)")).toEqual([{ n: 0 }])
    expect(await first.unsafe("select count(*)::int as n from sales.employee where name = 'Orphan'")).toEqual([{ n: 0 }])
    expect(await first.unsafe('select count(*)::int as n from sales.shipment')).toEqual([{ n: 0 }])
    expect(await first.unsafe("select iso_code, name from sales.country where iso_code in ('CH', 'DE') order by iso_code")).toEqual([
      { iso_code: 'CH', name: 'Switzerland' },
      { iso_code: 'DE', name: 'Germany' },
    ])
  })

  // Every build loads the same rows: a value the SQL left to a default --
  // a gen_random_uuid() key, a now() -- would differ between two loads.
  test('is alike in two loads, every column of every table', async () => {
    const [one, two] = await Promise.all([dump(first), dump(second)])
    expect(Object.keys(one)).toEqual(['country', 'customer', 'delivery', 'employee', '"order"', 'order_line', 'parcel', 'shipment'])
    expect(one['"order"']?.length).toBe(data.orders.length)
    expect(two).toEqual(one)
  })
})
