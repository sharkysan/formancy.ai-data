import {
  buildLookupConfig,
  deleteProblems,
  findObject,
  generateForm,
  lookupRowFilter,
  planCreate,
  planDelete,
  planList,
  planRead,
  planUpdate,
  recordPage,
  scopeRowFilters,
  toFormAnswers,
  validatePolicy,
} from '@formancy/data-core'
import type {
  CascadeRule,
  DeleteOutcome,
  FormBindings,
  FormPolicy,
  FormRecord,
  GenerationRequest,
  LookupAdapter,
  LookupConfig,
  MembershipCheck,
  MetadataSnapshot,
  ObjectMeta,
  PolicyContext,
  RecordAdapter,
  RecordList,
  RecordListQuery,
  RecordOutcome,
  RowFilters,
} from '@formancy/data-core'
import { covers, FIXTURE_SCOPE, startSqlServerFixture, UUID_PARITY, UUID_ROWS, uuidCase, uuidOrder } from '@formancy/data-fixtures'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerLookups, createSqlServerRecords, discoverSqlServer } from './index.js'

/*
 * A uuid key end to end (0056), against REAL SQL Server loaded with the
 * shared fixture (0005) and UUID_ROWS, inserted by the owner.
 *
 * sales.delivery is keyed by a uniqueidentifier its default fills,
 * newsequentialid() here; sales.parcel refers to it. SQL Server prints a
 * uniqueidentifier in upper case, and orders it by its byte groups, the last
 * six bytes first; the adapter reads every one in lower case (0017), and the
 * order is the engine's, written down in sql/order.ts. Everything after the
 * insert runs as the order form's own account, the writer: discovery, then
 * the generator, then the planner's requests for tenant 1's clerk and tenant
 * 2's, so what reaches the adapter is what the server sends with that
 * account's grants. Every expectation is UUID_PARITY's, written once for
 * both engines; the order of uuid values, the one fact the engines answer
 * differently, is written per engine there (`uuidOrder`). The PostgreSQL
 * suite runs the same cases, each declared with `covers()` (0035).
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let writer: mssql.ConnectionPool
let records: RecordAdapter
let lookups: LookupAdapter
let snapshot: MetadataSnapshot
let deliveries: FormBindings
let parcels: FormBindings

/** A signal nobody aborts: every lookup here completes, and answers exactly what it answered before the port carried a signal (0061). */
const NOT_ABORTED = new AbortController().signal

const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
const READ = { read: ['clerk'], write: [] }
const CLERK_RW = { read: ['clerk'], write: ['clerk'] }

/** A tenant's deliveries: its own tenant pinned, and reached only through an order of the tenant's (0043). */
const DELIVERY_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { id: READ, tenant_id: READ, order: CLERK_RW, carrier: CLERK_RW, shipped_at: CLERK_RW },
  rowFilters: TENANT,
  lookups: { order: TENANT },
  through: ['order'],
}

/** A parcel has no tenant: it is reached through its delivery, a uuid key, whose lookup offers the tenant's deliveries. It has no version, so no update. */
const PARCEL_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: [] },
  fields: { id: READ, delivery: CLERK_RW, label: CLERK_RW },
  rowFilters: [],
  lookups: { delivery: TENANT },
  through: ['delivery'],
}

const DELIVERY: GenerationRequest = {
  connection: 'test',
  root: UUID_PARITY.discovered.table,
  formId: 'delivery',
  title: 'Delivery',
  lookups: [{ foreignKey: 'fk_delivery_order', display: ['order_date'] }],
  pinned: ['tenant_id'],
  versionColumn: 'row_version',
}

/** The order form, as far as a delete of it is asked: its tenant pinned, its customer a lookup. */
const ORDER: GenerationRequest = {
  connection: 'test',
  root: { schema: 'sales', name: 'order' },
  formId: 'order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
  pinned: ['tenant_id'],
}

/** A tenant's clerk reads the tenant's orders, whose customers are the tenant's. */
const ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: {},
  rowFilters: TENANT,
  lookups: { customer: TENANT },
}

