import { findObject } from '@formancy/data-core'
import { startPostgresContainer } from '@formancy/data-fixtures'
import type { StartedPostgreSqlContainer } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { discoverPostgres } from './index.js'

/**
 * PostgreSQL 18 adds a check that is NOT ENFORCED: new rows are not checked
 * against it, and its `pg_constraint.conenforced` is false. Read as 17 reads
 * it — enforced always — it looked exactly like a NOT VALID check (enforced,
 * not validated), the conflation 0026 removes for SQL Server's disabled
 * checks, and a snapshot claimed an enforcement the database does not do.
 * And 18 lets a NOT NULL be added NOT VALID, which 15.19 and 17.11 refused
 * as a syntax error, 42601, on 2026-10-16.
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
    create table eighteen.loose (id integer primary key, amount integer);
    insert into eighteen.loose (id, amount) values (1, null);
    alter table eighteen.loose add constraint nn_loose_amount not null amount not valid;
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

// PostgreSQL 18 also lets a NOT NULL be added NOT VALID: new and changed rows
// are held to it, the rows already there are not checked, and
// pg_attribute.attnotnull is true from the moment it is added. Discovery
// reads NOT NULL from attnotnull, so the column is reported not nullable
// while a row older than the constraint holds NULL -- the same rule written
// as CHECK (amount IS NOT NULL) NOT VALID, which 17 can say too, is reported
// nullable with an unvalidated check. Characterised, not decided: the
// snapshot claims of the old rows more than the database keeps, and what a
// column that refuses NULL but may hold one should be reported as is not
// decided here (watched failing with the column expected nullable).
test('a NOT NULL added NOT VALID on PostgreSQL 18 is read as NOT NULL, though a row older than it holds NULL', async () => {
  // The server, first: a new NULL is refused, and the old one is still there.
  await expect(sql`insert into eighteen.loose (id, amount) values (2, null)`).rejects.toMatchObject({ code: '23502', column_name: 'amount' })
  expect([...(await sql`select count(*)::int as n from eighteen.loose where amount is null`)]).toEqual([{ n: 1 }])
  const loose = findObject(await discoverPostgres(sql, { schemas: ['eighteen'] }), { schema: 'eighteen', name: 'loose' })
  expect(loose?.columns.find((column) => column.name === 'amount')?.nullable).toBe(false)
  expect(loose?.checks).toEqual([])
})
