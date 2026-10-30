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
import { covers, FIXTURE_SCOPE, startPostgresFixture, UUID_PARITY, UUID_ROWS, uuidCase, uuidOrder } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresLookups, createPostgresRecords, discoverPostgres } from './index.js'

/** Nobody aborts this signal: every lookup here completes, and answers exactly as it did before the port carried one (0061). */
const NEVER = new AbortController().signal

/*
 * A uuid key end to end (0056), against REAL PostgreSQL loaded with the
 * shared fixture (0005) and UUID_ROWS, inserted by the owner.
 *
 * sales.delivery is keyed by a uuid its default fills, gen_random_uuid()
 * here; sales.parcel refers to it. Everything after the insert runs as the
 * order form's own account, the writer: discovery, then the generator, then
 * the planner's requests for tenant 1's clerk and tenant 2's, so what reaches
 * the adapter is what the server sends with that account's grants. Every
 * expectation is UUID_PARITY's, written once for both engines; the order of
 * uuid values, the one fact the engines answer differently, is written per
 * engine there (`uuidOrder`). The SQL Server suite runs the same cases, each
 * declared with `covers()` (0035).
 */

let fixture: PostgresFixture
let owner: Sql
let writer: Sql
let records: RecordAdapter
let lookups: LookupAdapter
let snapshot: MetadataSnapshot
let deliveries: FormBindings
let parcels: FormBindings

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
  versionColumn: 'row_version',
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
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, filter: [], offset: 0, limit: 50 }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  for (const [id, tenant] of UUID_ROWS.orders) {
    await owner.unsafe(
      `insert into sales."order" (id, tenant_id, customer_no, order_date, amount) overriding system value values ($1::bigint, $2::int, 1001, '2026-10-11', 1)`,
      [id, tenant],
    )
  }
  for (const [id, tenant, order, carrier] of UUID_ROWS.deliveries) {
    await owner.unsafe('insert into sales.delivery (id, tenant_id, order_id, carrier) values ($1::uuid, $2::int, $3::bigint, $4)', [id, tenant, order, carrier])
  }
  for (const [order, line] of UUID_ROWS.lines) {
    await owner.unsafe('insert into sales.order_line (order_id, line_no, quantity, unit_price) values ($1::bigint, $2::int, 1, 1.00)', [order, line])
  }
  for (const [delivery, label] of UUID_ROWS.parcels) {
    await owner.unsafe('insert into sales.parcel (delivery_id, label) values ($1::uuid, $2)', [delivery, label])
  }
  writer = postgres(fixture.writer, { onnotice: () => {} })
  snapshot = await discoverPostgres(writer, FIXTURE_SCOPE)
  deliveries = generateForm(snapshot, DELIVERY).bindings
  parcels = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'parcel' },
    formId: 'parcel',
    title: 'Parcel',
    lookups: [{ foreignKey: 'fk_parcel_delivery', display: ['carrier'] }],
  }).bindings
  records = createPostgresRecords(writer)
  lookups = createPostgresLookups(writer)
})

