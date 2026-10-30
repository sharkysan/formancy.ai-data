import { describedOf, findObject } from '@formancy/data-core'
import type { ObjectRef } from '@formancy/data-core'
import { startPostgresContainer } from '@formancy/data-fixtures'
import type { StartedPostgreSqlContainer } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/**
 * PostgreSQL 18 adds a check that is NOT ENFORCED: new rows are not checked
 * against it, and its `pg_constraint.conenforced` is false. Read as 17 reads
 * it — enforced always — it looked exactly like a NOT VALID check (enforced,
 * not validated), the conflation 0026 removes for SQL Server's disabled
 * checks, and a snapshot claimed an enforcement the database does not do.
 * And 18 lets a NOT NULL be added NOT VALID, which 15.19 and 17.11 refused
 * as a syntax error, 42601, on 2026-10-16, and which sets attnotnull over
 * rows that may hold NULL (0077).
 *
 * The rest of the suites run the image the run selects, the default 17
 * unless FORMANCY_IMAGES names another of the matrix (0067), 18 among them;
 * this file starts 18 on every leg, for the two catalog states only 18 can
 * hold, and names its image here.
 * Measured on 2026-10-09 against postgres:18-alpine: the NOT ENFORCED check
 * lets -5 in, and catalogues as convalidated f, conenforced f. On
 * 2026-10-16, against postgres:18-alpine answering 18.6: the NOT NULL added
 * NOT VALID over a NULL catalogues as contype n, convalidated f, and
 * attnotnull is t.
 */
const POSTGRES_18_IMAGE = 'postgres:18-alpine'

let container: StartedPostgreSqlContainer
let sql: Sql

beforeAll(async () => {
  // Through the harness, so the release report names this file beside the
  // image it ran on (0035).
  ;({ container } = await startPostgresContainer(POSTGRES_18_IMAGE))
  sql = postgres(container.getConnectionUri(), { onnotice: () => {} })
  await sql.unsafe(`
    create schema eighteen;
    create table eighteen.reading (
      value integer,
      constraint ck_reading_positive check (value > 0),
      constraint ck_reading_small check (value < 100) not enforced
    );
    create table eighteen.loose (id integer primary key, amount integer, "Paid On" date);
    insert into eighteen.loose (id, amount, "Paid On") values (1, null, null);
    alter table eighteen.loose add constraint nn_loose_amount not null amount not valid;
    alter table eighteen.loose add constraint nn_loose_paid_on not null "Paid On" not valid;
    create table eighteen.loose_check (id integer primary key, amount integer, "Paid On" date);
    insert into eighteen.loose_check (id, amount, "Paid On") values (1, null, null);
    alter table eighteen.loose_check add constraint ck_loose_amount check (amount is not null) not valid;
    alter table eighteen.loose_check add constraint ck_loose_paid_on check ("Paid On" is not null) not valid;
    create table eighteen.settled (id integer primary key, amount integer);
    insert into eighteen.settled (id, amount) values (1, null);
    alter table eighteen.settled add constraint nn_settled_amount not null amount not valid;
    create type eighteen.pair as (low integer, high integer);
    create domain eighteen.span as eighteen.pair;
    create domain eighteen.bounded_span as eighteen.span;
    create table eighteen.ranged (id integer primary key, pair eighteen.pair, span eighteen.span, bounded eighteen.bounded_span, pairs eighteen.pair[]);
    insert into eighteen.ranged (id) values (1);
    alter table eighteen.ranged add constraint nn_ranged_pair not null pair not valid;
    alter table eighteen.ranged add constraint nn_ranged_span not null span not valid;
    alter table eighteen.ranged add constraint nn_ranged_bounded not null bounded not valid;
    alter table eighteen.ranged add constraint nn_ranged_pairs not null pairs not valid;
    create table eighteen.ranged_check (id integer primary key, pair eighteen.pair, span eighteen.span, bounded eighteen.bounded_span, pairs eighteen.pair[]);
    insert into eighteen.ranged_check (id) values (1);
    alter table eighteen.ranged_check add constraint ck_ranged_pair check (pair is distinct from null) not valid;
    alter table eighteen.ranged_check add constraint ck_ranged_span check (span is distinct from null) not valid;
    alter table eighteen.ranged_check add constraint ck_ranged_bounded check (bounded is distinct from null) not valid;
    alter table eighteen.ranged_check add constraint ck_ranged_pairs check (pairs is not null) not valid;
  `)
})

