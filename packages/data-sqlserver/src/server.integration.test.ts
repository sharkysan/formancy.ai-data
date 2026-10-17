import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { serverName, serverStanding, TESTED_SERVERS } from '@formancy/data-core'
import { FIXTURE_SCOPE, imageMajor, startSqlServerFixture } from '@formancy/data-fixtures'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { createSqlServerAdapter } from './adapter.js'

/**
 * What the adapter says its server is (0068), against REAL SQL Server on the
 * image this leg of the matrix runs (0067). What a container can show: the
 * major its tag's year names, the connected database's compatibility level
 * rather than master's, a restricted account discovering on every release
 * of the matrix, and the floor held to what this leg's fixture database
 * answered. Every container answers EngineEdition 3 and has
 * sys.edge_constraints, so Azure SQL and the refusal are the pure
 * server.test.ts's.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let reader: mssql.ConnectionPool

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  reader = await new mssql.ConnectionPool(fixture.reader).connect()
})

afterAll(async () => {
  await reader?.close()
  await owner?.close()
  await fixture?.stop()
})

describe('the server the SQL Server adapter reports', () => {
  // Each leg runs the image FORMANCY_IMAGES names, whose tag names a year;
  // the server must answer that year's major, as SQL Server, with the level
  // the fixture recorded for its database. A major read as the year, or a
  // product read from the major, would report one release as another.
  test('is SQL Server, of the major the image this leg runs names, at the fixture database’s compatibility level', async () => {
    expect(fixture.server.compatibility).toEqual(expect.any(Number))
    expect(await createSqlServerAdapter(owner).ping()).toEqual({
      kind: 'sqlserver',
      version: fixture.server.version,
      product: 'sqlserver',
      major: imageMajor('sqlserver', fixture.server.image),
      compatibility: fixture.server.compatibility,
    })
  })

  // A database restored from an older server keeps its level after the
  // server is upgraded, and the level decides what much of T-SQL means.
  // Read from master, the 140 database below would report the server's
  // default and be called tested; master's own level is asserted to differ,
  // or the case could not tell the two apart.
  test('reads the compatibility level of the database it is connected to, never master’s', async () => {
    await owner.request().batch('create database compat_140')
    await owner.request().batch('alter database compat_140 set compatibility_level = 140')
    const old = await new mssql.ConnectionPool({ ...fixture.admin, database: 'compat_140' }).connect()
    try {
      const master = await old.request().query<{ level: number }>("select compatibility_level as level from sys.databases where name = N'master'")
      expect(master.recordset[0]?.level).not.toBe(140)
      const identity = await createSqlServerAdapter(old).ping()
      expect(identity.compatibility).toBe(140)
      const snapshot = await createSqlServerAdapter(old).discover({ schemas: ['dbo'] })
      expect(snapshot.server).toEqual({ product: 'sqlserver', major: identity.major, compatibility: 140 })
      const floor = TESTED_SERVERS.sqlserver.compatibilityFloor
      expect(serverStanding('sqlserver', snapshot.server)).toEqual({
        tested: false,
        says: `This release of Formancy Data was tested on ${serverName('sqlserver', identity)}, and the database’s compatibility level, 140, is below the lowest it was tested at, ${String(floor)}.`,
      })
    } finally {
      await old.close()
    }
  })

  // The one refusal a version meets is a catalog without
  // sys.edge_constraints. Every release of the matrix has it, for any
  // account: were the view hidden from one that may read a single table, or
  // object_id to answer null for it, that account would be refused on a
  // server discovery can read. The snapshot records the server ping does.
  test('is not refused at discovery, as an account that may read one table, and is what discovery records', async () => {
    const { kind: _kind, version, ...server } = await createSqlServerAdapter(owner).ping()
    for (const pool of [owner, reader]) {
      const snapshot = await createSqlServerAdapter(pool).discover(FIXTURE_SCOPE)
      expect({ version: snapshot.serverVersion, server: snapshot.server }).toEqual({ version, server })
    }
  })

  // TESTED_SERVERS is held to MATRIX_IMAGES without a run (data-fixtures'
  // images.test.ts); here to what each leg's server answered, so an image
  // whose server data-core calls untested fails the leg that runs it.
  test('is a server this release was tested on', async () => {
    const snapshot = await createSqlServerAdapter(owner).discover(FIXTURE_SCOPE)
    expect(serverStanding('sqlserver', snapshot.server).tested).toBe(true)
  })

  // The floor is not chosen: it is the lowest level a matrix leg's fixture
  // database answered. Each leg holds it at or below what its own database
  // answered, and the leg of the lowest tested release -- whose database
  // answers the lowest level if any leg's does, or a leg above would fail
  // the first assertion -- holds it equal. Across the matrix that is the
  // lowest any leg answered; on the other legs the first assertion is the
  // whole of it.
  test('holds the compatibility floor to the level this leg’s fixture database answered', () => {
    const floor = TESTED_SERVERS.sqlserver.compatibilityFloor
    const answered = fixture.server.compatibility
    expect(answered).toBeGreaterThanOrEqual(floor)
    if (imageMajor('sqlserver', fixture.server.image) === Math.min(...TESTED_SERVERS.sqlserver.majors)) expect(answered).toBe(floor)
  })
})
