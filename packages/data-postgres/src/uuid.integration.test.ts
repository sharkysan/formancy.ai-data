import {
  buildLookupConfig,
  deleteProblems,
  findObject,
  generateForm,
  lookupRowFilter,
  planCreate,
  planList,
  planRead,
  planUpdate,
  recordPage,
  scopeRowFilters,
  toFormAnswers,
  validatePolicy,
} from '@formancy/data-core'
import type {
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
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, offset: 0, limit: 50 }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  for (const [id, tenant] of UUID_ROWS.orders) {
    await owner.unsafe(`insert into sales."order" (id, tenant_id, customer_no, order_date, amount) overriding system value values ($1::bigint, $2::int, 1001, '2026-10-11', 1)`, [id, tenant])
  }
  for (const [id, tenant, order, carrier] of UUID_ROWS.deliveries) {
    await owner.unsafe('insert into sales.delivery (id, tenant_id, order_id, carrier) values ($1::uuid, $2::int, $3::bigint, $4)', [id, tenant, order, carrier])
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
  for (const check of checks) rejected.push(...(await lookups.rejects(check.config, check.tokens, check.filters)))
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
  // stays offered because the database fills it (0056). Delete is not: the
  // version column starts at its default again under a key used again, and
  // a key a default fills is not one the database numbers (0050).
  test('makes the key read-only, never required, and still offers create and update, and no delete', () => {
    const { form, bindings } = generateForm(snapshot, DELIVERY)
    const expected = UUID_PARITY.generated
    expect(bindings.fields.find((binding) => binding.field === expected.field)?.writes).toEqual(expected.writes)
    expect(form.model.fields.find((field) => field.key === expected.field)).not.toHaveProperty('required')
    expect(form.layouts?.[0]?.nodes.map((node) => ('label' in node ? node.label : undefined))).toEqual(expected.sections)
    expect(bindings.operations).toEqual(expected.operations.postgres)
    expect(bindings.identity).toEqual(UUID_PARITY.discovered.key)
  })
})

describe('a delete', covers('postgres', uuidCase('delete')), () => {
  // 0050 lets a delete reach nothing past its record through a foreign key,
  // and 0056's tables cascade: a parcel's key from its delivery, and a
  // delivery's from its order, beside a line's. Asked over what the order
  // form's own account discovers, as the publish check asks it -- the
  // policy's fit, then what a delete also does -- a grant of delete is
  // refused on the delivery form, which here offers none at all, its
  // version column guarding a key a default fills, and for the parcels a
  // delete would take with it; and on the order form for its deliveries and
  // its lines, so no order is deleted yet. Without the grant, neither form
  // is refused anything: the refusals are the delete's. A parcel has no
  // version column, so it offers no delete at all.
  test('is refused on the delivery form for its parcels, and on the order form for its deliveries and its lines', () => {
    const refused = (bindings: FormBindings, policy: FormPolicy): string[] => {
      const fit = validatePolicy(policy, bindings)
      return [...(fit.ok ? [] : fit.problems), ...deleteProblems(snapshot, bindings, policy)]
    }
    const deleting = (policy: FormPolicy): FormPolicy => ({ ...policy, operations: { ...policy.operations, delete: ['clerk'] } })
    expect(refused(deliveries, deleting(DELIVERY_POLICY))).toEqual(UUID_PARITY.delete.delivery.postgres)
    expect(refused(deliveries, DELIVERY_POLICY)).toEqual([])
    const orders = generateForm(snapshot, ORDER).bindings
    expect(refused(orders, deleting(ORDER_POLICY))).toEqual(UUID_PARITY.delete.order)
    expect(refused(orders, ORDER_POLICY)).toEqual([])
    expect({ update: parcels.operations.update, delete: parcels.operations.delete }).toEqual(UUID_PARITY.delete.parcel)
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
    const [stored] = await owner<{ tenant_id: number; carrier: string }[]>`select tenant_id, carrier from sales.delivery where id = ${String(made.answers['id'])}::uuid`
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
    expect(await update(OTTO, UUID_PARITY.update.record, before.version, { carrier: 'never written' })).toMatchObject({ ok: false, code: UUID_PARITY.update.stale })
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
      expect({ offset, keys: keysOf(page), hasMore: page.hasMore }).toEqual({ offset, keys: expected.slice(offset, offset + size), hasMore: offset + size < keys.length })
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
    const page = await lookups.search(config, { search: '', offset: 0, limit: 50 }, filters)
    expect(page).toEqual({ rows: expected.offered, hasMore: false, omitted: 0 })
    const found = await lookups.search(config, { search: expected.search.text, offset: 0, limit: 50 }, filters)
    expect(found.rows.map((row) => row.token)).toEqual(expected.search.tokens)
    expect(await lookups.resolve(config, [expected.resolved.token], filters)).toEqual([expected.resolved])
    const offered = expected.offered.map((row) => row.token)
    expect(await lookups.rejects(config, [...offered, ...expected.rejected], filters)).toEqual(expected.rejected)
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
    const page = await lookups.search(config, { search, offset: 0, limit: 50 }, filters)
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
