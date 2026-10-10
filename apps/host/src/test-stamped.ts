import { createDataServer } from '@formancy/data-server'
import mssql from 'mssql'
import postgres from 'postgres'
import { inject } from 'vitest'

/*
 * The table the two temporal suites save through the runtime plane (0040),
 * created by each in a schema of its own on the run's databases, and what the
 * database holds of it, asked of the owner as another application would.
 *
 * `created_at` is what the fixture's own `customer.created_at` is on each
 * engine: defaulted by `now()`, microseconds, and by `sysdatetimeoffset()`,
 * seven digits. `at_time` holds seconds and a fraction at the precision
 * recommendation 1 of the gap analysis names, `time(6)` and `time(7)`. Both
 * engines read the one to the second and the other to the minute, so every
 * unedited save echoes a value shorter than the stored one.
 *
 * What the owner reads back is each column's text in one fixed spelling and
 * the engine's own bytes -- `timestamptz_send` and `time_send`, `varbinary`
 * -- so "unchanged" means byte for byte, not as a driver parses it, and the
 * version, so "nothing was written" means the version did not move.
 */

export type Engine = 'pg' | 'ms'

export const ENGINE_NAME = { pg: 'PostgreSQL', ms: 'SQL Server' } as const

/** The database's owner on each engine: the account that creates the tables and checks what they hold. */
export interface Owners {
  pg: postgres.Sql
  ms: mssql.ConnectionPool
}

/** One temporal column as the database holds it. */
export interface Stored {
  text: string
  bytes: string
}

export interface Held {
  note: string
  created_at: Stored
  at_time: Stored
  /** PostgreSQL's version column, SQL Server's rowversion as hex. */
  version: string
}

/** The owner on both engines. TimeZone fixed on PostgreSQL's, so its text has one spelling; the bytes need no setting. */
export async function connectOwners(): Promise<Owners> {
  const { pg, ms } = inject('databases')
  return {
    pg: postgres({ host: pg.host, port: pg.port, database: pg.database, username: pg.user, password: pg.password, onnotice: () => {}, connection: { TimeZone: 'UTC' } }),
    ms: await new mssql.ConnectionPool({ server: ms.host, port: ms.port, database: ms.database, user: ms.user, password: ms.password, options: { encrypt: false, trustServerCertificate: true } }).connect(),
  }
}

/** `schema.stamped` on both engines, with the version each form is guarded by: PostgreSQL's confirmed column, SQL Server's rowversion. */
export async function createStamped(owners: Owners, schema: string): Promise<void> {
  await owners.pg.unsafe(`
    create schema ${schema};
    create table ${schema}.stamped (
      id integer generated always as identity constraint pk_${schema}_stamped primary key,
      tenant_id integer not null,
      note varchar(50) not null,
      created_at timestamptz not null default now(),
      at_time time(6) not null,
      row_version bigint not null default 1
    );
  `)
  await owners.ms.request().batch(`create schema ${schema}`)
  await owners.ms.request().batch(`
    create table ${schema}.stamped (
      id int identity constraint pk_${schema}_stamped primary key,
      tenant_id int not null,
      note nvarchar(50) not null,
      created_at datetimeoffset(7) not null constraint df_${schema}_created_at default sysdatetimeoffset(),
      at_time time(7) not null,
      rv rowversion
    )
  `)
}

/** Drops what `createStamped` made, and the tables the caller names beside it, on both engines. */
export async function dropStamped(owners: Owners, schema: string, others: readonly string[] = []): Promise<void> {
  await owners.pg.unsafe(`drop schema if exists ${schema} cascade`)
  for (const table of ['stamped', ...others]) await owners.ms.request().batch(`drop table if exists ${schema}.${table}`)
  await owners.ms.request().batch(`drop schema if exists ${schema}`)
}

/**
 * A row of tenant 1, written by the owner, every value bound as text and
 * converted by the server, so no driver serializer touches a fraction.
 * `createdAt` undefined: the column's default writes it, `now()` or
 * `sysdatetimeoffset()`, as it would for a row another application
 * inserted. Returns the record token the runtime plane names it by.
 */
