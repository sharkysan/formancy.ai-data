import { findObject } from '@formancy/data-core'
import type { MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import {
  accessDisagreements,
  covers,
  FIXTURE_MODEL,
  FIXTURE_SCOPE,
  MODEL_CASES,
  READER_ACCESS,
  restrictedDisagreements,
  snapshotDisagreements,
  startPostgresFixture,
  structuralDisagreements,
  versionFact,
} from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresAdapter } from './adapter.js'
import { discoverPostgres } from './index.js'

/**
 * Discovery against REAL PostgreSQL, loaded with the shared fixture (0005),
 * read as its owner and as `formancy_reader`, who may read sales."order" and
 * nothing else in the schema.
 *
 * What each snapshot must say is decided by `@formancy/data-fixtures`, not
 * here: the owner's is compared with the model, the reader's with the
 * restricted reader's rule and with what the fixture grants it (0027). What
 * the writer may do, and whether each capability is the server's own answer,
 * is `discovery-access.integration.test.ts`. The tests below that create their own schemas do
 * so outside `sales`, so the fixture stays exactly what the model describes.
 */
let fixture: PostgresFixture
let owner: Sql
let reader: Sql

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  reader = postgres(fixture.reader, { onnotice: () => {} })
})

afterAll(async () => {
  await Promise.all([owner?.end(), reader?.end()])
  await fixture?.stop()
})

function names(snapshot: MetadataSnapshot): string[] {
  return snapshot.objects.map((object) => `${object.ref.schema}.${object.ref.name}`)
}

/** What each column of an object may do, as `name:siu` with a dash for each capability it lacks. */
function capabilities(object: ObjectMeta): string[] {
  return object.columns.map(({ name, access }) => `${name}:${access.select ? 's' : '-'}${access.insert ? 'i' : '-'}${access.update ? 'u' : '-'}`)
}

function described(snapshot: MetadataSnapshot, schema: string, name: string): ObjectMeta {
  const found = findObject(snapshot, { schema, name })
  if (found === undefined) throw new Error(`${schema}.${name} is not in the snapshot`)
  return found
}

function column(object: ObjectMeta, name: string): ObjectMeta['columns'][number] {
  const found = object.columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`${object.ref.name} has no column ${name}`)
  return found
}