const clerk = (tenant: string): PolicyContext => ({ actor: { id: `u-${tenant}`, roles: ['clerk'] }, attributes: { tenant } })
const CLARA = clerk('1')
const OTTO = clerk('2')
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, filter: [], after: null, limit: 50 }

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  // IDENTITY_INSERT is the session's, so the orders go in one batch; every value is a constant of UUID_ROWS's digits.
  const orders = UUID_ROWS.orders.map(([id, tenant]) => `(${id}, ${tenant}, 1001, '2026-10-11', 1)`).join(', ')
  await owner.request().batch(`set identity_insert sales.[order] on; insert into sales.[order] (id, tenant_id, customer_no, order_date, amount) values ${orders}; set identity_insert sales.[order] off;`)
  for (const [id, tenant, order, carrier] of UUID_ROWS.deliveries) {
    await owner
      .request()
      .input('id', mssql.UniqueIdentifier, id)
      .input('tenant', mssql.Int, Number(tenant))
      .input('order', mssql.BigInt, order)
      .input('carrier', mssql.NVarChar(40), carrier)
      .query('insert into sales.delivery (id, tenant_id, order_id, carrier) values (@id, @tenant, @order, @carrier)')
  }
  for (const [order, line] of UUID_ROWS.lines) {
    await owner.request().input('order', mssql.BigInt, order).input('line', mssql.Int, Number(line)).query('insert into sales.order_line (order_id, line_no, quantity, unit_price) values (@order, @line, 1, 1.00)')
  }
  for (const [delivery, label] of UUID_ROWS.parcels) {
    await owner.request().input('delivery', mssql.UniqueIdentifier, delivery).input('label', mssql.NVarChar(40), label).query('insert into sales.parcel (delivery_id, label) values (@delivery, @label)')
  }
  writer = await new mssql.ConnectionPool(fixture.writer).connect()
  snapshot = await discoverSqlServer(writer, FIXTURE_SCOPE)
  deliveries = generateForm(snapshot, DELIVERY).bindings
  parcels = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'parcel' },
    formId: 'parcel',
    title: 'Parcel',
    lookups: [{ foreignKey: 'fk_parcel_delivery', display: ['carrier'] }],
  }).bindings
  records = createSqlServerRecords(writer)
  lookups = createSqlServerLookups(writer)
})

afterAll(async () => {
  await Promise.all([owner?.close(), writer?.close()])
  await fixture?.stop()
})

/** The table as `describe` reads it now: what the runtime decides a write over (0041). */
async function described(bindings: FormBindings) {
  const outcome = await records.describe(bindings.root)
  if (!outcome.ok) throw new Error(`expected a description, got ${outcome.code}`)
  return outcome.described
}

/** A record read for `actor` as the server reads one, or null when it is not found. */
async function read(bindings: FormBindings, policy: FormPolicy, actor: PolicyContext, token: string): Promise<FormRecord | null> {
  const plan = planRead(snapshot, bindings, policy, actor, token)
  if (!plan.ok) throw new Error(`expected a read, got ${plan.code}: ${plan.message}`)
  const outcome = await records.read(plan.request)
  if (!outcome.ok) throw new Error(`expected a record, got ${outcome.code}: ${outcome.message}`)
  return outcome.record === null ? null : toFormAnswers(bindings, plan.fields, { ok: true, ...outcome.record })
}

/** Whether every selection a write carries is one of the options, asked as the server asks before it writes. */
async function members(checks: readonly MembershipCheck[]): Promise<string[]> {
  const rejected: string[] = []
  for (const check of checks) rejected.push(...(await lookups.rejects(check.config, check.tokens, check.filters, NOT_ABORTED)))
  return rejected
}

/** A create for `actor`, planned, its selections checked, and inserted, as the form receives it. */
async function create(bindings: FormBindings, policy: FormPolicy, actor: PolicyContext, answers: Record<string, unknown>): Promise<FormRecord> {
  const plan = planCreate(snapshot, bindings, policy, actor, answers, await described(bindings))
  if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
  expect(await members(plan.memberships)).toEqual([])
  const outcome = await records.insert(plan.request)
  if (!outcome.ok) throw new Error(`expected an insert, got ${outcome.code}: ${outcome.message}`)
  return toFormAnswers(bindings, plan.fields, outcome)
}

/** A delivery's update for `actor`, planned over the table as it is now and run. */
async function update(actor: PolicyContext, token: string, version: string, answers: Record<string, unknown>): Promise<RecordOutcome> {
  const plan = planUpdate(snapshot, deliveries, DELIVERY_POLICY, actor, token, version, answers, undefined, await described(deliveries))
  if (!plan.ok) throw new Error(`expected an update, got ${plan.code}: ${plan.message}`)
  return records.update(plan.request)
}

/** One page of deliveries for `actor`, as the server answers it. */
async function listed(actor: PolicyContext, change: Partial<RecordListQuery>): Promise<RecordList> {
  const query = { ...EVERY, ...change }
  const plan = planList(snapshot, deliveries, DELIVERY_POLICY, actor, query)
  if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
  const outcome = await records.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
  return recordPage(deliveries, plan, outcome.rows)
}