export async function insertStamped(owners: Owners, schema: string, engine: Engine, row: { note: string; atTime: string; createdAt?: string }): Promise<string> {
  if (engine === 'pg') {
    const [inserted] =
      row.createdAt === undefined
        ? await owners.pg.unsafe<Array<{ id: number }>>(`insert into ${schema}.stamped (tenant_id, note, at_time) values (1, $1::text, $2::text::time) returning id`, [row.note, row.atTime])
        : await owners.pg.unsafe<Array<{ id: number }>>(`insert into ${schema}.stamped (tenant_id, note, at_time, created_at) values (1, $1::text, $2::text::time, $3::text::timestamptz) returning id`, [row.note, row.atTime, row.createdAt])
    return `k1:${String(inserted?.id)}`
  }
  const request = owners.ms.request().input('note', mssql.NVarChar(50), row.note).input('at', mssql.NVarChar(30), row.atTime)
  const result =
    row.createdAt === undefined
      ? await request.query<{ id: number }>(`insert into ${schema}.stamped (tenant_id, note, at_time) output inserted.id values (1, @note, convert(time(7), @at))`)
      : await request
          .input('created', mssql.NVarChar(40), row.createdAt)
          .query<{ id: number }>(`insert into ${schema}.stamped (tenant_id, note, at_time, created_at) output inserted.id values (1, @note, convert(time(7), @at), convert(datetimeoffset(7), @created))`)
  return `k1:${String(result.recordset[0]?.id)}`
}

/** What the database holds for the row, asked of the owner. */
export async function heldStamped(owners: Owners, schema: string, engine: Engine, record: string): Promise<Held> {
  const id = Number(record.slice(3))
  if (engine === 'pg') {
    const [row] = await owners.pg.unsafe<Array<{ note: string; ct: string; cb: string; tt: string; tb: string; version: string }>>(
      `select note,
              created_at::text as ct, encode(pg_catalog.timestamptz_send(created_at), 'hex') as cb,
              at_time::text as tt, encode(pg_catalog.time_send(at_time), 'hex') as tb,
              row_version::text as version
       from ${schema}.stamped where id = $1`,
      [id],
    )
    if (row === undefined) throw new Error(`no row ${String(id)}`)
    return { note: row.note, created_at: { text: row.ct, bytes: row.cb }, at_time: { text: row.tt, bytes: row.tb }, version: row.version }
  }
  const result = await owners.ms
    .request()
    .input('id', mssql.Int, id)
    .query<{ note: string; ct: string; cb: Buffer; tt: string; tb: Buffer; version: Buffer }>(
      `select note,
              cast(created_at as nvarchar(40)) as ct, cast(created_at as varbinary(16)) as cb,
              cast(at_time as nvarchar(20)) as tt, cast(at_time as varbinary(16)) as tb,
              cast(rv as varbinary(8)) as version
       from ${schema}.stamped where id = @id`,
    )
  const row = result.recordset[0]
  if (row === undefined) throw new Error(`no row ${String(id)}`)
  const hex = (bytes: Buffer) => Buffer.from(bytes).toString('hex')
  return { note: row.note, created_at: { text: row.ct, bytes: hex(row.cb) }, at_time: { text: row.tt, bytes: hex(row.tb) }, version: hex(row.version) }
}

/**
 * The default really wrote a fraction, or a case would prove nothing: `now()`
 * and `sysdatetimeoffset()` can land on a whole second.
 */
export function holdsFraction(held: Held): boolean {
  return /\.\d*[1-9]/.test(held.created_at.text)
}

/** One request as the page or the client sent it. */
export interface Sent {
  path: string
  body: string | undefined
}

/**
 * `app.inject` as a `fetch`, recording each request's path and body into
 * `sent`: the host suites' plane (`test-plane.ts`) without its extras, over a
 * server of the suite's own.
 */
export function fetchThrough(app: Awaited<ReturnType<typeof createDataServer>>, sent: Sent[]): typeof fetch {
  return async (input, init) => {
    const href = input instanceof Request ? input.url : String(input)
    const url = new URL(href, 'http://host.test')
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = typeof init?.body === 'string' ? init.body : undefined
    sent.push({ path: url.pathname, body })
    init?.signal?.throwIfAborted()
    const reply = await app.inject({ method: method as 'GET' | 'POST', url: `${url.pathname}${url.search}`, headers, ...(body === undefined ? {} : { payload: body }) })
    const answered = new Headers()
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined) answered.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: answered })
  }
}

/** The update bodies `sent` holds from `from` on: what the server was asked to write. */
export function updatesIn(sent: readonly Sent[], from: number): unknown[] {
  return sent.slice(from).filter((entry) => entry.path.endsWith('/records/update')).map((entry) => JSON.parse(entry.body ?? 'null') as unknown)
}
