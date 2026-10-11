import { encodeRowversion, generateForm, planRead, planUpdate } from '@formancy/data-core'
import type { DescribedRead, FormBindings, FormPolicy, MetadataSnapshot, PolicyContext, ReadRequest, RecordAdapter, RecordOutcome, UpdateRequest } from '@formancy/data-core'
import { covers, EDGE_VALUES, FIXTURE_SCOPE, startSqlServerFixture, throughCase } from '@formancy/data-fixtures'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/*
 * A child form's rows, reached only through a parent its policy admits
 * (0043), against REAL SQL Server loaded with the shared fixture (0005).
 *
 * sales.order_line has no tenant column. The line form's policy names its
 * order lookup in `through`, with the lookup's filter pinning the order's
 * tenant, so a line exists for tenant 1 only when its order is tenant 1's.
 * The requests are the planner's, from bindings generated over what
 * discovery reports, so what reaches the adapter is what the server sends;
 * the fixture's owner inserts an order of tenant 2 and a line under it,
 * which no request of tenant 1's may find, update or tell apart from a line
 * that does not exist. The PostgreSQL suite runs the same cases, each
 * declared with `covers()` (0035).
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let records: RecordAdapter
let snapshot: MetadataSnapshot
let line: FormBindings
let staff: FormBindings
let orders: FormBindings

/** 2^53 + 2: an order of tenant 2, beside the fixture's 2^53 + 1 of tenant 1. */
const THEIRS = '9007199254740994'
const OURS = EDGE_VALUES.beyondSafeInteger
const lineToken = (order: string, number = 1) => `k1:${order},${number}`
/** 2^53 + 3 to 2^53 + 5: orders of tenant 1, each moved to tenant 2 by another transaction while an update waits, one per race. */
const MOVED = { locking: '9007199254740995', snapshot: '9007199254740996', rowFilter: '9007199254740997' }

const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
const CLERK_RW = { read: ['clerk'], write: ['clerk'] }

/** The lines of the orders this tenant may reference: no row filter of their own, and the order lookup's filter in `through`. */
const LINE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { order: CLERK_RW, line_no: CLERK_RW, quantity: CLERK_RW, unit_price: CLERK_RW, line_total: { read: ['clerk'], write: [] } },
  rowFilters: [],
  lookups: { order: TENANT },
  through: ['order'],
}

/** Employees seen through their manager: the self-reference, its filter on the manager's name. */
const STAFF_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { id: { read: ['clerk'], write: [] }, name: { read: ['clerk'], write: [] }, employee: { read: ['clerk'], write: [] } },
  rowFilters: [],
  lookups: { employee: [{ column: 'name', attribute: 'manager' }] },
  through: ['employee'],
}

/**
 * Orders seen through their customer: a composite key, (tenant_id,
 * customer_no) onto the customer's primary key, its filter on the
 * customer's tenant, and no row filter of the order's own.
 */
const BY_CUSTOMER: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { id: { read: ['clerk'], write: [] }, customer: { read: ['clerk'], write: [] } },
  rowFilters: [],
  lookups: { customer: TENANT },
  through: ['customer'],
}

/** Orders under a row filter of their own: what a through is compared with when a row moves under an update. */
const OWN_TENANT: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: ['clerk'] },
  fields: { notes: CLERK_RW },
  rowFilters: TENANT,
  lookups: { customer: TENANT },
}

const clerk = (attributes: Record<string, string>): PolicyContext => ({ actor: { id: 'u-1', roles: ['clerk'] }, attributes })
const CLARA = clerk({ tenant: '1' })
const OTTO = clerk({ tenant: '2' })

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  await owner.request().batch(`
    set identity_insert sales.[order] on;
    insert into sales.[order] (id, tenant_id, customer_no, order_date, amount) values (${THEIRS}, 2, 1001, '2026-10-09', 1);
    insert into sales.[order] (id, tenant_id, customer_no, order_date, amount)
      values (${MOVED.locking}, 1, 1001, '2026-10-10', 1), (${MOVED.snapshot}, 1, 1001, '2026-10-10', 1), (${MOVED.rowFilter}, 1, 1001, '2026-10-10', 1);
    set identity_insert sales.[order] off;
    insert into sales.order_line (order_id, line_no, quantity, unit_price) values (${THEIRS}, 1, 5, 2.50), (${MOVED.locking}, 1, 7, 1.00), (${MOVED.snapshot}, 1, 7, 1.00)`)
  snapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
  line = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'order_line' },
    formId: 'order-line',
    title: 'Order line',
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
  }).bindings
  staff = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'employee' },
    formId: 'staff',
    title: 'Staff',
    lookups: [{ foreignKey: 'fk_employee_manager', display: ['name'] }],
  }).bindings
  orders = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'order' },
    formId: 'orders',
    title: 'Orders',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
  }).bindings
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