const keysOf = (page: RecordList): string[] => page.rows.map((row) => String(row.answers['id']))
const token = (key: string): string => `k1:${key}`

/** The parcel form's delivery lookup for `actor`: its config and the filter on the deliveries, as the server builds them. */
function deliveryLookup(actor: PolicyContext): { config: LookupConfig; filters: RowFilters } {
  const field = UUID_PARITY.lookup.field
  const filter = lookupRowFilter(PARCEL_POLICY, actor, parcels, 'create', field)
  if (!filter.ok) throw new Error(filter.message)
  const config = buildLookupConfig(parcels, field, { snapshot })
  const scoped = scopeRowFilters(findObject(snapshot, config.target) as ObjectMeta, filter.filter, `lookups.${field}`)
  if (!scoped.ok) throw new Error(scoped.message)
  return { config, filters: scoped.filters }
}

describe('discovery', covers('sqlserver', uuidCase('discovered')), () => {
  // The model's comparator holds the column's kind, that it is no identity,
  // and that it has a default. What the default is, it does not: here it is
  // newsequentialid(), as the catalog spells a default constraint's
  // definition, and the key is the uniqueidentifier.
  test("reports the delivery's uuid key and the default that fills it", () => {
    const table = findObject(snapshot, UUID_PARITY.discovered.table)
    const id = table?.columns.find((column) => column.name === 'id')
    expect({ key: table?.primaryKey?.columns, type: id?.type, generated: id?.generated, hasDefault: id?.hasDefault, default: id?.defaultExpression }).toEqual({
      key: UUID_PARITY.discovered.key,
      type: { kind: 'uuid' },
      generated: 'none',
      hasDefault: true,
      default: UUID_PARITY.discovered.default.sqlserver,
    })
  })
})

describe('generation', covers('sqlserver', uuidCase('generated')), () => {
  // The catalog calls the key 'none', because the column takes a value; a
  // form that offered it would let a person write the record's address. It
  // is shown in the Record section, never written or required, and create
  // stays offered because the database fills it (0056). So is delete: the
  // rowversion never repeats, whatever the key (0050).
  test('makes the key read-only, never required, and still offers create and update, and delete by its rowversion', () => {
    const { form, bindings } = generateForm(snapshot, DELIVERY)
    const expected = UUID_PARITY.generated
    expect(bindings.fields.find((binding) => binding.field === expected.field)?.writes).toEqual(expected.writes)
    expect(form.model.fields.find((field) => field.key === expected.field)).not.toHaveProperty('required')
    expect(form.layouts?.[0]?.nodes.map((node) => ('label' in node ? node.label : undefined))).toEqual(expected.sections)
    expect(bindings.operations).toEqual(expected.operations)
    expect(bindings.identity).toEqual(UUID_PARITY.discovered.key)
  })
})

