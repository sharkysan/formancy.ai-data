import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { serverStanding } from '@formancy/data-core'
import { FIXTURE_SCOPE, imageMajor, startPostgresFixture } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { createPostgresAdapter } from './adapter.js'

/**
 * What the adapter says its server is (0068), against REAL PostgreSQL on the
 * image this leg of the matrix runs (0067). What a container can show: the
 * major its tag names, the product, the ping and the snapshot agreeing, and
 * the standing data-core gives the leg's server. What no container answers
 * -- a Debian build's version text, a fork's `version()` -- is the pure
 * server.test.ts's.
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
  await reader?.end()
  await owner?.end()
  await fixture?.stop()
})

describe('the server the PostgreSQL adapter reports', () => {
  // Each leg runs the image FORMANCY_IMAGES names, and its server must
  // answer the major that image's tag names: a tag moved to another major,
  // or a major read wrongly from what the server said, would report one
  // version's results as another's. The version string is what the server
  // told the harness when it started, asked its own way.
  test('is PostgreSQL, of the major the image this leg runs names', async () => {
    expect(await createPostgresAdapter(owner).ping()).toEqual({
      kind: 'postgres',
      version: fixture.server.version,
      product: 'postgresql',
      major: imageMajor('postgres', fixture.server.image),
    })
  })

  // A ping and a discovery read the server by one query; if a snapshot ever
  // recorded another server than the ping reported, the connection test and
  // drift review would disagree about one database. The account that may
  // read one table can ask it too: the settings are every role's.
  test('is what discovery records in the snapshot, for the owner and for an account that may read one table', async () => {
    const { kind: _kind, version, ...server } = await createPostgresAdapter(owner).ping()
    for (const sql of [owner, reader]) {
      const snapshot = await createPostgresAdapter(sql).discover(FIXTURE_SCOPE)
      expect({ version: snapshot.serverVersion, server: snapshot.server }).toEqual({ version, server })
    }
  })

  // TESTED_SERVERS is held to MATRIX_IMAGES without a run (data-fixtures'
  // images.test.ts); here to what each leg's server answered, so an image
  // whose server data-core calls untested fails the leg that runs it.
  test('is a server this release was tested on', async () => {
    const snapshot = await createPostgresAdapter(owner).discover(FIXTURE_SCOPE)
    expect(serverStanding('postgres', snapshot.server)).toEqual({
      tested: true,
      says: `This release of Formancy Data was tested on PostgreSQL ${String(imageMajor('postgres', fixture.server.image))}.`,
    })
  })
})