describe('discovery as the owner', () => {
  // The conformance both engines answer to (0005). A table, a key, a type or a
  // relationship that this adapter reads differently from the model is a
  // named sentence here, and the same sentence on SQL Server's suite.
  test('describes the fixture exactly as the shared model says', covers('postgres', MODEL_CASES.owner), async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(snapshotDisagreements(snapshot)).toEqual([])
  })

  // Two answers to "which server is this" would let a snapshot claim a version
  // the ping denies. Both read the same setting, and this holds them to it.
  test("reports the server version the adapter's ping reports", async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    const identity = await createPostgresAdapter(owner).ping()
    expect(snapshot.kind).toBe('postgres')
    expect(snapshot.serverVersion).toBe(identity.version)
  })

  // Whose snapshot it is (0027). The container's user is a superuser that
  // logged in as itself, so current_user and session_user are both it. An
  // adapter that reported no account, or another, would hash the wrong
  // principal into the fingerprint.
  test("names the account it discovered as: the container's owner, as user and as login", async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(snapshot.account).toEqual(fixture.owner)
  })

  // PostgreSQL files a stored generated column's expression in pg_attrdef and
  // sets atthasdef, exactly as it does for a default. Read naively, line_total
  // "has a default" -- and the model does not pin hasDefault for it, so only
  // this test notices an adapter that says so.
  test('a computed column has no default, though PostgreSQL files its expression where defaults live', async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(column(described(snapshot, 'sales', 'order_line'), 'line_total')).toMatchObject({
      generated: 'computed',
      hasDefault: false,
      defaultExpression: null,
    })
  })

  // What the model leaves out is still something a person reads in a report:
  // the type as PostgreSQL spells it, the default and check as it states them.
  // An adapter that reported `numeric` for numeric(18,4), or a check without
  // its expression, would pass the model and mislead the reader of the report.
  test("keeps the database's own spelling and expressions beside the normalised facts", async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    const order = described(snapshot, 'sales', 'order')
    expect(column(order, 'amount').databaseType).toBe('numeric(18,4)')
    expect(column(order, 'status')).toMatchObject({ databaseType: 'character varying(20)', defaultExpression: "'draft'::character varying" })
    expect(column(order, 'row_version')).toMatchObject({ databaseType: 'bigint', defaultExpression: '1' })
    expect(column(described(snapshot, 'sales', 'customer'), 'created_at')).toMatchObject({
      databaseType: 'timestamp with time zone',
      defaultExpression: 'now()',
    })
    expect(column(described(snapshot, 'sales', 'country'), 'iso_code').databaseType).toBe('character(2)')

    const [check] = order.checks
    expect(check?.name).toBe('ck_order_status')
    expect(check?.enforced).toBe(true)
    expect(check?.validated).toBe(true)
    expect(check?.expression).toMatch(/status.*'draft'.*'placed'.*'shipped'/)
  })

  // An identity column takes its value from a sequence, not a default, and
  // pg_attrdef has no row for it. Reported with a default, a form would treat
  // it as "may be supplied, else filled in", which GENERATED ALWAYS refuses --
  // and BY DEFAULT accepts, so the two are named apart, and shipment.id, the
  // by-default one, has no default either.
  test('an identity column is generated, always or by default, and has no default', async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(column(described(snapshot, 'sales', 'country'), 'id')).toMatchObject({
      generated: 'identity-always',
      hasDefault: false,
      defaultExpression: null,
    })
    expect(column(described(snapshot, 'sales', 'shipment'), 'id')).toMatchObject({
      generated: 'identity-by-default',
      hasDefault: false,
      defaultExpression: null,
    })
  })

  // NOT VALID skips the rows already there and nothing else: PostgreSQL 17
  // checks every new row against the constraint. An adapter that read
  // convalidated as enforcement would call ck_shipment_carrier switched off,
  // and a form would let through the carrier 0 the database refuses.
  test('a check added NOT VALID is enforced and not validated', async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    const checks = described(snapshot, 'sales', 'shipment').checks.map(({ name, enforced, validated }) => ({ name, enforced, validated }))
    expect(checks.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'ck_shipment_carrier', enforced: true, validated: false },
      { name: 'ck_shipment_reference', enforced: true, validated: true },
      { name: 'ck_shipment_weight', enforced: true, validated: true },
    ])
    // And the database agrees: carrier 0 is refused for a new row.
    await expect(
      owner`insert into sales.shipment (tenant_id, tracking_no, carrier_code, reference, pickup_time) values (9, gen_random_uuid(), 0, 'C', '08:00')`,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'ck_shipment_carrier' })
  })

  // The model compares on-delete and validation only. On-update and
  // enforcement are the adapter's to get right, and PostgreSQL 17 cannot
  // declare a foreign key NOT ENFORCED, so every fixture key is enforced.
  test('reads on-update and enforcement for every foreign key', async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    const keys = snapshot.objects.flatMap((object) => object.foreignKeys)
    expect(keys).toHaveLength(FIXTURE_MODEL.flatMap((object) => object.foreignKeys).length)
    for (const key of keys) expect(key).toMatchObject({ onUpdate: 'no-action', enforced: true })
  })

  // A comment is for the person choosing a table. One read from the wrong
  // pg_description row -- a column's for the table's -- reads as plausible.
  test('reads a table comment and leaves the uncommented ones null', async () => {
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(described(snapshot, 'sales', 'customer').comment).toBe('A buyer, numbered within its tenant.')
    expect(described(snapshot, 'sales', 'order').comment).toBeNull()
    expect(described(snapshot, 'sales', 'customer').columns.every((entry) => entry.comment === null)).toBe(true)
  })
})