describe('a delete', covers('sqlserver', uuidCase('delete')), () => {
  const refused = (bindings: FormBindings, policy: FormPolicy): string[] => {
    const fit = validatePolicy(policy, bindings)
    return [...(fit.ok ? [] : fit.problems), ...deleteProblems(snapshot, bindings, policy)]
  }
  const deleting = (policy: FormPolicy, cascades?: ReadonlyArray<CascadeRule>): FormPolicy => ({
    ...policy,
    operations: { ...policy.operations, delete: ['clerk'] },
    ...(cascades === undefined ? {} : { cascades: cascades.map((entry) => ({ ...entry, table: { ...entry.table } })) }),
  })

  // A delete reaches past its record only through a key the policy names
  // in `cascades` with its action (0051), and 0056's tables cascade: a
  // parcel's key from its delivery, and a delivery's from its order, beside
  // a line's. Asked over what the order form's own account discovers, as
  // the publish check asks it -- the policy's fit, then what a delete also
  // does -- a grant of delete under a policy that names no key is refused
  // on the delivery form, which offers one by its rowversion, for the
  // parcels a delete would take with it, and for nothing else; and on the
  // order form for its deliveries, its lines and, through the deliveries,
  // their parcels. Without the grant, neither form is refused anything: the
  // refusals are the delete's. A parcel has no version column, so it
  // offers no delete at all.
  test('is refused on the delivery form for its parcels, and on the order form for its deliveries, its lines and their parcels', () => {
    expect(refused(deliveries, deleting(DELIVERY_POLICY))).toEqual(UUID_PARITY.delete.delivery)
    expect(refused(deliveries, DELIVERY_POLICY)).toEqual([])
    const orders = generateForm(snapshot, ORDER).bindings
    expect(refused(orders, deleting(ORDER_POLICY))).toEqual(UUID_PARITY.delete.order)
    expect(refused(orders, ORDER_POLICY)).toEqual([])
    expect({ update: parcels.operations.update, delete: parcels.operations.delete }).toEqual(UUID_PARITY.delete.parcel)
  })

  /** What is left of the delete case's order: the order, its line, its two deliveries and their parcels, counted by the owner. */
  async function left(): Promise<{ orders: number; lines: number; deliveries: number; parcels: number }> {
    const { order, deliveries: keys } = UUID_PARITY.delete.left
    const { recordset } = await owner
      .request()
      .input('order', mssql.BigInt, order)
      .input('first', mssql.UniqueIdentifier, keys[0])
      .input('second', mssql.UniqueIdentifier, keys[1])
      .query<{ orders: number; lines: number; deliveries: number; parcels: number }>(
        `select (select count(*) from sales.[order] where id = @order) as orders,
                (select count(*) from sales.order_line where order_id = @order) as lines,
                (select count(*) from sales.delivery where id in (@first, @second)) as deliveries,
                (select count(*) from sales.parcel where delivery_id in (@first, @second)) as parcels`,
      )
    const [row] = recordset
    if (row === undefined) throw new Error('nothing counted')
    return row
  }

  /** Tenant 2's delete of `record` as the server runs one: read for the version a person names, then planned over the table as it is now. */
  async function removed(bindings: FormBindings, policy: FormPolicy, record: string): Promise<{ version: string; outcome: DeleteOutcome }> {
    const reading = planRead(snapshot, bindings, policy, OTTO, record)
    if (!reading.ok) throw new Error(`expected a read, got ${reading.code}: ${reading.message}`)
    const found = await records.read(reading.request)
    if (!found.ok || found.record === null) throw new Error(`expected ${record}`)
    const version = found.record.version as string
    const plan = planDelete(snapshot, bindings, policy, OTTO, record, version, await described(bindings))
    if (!plan.ok) throw new Error(`expected a delete, got ${plan.code}: ${plan.message}`)
    return { version, outcome: await records.delete(plan.request) }
  }

  // Named with their actions, the keys are the policy's to accept (0051):
  // the delivery form's names its parcels' key, the order form's all three,
  // and neither is refused anything. Tenant 2's clerk then deletes one of
  // an order's deliveries by its uuid token, at the rowversion read, and
  // its two parcels go with it; then that order, and its line, its other
  // delivery and that delivery's parcel go with it. Each runs as the order
  // form's own account in the write batch, whose reach guard reads the keys
  // onto every table it removes rows of and whose DELETE check asks the
  // account of each: the delivery's, keyed by a uniqueidentifier, is the
  // one no other suite runs, and a guard that lost the key's table, or a
  // check that asked of the parcels anything the account lacks, would roll
  // it back.
  test("deletes a delivery with its parcels, and then its order with its line, its other delivery and that one's parcel, once the policy names each key", async () => {
    const { cascades, removed: sent, left: { counts } } = UUID_PARITY.delete
    const orders = generateForm(snapshot, ORDER).bindings
    const named = { delivery: deleting(DELIVERY_POLICY, cascades.delivery), order: deleting(ORDER_POLICY, cascades.order) }
    expect([refused(deliveries, named.delivery), refused(orders, named.order)]).toEqual([[], []])
    expect(await left()).toEqual(counts[0])
    const delivery = await removed(deliveries, named.delivery, sent.delivery.record)
    expect(delivery.outcome).toEqual({ ok: true, deleted: { values: sent.delivery.values, version: delivery.version } })
    expect(await left()).toEqual(counts[1])
    const order = await removed(orders, named.order, sent.order.record)
    expect(order.outcome).toEqual({ ok: true, deleted: { values: sent.order.values, version: order.version } })
    expect(await left()).toEqual(counts[2])
  })
})

describe('a record token', covers('sqlserver', uuidCase('token')), () => {
  // One record, one token: SQL Server prints a uniqueidentifier in upper
  // case, and the adapter reads it lower-cased (0017), so the token is the
  // one PostgreSQL's read gives. The same key spelled in upper case is a
  // second spelling, which the planner refuses before anything is asked, as
  // it refuses 007 for 7.
  test('spells the key in lower case, finds the row by it, and refuses the key in upper case', async () => {
    const found = await read(deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.token.record)
    expect({ record: found?.record, carrier: found?.answers['carrier'] }).toEqual({ record: UUID_PARITY.token.record, carrier: UUID_PARITY.token.carrier })
    expect(planRead(snapshot, deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.token.upper)).toMatchObject({ ok: false, code: UUID_PARITY.token.refused })
  })
})

