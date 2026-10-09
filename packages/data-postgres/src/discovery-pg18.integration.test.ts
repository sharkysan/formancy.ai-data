import { findObject } from '@formancy/data-core'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
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
 *
 * The rest of the suites run 17, the version the fixture names; this file
 * starts 18 for the one catalog fact that differs, and names its image here.
 * Measured on 2026-10-09 against postgres:18-alpine: the NOT ENFORCED check
 * lets -5 in, and catalogues as convalidated f, conenforced f.
 */
const POSTGRES_18_IMAGE = 'postgres:18-alpine'

let container: StartedPostgreSqlContainer
let sql: Sql

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_18_IMAGE).start()
  sql = postgres(container.getConnectionUri(), { onnotice: () => {} })
  await sql.unsafe(`
    create schema eighteen;
    create table eighteen.reading (
      value integer,
      constraint ck_reading_positive check (value > 0),
      constraint ck_reading_small check (value < 100) not enforced
    );
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