afterAll(async () => {
  await sql?.end()
  await container?.stop()
})

// A NOT ENFORCED check reported enforced would be a rule the snapshot claims
// and the database does not keep; reported only as unvalidated, it would read
// like NOT VALID, which IS kept for new rows.
test('a NOT ENFORCED check on PostgreSQL 18 is reported as not enforced, and an ordinary one as enforced', async () => {
  // The server, first: the unenforced check lets a value it names through.
  await sql`insert into eighteen.reading (value) values (500)`
  const reading = findObject(await discoverPostgres(sql, { schemas: ['eighteen'] }), { schema: 'eighteen', name: 'reading' })
  expect(reading?.checks.map(({ name, enforced, validated }) => ({ name, enforced, validated }))).toEqual([
    { name: 'ck_reading_positive', enforced: true, validated: true },
    { name: 'ck_reading_small', enforced: false, validated: false },
  ])
})

const eighteen = (name: string): ObjectRef => ({ schema: 'eighteen', name })

// PostgreSQL 18 also lets a NOT NULL be added NOT VALID: new and changed rows
// are held to it, the rows already there are not checked, and
// pg_attribute.attnotnull is true from the moment it is added. Read from
// attnotnull, the column was reported not nullable while a row older than
// the constraint held NULL: its field was generated required, a record
// holding that NULL opened with a value the form called invalid, and a key
// over it would have been taken for a total order (0077). The same rule
// written as CHECK (amount IS NOT NULL) NOT VALID, which 15 to 17 can say
// too, is a nullable column and an enforced, unvalidated check, so the two
// spellings read alike, quoting included; and the description a request
// reads (0041) says what discovery says, or a form over the column would
// have every write refused as drift (watched failing with the column read
// from attnotnull, and with only the description reading it so).
test('a NOT NULL added NOT VALID on PostgreSQL 18 reads as CHECK (… IS NOT NULL) NOT VALID does: a nullable column and an enforced, unvalidated check', async () => {
  // The server, first: a new NULL is refused, and the old one is still there.
  await expect(sql`insert into eighteen.loose (id, amount, "Paid On") values (2, null, current_date)`).rejects.toMatchObject({
    code: '23502',
    column_name: 'amount',
  })
  await expect(sql`insert into eighteen.loose (id, amount, "Paid On") values (2, 1, null)`).rejects.toMatchObject({ code: '23502', column_name: 'Paid On' })
  expect([...(await sql`select count(*)::int as n from eighteen.loose where amount is null and "Paid On" is null`)]).toEqual([{ n: 1 }])
  const snapshot = await discoverPostgres(sql, { schemas: ['eighteen'] })
  const loose = findObject(snapshot, eighteen('loose'))
  const checked = findObject(snapshot, eighteen('loose_check'))
  expect(loose?.columns.map(({ name, nullable }) => ({ name, nullable }))).toEqual([
    { name: 'id', nullable: false },
    { name: 'amount', nullable: true },
    { name: 'Paid On', nullable: true },
  ])
  expect(loose?.columns).toEqual(checked?.columns)
  expect(loose?.checks).toEqual([
    { name: 'nn_loose_amount', expression: '(amount IS NOT NULL)', enforced: true, validated: false },
    { name: 'nn_loose_paid_on', expression: '("Paid On" IS NOT NULL)', enforced: true, validated: false },
  ])
  expect(loose?.checks.map(({ name: _name, ...check }) => check)).toEqual(checked?.checks.map(({ name: _name, ...check }) => check))
  const described = await createPostgresRecords(sql).describe(eighteen('loose'))
  if (!described.ok) throw new Error(`expected a description, got ${described.code}: ${described.message}`)
  const { definition: _definition, ...description } = described.described
  expect(description).toEqual(describedOf(snapshot, eighteen('loose')))
})

