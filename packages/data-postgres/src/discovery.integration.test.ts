import { findObject } from '@formancy/data-core'
import type { MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import {
  accessDisagreements,
  FIXTURE_SCOPE,
  READER_ACCESS,
  restrictedDisagreements,
  snapshotDisagreements,
  startPostgresFixture,
  structuralDisagreements,
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
  test('describes the fixture exactly as the shared model says', async () => {
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
    expect(keys).toHaveLength(6)
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
  test('says the right thing about every foreign key of sales.order', async () => {
    expect(restrictedDisagreements(await discoverPostgres(reader, FIXTURE_SCOPE))).toEqual([])
  })

  // 0027 narrows 0006: an object in scope the account cannot use is
  // described, with every capability false, rather than replaced by a gap.
  // pg_catalog and the privilege functions answer every role, so nothing is
  // left that this account cannot establish -- an unusable table returning as
  // a gap would make "not yours" read as "cannot tell" again.
  test('describes every object in scope with no gap, and each capability as the fixture grants it', async () => {
    const snapshot = await discoverPostgres(reader, FIXTURE_SCOPE)
    expect(names(snapshot)).toEqual([
      'sales.country',
      'sales.customer',
      'sales.customer_summary',
      'sales.employee',
      'sales.order',
      'sales.order_line',
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
  test("has the owner's structure, every object, key and constraint, apart from access", async () => {
    expect(structuralDisagreements(await discoverPostgres(reader, FIXTURE_SCOPE))).toEqual([])
  })

  // The reader's description of the table it may read is the owner's, down
  // to fk_order_customer's target in a table it may not read -- so on
  // PostgreSQL the restricted rule above is met by the right answer, not by a
  // gap. Its columns differ from the owner's only in what it may write.
  test('sees sales.order exactly as the owner does, the key into sales.customer included, apart from access', async () => {
    const [asReader, asOwner] = await Promise.all([discoverPostgres(reader, FIXTURE_SCOPE), discoverPostgres(owner, FIXTURE_SCOPE)])
    const withoutAccess = (object: ObjectMeta) => ({ ...object, columns: object.columns.map(({ access: _access, ...rest }) => rest) })
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
  // relationships, and nothing would say so.
  test('information_schema hides every constraint on sales.order from the reader; pg_catalog hides none', async () => {
    const [hidden] = await reader<{ referential: number; listed: number; catalog: number }[]>`
      select
        (select count(*)::int from information_schema.referential_constraints where constraint_schema = 'sales') as referential,
        (select count(*)::int from information_schema.table_constraints where table_schema = 'sales' and table_name = 'order') as listed,
        (select count(*)::int from pg_catalog.pg_constraint where conrelid = 'sales."order"'::regclass) as catalog`
    expect(hidden).toEqual({ referential: 0, listed: 0, catalog: 5 })
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