describe('discovery as the restricted reader', () => {
  // The rule every engine is held to: for each foreign key of sales.order,
  // the right target or a gap that says it cannot tell. Never the silent
  // answer, which reads as "no relationship".
  test('says the right thing about every foreign key of sales.order', covers('postgres', MODEL_CASES.restricted), async () => {
    expect(restrictedDisagreements(await discoverPostgres(reader, FIXTURE_SCOPE))).toEqual([])
  })

  // 0027 narrows 0006: an object in scope the account cannot use is
  // described, with every capability false, rather than replaced by a gap.
  // pg_catalog and the privilege functions answer every role, so nothing is
  // left that this account cannot establish -- an unusable table returning as
  // a gap would make "not yours" read as "cannot tell" again.
  test('describes every object in scope with no gap, and each capability as the fixture grants it', covers('postgres', MODEL_CASES.readerAccess), async () => {
    const snapshot = await discoverPostgres(reader, FIXTURE_SCOPE)
    expect(names(snapshot)).toEqual([
      'sales.country',
      'sales.customer',
      'sales.customer_summary',
      'sales.delivery',
      'sales.employee',
      'sales.order',
      'sales.order_line',
      'sales.parcel',
      'sales.shipment',
    ])
    expect(snapshot.gaps).toEqual([])
    expect(accessDisagreements(snapshot, READER_ACCESS)).toEqual([])
    // The reader may not read customer, and row_security_active still answers
    // for it (B1): the policy applies to every role but the superuser owner.
    const customer = described(snapshot, 'sales', 'customer')
    expect(customer.rowSecurity).toBe('applies')
    expect(capabilities(customer).every((entry) => entry.endsWith(':---'))).toBe(true)
  })

  // pg_catalog is not filtered by privilege, so the reader's snapshot has the
  // owner's structure everywhere -- only what it may do, and whether row
  // security applies to it, differ. A privilege-filtered read sneaking back
  // in (information_schema, or a privilege test in a WHERE) fails here.
  test("has the owner's structure, every object, key and constraint, apart from access", covers('postgres', MODEL_CASES.structure), async () => {
    expect(structuralDisagreements(await discoverPostgres(reader, FIXTURE_SCOPE))).toEqual([])
  })

  // The reader's description of the table it may read is the owner's, down
  // to fk_order_customer's target in a table it may not read -- so on
  // PostgreSQL the restricted rule above is met by the right answer, not by a
  // gap. Its columns differ from the owner's only in what it may write.
  test('sees sales.order exactly as the owner does, the key into sales.customer included, apart from access', async () => {
    const [asReader, asOwner] = await Promise.all([discoverPostgres(reader, FIXTURE_SCOPE), discoverPostgres(owner, FIXTURE_SCOPE)])
    const withoutAccess = ({ access: _deletes, ...object }: ObjectMeta) => ({ ...object, columns: object.columns.map(({ access: _access, ...rest }) => rest) })
    expect(withoutAccess(described(asReader, 'sales', 'order'))).toEqual(withoutAccess(described(asOwner, 'sales', 'order')))
    expect(capabilities(described(asReader, 'sales', 'order')).every((entry) => entry.endsWith(':s--'))).toBe(true)
    expect(described(asReader, 'sales', 'order').foreignKeys.find((key) => key.name === 'fk_order_customer')?.references).toEqual({
      table: { schema: 'sales', name: 'customer' },
      columns: ['tenant_id', 'customer_no'],
    })
  })

  // Why this adapter reads pg_catalog (0006). information_schema shows a
  // constraint only to an account with a privilege other than SELECT on its
  // table, so the reader sees no constraint at all on the table it reads: an
  // adapter built on it would report sales.order with no key and no
  // relationships, and nothing would say so. PostgreSQL 18 also files each
  // NOT NULL in pg_constraint, a row of type n for every column pg_attribute
  // holds NOT NULL, and the reader sees those as it sees the rest; 15 to 17
  // file none (VERSION_FACTS.notNullConstraints; watched failing on 18 while
  // this counted every row as one of the five, and with 18's value given to
  // 17). Discovery reads NOT NULL from attnotnull, and a row of type n only
  // when it is not validated, which only a NOT NULL added NOT VALID is and
  // which it reads as a check (0077); no table of the shared model has one,
  // so its snapshot of the table is the same on each: the shared model's
  // cases above hold that on every leg.
  test('information_schema hides every constraint on sales.order from the reader; pg_catalog hides none', async () => {
    const [hidden] = await reader<{ referential: number; listed: number; catalog: number; notNull: number; notNullColumns: number }[]>`
      select
        (select count(*)::int from information_schema.referential_constraints where constraint_schema = 'sales') as referential,
        (select count(*)::int from information_schema.table_constraints where table_schema = 'sales' and table_name = 'order') as listed,
        (select count(*)::int from pg_catalog.pg_constraint where conrelid = 'sales."order"'::regclass and contype <> 'n') as catalog,
        (select count(*)::int from pg_catalog.pg_constraint where conrelid = 'sales."order"'::regclass and contype = 'n') as "notNull",
        (select count(*)::int from pg_catalog.pg_attribute where attrelid = 'sales."order"'::regclass and attnum > 0 and not attisdropped and attnotnull) as "notNullColumns"`
    const { notNullColumns = 0, ...counted } = hidden ?? {}
    expect(notNullColumns).toBeGreaterThan(0)
    expect(counted).toEqual({ referential: 0, listed: 0, catalog: 5, notNull: versionFact('notNullConstraints', fixture.server) ? notNullColumns : 0 })
  })

  describe('privileges short of a whole table', () => {
    beforeAll(async () => {
      await owner.unsafe(`
        create schema access;
        create table access.whole (id integer primary key, secret text);
        create table access.partial (id integer primary key, gone text, secret text);
        create table access.none (id integer primary key);
        alter table access.partial drop column gone;
        grant usage on schema access to formancy_reader;
        grant select on access.whole to formancy_reader;
        grant select (id) on access.partial to formancy_reader;
        grant update (secret) on access.partial to formancy_reader;

        create schema sealed;
        create table sealed.inside (id integer primary key);
        grant select on sealed.inside to formancy_reader;
      `)
    })

    // A grant on some columns is how a narrow lookup account is often set up.
    // Described as if every column were readable, a form would bind `secret`
    // and fail at the first read; replaced by a gap that "cannot say which",
    // the lookup the grant was made for would vanish. Each column says what
    // it may do, an UPDATE granted without SELECT included. The dropped
    // column leaves a hole in the attnums (id 1, secret 3): an answer matched
    // to its column by list position, from a query that kept the dropped
    // column's row, would give `secret` the dropped column's answer. Both
    // queries drop that row, so a positional match over the two filtered
    // lists still lines up and is not what this catches.
    test('a table granted column by column reports exactly the columns it may read, and no gap', async () => {
      const snapshot = await discoverPostgres(reader, { schemas: ['access'] })
      expect(names(snapshot)).toEqual(['access.none', 'access.partial', 'access.whole'])
      expect(snapshot.gaps).toEqual([])
      expect(capabilities(described(snapshot, 'access', 'whole'))).toEqual(['id:s--', 'secret:s--'])
      expect(capabilities(described(snapshot, 'access', 'partial'))).toEqual(['id:s--', 'secret:--u'])
      expect(capabilities(described(snapshot, 'access', 'none'))).toEqual(['id:---'])
    })

    // A table privilege is useless without USAGE on its schema: every read
    // fails with "permission denied for schema" (B2). An adapter that checked
    // the table alone would describe a column it says may be read, and a form
    // bound to it would fail at the first request.
    test('a table in a schema without USAGE is described with no capability, though its grant says SELECT', async () => {
      const snapshot = await discoverPostgres(reader, { schemas: ['sealed'] })
      expect(snapshot.gaps).toEqual([])
      expect(capabilities(described(snapshot, 'sealed', 'inside'))).toEqual(['id:---'])
      const [granted] = await reader<{ granted: boolean }[]>`
        select pg_catalog.has_table_privilege(c.oid, 'SELECT') as granted
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'sealed' and c.relname = 'inside'`
      expect(granted?.granted).toBe(true)
      await expect(reader`select id from sealed.inside`).rejects.toMatchObject({ code: '42501' })
    })

    // 0004 promises that a revoked permission is noticed, and noticed as an
    // access problem rather than as a dropped table. Both halves: the
    // fingerprint moves, and the object is still there, its columns saying
    // what was lost -- which drift review reads as privilege-narrowed.
    test('a revoked privilege changes the fingerprint and the columns it covered, not the object list', async () => {
      const before = await discoverPostgres(reader, { schemas: ['access'] })
      await owner`revoke select on access.whole from formancy_reader`
      try {
        const after = await discoverPostgres(reader, { schemas: ['access'] })
        expect(after.fingerprint).not.toBe(before.fingerprint)
        expect(names(after)).toEqual(names(before))
        expect(after.gaps).toEqual([])
        expect(capabilities(described(after, 'access', 'whole'))).toEqual(['id:---', 'secret:---'])
      } finally {
        await owner`grant select on access.whole to formancy_reader`
      }
      // And back: the fingerprint hashes privileges, not when they were read.
      expect((await discoverPostgres(reader, { schemas: ['access'] })).fingerprint).toBe(before.fingerprint)
    })
  })
})

