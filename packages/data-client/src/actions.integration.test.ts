import { ACTION_DECLINED_REASON, actionToken } from '@formancy/data-fixtures'
import mssql from 'mssql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { inject } from 'vitest'
import { isUnknownAction } from './actions.js'
import type { ActionOutcome } from './actions.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * An action run over the open record through the client (0161), on both
 * engines, across real HTTP into the real server, its drivers and the
 * actions' own pool (0160): the form offers the action with its dialog,
 * a run commits and moves the version, the same run from the same read is
 * stale, the deployment's refusal reaches the person in its words, and
 * another tenant's record is not found. What one transaction stores, and
 * what a version that moved refuses, are database answers, so they are
 * asked of the databases.
 */

let plane: Plane
let pgOwner: postgres.Sql
let msOwner: mssql.ConnectionPool

beforeAll(async () => {
  plane = await startPlane({ actions: true })
  const { pg, ms } = inject('databases')
  pgOwner = postgres({ host: pg.host, port: pg.port, database: pg.database, username: pg.user, password: pg.password, onnotice: () => {} })
  msOwner = await new mssql.ConnectionPool({
    server: ms.host,
    port: ms.port,
    database: ms.database,
    user: ms.user,
    password: ms.password,
    options: { encrypt: false, trustServerCertificate: true },
  }).connect()
})

afterAll(async () => {
  await plane?.close()
  await pgOwner?.end({ timeout: 5 })
  await msOwner?.close()
})

/** An order of the actions schema of `tenant`, through a customer of its own, as the owner inserts it: its token. */
async function order(connection: 'pg' | 'ms', tenant: number): Promise<string> {
  if (connection === 'pg') {
    const [customer] = await pgOwner<
      Array<{ id: string }>
    >`insert into actions.customer (tenant_id, name) values (${tenant}, 'Customer') returning id::text as id`
    const [row] = await pgOwner<
      Array<{ id: string }>
    >`insert into actions."order" (customer_id, amount) values (${customer?.id ?? ''}::bigint, 12.50) returning id::text as id`
    return actionToken(row?.id ?? '')
  }
  const customer = await msOwner
    .request()
    .input('tenant', mssql.Int, tenant)
    .query<{ id: string }>("insert into actions.customer (tenant_id, name) output inserted.id values (@tenant, N'Customer')")
  const row = await msOwner
    .request()
    .input('customer', mssql.BigInt, customer.recordset[0]?.id)
    .query<{ id: string }>('insert into actions.[order] (customer_id, amount) output inserted.id values (@customer, 12.50)')
  return actionToken(String(row.recordset[0]?.id))
}

/** An order's status, version and note, and who the routine was told closed it, as the owner reads them. */
async function stored(connection: 'pg' | 'ms', record: string): Promise<{ status: string; version: number; note: string | null; actor: string | null }> {
  const id = record.replace(/^k1:/, '')
  if (connection === 'pg') {
    const [row] = await pgOwner<Array<{ status: string; version: number; note: string | null; actor: string | null }>>`
      select o.status, o.version, o.note, (select c.actor from actions.call c where c.record_id = o.id and c.routine = 'close_order' order by c.id desc limit 1) as actor
      from actions."order" o where o.id = ${id}::bigint`
    return { ...(row as { status: string; version: number; note: string | null; actor: string | null }) }
  }
  const result = await msOwner
    .request()
    .input('id', mssql.BigInt, id)
    .query<{ status: string; version: number; note: string | null; actor: string | null }>(
      "select o.status, o.version, o.note, (select top (1) c.actor from actions.call c where c.record_id = o.id and c.routine = N'close_order' order by c.id desc) as actor from actions.[order] o where o.id = @id",
    )
  return { ...(result.recordset[0] as { status: string; version: number; note: string | null; actor: string | null }) }
}

const refused = (outcome: ActionOutcome) => (outcome.ok ? 'done' : `${String(outcome.status)} ${outcome.code}`)

describe.each(ENGINES)('an action run over the open record on $engine', ({ connection }) => {
  const form = `${connection}-action-order`

  // The form offers close with its dialog's one field, and a run commits:
  // the routine closed the order with the note asked and the clerk's id,
  // the version moved by one, and the answer is the order's token. The
  // same run from the same read is then stale, and nothing more is kept.
  // Watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with the client posting to
  // the update route: every run was refused 400.
  test('is offered with its dialog, commits and moves the version, and the same run again is stale', async () => {
    const client = plane.client()
    const definition = await client.form(form)
    if (!definition.ok) throw new Error(JSON.stringify(definition))
    expect(definition.value.actions.map((action) => [action.name, action.dialog?.model.fields.map((field) => field.key)])).toEqual([['close', ['note']]])
    const record = await order(connection, 1)
    const run = { records: [{ record, version: '1' }], answers: { note: 'closed by the client' } }
    expect(await client.runAction(form, 'close', run)).toEqual({ ok: true, value: { records: [record] } })
    expect(await stored(connection, record)).toEqual({ status: 'closed', version: 2, note: 'closed by the client', actor: 'clerk-1' })
    const again = await client.runAction(form, 'close', run)
    expect(refused(again)).toBe('409 stale')
    expect(isUnknownAction(again)).toBe(false)
    expect((await stored(connection, record)).version).toBe(2)
  })

  // The deployment's refusal under the prefix reaches the person in its
  // own words (0156), nothing kept; another tenant's order, whose token
  // anybody can spell, is not found, and the routine never runs over it.
  // Watched failing on postgres:17-alpine and
  // mcr.microsoft.com/mssql/server:2022-latest with declined answered as
  // refused: the person read the server's sentence, not the routine's.
  test('is refused in the deployment’s words, and another tenant’s order is not found', async () => {
    const client = plane.client()
    const record = await order(connection, 1)
    const declined = await client.runAction(form, 'close', { records: [{ record, version: '1' }], answers: { note: 'refuse' } })
    expect(declined).toEqual({ ok: false, status: 422, code: 'declined', message: ACTION_DECLINED_REASON })
    expect(await stored(connection, record)).toEqual({ status: 'open', version: 1, note: null, actor: null })
    const theirs = await order(connection, 2)
    const minted = await client.runAction(form, 'close', { records: [{ record: theirs, version: '1' }], answers: { note: 'not mine' } })
    expect(refused(minted)).toBe('404 not-found')
    expect(await stored(connection, theirs)).toEqual({ status: 'open', version: 1, note: null, actor: null })
  })
})
