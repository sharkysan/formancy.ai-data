import { findObject } from '@formancy/data-core'
import type { ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { discoverPostgres } from './index.js'

/**
 * Catalog shapes the shared fixture does not have and real databases do:
 * unique indexes that are not constraints, every referential action, a
 * foreign key whose triggers were disabled, partitioning, materialized views,
 * foreign tables. Each is declared here and read back from the catalog.
 *
 * Like the types suite, these live in a schema of this suite's own because
 * `@formancy/data-fixtures` does not describe them yet.
 */
let fixture: PostgresFixture
let owner: Sql
let snapshot: MetadataSnapshot

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  await owner.unsafe(`
    create schema shapes;

    create table shapes.account (
      id integer constraint pk_account primary key,
      email text not null,
      tenant integer not null,
      code text not null,
      deleted boolean not null default false
    );
    -- What Rails and Django migrations create: a unique INDEX, no constraint.
    create unique index ux_account_email on shapes.account (email);
    -- Unique on (tenant, code); "deleted" is carried, not part of the key.
    create unique index ux_account_tenant_code on shapes.account (tenant, code) include (deleted);
    -- Unique only among live rows, and unique over an expression: neither is a key.
    create unique index ux_account_live_email on shapes.account (email) where not deleted;
    create unique index ux_account_lower_email on shapes.account (lower(email));
    create index ix_account_tenant on shapes.account (tenant);
    comment on column shapes.account.code is 'Unique within a tenant.';

    -- A foreign key may point at a unique index; PostgreSQL accepts it.
    create table shapes.membership (
      id integer constraint pk_membership primary key,
      tenant integer,
      code text,
      constraint fk_membership_account foreign key (tenant, code) references shapes.account (tenant, code)
    );

    create table shapes.target (id integer constraint pk_target primary key);
    create table shapes.actions (
      id integer constraint pk_actions primary key,
      a integer default 0 constraint fk_actions_a references shapes.target on update cascade on delete restrict,
      b integer default 0 constraint fk_actions_b references shapes.target on update set null on delete set null,
      c integer default 0 constraint fk_actions_c references shapes.target on update set default on delete set default,
      d integer constraint fk_actions_d references shapes.target on update no action on delete cascade
    );

    create table shapes.unchecked (
      id integer constraint pk_unchecked primary key,
      target_id integer constraint fk_unchecked_target references shapes.target
    );
    -- Only a superuser may do this, and it is exactly what a bulk load does.
    alter table shapes.unchecked disable trigger all;

    create table shapes.ledger (
      id integer not null,
      region integer not null,
      constraint pk_ledger primary key (id, region)
    ) partition by list (region);
    create table shapes.ledger_east partition of shapes.ledger for values in (1);
    create table shapes.ledger_west partition of shapes.ledger for values in (2);
    create table shapes.posting (
      id integer constraint pk_posting primary key,
      ledger_id integer,
      region integer,
      constraint fk_posting_ledger foreign key (ledger_id, region) references shapes.ledger (id, region)
    );

    -- NOT VALID inside CREATE TABLE is ignored: an empty table is valid. It
    -- takes a row that breaks the check and an ALTER, as in the fixture.
    create table shapes.measure (reading integer);
    insert into shapes.measure values (-1);
    alter table shapes.measure add constraint ck_measure_positive check (reading > 0) not valid;

    create materialized view shapes.account_count as select tenant, count(*) as accounts from shapes.account group by tenant;

    -- Legal, and the state a table is in between a migration's CREATE and its ALTERs.
    create table shapes.bare ();

    create extension postgres_fdw;
    create server elsewhere foreign data wrapper postgres_fdw options (host 'localhost', dbname 'nowhere');
    create foreign table shapes.remote (id integer) server elsewhere;

    insert into shapes.account (id, email, tenant, code) values (1, 'a@example.com', 1, 'same'), (2, 'b@example.com', 2, 'same');
  `)
  // A unique index built CONCURRENTLY over duplicates fails and stays behind,
  // marked invalid. Outside the block above: CONCURRENTLY refuses to run in a
  // transaction, and a multi-statement query is one.
  await expect(owner`create unique index concurrently ux_account_code on shapes.account (code)`).rejects.toMatchObject({ code: '23505' })
  snapshot = await discoverPostgres(owner, { schemas: ['shapes'] })
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

function described(name: string): ObjectMeta {
  const found = findObject(snapshot, { schema: 'shapes', name })
  if (found === undefined) throw new Error(`shapes.${name} is not in the snapshot`)
  return found
}

function foreignKey(table: string, name: string): ForeignKeyMeta {
  const found = described(table).foreignKeys.find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`shapes.${table} has no foreign key ${name}`)
  return found
}

describe('keys', () => {
  // pg_constraint alone misses every unique index that is not a constraint,
  // which is what most migration tools create. The account's email would read
  // as not unique, and the lookup key a foreign key points at would not be a
  // key of its target at all.
  test('a unique index is a unique key; a partial or expression one is not', () => {
    expect(described('account').uniqueKeys).toEqual([
      { name: 'ux_account_email', columns: ['email'] },
      { name: 'ux_account_tenant_code', columns: ['tenant', 'code'] },
    ])
  })

  // An invalid unique index enforces nothing for the rows already there --
  // two accounts share the code it was meant to make unique. Reported as a
  // key, a lookup by code would promise one row and find two.
  test('a unique index left invalid by a failed concurrent build is not a key', async () => {
    const [index] = await owner<{ valid: boolean }[]>`
      select indisvalid as valid from pg_catalog.pg_index where indexrelid = 'shapes.ux_account_code'::pg_catalog.regclass`
    expect(index?.valid).toBe(false)
    expect(described('account').uniqueKeys.map((key) => key.name)).not.toContain('ux_account_code')
  })

  // Included columns ride along in pg_index.indkey after the key columns.
  // Read whole, (tenant, code) INCLUDE (deleted) would become a three-column
  // key that no foreign key matches.
  test("a foreign key to a unique index pairs with that index's key columns", () => {
    expect(foreignKey('membership', 'fk_membership_account').references).toEqual({
      table: { schema: 'shapes', name: 'account' },
      columns: ['tenant', 'code'],
    })
  })
})

