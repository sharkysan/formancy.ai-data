import type { DatabaseKind } from './adapter.js'

/*
 * Which servers this release was tested on, and whether a given one is
 * (0068). Each adapter translates what its server answered into the facts
 * below; this file alone decides what they mean, so the two engines cannot
 * disagree about what "tested" is.
 *
 * Nothing here refuses a server. A standing is said -- in the snapshot, the
 * connection test and drift review -- and a form is generated, published and
 * served on a server the release was not tested on as on one it was. The one
 * refusal a version meets is the SQL Server adapter's, at discovery, and it
 * is decided by what that server's catalog lacks, not by a version.
 */

/**
 * What a server is, as its adapter reads it: PostgreSQL by whether
 * `version()` calls it PostgreSQL, SQL Server by `EngineEdition`, which is
 * read before the major because Azure SQL Database answers 12 -- 2014 on a
 * boxed server -- and Managed Instance 16. `other` is a server that speaks
 * the engine's protocol and is none of these.
 */
export type ServerProduct = 'postgresql' | 'sqlserver' | 'azure-sql-database' | 'azure-sql-managed-instance' | 'other'

/** Every `ServerProduct`, as a record so that a sixth one is a compile error here until it is named. */
const PRODUCT_NAMES: Readonly<Record<ServerProduct, string>> = {
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  'azure-sql-database': 'Azure SQL Database',
  'azure-sql-managed-instance': 'Azure SQL Managed Instance',
  other: 'other',
}

/** Whether a value names a product this release knows. */
export function isServerProduct(value: unknown): value is ServerProduct {
  return typeof value === 'string' && Object.hasOwn(PRODUCT_NAMES, value)
}

/** What a server is, beside the version string it states (0068). */
export interface ServerFacts {
  product: ServerProduct
  /**
   * The major version the server answered: PostgreSQL's `server_version_num`
   * divided by 10000, SQL Server's `ProductMajorVersion`. Null when the
   * server said none the adapter could read.
   */
  major: number | null
  /**
   * SQL Server only: the `compatibility_level` of the database the
   * connection is in, never `master`'s -- a database restored from an older
   * server keeps its level after the server is upgraded, and the level, not
   * the server, decides what much of T-SQL means.
   */
  compatibility?: number
}

/**
 * The year each SQL Server major is sold as: the one table of them. 11 and
 * 12 are here so that a major Azure SQL Database also answers has a year to
 * be wrongly named by, and is not.
 */
export const SQLSERVER_RELEASES: Readonly<Record<number, number>> = { 11: 2012, 12: 2014, 13: 2016, 14: 2017, 15: 2019, 16: 2022, 17: 2025 }

/** What one engine was tested on: the product, its majors ascending, and for SQL Server the compatibility floor. */
export interface TestedServer {
  product: ServerProduct
  majors: readonly number[]
  compatibilityFloor?: number
}

/**
 * The servers this release was tested on: the majors of every image of the
 * matrix (0067), which data-fixtures' images.test.ts holds to MATRIX_IMAGES'
 * tags so neither moves alone, and each adapter's server.integration.test.ts
 * to what every leg's server answered.
 *
 * SQL Server's floor is not chosen: it is the lowest compatibility level a
 * matrix leg's fixture database answered -- a database created on a server
 * takes that server's default -- which the fixture records beside the server
 * and data-sqlserver's server.integration.test.ts holds this to on every leg.
 */
export const TESTED_SERVERS = {
  postgres: { product: 'postgresql', majors: [15, 16, 17, 18] },
  sqlserver: { product: 'sqlserver', majors: [15, 16, 17], compatibilityFloor: 150 },
} as const satisfies Readonly<Record<DatabaseKind, TestedServer>>

/** Whether a server is one this release was tested on, and a sentence a person reads that says so. */
export interface ServerStanding {
  tested: boolean
  says: string
}

/** `items` as prose, "a, b and c": British English, as every sentence here is, so no reader's locale moves a comma. */
const LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })
const listed = (items: readonly string[]): string => LIST.format(items)

/** A SQL Server major as a person knows it: its year and the major it answers, or the number alone when the table has no year. */
function sqlServerRelease(major: number): string {
  const year = SQLSERVER_RELEASES[major]
  return year === undefined ? String(major) : `${String(year)} (${String(major)})`
}

/**
 * The server as a person names it: "PostgreSQL 17", "SQL Server 2019 (15)",
 * "Azure SQL Database" -- never by the release a boxed server of its major
 * would be.
 */
export function serverName(kind: DatabaseKind, facts: ServerFacts): string {
  switch (facts.product) {
    case 'postgresql':
      return facts.major === null ? 'PostgreSQL' : `PostgreSQL ${String(facts.major)}`
    case 'sqlserver':
      return facts.major === null ? 'SQL Server' : `SQL Server ${sqlServerRelease(facts.major)}`
    case 'azure-sql-database':
    case 'azure-sql-managed-instance':
      return PRODUCT_NAMES[facts.product]
    case 'other':
      return kind === 'postgres'
        ? 'a server that speaks PostgreSQL’s protocol and does not call itself PostgreSQL'
        : 'a server that speaks SQL Server’s protocol and is no SQL Server product Formancy Data knows'
  }
}

/** The servers `kind` was tested on, as prose: "PostgreSQL 15, 16, 17 and 18". */
function testedList(kind: DatabaseKind): string {
  const tested = TESTED_SERVERS[kind]
  const releases = kind === 'sqlserver' ? tested.majors.map(sqlServerRelease) : tested.majors.map(String)
  return `${PRODUCT_NAMES[tested.product]} ${listed(releases)}`
}

const NOT_RECORDED =
  'The snapshot does not record the server it was read from, as none taken before Formancy Data recorded it does: discover again to learn whether this release was tested on that server.'

/**
 * Whether `facts`, read from a `kind` server, name a server this release was
 * tested on: its product, one of its majors, and for SQL Server a database
 * at the compatibility floor or above. Anything unknown -- no facts, no
 * major, no level -- is not tested, and says what is missing.
 */
export function serverStanding(kind: DatabaseKind, facts: ServerFacts | undefined): ServerStanding {
  if (facts === undefined) return { tested: false, says: NOT_RECORDED }
  const tested: TestedServer = TESTED_SERVERS[kind]
  const name = serverName(kind, facts)
  if (facts.product !== tested.product) return { tested: false, says: `This release of Formancy Data was not tested on ${name}: it was tested on ${testedList(kind)}.` }
  if (facts.major === null) {
    return { tested: false, says: `${name} did not say its major version, so this release of Formancy Data cannot be said to have been tested on it: it was tested on ${testedList(kind)}.` }
  }
  if (!tested.majors.includes(facts.major)) return { tested: false, says: `This release of Formancy Data was not tested on ${name}: it was tested on ${testedList(kind)}.` }
  const floor = tested.compatibilityFloor
  if (floor === undefined) return { tested: true, says: `This release of Formancy Data was tested on ${name}.` }
  if (facts.compatibility === undefined) {
    return { tested: false, says: `${name} did not say the database’s compatibility level, so this release of Formancy Data cannot be said to have been tested at it.` }
  }
  const level = String(facts.compatibility)
  return facts.compatibility < floor
    ? { tested: false, says: `This release of Formancy Data was tested on ${name}, and the database’s compatibility level, ${level}, is below the lowest it was tested at, ${String(floor)}.` }
    : { tested: true, says: `This release of Formancy Data was tested on ${name}, and the database’s compatibility level, ${level}, is not below the lowest it was tested at, ${String(floor)}.` }
}