describe('the discovery scope', () => {
  // Schema names come from an administrator's configuration, which is input.
  // Spliced into the catalog query, either of these would end the string or
  // the identifier and drop a table. Bound, each is a name no schema has.
  test('a schema name carrying a quote and SQL is bound: it finds nothing and harms nothing', async () => {
    const snapshot = await discoverPostgres(owner, {
      schemas: [`sales'); drop table sales.employee cascade; --`, `sales"; drop table sales.employee cascade; --`],
    })
    expect(snapshot.objects).toEqual([])
    expect(snapshot.gaps).toEqual([])
    expect(snapshotDisagreements(await discoverPostgres(owner, FIXTURE_SCOPE))).toEqual([])
  })

  // Binding is not only refusal. A real schema with a quote in its name has
  // to be found, which is where hand-escaped SQL usually goes wrong.
  test('a schema and a table whose names contain quotes are found by those names', async () => {
    await owner.unsafe(`create schema "o'brien"; create table "o'brien"."it's" (id integer primary key)`)
    const snapshot = await discoverPostgres(owner, { schemas: ["o'brien"] })
    expect(names(snapshot)).toEqual(["o'brien.it's"])
  })

  // The approved scope is a boundary: an administrator who approved `sales`
  // did not approve whatever else the database holds.
  test('an object in a schema outside the scope is not reported', async () => {
    await owner.unsafe('create schema outside; create table outside.secret (id integer primary key)')
    const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(snapshot.objects.filter((object) => object.ref.schema !== 'sales')).toEqual([])
    expect(snapshotDisagreements(snapshot)).toEqual([])
    // Found once its schema is in scope, so the absence above is the scope's doing.
    expect(names(await discoverPostgres(owner, { schemas: ['outside'] }))).toEqual(['outside.secret'])
  })

  // A delete of an order reaches every table whose key refers to it, in any
  // schema (0049). The scope bounds what is described, not what refers to it:
  // a key from outside is named on the table it refers to, and nothing else
  // of its table is read. pg_catalog shows it to the reader too, who has no
  // USAGE on that schema (P2), so a PostgreSQL snapshot needs no gap for it.
  // An adapter that read only the keys of tables in scope would say a delete
  // of an order reaches its deliveries and lines and nothing else.
  test('a key from a schema outside the scope that refers to a table in it is named there, and its table is not described', async () => {
    await owner.unsafe('create schema elsewhere; create table elsewhere.order_copy (id integer primary key, order_id bigint constraint fk_copy_order references sales."order" (id) on delete set null)')
    try {
      for (const sql of [owner, reader]) {
        const snapshot = await discoverPostgres(sql, FIXTURE_SCOPE)
        expect(names(snapshot).every((name) => name.startsWith('sales.'))).toBe(true)
        expect(described(snapshot, 'sales', 'order').referencedBy).toEqual([
          { table: { schema: 'elsewhere', name: 'order_copy' }, name: 'fk_copy_order', columns: ['order_id'], referencedColumns: ['id'], onDelete: 'set-null', onUpdate: 'no-action', enforced: true },
          { table: { schema: 'sales', name: 'delivery' }, name: 'fk_delivery_order', columns: ['order_id'], referencedColumns: ['id'], onDelete: 'cascade', onUpdate: 'no-action', enforced: true },
          { table: { schema: 'sales', name: 'order_line' }, name: 'fk_order_line_order', columns: ['order_id'], referencedColumns: ['id'], onDelete: 'cascade', onUpdate: 'no-action', enforced: true },
        ])
        expect(snapshot.gaps).toEqual([])
      }
      expect(await reader`select pg_catalog.has_schema_privilege('elsewhere', 'USAGE') as usage`).toEqual([{ usage: false }])
    } finally {
      await owner.unsafe('drop schema elsewhere cascade')
    }
    expect(snapshotDisagreements(await discoverPostgres(owner, FIXTURE_SCOPE))).toEqual([])
  })

  // A key between partitioned tables is declared once, and PostgreSQL clones
  // it onto every partition of the referring table, each clone referring to
  // the same table (0006). The clones are plumbing: listed, they would make
  // one key three, and a delete's reach would name partitions nobody
  // declared a key on. Disabling the triggers of one partition's clone makes
  // the declared key not enforced, as on the referring side -- and that is
  // all `enforced: false` says on PostgreSQL: the referring partition's
  // checks are off, yet the referenced side's action triggers still cascade
  // a delete into it. A later reach that left out keys not enforced would
  // miss this cascade.
  test('a key onto a partitioned table is listed once, by the table it was declared on, and no clone is', async () => {
    await owner.unsafe(`
      create schema parted;
      create table parted.root (id integer primary key) partition by range (id);
      create table parted.root_low partition of parted.root for values from (0) to (100);
      create table parted.root_high partition of parted.root for values from (100) to (200);
      create table parted.leaf (id integer, root_id integer constraint fk_leaf_root references parted.root (id) on delete cascade, primary key (id)) partition by range (id);
      create table parted.leaf_low partition of parted.leaf for values from (0) to (100);
      create table parted.leaf_high partition of parted.leaf for values from (100) to (200);`)
    const keysOnto = async () => (described(await discoverPostgres(owner, { schemas: ['parted'] }), 'parted', 'root').referencedBy ?? []).map((key) => [key.table.name, key.name, key.enforced])
    expect(await keysOnto()).toEqual([['leaf', 'fk_leaf_root', true]])
    const [clones] = await owner<{ count: number }[]>`select count(*)::int as count from pg_catalog.pg_constraint where conparentid <> 0 and confrelid = 'parted.root'::regclass`
    expect(clones?.count).toBe(2)
    await owner.unsafe('alter table parted.leaf_low disable trigger all')
    expect(await keysOnto()).toEqual([['leaf', 'fk_leaf_root', false]])
    // Not checked: a row referring to nothing goes in. Still acted on: the delete cascades.
    await owner.unsafe('insert into parted.root values (1); insert into parted.leaf values (5, 1), (6, 999); delete from parted.root where id = 1')
    expect(await owner`select id, root_id from parted.leaf order by id`).toEqual([{ id: 6, root_id: 999 }])
  })

  // A key may be declared onto one partition of a partitioned table, or onto
  // a table that inherits from another, and pg_constraint then records it on
  // that partition or child alone -- which discovery does not describe, or
  // describes as a table of its own. A delete from the parent still reaches
  // the partition's or the child's rows, and the key acts: the cascades
  // below run. An adapter that listed keys only by the relation they name
  // would say nothing refers to the parent but its own keys, and a delete's
  // reach reviewed from it would be short without a word -- so each such
  // key is a referenced-by gap on every described relation above it, the
  // partition's schema in scope or not, the clones of a key onto the parent
  // apart. As the reader too, who holds nothing on these tables (P2).
  test('a key onto a partition, or onto a table that inherits, is a referenced-by gap on every described table above it', async () => {
    await owner.unsafe(`
      create schema heir;
      create schema heir_far;
      create schema heir_refs;
      create table heir.ord (id integer, region integer, primary key (id, region)) partition by list (region);
      create table heir.ord_1 partition of heir.ord for values in (1);
      create table heir_far.ord_2 partition of heir.ord for values in (2) partition by list (id);
      create table heir_far.ord_2a partition of heir_far.ord_2 for values in (1);
      create table heir_refs.note (id integer primary key, ord_id integer, region integer,
        constraint fk_note_ord_1 foreign key (ord_id, region) references heir.ord_1 (id, region) on delete cascade);
      create table heir_refs.memo (id integer primary key, ord_id integer, region integer,
        constraint fk_memo_ord_2a foreign key (ord_id, region) references heir_far.ord_2a (id, region) on delete set null);
      create table heir_refs.line (id integer primary key, ord_id integer, region integer,
        constraint fk_line_ord foreign key (ord_id, region) references heir.ord (id, region) on delete cascade);
      create table heir.doc (id integer primary key);
      create table heir.doc_archive (archived_at date) inherits (heir.doc);
      alter table heir.doc_archive add primary key (id);
      create table heir_refs.mention (id integer primary key, doc_id integer constraint fk_mention_archive references heir.doc_archive (id) on delete cascade);
      insert into heir.ord values (1, 1), (1, 2);
      insert into heir_refs.note values (1, 1, 1);
      insert into heir_refs.memo values (1, 1, 2);
      insert into heir.doc_archive values (7, null);
      insert into heir_refs.mention values (1, 7);`)
    try {
      for (const sql of [owner, reader]) {
        const snapshot = await discoverPostgres(sql, { schemas: ['heir'] })
        expect(names(snapshot)).toEqual(['heir.doc', 'heir.doc_archive', 'heir.ord'])
        expect(snapshot.gaps.map((gap) => [`${gap.subject.kind === 'object' ? gap.subject.object.name : gap.subject.kind}`, gap.aspect, gap.detail])).toEqual([
          ['doc', 'referenced-by', 'foreign key fk_mention_archive of heir_refs.mention refers to heir.doc_archive, a table that inherits from this one, and a delete from this table reaches its rows; this release lists a key only on the table it names'],
          ['ord', 'referenced-by', 'foreign key fk_memo_ord_2a of heir_refs.memo refers to heir_far.ord_2a, a partition of this table, and a delete from this table reaches its rows; this release lists a key only on the table it names'],
          ['ord', 'referenced-by', 'foreign key fk_note_ord_1 of heir_refs.note refers to heir.ord_1, a partition of this table, and a delete from this table reaches its rows; this release lists a key only on the table it names'],
        ])
        expect(described(snapshot, 'heir', 'ord').referencedBy?.map((key) => key.name)).toEqual(['fk_line_ord'])
        expect(described(snapshot, 'heir', 'doc').referencedBy).toEqual([])
        expect(described(snapshot, 'heir', 'doc_archive').referencedBy?.map((key) => key.name)).toEqual(['fk_mention_archive'])
      }
      await owner.unsafe('delete from heir.ord where id = 1; delete from heir.doc where id = 7')
      const [left] = await owner<{ notes: number; cleared: number; mentions: number }[]>`
        select (select count(*)::int from heir_refs.note) as notes,
          (select count(*)::int from heir_refs.memo where ord_id is null) as cleared,
          (select count(*)::int from heir_refs.mention) as mentions`
      expect(left).toEqual({ notes: 0, cleared: 1, mentions: 0 })
    } finally {
      await owner.unsafe('drop schema heir_refs cascade; drop schema heir_far cascade; drop schema heir cascade')
    }
  })

  // An empty list is where a filter most often disappears from a query, and
  // "no schemas" would become "every schema".
  test('an empty scope reads nothing, rather than everything', async () => {
    const snapshot = await discoverPostgres(owner, { schemas: [] })
    expect(snapshot.objects).toEqual([])
    expect(snapshot.gaps).toEqual([])
  })
})