describe('foreign keys', () => {
  // Each action decides what a delete in the form does to other rows. One
  // read from the wrong column -- on update for on delete -- turns RESTRICT
  // into CASCADE in the report.
  test('reads every referential action, on update and on delete separately', () => {
    const actions = Object.fromEntries(
      described('actions').foreignKeys.map((entry) => [entry.name, [entry.onUpdate, entry.onDelete]]),
    )
    expect(actions).toEqual({
      fk_actions_a: ['cascade', 'restrict'],
      fk_actions_b: ['set-null', 'set-null'],
      fk_actions_c: ['set-default', 'set-default'],
      fk_actions_d: ['no-action', 'cascade'],
    })
  })

  // PostgreSQL 17 cannot declare a foreign key NOT ENFORCED; its constraint
  // is enforced by triggers, and DISABLE TRIGGER ALL switches them off while
  // pg_constraint still says nothing has changed. Reported as enforced, a
  // form would rely on the database refusing an orphan it will now accept.
  test('a foreign key whose triggers are disabled is not enforced', () => {
    expect(foreignKey('unchecked', 'fk_unchecked_target').enforced).toBe(false)
    expect(foreignKey('actions', 'fk_actions_a').enforced).toBe(true)
  })

  // A foreign key to a partitioned table is one constraint to the person who
  // wrote it, and one pg_constraint row per partition besides, all on the
  // referencing table. Read naively, posting has three foreign keys.
  test('a foreign key to a partitioned table is reported once, pointing at the table', () => {
    expect(described('posting').foreignKeys).toEqual([
      {
        name: 'fk_posting_ledger',
        columns: ['ledger_id', 'region'],
        references: { table: { schema: 'shapes', name: 'ledger' }, columns: ['id', 'region'] },
        onUpdate: 'no-action',
        onDelete: 'no-action',
        enforced: true,
        validated: true,
      },
    ])
  })
})

describe('objects', () => {
  // A partition is storage for its parent. Reported as tables, each would be
  // offered as a form of its own, and a write to one could bypass the routing
  // the parent does.
  test('a partitioned table is a table, and its partitions are not objects', () => {
    expect(described('ledger')).toMatchObject({ kind: 'table', primaryKey: { name: 'pk_ledger', columns: ['id', 'region'] } })
    expect(snapshot.objects.map((object) => object.ref.name)).not.toContain('ledger_east')
  })

  // A materialized view is read like a view and cannot be written. Reported
  // as a table, a form would offer to insert into it.
  test('a materialized view is a view', () => {
    expect(described('account_count')).toMatchObject({ kind: 'view', primaryKey: null })
  })

  // A table with no columns has no pg_attribute rows to group it by. An
  // assembly keyed on columns would lose it, and a migration half-applied
  // would read as a table that was never created.
  test('a table with no columns is still a table', () => {
    expect(described('bare')).toMatchObject({ kind: 'table', columns: [], primaryKey: null })
  })

  // A foreign table's rows live on another server, through a wrapper this
  // release has never tested. Leaving it out silently would read as "there
  // is no such table"; so it is a gap.
  test('a foreign table is a gap, not an object', () => {
    expect(findObject(snapshot, { schema: 'shapes', name: 'remote' })).toBeUndefined()
    expect(snapshot.gaps).toEqual([
      { object: { schema: 'shapes', name: 'remote' }, aspect: 'objects', detail: expect.stringMatching(/foreign table/) as unknown },
    ])
  })

  // The other relations in a schema -- indexes, sequences, composite types
  // -- are pg_class rows too. Listed, the account's indexes would be tables.
  test('reports tables and views and nothing else', () => {
    expect(snapshot.objects.map((object) => `${object.kind} ${object.ref.name}`)).toEqual([
      'table account',
      'view account_count',
      'table actions',
      'table bare',
      'table ledger',
      'table measure',
      'table membership',
      'table posting',
      'table target',
      'table unchecked',
    ])
  })
})

describe('checks and comments', () => {
  // NOT VALID means the rows already there were never checked. And the
  // expression is the expression: pg_get_constraintdef would append
  // "NOT VALID" to it, and a translator would choke on SQL that is not one.
  test('a NOT VALID check is unvalidated, and its expression is only the expression', () => {
    expect(described('measure').checks).toEqual([{ name: 'ck_measure_positive', expression: '(reading > 0)', validated: false }])
  })

  // A column comment lives in pg_description beside the table's, told apart
  // only by objsubid. Mixed up, the table would carry its column's comment.
  test('a column comment is read onto its column and not onto the table', () => {
    const account = described('account')
    expect(account.comment).toBeNull()
    expect(account.columns.find((entry) => entry.name === 'code')?.comment).toBe('Unique within a tenant.')
  })
})