describe('a create', covers('sqlserver', uuidCase('create')), () => {
  // The key is the database's: left out, newsequentialid() fills it, and the
  // batch's OUTPUT hands it back, lower-cased, and finds the row again by it
  // for its rowversion, so the form receives the token of the row it made
  // and a read by that token finds it. A key the person sends is
  // refused as over-posting, before anything is written, because the form
  // never writes it -- not only because this policy withholds it.
  test('is answered with the key the database chose, and refuses one that is sent', async () => {
    const answers = { order: UUID_PARITY.create.order, carrier: UUID_PARITY.create.carrier }
    const made = await create(deliveries, DELIVERY_POLICY, OTTO, answers)
    expect(made.record).toMatch(/^k1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(made.record).toBe(token(String(made.answers['id'])))
    expect(await read(deliveries, DELIVERY_POLICY, OTTO, made.record as string)).toEqual(made)
    const stored = await owner
      .request()
      .input('id', mssql.UniqueIdentifier, String(made.answers['id']))
      .query<{ tenant_id: number; carrier: string }>('select tenant_id, carrier from sales.delivery where id = @id')
    expect(stored.recordset).toEqual([{ tenant_id: 2, carrier: UUID_PARITY.create.carrier }])
    const sent = planCreate(snapshot, deliveries, DELIVERY_POLICY, OTTO, { ...answers, id: UUID_PARITY.parent.ours.keys[0] }, await described(deliveries))
    expect(sent).toEqual({ ok: false, ...UUID_PARITY.create.given })
  })
})

describe('an update', covers('sqlserver', uuidCase('update')), () => {
  // The update finds its row by the uuid, guarded by the version read, in
  // one statement (0015): written once, and the version it was read at is
  // stale afterwards.
  test('is written with the version read, and the version before it is stale', async () => {
    const before = await read(deliveries, DELIVERY_POLICY, OTTO, UUID_PARITY.update.record)
    if (before?.version == null) throw new Error('tenant 2 reads its delivery')
    const written = await update(OTTO, UUID_PARITY.update.record, before.version, { carrier: UUID_PARITY.update.carrier })
    expect(written).toMatchObject({ ok: true, values: { carrier: UUID_PARITY.update.carrier } })
    expect(written.ok && written.version).not.toBe(before.version)
    expect(await update(OTTO, UUID_PARITY.update.record, before.version, { carrier: 'never written' })).toMatchObject({ ok: false, code: UUID_PARITY.update.stale })
  })
})

describe('another tenant', covers('sqlserver', uuidCase('tenant')), () => {
  // A uuid in hand is a reference, never a permission (0012): tenant 2's
  // clerk holding tenant 1's token and its current version is told the
  // delivery is not found -- never stale, which would say it is there --
  // and tenant 1's clerk does not find tenant 2's, which exists.
  test('finds no delivery of another tenant, by token or by update', async () => {
    const ours = await read(deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.tenant.ours)
    if (ours?.version == null) throw new Error('tenant 1 reads its delivery')
    expect(await read(deliveries, DELIVERY_POLICY, OTTO, UUID_PARITY.tenant.ours)).toBeNull()
    expect(await update(OTTO, UUID_PARITY.tenant.ours, ours.version, { carrier: 'by tenant 2' })).toMatchObject({ ok: false, code: UUID_PARITY.tenant.refused })
    expect(await read(deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.tenant.ours)).toEqual(ours)
    expect(await read(deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.tenant.theirs)).toBeNull()
  })
})

describe('deliveries listed under an order', covers('sqlserver', uuidCase('parent')), () => {
  // A child grid of one order (0044): its deliveries, in the order of their
  // keys, which is SQL Server's here -- the last six bytes first, so not
  // the order PostgreSQL lists them in -- and under another tenant's order,
  // none, though one is there.
  test("lists the order's deliveries in this engine's order of their keys, and none of another tenant's order", async () => {
    const { ours, theirs } = UUID_PARITY.parent
    expect(keysOf(await listed(CLARA, { parent: { field: 'order', record: ours.order } }))).toEqual(uuidOrder('sqlserver', ours.keys))
    expect(keysOf(await listed(CLARA, { parent: { field: 'order', record: theirs.order } }))).toEqual(theirs.keys)
  })
})

describe('a list ordered by the uuid key', covers('sqlserver', uuidCase('order')), () => {
  // Where the engines differ (0056). Sixteen keys each set one byte, so the
  // order they come in is the order in which SQL Server weighs the bytes:
  // bytes 10 to 15 of the text most, then 8 and 9, then 7 down to 0, which
  // the adapter does not reorder -- the column's own order, which its
  // primary key's index serves. Paged five at a time, each page after the
  // one before (0108), the pages join without a gap or a repeat, and asked
  // again a page is the same: a page after a uniqueidentifier is compared by
  // its byte groups, as the order is, never by its text. That PostgreSQL's
  // order is another is held here too, so a uuidOrder that gave one order
  // for both would fail.
  test("pages sixteen deliveries in SQL Server's order of uniqueidentifier, the same rows each time", async () => {
    const { parent, size, keys } = UUID_PARITY.order
    const expected = uuidOrder('sqlserver', keys)
    expect(expected).not.toEqual(uuidOrder('postgres', keys))
    const seen: string[] = []
    let after: string | null = null
    for (let start = 0; start < keys.length; start += size) {
      const query = { parent: { field: 'order', record: parent }, after, limit: size }
      const page: RecordList = await listed(OTTO, query)
      expect({ start, keys: keysOf(page), hasMore: page.hasMore }).toEqual({ start, keys: expected.slice(start, start + size), hasMore: start + size < keys.length })
      expect(keysOf(await listed(OTTO, query))).toEqual(keysOf(page))
      seen.push(...keysOf(page))
      after = page.next
    }
    expect(seen).toEqual(expected)
  })
})

describe("a lookup onto the delivery's uuid", covers('sqlserver', uuidCase('lookup')), () => {
  // A lookup's key is a uuid: its options are tenant 1's deliveries, each
  // by its uuid token in lower case, ordered by carrier; a search matches the
  // carrier; a token resolves to its label; and membership is decided under
  // the tenant's filter in the database, so another tenant's delivery, a key
  // nobody has and the key in upper case are each rejected (0012).
  test('offers, finds, resolves and rejects deliveries by their uuid tokens', async () => {
    const expected = UUID_PARITY.lookup
    const { config, filters } = deliveryLookup(CLARA)
    const page = await lookups.search(config, { search: '', offset: 0, limit: 50 }, filters, NOT_ABORTED)
    expect(page).toEqual({ rows: expected.offered, hasMore: false, omitted: 0 })
    const found = await lookups.search(config, { search: expected.search.text, offset: 0, limit: 50 }, filters, NOT_ABORTED)
    expect(found.rows.map((row) => row.token)).toEqual(expected.search.tokens)
    expect(await lookups.resolve(config, [expected.resolved.token], filters, NOT_ABORTED)).toEqual([expected.resolved])
    const offered = expected.offered.map((row) => row.token)
    expect(await lookups.rejects(config, [...offered, ...expected.rejected], filters, NOT_ABORTED)).toEqual(expected.rejected)
  })

  // Options whose labels tie are ordered by the key that ends every lookup's
  // order (0012), so sixteen deliveries of one carrier come in this engine's
  // order of uuid -- the last six bytes first -- and not the other's. A
  // lookup that ordered the key by its text would offer them in PostgreSQL's
  // order. One whose order dropped the key would offer them as a scan of the
  // heap returns them, which is another order, and a page of them could
  // repeat a row: the fixture's key is nonclustered for this, because a
  // clustered key would return them in its own order with or without it.
  test("offers deliveries tied on their carrier in this engine's order of their keys", async () => {
    const { search, label, keys } = UUID_PARITY.lookup.tied
    const expected = uuidOrder('sqlserver', keys)
    expect(expected).not.toEqual(uuidOrder('postgres', keys))
    const { config, filters } = deliveryLookup(OTTO)
    const page = await lookups.search(config, { search, offset: 0, limit: 50 }, filters, NOT_ABORTED)
    expect(page.rows).toEqual(expected.map((key) => ({ token: token(key), label })))
  })

  // The selection is written as the key it names, and the parcel, which has
  // no tenant, is read through it (0043): the token comes back as chosen.
  test('writes a chosen delivery as its key, and reads the parcel through it', async () => {
    const { label, delivery } = UUID_PARITY.lookup.parcel
    const made = await create(parcels, PARCEL_POLICY, CLARA, { delivery, label })
    expect(made.answers).toMatchObject({ delivery, label })
    expect(await read(parcels, PARCEL_POLICY, CLARA, made.record as string)).toEqual(made)
    expect(await read(parcels, PARCEL_POLICY, OTTO, made.record as string)).toBeNull()
  })
})

describe('uniqueidentifier, as SQL Server stores and orders it', () => {
  // What 0056 and sql/order.ts say SQL Server does, measured on the rows
  // themselves rather than through uuidOrder alone: it stores the first three
  // groups of the text little-endian, and orders by the sixteen bytes it
  // stores, group by group from the last -- stored bytes 10-15, 8-9, 6-7, 4-5,
  // 0-3. Read through the text, that is uuidOrder's rule. A record that
  // described the order by the text's bytes taken in those stored positions,
  // without the swap, would describe another order, and this fails on it.
  test('stores the first three groups little-endian and orders by its stored bytes, group by group from the last', async () => {
    const { recordset } = await owner.request().query<{ text: string; stored: Buffer }>(
      'select lower(convert(nchar(36), d.id)) as text, convert(binary(16), d.id) as stored from sales.delivery as d order by d.id',
    )
    const hex = (text: string): string[] => text.replaceAll('-', '').match(/../g) ?? []
    const littleEndian = (bytes: string[]): string[] => [...bytes.slice(0, 4).reverse(), ...bytes.slice(4, 6).reverse(), ...bytes.slice(6, 8).reverse(), ...bytes.slice(8)]
    expect(recordset.map((row) => row.stored.toString('hex'))).toEqual(recordset.map((row) => littleEndian(hex(row.text)).join('')))
    const GROUPS = [10, 11, 12, 13, 14, 15, 8, 9, 6, 7, 4, 5, 0, 1, 2, 3]
    const byStored = (row: { stored: Buffer }): string => GROUPS.map((at) => row.stored.toString('hex', at, at + 1)).join('')
    const sorted = [...recordset].sort((left, right) => (byStored(left) < byStored(right) ? -1 : byStored(left) > byStored(right) ? 1 : 0))
    expect(recordset.length).toBeGreaterThanOrEqual(UUID_PARITY.order.keys.length)
    expect(recordset.map((row) => row.text)).toEqual(sorted.map((row) => row.text))
    expect(recordset.map((row) => row.text)).toEqual(uuidOrder('sqlserver', recordset.map((row) => row.text)))
  })

  // Where the engines differ in what a key tells (0056). newsequentialid()
  // is the server's, not a tenant's: a key made for another tenant between
  // two of tenant 2's creates sorts between them, and all three share their
  // last eight bytes, so a record token tells a tenant that others were
  // created between its own. PostgreSQL's gen_random_uuid() keys are random
  // (fixtures.integration.test.ts holds them to version 4). A server whose
  // keys stopped rising would make 0056's limitation stale, and this fails.
  test("hands out keys that rise across tenants, so a tenant's keys show that others were made between them", async () => {
    const answers = { order: UUID_PARITY.create.order, carrier: 'Sequence' }
    const first = String((await create(deliveries, DELIVERY_POLICY, OTTO, answers)).answers['id'])
    const other = await owner
      .request()
      .input('order', mssql.BigInt, UUID_ROWS.orders[0][0])
      .query<{ id: string }>("insert into sales.delivery (tenant_id, order_id, carrier) output lower(convert(nchar(36), inserted.id)) as id values (3, @order, N'Another tenant')")
    const between = String(other.recordset[0]?.id)
    const last = String((await create(deliveries, DELIVERY_POLICY, OTTO, answers)).answers['id'])
    expect(uuidOrder('sqlserver', [last, between, first])).toEqual([first, between, last])
    expect(new Set([first, between, last].map((key) => key.slice(19)))).toEqual(new Set([first.slice(19)]))
  })
})

describe("the default that fills a uuid key", covers('sqlserver', uuidCase('defaults')), () => {
  // Which default makes a key one a version column proves a record over
  // (0057): tables keyed by a uniqueidentifier, each guarded by an int
  // version column the module maintains -- not a rowversion, which proves a
  // record whatever its key -- created by the owner in a schema of this
  // suite's own and discovered as the order form's account, which may read,
  // insert into, update and delete from each. Only newsequentialid(), which
  // never hands out one value twice, filling a key that is all of it and
  // that no foreign key includes, counts. A constant does not; nor does
  // newid(), which this release has not named; nor a function of the
  // schema's own named newsequentialid, which the catalog spells with its
  // schema; nor newsequentialid() beside a pinned tenant; nor
  // newsequentialid() on a key that refers to another table's, which a
  // lookup writes. However the DDL writes SQL Server's own -- in upper case,
  // mixed case or in more parentheses -- object_definition spells it one
  // way. Each is told apart by the default as this account's snapshot
  // spells it, whole (watched failing before the rule: no table offered
  // delete; and with the default matched by the function's name inside it:
  // the lookalike offered delete; and with the foreign keys not asked: the
  // key that refers to another offered delete).
  const { schema, constant, spelled, offered, deleted } = UUID_PARITY.defaults
  const tables = Object.keys(offered) as Array<keyof typeof offered>
  const DEFAULTS: Record<keyof typeof offered, string> = {
    never_repeating: 'newsequentialid()',
    fixed: `'${constant}'`,
    other_function: 'newid()',
    lookalike: `${schema}.newsequentialid()`,
    two_columns: 'newsequentialid()',
    foreign_key: 'newsequentialid()',
    upper_case: 'NEWSEQUENTIALID()',
    mixed_case: '(NewSequentialId())',
    parenthesised: '((newsequentialid()))',
  }
  const REMOVING: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
    fields: { id: READ, note: READ },
    rowFilters: [],
    lookups: {},
  }
  let minted: MetadataSnapshot

  const request = (name: string): GenerationRequest => ({
    connection: 'test',
    root: { schema, name },
    formId: name.replaceAll('_', '-'),
    title: name,
    lookups: [],
    versionColumn: 'version',
    ...(name === 'two_columns' ? { pinned: ['tenant_id'] } : {}),
  })

  beforeAll(async () => {
    await owner.request().batch(`create schema ${schema}`)
    await owner.request().batch(`create function ${schema}.newsequentialid() returns uniqueidentifier as begin return cast('${constant}' as uniqueidentifier) end`)
    for (const name of tables) {
      const tenant = name === 'two_columns' ? 'tenant_id int not null, ' : ''
      const key = name === 'two_columns' ? 'tenant_id, id' : 'id'
      const refers = name === 'foreign_key' ? `, constraint fk_${name}_never_repeating foreign key (id) references ${schema}.never_repeating (id)` : ''
      await owner
        .request()
        .batch(
          `create table ${schema}.${name} (${tenant}id uniqueidentifier not null constraint df_${name}_id default ${DEFAULTS[name]}, note nvarchar(50) null, version int not null constraint df_${name}_version default 1, constraint pk_${name} primary key (${key})${refers})`,
        )
      await owner.request().batch(`grant update (note, version) on ${schema}.${name} to formancy_forms`)
    }
    await owner.request().batch(`grant select, insert, delete on schema::${schema} to formancy_forms`)
    minted = await discoverSqlServer(writer, { schemas: [schema] })
  })

  test("reports each key's default as SQL Server spells it, and offers delete over newsequentialid() on a key of its own alone", () => {
    const found = Object.fromEntries(tables.map((name) => [name, findObject(minted, { schema, name })?.columns.find((column) => column.name === 'id')?.defaultExpression]))
    expect(found).toEqual(spelled.sqlserver)
    expect(Object.fromEntries(tables.map((name) => [name, generateForm(minted, request(name)).bindings.operations.delete]))).toEqual(offered)
  })

  // The delete runs as the server runs one: the row read by its token, then
  // planned over the table as this request describes it, which still has
  // the default the form was generated over, at the version that read
  // returned -- the version column's default -- by the key in lower case:
  // SQL Server prints it in upper case, and the answer spells it as the
  // token does (0056).
  test('deletes a row of the table whose key never repeats by its token at the version read, and the same delete again is not found', async () => {
    const inserted = await owner.request().query<{ id: string }>(`insert into ${schema}.never_repeating (note) output lower(convert(nchar(36), inserted.id)) as id values (N'deleted')`)
    const id = String(inserted.recordset[0]?.id)
    const bindings = generateForm(minted, request('never_repeating')).bindings
    const reading = planRead(minted, bindings, REMOVING, CLARA, token(id))
    if (!reading.ok) throw new Error(`expected a read, got ${reading.code}: ${reading.message}`)
    const found = await records.read(reading.request)
    if (!found.ok || found.record === null) throw new Error('expected the row')
    const version = found.record.version as string
    expect(version).toBe(deleted.version)
    const removed = async (): Promise<DeleteOutcome> => {
      const now = await records.describe(bindings.root)
      if (!now.ok) throw new Error(`expected a description, got ${now.code}`)
      const plan = planDelete(minted, bindings, REMOVING, CLARA, token(id), version, now.described)
      if (!plan.ok) throw new Error(`expected a delete, got ${plan.code}: ${plan.message}`)
      return records.delete(plan.request)
    }
    expect(await removed()).toEqual({ ok: true, deleted: { values: { id }, version } })
    const left = await owner.request().input('id', mssql.UniqueIdentifier, id).query(`select id from ${schema}.never_repeating where id = @id`)
    expect(left.recordset).toHaveLength(0)
    expect(await removed()).toMatchObject({ ok: false, code: deleted.again })
  })
})
