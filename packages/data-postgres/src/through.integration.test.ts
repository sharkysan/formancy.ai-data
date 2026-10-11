import { generateForm, planRead, planUpdate } from '@formancy/data-core'
import type { DescribedRead, FormBindings, FormPolicy, MetadataSnapshot, PolicyContext, ReadRequest, RecordAdapter, RecordOutcome, UpdateRequest } from '@formancy/data-core'
import { covers, EDGE_VALUES, FIXTURE_SCOPE, startPostgresFixture, throughCase } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql, TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A child form's rows, reached only through a parent its policy admits
 * (0043), against REAL PostgreSQL loaded with the shared fixture (0005).
 *
 * sales.order_line has no tenant column. The line form's policy names its
 * order lookup in `through`, with the lookup's filter pinning the order's
 * tenant, so a line exists for tenant 1 only when its order is tenant 1's.
 * The requests are the planner's, from bindings generated over what
 * discovery reports, so what reaches the adapter is what the server sends;
 * the fixture's owner inserts an order of tenant 2 and a line under it,
 * which no request of tenant 1's may find, update or tell apart from a line
 * that does not exist. The SQL Server suite runs the same cases, each
 * declared with `covers()` (0035).
 */

let fixture: PostgresFixture
let owner: Sql
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
const MOVED = { readCommitted: '9007199254740995', repeatableRead: '9007199254740996', rowFilter: '9007199254740997' }

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
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  await owner.unsafe(`
    insert into sales."order" (id, tenant_id, customer_no, order_date, amount) overriding system value values (${THEIRS}, 2, 1001, '2026-10-09', 1);
    insert into sales.order_line (order_id, line_no, quantity, unit_price) values (${THEIRS}, 1, 5, 2.50);
    insert into sales."order" (id, tenant_id, customer_no, order_date, amount) overriding system value
      values (${MOVED.readCommitted}, 1, 1001, '2026-10-10', 1), (${MOVED.repeatableRead}, 1, 1001, '2026-10-10', 1), (${MOVED.rowFilter}, 1, 1001, '2026-10-10', 1);
    insert into sales.order_line (order_id, line_no, quantity, unit_price) values (${MOVED.readCommitted}, 1, 7, 1.00), (${MOVED.repeatableRead}, 1, 7, 1.00);
  `)
  snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
  line = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'order_line' },
    formId: 'order-line',
    title: 'Order line',
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
    versionColumn: 'row_version',
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
    versionColumn: 'row_version',
  }).bindings
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
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
  const [row] = await owner<{ quantity: number; row_version: string }[]>`select quantity, row_version::text as row_version from sales.order_line where order_id = ${order} and line_no = 1`
  if (row === undefined) throw new Error(`no line of ${order}`)
  return row
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

/** The order's tenant and version as the owner reads them. */
async function orderOf(id: string): Promise<{ tenant_id: number; notes: string | null; row_version: string }> {
  const [row] = await owner<{ tenant_id: number; notes: string | null; row_version: string }[]>`select tenant_id, notes, row_version::text as row_version from sales."order" where id = ${id}`
  if (row === undefined) throw new Error(`no order ${id}`)
  return row
}