afterAll(async () => {
  await Promise.all([owner?.end(), writer?.end()])
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
  for (const check of checks) rejected.push(...(await lookups.rejects(check.config, check.tokens, check.filters, NEVER)))
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
  return recordPage(deliveries, plan.fields, outcome.rows, query.limit)
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

describe('discovery', covers('postgres', uuidCase('discovered')), () => {
  // The model's comparator holds the column's kind, that it is no identity,
  // and that it has a default. What the default is, it does not: here it is
  // gen_random_uuid(), as pg_get_expr spells it, and the key is the uuid.
  test("reports the delivery's uuid key and the default that fills it", () => {
    const table = findObject(snapshot, UUID_PARITY.discovered.table)
    const id = table?.columns.find((column) => column.name === 'id')
    expect({ key: table?.primaryKey?.columns, type: id?.type, generated: id?.generated, hasDefault: id?.hasDefault, default: id?.defaultExpression }).toEqual({
      key: UUID_PARITY.discovered.key,
      type: { kind: 'uuid' },
      generated: 'none',
      hasDefault: true,
      default: UUID_PARITY.discovered.default.postgres,
    })
  })
})

describe('generation', covers('postgres', uuidCase('generated')), () => {
  // The catalog calls the key 'none', because the column takes a value; a
  // form that offered it would let a person write the record's address. It
  // is shown in the Record section, never written or required, and create
  // stays offered because the database fills it (0056). So is delete, over
  // the version column: the key is all of it and gen_random_uuid() fills
  // it, as this account's snapshot spells the default, and that default
  // never hands out one value twice (0057).
  test('makes the key read-only, never required, and offers create, update and delete', () => {
    const { form, bindings } = generateForm(snapshot, DELIVERY)
    const expected = UUID_PARITY.generated
    expect(bindings.fields.find((binding) => binding.field === expected.field)?.writes).toEqual(expected.writes)
    expect(form.model.fields.find((field) => field.key === expected.field)).not.toHaveProperty('required')
    expect(form.layouts?.[0]?.nodes.map((node) => ('label' in node ? node.label : undefined))).toEqual(expected.sections)
    expect(bindings.operations).toEqual(expected.operations)
    expect(bindings.identity).toEqual(UUID_PARITY.discovered.key)
  })
})

describe('a delete', covers('postgres', uuidCase('delete')), () => {
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
  // on the delivery form, which offers one over its version column (0057),
  // for the parcels a delete would take with it, and for nothing else; and
  // on the order form for its deliveries, its lines and, through the
  // deliveries, their parcels. Without the grant, neither form is refused
  // anything: the refusals are the delete's. A parcel has no version
  // column, so it offers no delete at all.
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
    const [row] = await owner.unsafe<Array<{ orders: number; lines: number; deliveries: number; parcels: number }>>(
      `select (select count(*)::int from sales."order" where id = $1::bigint) as orders,
              (select count(*)::int from sales.order_line where order_id = $1::bigint) as lines,
              (select count(*)::int from sales.delivery where id in ($2::uuid, $3::uuid)) as deliveries,
              (select count(*)::int from sales.parcel where delivery_id in ($2::uuid, $3::uuid)) as parcels`,
      [order, ...keys],
    )
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
  // an order's deliveries by its uuid token, at the version its version
  // column was read at, and its two parcels go with it; then that order,
  // and its line, its other delivery and that delivery's parcel go with it.
  // Each runs as the order form's own account and takes the locked path, a
  // delete that reaches past its record: the delivery's, keyed by a uuid
  // 0057 counts as numbered, is the one no other suite runs, and a guard or
  // a lock that lost the uuid key's table, or a DELETE check that asked of
  // the parcels anything the account lacks, would refuse it or delete
  // nothing (watched failing with the guard accepting no key, as 0050's
  // did: the delivery's delete was answered schema-changed).
  test("deletes a delivery with its parcels, and then its order with its line, its other delivery and that one's parcel, once the policy names each key", async () => {
    const {
      cascades,
      removed: sent,
      left: { counts },
    } = UUID_PARITY.delete
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

describe('a record token', covers('postgres', uuidCase('token')), () => {
  // One record, one token: PostgreSQL prints a uuid in lower case, and the
  // fixture wrote this one in upper case. The same key spelled in upper case
  // is a second spelling, which the planner refuses before anything is
  // asked, as it refuses 007 for 7.
  test('spells the key in lower case, finds the row by it, and refuses the key in upper case', async () => {
    const found = await read(deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.token.record)
    expect({ record: found?.record, carrier: found?.answers['carrier'] }).toEqual({ record: UUID_PARITY.token.record, carrier: UUID_PARITY.token.carrier })
    expect(planRead(snapshot, deliveries, DELIVERY_POLICY, CLARA, UUID_PARITY.token.upper)).toMatchObject({ ok: false, code: UUID_PARITY.token.refused })
  })
})

describe('a create', covers('postgres', uuidCase('create')), () => {
  // The key is the database's: left out, gen_random_uuid() fills it, and the
  // insert's RETURNING hands it back, so the form receives the token of the
  // row it made and a read by that token finds it. A key the person sends is
  // refused as over-posting, before anything is written, because the form
  // never writes it -- not only because this policy withholds it.
  test('is answered with the key the database chose, and refuses one that is sent', async () => {
    const answers = { order: UUID_PARITY.create.order, carrier: UUID_PARITY.create.carrier }
    const made = await create(deliveries, DELIVERY_POLICY, OTTO, answers)
    expect(made.record).toMatch(/^k1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(made.record).toBe(token(String(made.answers['id'])))
    expect(await read(deliveries, DELIVERY_POLICY, OTTO, made.record as string)).toEqual(made)
    const [stored] = await owner<
      { tenant_id: number; carrier: string }[]
    >`select tenant_id, carrier from sales.delivery where id = ${String(made.answers['id'])}::uuid`
    expect(stored).toEqual({ tenant_id: 2, carrier: UUID_PARITY.create.carrier })
    const sent = planCreate(snapshot, deliveries, DELIVERY_POLICY, OTTO, { ...answers, id: UUID_PARITY.parent.ours.keys[0] }, await described(deliveries))
    expect(sent).toEqual({ ok: false, ...UUID_PARITY.create.given })
  })
})

describe('an update', covers('postgres', uuidCase('update')), () => {
  // The update finds its row by the uuid, guarded by the version read, in
  // one statement (0015): written once, and the version it was read at is
  // stale afterwards.
  test('is written with the version read, and the version before it is stale', async () => {
    const before = await read(deliveries, DELIVERY_POLICY, OTTO, UUID_PARITY.update.record)
    if (before?.version == null) throw new Error('tenant 2 reads its delivery')
    const written = await update(OTTO, UUID_PARITY.update.record, before.version, { carrier: UUID_PARITY.update.carrier })
    expect(written).toMatchObject({ ok: true, values: { carrier: UUID_PARITY.update.carrier } })
    expect(written.ok && written.version).not.toBe(before.version)
    expect(await update(OTTO, UUID_PARITY.update.record, before.version, { carrier: 'never written' })).toMatchObject({
      ok: false,
      code: UUID_PARITY.update.stale,
    })
  })
})

describe('another tenant', covers('postgres', uuidCase('tenant')), () => {
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

describe('deliveries listed under an order', covers('postgres', uuidCase('parent')), () => {
  // A child grid of one order (0044): its deliveries, in the order of their
  // keys, which is PostgreSQL's here -- the bytes in turn -- and under
  // another tenant's order, none, though one is there.
  test("lists the order's deliveries in this engine's order of their keys, and none of another tenant's order", async () => {
    const { ours, theirs } = UUID_PARITY.parent
    expect(keysOf(await listed(CLARA, { parent: { field: 'order', record: ours.order } }))).toEqual(uuidOrder('postgres', ours.keys))
    expect(keysOf(await listed(CLARA, { parent: { field: 'order', record: theirs.order } }))).toEqual(theirs.keys)
  })
})

describe('a list ordered by the uuid key', covers('postgres', uuidCase('order')), () => {
  // Where the engines differ (0056). Sixteen keys each set one byte, so the
  // order they come in is the order in which PostgreSQL weighs the bytes:
  // the first most, as its text reads. Paged five at a time the pages join
  // without a gap or a repeat, and asked again a page is the same, which is
  // what offset paging needs of an order; that SQL Server's order is
  // another is held here too, so a uuidOrder that gave one order for both
  // would fail.
  test("pages sixteen deliveries in PostgreSQL's order of uuid, the same rows each time", async () => {
    const { parent, size, keys } = UUID_PARITY.order
    const expected = uuidOrder('postgres', keys)
    expect(expected).not.toEqual(uuidOrder('sqlserver', keys))
    const seen: string[] = []
    for (let offset = 0; offset < keys.length; offset += size) {
      const query = { parent: { field: 'order', record: parent }, offset, limit: size }
      const page = await listed(OTTO, query)
      expect({ offset, keys: keysOf(page), hasMore: page.hasMore }).toEqual({
        offset,
        keys: expected.slice(offset, offset + size),
        hasMore: offset + size < keys.length,
      })
      expect(keysOf(await listed(OTTO, query))).toEqual(keysOf(page))
      seen.push(...keysOf(page))
    }
    expect(seen).toEqual(expected)
  })
})

describe("a lookup onto the delivery's uuid", covers('postgres', uuidCase('lookup')), () => {
  // A lookup's key is a uuid: its options are tenant 1's deliveries, each
  // by its uuid token in lower case, ordered by carrier; a search matches the
  // carrier; a token resolves to its label; and membership is decided under
  // the tenant's filter in the database, so another tenant's delivery, a key
  // nobody has and the key in upper case are each rejected (0012).
  test('offers, finds, resolves and rejects deliveries by their uuid tokens', async () => {
    const expected = UUID_PARITY.lookup
    const { config, filters } = deliveryLookup(CLARA)
    const page = await lookups.search(config, { search: '', offset: 0, limit: 50 }, filters, NEVER)
    expect(page).toEqual({ rows: expected.offered, hasMore: false, omitted: 0 })
    const found = await lookups.search(config, { search: expected.search.text, offset: 0, limit: 50 }, filters, NEVER)
    expect(found.rows.map((row) => row.token)).toEqual(expected.search.tokens)
    expect(await lookups.resolve(config, [expected.resolved.token], filters, NEVER)).toEqual([expected.resolved])
    const offered = expected.offered.map((row) => row.token)
    expect(await lookups.rejects(config, [...offered, ...expected.rejected], filters, NEVER)).toEqual(expected.rejected)
  })

  // Options whose labels tie are ordered by the key that ends every lookup's
  // order (0012), so sixteen deliveries of one carrier come in this engine's
  // order of uuid -- its bytes in turn -- and not the other's. A lookup whose
  // order dropped the key would offer them as a scan of the heap returns
  // them, which is another order, and a page of them could repeat a row. One
  // that ordered the key by its text would pass here: on PostgreSQL that is
  // the uuid's own order (0056), and only the SQL Server suite tells the two
  // apart.
  test("offers deliveries tied on their carrier in this engine's order of their keys", async () => {
    const { search, label, keys } = UUID_PARITY.lookup.tied
    const expected = uuidOrder('postgres', keys)
    expect(expected).not.toEqual(uuidOrder('sqlserver', keys))
    const { config, filters } = deliveryLookup(OTTO)
    const page = await lookups.search(config, { search, offset: 0, limit: 50 }, filters, NEVER)
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

describe('the default that fills a uuid key', covers('postgres', uuidCase('defaults')), () => {
  // Which default makes a key one a version column proves a record over
  // (0057): tables keyed by a uuid, created by the owner in a schema of
  // this suite's own and discovered as the order form's account, which may
  // read, insert into, update and delete from each. Only gen_random_uuid(),
  // which never hands out one value twice, filling a key that is all of it
  // and that no foreign key includes, counts. A constant does not; nor does
  // uuid_generate_v4(), which this release has not named; nor a function of
  // the schema's own named gen_random_uuid, which the catalog spells with
  // its schema; nor gen_random_uuid() beside a pinned tenant; nor
  // gen_random_uuid() on a key that refers to another table's, which a
  // lookup writes. However the DDL writes PostgreSQL's own -- in upper case,
  // mixed case, qualified and in parentheses -- pg_get_expr spells it one
  // way, from the stored expression. Each is told apart by the default as
  // this account's snapshot spells it, whole (watched failing before the
  // rule: no table offered delete; with the default matched by the
  // function's name inside it: the lookalike offered delete; and with the
  // foreign keys not asked: the key that refers to another offered delete).
  const { schema, constant, spelled, offered, deleted } = UUID_PARITY.defaults
  const tables = Object.keys(offered) as Array<keyof typeof offered>
  const DEFAULTS: Record<keyof typeof offered, string> = {
    never_repeating: 'gen_random_uuid()',
    fixed: `'${constant}'::uuid`,
    other_function: 'public.uuid_generate_v4()',
    lookalike: `${schema}.gen_random_uuid()`,
    two_columns: 'gen_random_uuid()',
    foreign_key: 'gen_random_uuid()',
    upper_case: 'GEN_RANDOM_UUID()',
    mixed_case: 'Gen_Random_Uuid()',
    parenthesised: '(pg_catalog.gen_random_uuid())',
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

  /** Each table's key default in `found`, and whether a form over each offers delete. */
  const defaultsIn = (found: MetadataSnapshot) => ({
    spelled: Object.fromEntries(
      tables.map((name) => [name, findObject(found, { schema, name })?.columns.find((column) => column.name === 'id')?.defaultExpression]),
    ),
    offered: Object.fromEntries(tables.map((name) => [name, generateForm(found, request(name)).bindings.operations.delete])),
  })

  beforeAll(async () => {
    await owner.unsafe(`create schema ${schema}`)
    await owner.unsafe('create extension "uuid-ossp" schema public')
    await owner.unsafe(`create function ${schema}.gen_random_uuid() returns uuid language sql as $$ select '${constant}'::uuid $$`)
    for (const name of tables) {
      const tenant = name === 'two_columns' ? 'tenant_id int not null, ' : ''
      const key = name === 'two_columns' ? 'tenant_id, id' : 'id'
      const refers = name === 'foreign_key' ? `, constraint fk_${name}_never_repeating foreign key (id) references ${schema}.never_repeating (id)` : ''
      await owner.unsafe(
        `create table ${schema}.${name} (${tenant}id uuid not null default ${DEFAULTS[name]}, note varchar(50) null, version int not null default 1, constraint pk_${name} primary key (${key})${refers})`,
      )
      await owner.unsafe(`grant update (note, version) on ${schema}.${name} to formancy_forms`)
    }
    await owner.unsafe(`grant usage on schema ${schema} to formancy_forms`)
    await owner.unsafe(`grant select, insert, delete on all tables in schema ${schema} to formancy_forms`)
    minted = await discoverPostgres(writer, { schemas: [schema] })
  })

  test("reports each key's default as PostgreSQL spells it, and offers delete over gen_random_uuid() on a key of its own alone", () => {
    expect(defaultsIn(minted)).toEqual({ spelled: spelled.postgres, offered })
  })

  // The delete runs as the server runs one: the row read by its token, then
  // planned over the table as this request describes it, which still has
  // the default the form was generated over, at the version that read
  // returned -- the version column's default -- by the key in lower case.
  test('deletes a row of the table whose key never repeats by its token at the version read, and the same delete again is not found', async () => {
    const [row] = await owner.unsafe<Array<{ id: string }>>(`insert into ${schema}.never_repeating (note) values ('deleted') returning id::text as id`)
    if (row === undefined) throw new Error('nothing inserted')
    const bindings = generateForm(minted, request('never_repeating')).bindings
    const reading = planRead(minted, bindings, REMOVING, CLARA, token(row.id))
    if (!reading.ok) throw new Error(`expected a read, got ${reading.code}: ${reading.message}`)
    const found = await records.read(reading.request)
    if (!found.ok || found.record === null) throw new Error('expected the row')
    const version = found.record.version as string
    expect(version).toBe(deleted.version)
    const removed = async (): Promise<DeleteOutcome> => {
      const now = await records.describe(bindings.root)
      if (!now.ok) throw new Error(`expected a description, got ${now.code}`)
      const plan = planDelete(minted, bindings, REMOVING, CLARA, token(row.id), version, now.described)
      if (!plan.ok) throw new Error(`expected a delete, got ${plan.code}: ${plan.message}`)
      return records.delete(plan.request)
    }
    expect(await removed()).toEqual({ ok: true, deleted: { values: { id: row.id }, version } })
    expect(await owner.unsafe(`select id from ${schema}.never_repeating where id = $1::uuid`, [row.id])).toHaveLength(0)
    expect(await removed()).toMatchObject({ ok: false, code: deleted.again })
  })

  // PostgreSQL's alone: pg_get_expr leaves a function's schema out where
  // the session's search_path finds that function by its bare name, and
  // the path is the composition root's. Discovery reads every default with
  // pg_catalog searched first, so a path that names the schema of the
  // lookalike before pg_catalog changes no spelling and no offer: the
  // lookalike is spelled with its schema and PostgreSQL's own without one
  // (watched failing with discovery under the session's path: the
  // lookalike was spelled bare and offered delete, and the six keys
  // PostgreSQL's own fills were spelled pg_catalog.gen_random_uuid(), the
  // four of them that offer delete offering none). A description is read
  // in the request's own statement, under the session's path, so
  // there it spells PostgreSQL's own with its schema: the runtime reads the
  // key's default as changed, and refuses the delete as drift -- it can
  // withdraw an offer under such a path, never make one.
  test('a search_path that names the lookalike before pg_catalog changes no spelling and no offer, and the runtime then refuses the delete', async () => {
    const catalogLast = postgres(fixture.writer, { onnotice: () => {}, connection: { search_path: `${schema}, public, pg_catalog` } })
    try {
      expect(defaultsIn(await discoverPostgres(catalogLast, { schemas: [schema] }))).toEqual({ spelled: spelled.postgres, offered })
      const bindings = generateForm(minted, request('never_repeating')).bindings
      const now = await createPostgresRecords(catalogLast).describe(bindings.root)
      if (!now.ok) throw new Error(`expected a description, got ${now.code}`)
      expect(now.described.columns.find((column) => column.name === 'id')?.defaultExpression).toBe('pg_catalog.gen_random_uuid()')
      expect(planDelete(minted, bindings, REMOVING, CLARA, token(constant), deleted.version, now.described)).toMatchObject({ ok: false, code: 'drift' })
    } finally {
      await catalogLast.end()
    }
  })
})
