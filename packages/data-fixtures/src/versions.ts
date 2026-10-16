import type { DatabaseKind } from '@formancy/data-core'
import type { ServerRecord } from './servers.js'

/*
 * What the versions of one engine disagree on (0067), each named: 0026's
 * "name every column fact the engines disagree on" and 0058's FACTS, applied
 * to the images of the matrix. A test that meets a version difference asks
 * this table for the value on the server it runs against, by the major that
 * server answered, and asserts that value; it is never skipped on a version.
 * A row is added when a leg of the matrix shows a difference, with what each
 * version answered and how that was measured.
 */

export interface VersionFact {
  engine: DatabaseKind
  /** The fact, as a sentence: what the versions with `true` do, and what the others do instead. */
  says: string
  /** The value on each major, by the major the server answers. */
  values: Readonly<Record<number, boolean>>
  /** Where the difference is documented. */
  source: string
  /** How each major's value was measured: when, on what, and what it answered. */
  measured: Readonly<Record<number, string>>
  /** The test that asserts each value, on every leg of the matrix. */
  heldBy: { file: string; test: string }
}

export type VersionFactName = 'transactionTimeout' | 'notNullTestsRemoved' | 'viewSecurityDefinition'

export const VERSION_FACTS: Readonly<Record<VersionFactName, VersionFact>> = {
  transactionTimeout: {
    engine: 'postgres',
    says:
      'PostgreSQL knows transaction_timeout, a setting a client may send when it connects, and ends a transaction that outlives it by closing the connection (25P04, FATAL); a server without it refuses the connection that sends it with 42704 before any statement runs, and the adapter, which reads class 42 as its own SQL at fault, throws that rather than answering a failure',
    values: { 15: false, 16: false, 17: true, 18: true },
    source: 'PostgreSQL 17’s release notes: "Add server variable transaction_timeout to restrict the duration of transactions"; 15’s and 16’s server configuration chapters have no such setting',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: the insert through a client that sent transaction_timeout threw PostgresError 42704, unrecognized configuration parameter "transaction_timeout"',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 15',
      17: 'every run, on the default image: the transaction timed out, the connection closed, and the write was unknown-outcome (0028)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: as 17',
    },
    heldBy: {
      file: 'packages/data-postgres/src/parity.integration.test.ts',
      test: 'a terminated backend and a transaction timeout close the connection, and a write is unknown-outcome',
    },
  },
  notNullTestsRemoved: {
    engine: 'postgres',
    says:
      'PostgreSQL’s planner drops an IS NOT NULL test on a column declared NOT NULL, so the `is not null` a lookup puts on each key never reaches its plan; a server without it keeps the tests and prints them in the index condition beside the tenant’s, as ((tenant_id IS NOT NULL) AND (tenant_id = 1) AND (customer_no IS NOT NULL)), reading the same rows by the same scans',
    values: { 15: false, 16: false, 17: true, 18: true },
    source: 'PostgreSQL 17’s release notes, under the optimizer: IS NOT NULL restrictions on NOT NULL columns are removed',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: every tenant search of the sized customers planned as a Bitmap Heap Scan over a Bitmap Index Scan of pk_customer on ((tenant_id IS NOT NULL) AND (tenant_id = 1) AND (customer_no IS NOT NULL)), reading the tenant’s 100,001 rows',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 15',
      17: 'every run, on the default image: the same scans on (tenant_id = 1) alone (0034, P3)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: as 17',
    },
    heldBy: {
      file: 'packages/data-postgres/src/lookups-sized.integration.test.ts',
      test: 'lookups over the sized customers on the order form, filtered to the tenant',
    },
  },
  viewSecurityDefinition: {
    engine: 'sqlserver',
    says: 'SQL Server has the database permission VIEW SECURITY DEFINITION, which shows no security policy (0027, B10d); a server without it refuses the grant as a syntax error, "Incorrect syntax near \'view\'."',
    values: { 15: false, 16: true, 17: true },
    source: 'Microsoft’s documentation of the granular permissions SQL Server 2022 (16.x) added, VIEW SECURITY DEFINITION among them',
    measured: {
      15: '2026-10-16, mcr.microsoft.com/mssql/server:2019-latest answering 15.0.4500.2 (CU32), on Docker Desktop on Windows: the grant failed with RequestError "Incorrect syntax near \'view\'."',
      16: 'every run, on the default image: granted, and has_perms_by_name answers 1 for it',
      17: 'by source only until the 2025 leg of the matrix runs it',
    },
    heldBy: {
      file: 'packages/data-sqlserver/src/discovery-access.integration.test.ts',
      test: 'VIEW SECURITY DEFINITION alone does not settle row security',
    },
  },
}

/**
 * The major version `server` answered: PostgreSQL's `server_version` (`16.15`,
 * or Debian's `16.4 (Debian …)`) and SQL Server's `ProductVersion`
 * (`15.0.4430.1`) both begin with it. Throws when the answer names none.
 */
export function serverMajor(server: Pick<ServerRecord, 'engine' | 'version'>): number {
  const major = /^(\d+)\./.exec(server.version)?.[1]
  if (major === undefined) throw new Error(`the ${server.engine} server answered ${server.version}, which names no major version`)
  return Number(major)
}

/**
 * `name`'s value on `server`, by the major it answered. Throws for a server
 * of another engine, and for a major the row has no value for: a leg on a
 * version nobody measured fails here rather than asserting nothing.
 */
export function versionFact(name: VersionFactName, server: Pick<ServerRecord, 'engine' | 'version'>): boolean {
  const fact = VERSION_FACTS[name]
  if (server.engine !== fact.engine) throw new Error(`VERSION_FACTS.${name} is a ${fact.engine} fact, and this server is ${server.engine}`)
  const major = serverMajor(server)
  const value = fact.values[major]
  if (value === undefined) throw new Error(`VERSION_FACTS.${name} has no value for ${fact.engine} ${String(major)}: measure it on that version and add it, or leave the version out of the matrix`)
  return value
}