/** Waits until a backend is blocked by another, so a race is a race and not a sequence. */
async function waitUntilBlocked(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`
    if ((row?.n ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('the update never queued behind the held row')
}

/**
 * `pending`, started while another transaction has done `hold` and not
 * committed, and answered after that transaction commits: the commit waits
 * until the server shows `pending` blocked behind it. What `pending` started
 * is returned in an object, so the transaction does not wait for itself.
 */
async function racedWith(hold: (tx: TransactionSql) => Promise<unknown>, pending: () => Promise<RecordOutcome>): Promise<RecordOutcome> {
  const held = await owner.begin(async (tx) => {
    await hold(tx)
    const answer = pending()
    await waitUntilBlocked()
    return { answer }
  })
  return held.answer
}

describe('a line read through its order', covers('postgres', throughCase('read')), () => {
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

describe('a line updated through its order', covers('postgres', throughCase('update')), () => {
  // The update's own WHERE, and the statement that tells a stale update from
  // one aimed at nothing, both carry the order's scope. So tenant 1's update
  // of tenant 2's line is not found with the line's current version -- never
  // declined, which would say the line is there -- and with a wrong one --
  // never stale, which would say so too -- and the owner reads it unchanged.
  test("is not found for another tenant's order, whatever version is sent, and changes nothing", async () => {
    const before = await stored(THEIRS)
    for (const version of [before.row_version, String(Number(before.row_version) + 7)]) {
      expect(await update(CLARA, THEIRS, version, 99), version).toMatchObject({ ok: false, code: 'not-found' })
    }
    expect(await stored(THEIRS)).toEqual(before)
  })

  // And the scope admits what it should: tenant 1's own line is updated,
  // its version moved, under the same EXISTS.
  test("updates this tenant's line", async () => {
    const before = await stored(OURS)
    expect(await update(CLARA, OURS, before.row_version, before.quantity + 1)).toMatchObject({ ok: true, values: { quantity: String(before.quantity + 1) } })
    expect(await stored(OURS)).toEqual({ quantity: before.quantity + 1, row_version: String(Number(before.row_version) + 1) })
  })
})

describe('a table scoped through a key onto itself', covers('postgres', throughCase('self-reference')), () => {
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

describe('a table scoped through a composite key', covers('postgres', throughCase('composite')), () => {
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

describe('an update that waits while its parent moves out of the scope', covers('postgres', throughCase('moved-parent')), () => {
  // Where the engines differ under concurrency (0043). Another transaction
  // holds tenant 1's line and moves the line's order to tenant 2; tenant 1's
  // update of the line, with its current version, waits for the line and
  // then runs. PostgreSQL reads the order as the update's statement found it
  // when it began -- tenant 1's -- and never again: the line was only
  // locked, not changed, so there is nothing to re-check, and the write
  // lands as though it had come before the move. SQL Server, in the same
  // race, answers not-found. Pinned here so that the day either changes,
  // the record that says so is read again.
  test("writes the line under READ COMMITTED: the order is read as the update's statement first found it", async () => {
    const id = MOVED.readCommitted
    const before = await stored(id)
    const outcome = await racedWith(
      async (tx) => {
        await tx`select 1 from sales.order_line where order_id = ${id} for update`
        await tx`update sales."order" set tenant_id = 2 where id = ${id}`
      },
      () => update(CLARA, id, before.row_version, 8),
    )
    expect(outcome).toMatchObject({ ok: true, values: { quantity: '8' } })
    expect((await orderOf(id)).tenant_id).toBe(2)
    expect(found(await records.read(planned(line, LINE_POLICY, CLARA, lineToken(id))))).toBeNull()
    expect(found(await records.read(planned(line, LINE_POLICY, OTTO, lineToken(id))))).toMatchObject({ quantity: '8' })
  })

  // Under REPEATABLE READ the adapter locks the table first and runs the
  // update in a transaction (0041), whose snapshot is taken by the update
  // itself: the same reading of the order, and the same write.
  test('writes the line under REPEATABLE READ too', async () => {
    const id = MOVED.repeatableRead
    const repeatable = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    try {
      const via = createPostgresRecords(repeatable)
      const before = await stored(id)
      const outcome = await racedWith(
        async (tx) => {
          await tx`select 1 from sales.order_line where order_id = ${id} for update`
          await tx`update sales."order" set tenant_id = 2 where id = ${id}`
        },
        () => update(CLARA, id, before.row_version, 8, via),
      )
      expect(outcome).toMatchObject({ ok: true, values: { quantity: '8' } })
      expect((await orderOf(id)).tenant_id).toBe(2)
    } finally {
      await repeatable.end()
    }
  })

  // The control: a row filter on the record itself. Moving the order's own
  // tenant changes the row the update waits for, and PostgreSQL checks the
  // WHERE again on the row the wait ends with (EvalPlanQual): not found,
  // and nothing written. A through is weaker than this under concurrency on
  // PostgreSQL; on SQL Server both answer not-found.
  test('answers not-found for a row filter on the record, whose row the wait ends with is checked again', async () => {
    const id = MOVED.rowFilter
    const before = await orderOf(id)
    const outcome = await racedWith(
      async (tx) => {
        await tx`update sales."order" set tenant_id = 2 where id = ${id}`
      },
      async () => records.update(await plannedUpdate(records, orders, OWN_TENANT, CLARA, `k1:${id}`, before.row_version, { notes: 'by tenant 1' })),
    )
    expect(outcome).toMatchObject({ ok: false, code: 'not-found' })
    expect(await orderOf(id)).toEqual({ ...before, tenant_id: 2 })
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
