import { describe, expect, test } from 'vitest'
import { serverName, serverStanding, SQLSERVER_RELEASES, TESTED_SERVERS, UNTESTED_PRODUCTS } from './server.js'
import type { ServerFacts, TestedServer } from './server.js'

/**
 * Whether a server is one this release was tested on (0068): pure, over
 * facts this file writes. What each adapter translates its server's answer
 * into is that adapter's server.test.ts; that every image of the matrix
 * answers a server this decides was tested is each adapter's
 * server.integration.test.ts, on every leg; that TESTED_SERVERS names the
 * majors of MATRIX_IMAGES is data-fixtures' images.test.ts.
 */
const postgres = (major: number | null, product: ServerFacts['product'] = 'postgresql'): ServerFacts => ({ product, major })
const sqlserver = (major: number | null, compatibility?: number, product: ServerFacts['product'] = 'sqlserver'): ServerFacts =>
  compatibility === undefined ? { product, major } : { product, major, compatibility }

const POSTGRES_LIST = 'PostgreSQL 15, 16, 17 and 18'
const SQLSERVER_LIST = 'SQL Server 2019 (15), 2022 (16) and 2025 (17)'

describe('serverStanding on PostgreSQL', () => {
  // Every major the matrix runs is tested, and says so; one it does not run
  // -- 14, a month from its end of life, started by one file only -- must
  // not read as tested because the product is right.
  test('calls each major the release was tested on tested, and another major not tested, naming the ones that were', () => {
    for (const major of TESTED_SERVERS.postgres.majors) {
      expect(serverStanding('postgres', postgres(major))).toEqual({ tested: true, says: `This release of Formancy Data was tested on PostgreSQL ${String(major)}.` })
    }
    expect(serverStanding('postgres', postgres(14))).toEqual({
      tested: false,
      says: `This release of Formancy Data was not tested on PostgreSQL 14: it was tested on ${POSTGRES_LIST}.`,
    })
  })

  // A server that speaks PostgreSQL's protocol and does not call itself
  // PostgreSQL -- a fork, or a database copying the protocol -- answers a
  // major of its own numbering, and that number names no PostgreSQL release.
  test('calls a server that does not call itself PostgreSQL not tested, whatever major it answers', () => {
    expect(serverStanding('postgres', postgres(17, 'other'))).toEqual({
      tested: false,
      says: `This release of Formancy Data was not tested on a server that speaks PostgreSQL’s protocol and does not call itself PostgreSQL: it was tested on ${POSTGRES_LIST}.`,
    })
  })

  // A major the server did not say cannot be one the release was tested on.
  test('calls a server that named no major not tested', () => {
    expect(serverStanding('postgres', postgres(null))).toEqual({
      tested: false,
      says: `PostgreSQL did not say its major version, so this release of Formancy Data cannot be said to have been tested on it: it was tested on ${POSTGRES_LIST}.`,
    })
  })
})

describe('serverStanding on SQL Server', () => {
  // Each release the matrix runs, with its database at the lowest level a
  // leg's fixture database answered or above, is tested. The floor itself
  // is tested and one level below it is not: an off-by-one either way would
  // pass a database nobody ran, or refuse the one every 2019 leg runs.
  test('calls each tested release tested at the compatibility floor and above, and not one level below it', () => {
    const floor = TESTED_SERVERS.sqlserver.compatibilityFloor
    for (const major of TESTED_SERVERS.sqlserver.majors) {
      expect(serverStanding('sqlserver', sqlserver(major, floor)).tested, String(major)).toBe(true)
      expect(serverStanding('sqlserver', sqlserver(major, major * 10)).tested, String(major)).toBe(true)
    }
    expect(serverStanding('sqlserver', sqlserver(16, 160))).toEqual({
      tested: true,
      says: 'This release of Formancy Data was tested on SQL Server 2022 (16), and the database’s compatibility level, 160, is not below the lowest it was tested at, 150.',
    })
    expect(serverStanding('sqlserver', sqlserver(16, floor - 10))).toEqual({
      tested: false,
      says: 'This release of Formancy Data was tested on SQL Server 2022 (16), and the database’s compatibility level, 140, is below the lowest it was tested at, 150.',
    })
  })

  // 2017 cannot be discovered at all (the adapter's refusal); its standing
  // is still said wherever a ping answers, as the release it is.
  test('calls a release outside the matrix not tested, naming it by its year', () => {
    expect(serverStanding('sqlserver', sqlserver(14, 140))).toEqual({
      tested: false,
      says: `This release of Formancy Data was not tested on SQL Server 2017 (14): it was tested on ${SQLSERVER_LIST}.`,
    })
  })

  // Managed Instance answers ProductMajorVersion 16 on its current update
  // policy, and no container answers its EngineEdition: read by the major
  // alone it would be SQL Server 2022, tested, which no test ever ran.
  test('calls Azure SQL Managed Instance not tested, though it answers a tested major', () => {
    expect(serverStanding('sqlserver', sqlserver(16, 160, 'azure-sql-managed-instance'))).toEqual({
      tested: false,
      says: `This release of Formancy Data was not tested on Azure SQL Managed Instance: it was tested on ${SQLSERVER_LIST}.`,
    })
  })

  // Azure SQL Database answers 12, which on a boxed server is 2014: named
  // by the major, an Azure estate would be told it runs a ten-year-old
  // release, and the sentence would be the first thing it disbelieved.
  test('names Azure SQL Database as itself, never as the release its major would be on a boxed server', () => {
    expect(SQLSERVER_RELEASES[12]).toBe(2014)
    const standing = serverStanding('sqlserver', sqlserver(12, 160, 'azure-sql-database'))
    expect(standing).toEqual({ tested: false, says: `This release of Formancy Data was not tested on Azure SQL Database: it was tested on ${SQLSERVER_LIST}.` })
    expect(standing.says).not.toMatch(/2014/)
  })

  // A SQL Server snapshot without the level, or a server that named no
  // major, cannot be one the release was tested on: unknown is never tested.
  test('calls a server with no major, or a database with no compatibility level, not tested', () => {
    expect(serverStanding('sqlserver', sqlserver(16))).toEqual({
      tested: false,
      says: 'SQL Server 2022 (16) did not say the database’s compatibility level, so this release of Formancy Data cannot be said to have been tested at it.',
    })
    expect(serverStanding('sqlserver', sqlserver(null, 160))).toEqual({
      tested: false,
      says: `SQL Server did not say its major version, so this release of Formancy Data cannot be said to have been tested on it: it was tested on ${SQLSERVER_LIST}.`,
    })
  })
})