function planned(bindings: FormBindings, policy: FormPolicy, actor: PolicyContext, token: string): ReadRequest {
  const plan = planRead(snapshot, bindings, policy, actor, token)
  if (!plan.ok) throw new Error(`expected a read, got ${plan.code}: ${plan.message}`)
  return plan.request
}

function found(read: DescribedRead): Record<string, unknown> | null {
  if (!read.ok) throw new Error(`expected a read, got ${read.code}: ${read.message}`)
  return read.record?.values ?? null
}

/** The line as the owner reads it: what no request of anybody's changed. */
async function stored(order: string): Promise<{ quantity: number; row_version: string }> {
  const result = await owner.request().input('order', mssql.BigInt, order).query<{ quantity: number; row_version: Buffer }>('select quantity, row_version from sales.order_line where order_id = @order and line_no = 1')
  const row = result.recordset[0]
  if (row === undefined) throw new Error(`no line of ${order}`)
  return { quantity: row.quantity, row_version: encodeRowversion(row.row_version) }
}

/** An update planned for `actor` as the server plans one: over the table as `describe` reads it now, through `via`. */
async function plannedUpdate(via: RecordAdapter, bindings: FormBindings, policy: FormPolicy, actor: PolicyContext, token: string, version: string, answers: Record<string, unknown>): Promise<UpdateRequest> {
  const described = await via.describe(bindings.root)
  if (!described.ok) throw new Error(`expected a description, got ${described.code}`)
  const plan = planUpdate(snapshot, bindings, policy, actor, token, version, answers, undefined, described.described)
  if (!plan.ok) throw new Error(`expected an update, got ${plan.code}: ${plan.message}`)
  return plan.request
}

/** An update of the line's quantity, planned for `actor`. */
async function update(actor: PolicyContext, order: string, version: string, quantity: number, via = records): Promise<RecordOutcome> {
  return via.update(await plannedUpdate(via, line, LINE_POLICY, actor, lineToken(order), version, { quantity }))
}

/** The order's tenant, notes and rowversion as the owner reads them. */
async function orderOf(id: string): Promise<{ tenant_id: number; notes: string | null; row_version: string }> {
  const result = await owner.request().input('id', mssql.BigInt, id).query<{ tenant_id: number; notes: string | null; row_version: Buffer }>('select tenant_id, notes, row_version from sales.[order] where id = @id')
  const row = result.recordset[0]
  if (row === undefined) throw new Error(`no order ${id}`)
  return { tenant_id: row.tenant_id, notes: row.notes, row_version: encodeRowversion(row.row_version) }
}

/** Whether the fixture's database reads committed data from row versions. */
async function snapshotReads(): Promise<boolean> {
  const result = await owner.request().query<{ on: boolean }>('select is_read_committed_snapshot_on as [on] from sys.databases where database_id = db_id()')
  return result.recordset[0]?.on === true
}