describe('the fingerprint', () => {
  // Drift review compares fingerprints. One that moved between two reads of
  // an unchanged database would report drift nobody caused.
  test('is the same for two discoveries of an unchanged database', async () => {
    const first = await discoverPostgres(owner, FIXTURE_SCOPE)
    const second = await discoverPostgres(owner, FIXTURE_SCOPE)
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  // One that did not move after ALTER TABLE would miss real drift. And one
  // that did not come back after the change was undone would be hashing
  // something other than the structure -- an oid, a transaction id.
  test('changes after an ALTER TABLE, and comes back when the change is undone', async () => {
    await owner.unsafe('create schema drift; create table drift.note (id integer primary key, body varchar(50))')
    const scope = { schemas: ['drift'] }
    const before = await discoverPostgres(owner, scope)
    await owner`alter table drift.note alter column body type varchar(60)`
    const altered = await discoverPostgres(owner, scope)
    await owner`alter table drift.note alter column body type varchar(50)`
    const restored = await discoverPostgres(owner, scope)
    expect(altered.fingerprint).not.toBe(before.fingerprint)
    expect(restored.fingerprint).toBe(before.fingerprint)
  })
})

describe('discovery through the adapter port', () => {
  // The server will only ever hold a DatabaseAdapter. Discovery reached
  // through it must be the same discovery, with the same fingerprint, or drift
  // review would compare two different readings of one database.
  test('the port discovers exactly what discoverPostgres does', async () => {
    const direct = await discoverPostgres(owner, FIXTURE_SCOPE)
    const through = await createPostgresAdapter(owner).discover(FIXTURE_SCOPE)
    expect(snapshotDisagreements(through)).toEqual([])
    expect(through.fingerprint).toBe(direct.fingerprint)
  })
})