// Validated, the constraint proves every row, and the column reads as any
// NOT NULL does on 18: not nullable, and no check, the type-n row left out
// as 0067's notNullConstraints says. Between two snapshots that is the
// column tightened and the check gone, which drift review reports (0077);
// read either way round, the column would claim a NOT NULL before it held or
// lose one after.
test('a NOT NULL added NOT VALID on PostgreSQL 18, once validated, reads as NOT NULL with no check', async () => {
  const before = findObject(await discoverPostgres(sql, { schemas: ['eighteen'] }), eighteen('settled'))
  expect(before?.columns.find((column) => column.name === 'amount')?.nullable).toBe(true)
  expect(before?.checks.map(({ name, validated }) => ({ name, validated }))).toEqual([{ name: 'nn_settled_amount', validated: false }])
  await sql`update eighteen.settled set amount = 0 where amount is null`
  await sql`alter table eighteen.settled validate constraint nn_settled_amount`
  const after = findObject(await discoverPostgres(sql, { schemas: ['eighteen'] }), eighteen('settled'))
  expect(after?.columns.find((column) => column.name === 'amount')?.nullable).toBe(false)
  expect(after?.checks).toEqual([])
})

// A NOT NULL refuses the NULL value and nothing else. IS NOT NULL asks more of
// a row type -- a composite, or a domain over one at any depth -- where it is
// true only when every field is non-null, so the same rule spelled as a check
// is CHECK (pair IS DISTINCT FROM NULL), and an array of a composite is not a
// row type. Spelled (pair IS NOT NULL) whatever the type, the check claimed a
// rule stricter than the database keeps: a row(null, null) the column holds
// read as one the rule refuses (watched failing on '(pair IS NOT NULL)' and,
// with the domain chain walked one step, on '(bounded IS NOT NULL)'; 0077).
test('a NOT NULL added NOT VALID over a row type on PostgreSQL 18 reads as CHECK (… IS DISTINCT FROM NULL) NOT VALID does, the rule it keeps', async () => {
  // The server, first: each column of both tables takes a value whose every
  // field is NULL, which IS NOT NULL calls null and IS DISTINCT FROM NULL
  // does not, and the NULL value itself is refused.
  for (const table of ['ranged', 'ranged_check']) {
    await sql`insert into eighteen.${sql(table)} (id, pair, span, bounded, pairs) values (2, row(null, null), row(null, null), row(null, null), array[row(null, null)]::eighteen.pair[])`
  }
  expect([
    ...(await sql`select (row(null, null)::eighteen.bounded_span) is not null as "notNull", (row(null, null)::eighteen.bounded_span) is distinct from null as "distinct"`),
  ]).toEqual([{ notNull: false, distinct: true }])
  await expect(sql`insert into eighteen.ranged (id, pair, span, bounded, pairs) values (3, null, row(1, 1), row(1, 1), '{}')`).rejects.toMatchObject({
    code: '23502',
    column_name: 'pair',
  })
  const snapshot = await discoverPostgres(sql, { schemas: ['eighteen'] })
  const ranged = findObject(snapshot, eighteen('ranged'))
  const checked = findObject(snapshot, eighteen('ranged_check'))
  expect(ranged?.columns.filter(({ nullable }) => nullable).map(({ name }) => name)).toEqual(['pair', 'span', 'bounded', 'pairs'])
  expect(ranged?.columns).toEqual(checked?.columns)
  expect(ranged?.checks.map(({ name, expression }) => ({ name, expression }))).toEqual([
    { name: 'nn_ranged_bounded', expression: '(bounded IS DISTINCT FROM NULL)' },
    { name: 'nn_ranged_pair', expression: '(pair IS DISTINCT FROM NULL)' },
    { name: 'nn_ranged_pairs', expression: '(pairs IS NOT NULL)' },
    { name: 'nn_ranged_span', expression: '(span IS DISTINCT FROM NULL)' },
  ])
  expect(ranged?.checks.map(({ name: _name, ...check }) => check)).toEqual(checked?.checks.map(({ name: _name, ...check }) => check))
})