/** Waits until the server shows `session` waiting on another's lock: polled, never a fixed delay. */
async function blocked(session: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = await owner
      .request()
      .input('session', mssql.Int, session)
      .query<{ blocker: number }>('select blocking_session_id as blocker from sys.dm_exec_requests where session_id = @session')
    if ((found.recordset[0]?.blocker ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`session ${String(session)} never waited on the held row`)
}

/**
 * `pending`, through an adapter on a connection of its own, started while
 * another transaction has run `hold` and not committed, and answered after
 * that transaction commits: the commit waits until the server shows the
 * adapter's session blocked behind it.
 */
async function racedWith(hold: string, pending: (via: RecordAdapter) => Promise<RecordOutcome>): Promise<RecordOutcome> {
  const adapterPool = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
  const holder = new mssql.Transaction(owner)
  let open = false
  try {
    const session = (await adapterPool.request().query<{ id: number }>('select @@spid as id')).recordset[0]?.id ?? 0
    await holder.begin()
    open = true
    await new mssql.Request(holder).batch(hold)
    const answer = pending(createSqlServerRecords(adapterPool))
    await blocked(session)
    await holder.commit()
    open = false
    return await answer
  } finally {
    if (open) await holder.rollback()
    await adapterPool.close()
  }
}

/** Another transaction holds the line of `order` and moves the order to tenant 2. */
const lineHeldAndOrderMoved = (order: string) => `select 1 from sales.order_line with (updlock, holdlock) where order_id = ${order};
  update sales.[order] set tenant_id = 2 where id = ${order}`

describe('a line read through its order', covers('sqlserver', throughCase('read')), () => {
  // A line has no tenant. Its order does, and the line form's lookup filter
  // on sales.order says which orders a tenant may reference: tenant 1 reads
  // the line of its own order, and the line of tenant 2's order is not found
  // -- the answer a line that does not exist gets, so its existence is not
  // disclosed -- though the owner sees it is there. Tenant 2 is the mirror.
  test("finds this tenant's line, and not the line of another tenant's order", async () => {
    expect(found(await records.read(planned(line, LINE_POLICY, CLARA, lineToken(OURS))))).toMatchObject({ order_id: OURS, line_no: '1' })
    expect(found(await records.read(planned(line, LINE_POLICY, CLARA, lineToken(THEIRS))))).toBeNull()
    expect(found(await records.read(planned(line, LINE_POLICY, CLARA, lineToken('1'))))).toBeNull()
    expect(found(await records.read(planned(line, LINE_POLICY, OTTO, lineToken(THEIRS))))).toMatchObject({ order_id: THEIRS, quantity: '5' })
    expect(found(await records.read(planned(line, LINE_POLICY, OTTO, lineToken(OURS))))).toBeNull()
    expect(await stored(THEIRS)).toMatchObject({ quantity: 5 })
  })
})

describe('a line updated through its order', covers('sqlserver', throughCase('update')), () => {
  // The update's own WHERE, and the statement that tells a stale update from
  // one aimed at nothing, both carry the order's scope. So tenant 1's update
  // of tenant 2's line is not found with the line's current version and
  // with a wrong one -- never stale, which would say the line is there --
  // and the owner reads it unchanged.
  test("is not found for another tenant's order, whatever version is sent, and changes nothing", async () => {
    const before = await stored(THEIRS)
    for (const version of [before.row_version, '00000000000007d1']) {
      expect(await update(CLARA, THEIRS, version, 99), version).toMatchObject({ ok: false, code: 'not-found' })
    }
    expect(await stored(THEIRS)).toEqual(before)
  })

  // And the scope admits what it should: tenant 1's own line is updated,
  // its rowversion moved, under the same EXISTS.
  test("updates this tenant's line", async () => {
    const before = await stored(OURS)
    const outcome = await update(CLARA, OURS, before.row_version, before.quantity + 1)
    expect(outcome).toMatchObject({ ok: true, values: { quantity: String(before.quantity + 1) } })
    const after = await stored(OURS)
    expect(after.quantity).toBe(before.quantity + 1)
    expect(after.row_version).not.toBe(before.row_version)
    expect(outcome.ok && outcome.version).toBe(after.row_version)
  })
})

describe('a table scoped through a key onto itself', covers('sqlserver', throughCase('self-reference')), () => {
  // sales.employee references itself through fk_employee_manager: Grace's
  // manager is Ada, Ada has none, and Orphan's manager 99 does not exist.
  // Scoped through the manager, filtered by the manager's name, only the
  // employees whose manager the filter admits are found. Every column of
  // the EXISTS is qualified: a bare manager_id inside it would be the inner
  // employee's own, and the scope would ask whether the manager manages
  // itself.
  test('finds only the employees whose manager the filter admits', async () => {
    const read = async (attributes: Record<string, string>, id: string) => found(await records.read(planned(staff, STAFF_POLICY, clerk(attributes), `k1:${id}`)))
    expect(await read({ manager: 'Ada' }, '2')).toMatchObject({ id: '2', name: 'Grace' })
    expect(await read({ manager: 'Ada' }, '1')).toBeNull()
    expect(await read({ manager: 'Ada' }, '3')).toBeNull()
    expect(await read({ manager: 'Grace' }, '2')).toBeNull()
  })
})

describe('a table scoped through a composite key', covers('sqlserver', throughCase('composite')), () => {
  // sales.order references its customer by (tenant_id, customer_no), and
  // customer 1001 exists in both tenants. Scoped through the customer, by
  // the customer's tenant, tenant 1 finds its own order and not tenant 2's,
  // though both name customer 1001: each root column is compared with the
  // target column the foreign key pairs it with, all of them. Compared by
  // customer_no alone, tenant 2's order would be tenant 1's; paired the
  // wrong way round, (1, 1001) would be looked for as customer 1 of tenant
  // 1001, and tenant 1 would find nothing.
  test("finds this tenant's order through its customer, and not another tenant's with the same customer number", async () => {
    const read = async (actor: PolicyContext, id: string) => found(await records.read(planned(orders, BY_CUSTOMER, actor, `k1:${id}`)))
    expect(await read(CLARA, OURS)).toMatchObject({ id: OURS, tenant_id: '1', customer_no: '1001' })
    expect(await read(CLARA, THEIRS)).toBeNull()
    expect(await read(OTTO, THEIRS)).toMatchObject({ id: THEIRS, tenant_id: '2', customer_no: '1001' })
    expect(await read(OTTO, OURS)).toBeNull()
  })
})

describe('an update that waits while its parent moves out of the scope', covers('sqlserver', throughCase('moved-parent')), () => {
  // Where the engines differ under concurrency (0043). Another transaction
  // holds tenant 1's line and moves the line's order to tenant 2; tenant 1's
  // update of the line, with its current version, waits for the line and
  // then runs. SQL Server reads the order after the wait, and the line is
  // not found: nothing written. PostgreSQL, in the same race, reads the
  // order as the update's statement first found it, and writes the line.
  // Pinned here so that the day either changes, the record that says so is
  // read again.
  test('answers not-found, with the fixture reading committed data under locks', async () => {
    const id = MOVED.locking
    expect(await snapshotReads()).toBe(false)
    const before = await stored(id)
    const outcome = await racedWith(lineHeldAndOrderMoved(id), (via) => update(CLARA, id, before.row_version, 8, via))
    expect(outcome).toMatchObject({ ok: false, code: 'not-found' })
    expect(await stored(id)).toEqual(before)
    expect((await orderOf(id)).tenant_id).toBe(2)
  })

  // READ_COMMITTED_SNAPSHOT, which a database may have on, reads committed
  // rows from their versions instead of waiting on their locks. The answer
  // is the same.
  test('answers not-found under READ_COMMITTED_SNAPSHOT too', async () => {
    const id = MOVED.snapshot
    await owner.request().batch('alter database current set read_committed_snapshot on with rollback immediate')
    try {
      expect(await snapshotReads()).toBe(true)
      const before = await stored(id)
      const outcome = await racedWith(lineHeldAndOrderMoved(id), (via) => update(CLARA, id, before.row_version, 8, via))
      expect(outcome).toMatchObject({ ok: false, code: 'not-found' })
      expect(await stored(id)).toEqual(before)
    } finally {
      await owner.request().batch('alter database current set read_committed_snapshot off with rollback immediate')
    }
  })

  // The control: a row filter on the record itself, whose own tenant is
  // moved while the update waits for it. Not found on both engines.
  test('answers not-found for a row filter on the record whose own tenant moved', async () => {
    const id = MOVED.rowFilter
    const before = await orderOf(id)
    const outcome = await racedWith(`update sales.[order] set tenant_id = 2 where id = ${id}`, async (via) =>
      via.update(await plannedUpdate(via, orders, OWN_TENANT, CLARA, `k1:${id}`, before.row_version, { notes: 'by tenant 1' })),
    )
    expect(outcome).toMatchObject({ ok: false, code: 'not-found' })
    const after = await orderOf(id)
    expect([after.tenant_id, after.notes]).toEqual([2, before.notes])
  })
})

describe('a request without its throughs', () => {
  // An adapter reads a request's throughs through throughTerms, which
  // refuses anything but a list. A request rebuilt from JSON without the
  // property would otherwise read as one with no scope -- every tenant's
  // line -- so it is thrown before a statement is built, for a read and for
  // an update, and nothing is written (watched failing with each path
  // reading a missing property as none: the read was answered, and the
  // update written).
  test('is thrown, for a read and an update, and changes nothing', async () => {
    const read = planned(line, LINE_POLICY, CLARA, lineToken(THEIRS))
    for (const through of [undefined, null, {}]) {
      await expect(records.read({ ...read, through: through as never })).rejects.toThrow(/throughs are a list/)
    }
    const before = await stored(OURS)
    const request = await plannedUpdate(records, line, LINE_POLICY, CLARA, lineToken(OURS), before.row_version, { quantity: before.quantity + 5 })
    for (const through of [undefined, null, {}]) {
      await expect(records.update({ ...request, through: through as never })).rejects.toThrow(/throughs are a list/)
    }
    expect(await stored(OURS)).toEqual(before)
  })
})