describe('serverStanding without facts', () => {
  // A snapshot taken before 0068 carries no server. Reading its absence as
  // tested would pass every stored bundle; reading it as untested would
  // claim a fact nobody read. It says what is missing and decides nothing.
  test('says the snapshot does not record its server, and never calls it tested', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      expect(serverStanding(kind, undefined)).toEqual({
        tested: false,
        says: 'The snapshot does not record the server it was read from, as none taken before Formancy Data recorded it does: discover again to learn whether this release was tested on that server.',
      })
    }
  })
})

describe('serverName', () => {
  // The name a person reads in a standing and in a refusal: the year a
  // boxed SQL Server is sold as, beside the major it answers, and a major
  // the table has no year for as the number itself, never a guessed year.
  test('names each product, a SQL Server release by its year and major, and a major without a year by its number', () => {
    expect(serverName('postgres', postgres(17))).toBe('PostgreSQL 17')
    expect(serverName('postgres', postgres(null))).toBe('PostgreSQL')
    expect(serverName('sqlserver', sqlserver(15))).toBe('SQL Server 2019 (15)')
    expect(serverName('sqlserver', sqlserver(10))).toBe('SQL Server 10')
    expect(serverName('sqlserver', sqlserver(null))).toBe('SQL Server')
    expect(serverName('sqlserver', sqlserver(12, 160, 'azure-sql-database'))).toBe('Azure SQL Database')
    expect(serverName('sqlserver', sqlserver(16, 160, 'azure-sql-managed-instance'))).toBe('Azure SQL Managed Instance')
    expect(serverName('sqlserver', sqlserver(16, 160, 'other'))).toBe('a server that speaks SQL Server’s protocol and is no SQL Server product Formancy Data knows')
  })
})

describe('UNTESTED_PRODUCTS', () => {
  // No test runs on Azure SQL Database or Managed Instance (0073), and the
  // README's "Recognised, not tested" row is derived from this list. A
  // product dropped from it -- an Azure product added to TESTED_SERVERS, a
  // filter turned round -- would leave the README silent where 0073 says
  // it speaks; a tested product in it would tell a buyer that PostgreSQL 17
  // was not tested. `other` names no product, so it is never listed.
  test('names Azure SQL Database and Azure SQL Managed Instance, and no product the release was tested on', () => {
    expect(UNTESTED_PRODUCTS).toEqual([
      { product: 'azure-sql-database', name: 'Azure SQL Database' },
      { product: 'azure-sql-managed-instance', name: 'Azure SQL Managed Instance' },
    ])
  })

  // The list and serverStanding must never disagree: the row says "not
  // tested" from the list, the connection test and drift review from the
  // standing. The cases above hold each Azure product at one major and
  // level; this holds every listed product at every major and compatibility
  // level the release was tested at, on both engines, so an Azure product
  // answering another tested major, or a standing that read the major
  // before the product, is still never called tested.
  test('lists only products serverStanding calls not tested at every major and level the release was tested at', () => {
    for (const { product } of UNTESTED_PRODUCTS) {
      for (const kind of ['postgres', 'sqlserver'] as const) {
        const tested: TestedServer = TESTED_SERVERS[kind]
        for (const major of tested.majors) {
          for (const compatibility of [tested.compatibilityFloor, major * 10]) {
            const facts: ServerFacts = compatibility === undefined ? { product, major } : { product, major, compatibility }
            expect(serverStanding(kind, facts).tested, `${product} ${String(major)} at ${String(compatibility)} on ${kind}`).toBe(false)
          }
        }
      }
    }
  })
})

describe('TESTED_SERVERS', () => {
  // Each tested SQL Server major names a release the table can say, or the
  // sentences above would print a bare number for a release that was run;
  // and a list out of order or twice over would be printed so.
  test('names, for each tested SQL Server major, a release year, and lists each engine’s majors once and ascending', () => {
    for (const major of TESTED_SERVERS.sqlserver.majors) expect(SQLSERVER_RELEASES[major], String(major)).toEqual(expect.any(Number))
    for (const tested of [TESTED_SERVERS.postgres, TESTED_SERVERS.sqlserver]) expect([...tested.majors]).toEqual([...new Set(tested.majors)].sort((a, b) => a - b))
  })
})
