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

export type VersionFactName =
  | 'transactionTimeout'
  | 'notNullTestsRemoved'
  | 'membershipInherit'
  | 'afterTriggerAsQueuer'
  | 'restrictViolation'
  | 'notNullConstraints'
  | 'viewSecurityDefinition'

export const VERSION_FACTS: Readonly<Record<VersionFactName, VersionFact>> = {
  transactionTimeout: {
    engine: 'postgres',
    says: 'PostgreSQL knows transaction_timeout, a setting a client may send when it connects, and ends a transaction that outlives it by closing the connection (25P04, FATAL); a server without it refuses the connection that sends it with 42704 before any statement runs, and the adapter, which reads class 42 as its own SQL at fault, throws that rather than answering a failure',
    values: { 15: false, 16: false, 17: true, 18: true },
    source:
      'PostgreSQL 17’s release notes: "Add server variable transaction_timeout to restrict the duration of transactions"; 15’s and 16’s server configuration chapters have no such setting',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: the insert through a client that sent transaction_timeout threw PostgresError 42704, unrecognized configuration parameter "transaction_timeout"',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 15',
      17: 'every run, on the default image: the transaction timed out, the connection closed, and the write was unknown-outcome (0028)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: as 17',
    },
    heldBy: {
      file: 'packages/data-postgres/src/parity.integration.test.ts',
      test: 'a terminated backend closes the connection and a write is unknown-outcome, as a transaction timeout does where the server has transaction_timeout; a server without it refuses the connection that sends it',
    },
  },
  notNullTestsRemoved: {
    engine: 'postgres',
    says: 'PostgreSQL’s planner drops an IS NOT NULL test on a column declared NOT NULL, so the `is not null` a lookup puts on each key never reaches its plan; a server without it keeps the tests and prints them in the index condition beside the tenant’s, as ((tenant_id IS NOT NULL) AND (tenant_id = 1) AND (customer_no IS NOT NULL)), reading the same rows by the same scans',
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
  membershipInherit: {
    engine: 'postgres',
    says: 'PostgreSQL makes inheritance a property of each membership, set by GRANT role TO member WITH INHERIT TRUE or FALSE (0027, B4); a server without it refuses that grant as a syntax error at or near "inherit" (42601), and whether a member inherits is the member role’s own INHERIT or NOINHERIT',
    values: { 15: false, 16: true, 17: true, 18: true },
    source:
      'PostgreSQL 16’s release notes, under privileges: GRANT gains WITH INHERIT, which sets whether one membership inherits, where the member role’s INHERIT or NOINHERIT alone decided it before; 15’s GRANT has no such option',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: GRANT … WITH INHERIT FALSE failed with PostgresError 42601, syntax error at or near "inherit", and a NOINHERIT member’s privilege functions answered false and its read 42501',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 17',
      17: 'every run, on the default image: granted, the WITH INHERIT FALSE member’s privilege functions answered false and its read 42501 (0027, B4)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: as 17',
    },
    heldBy: {
      file: 'packages/data-postgres/src/discovery-access.integration.test.ts',
      test: 'a WITH INHERIT FALSE membership reports no capability, and the read is refused; a server without the option refuses the grant, and a NOINHERIT member reports none',
    },
  },
  afterTriggerAsQueuer: {
    engine: 'postgres',
    says: 'PostgreSQL runs an AFTER trigger as the role that was active when its event was queued, so a cascaded table’s AFTER DELETE trigger, queued while the referential action deleted as that table’s owner, runs as the owner, with the owner’s grants, and a delete whose trigger writes where only the owner may is done; a server without it runs the trigger as the role active when it fires, the deleting account at the end of its statement, with that account’s grants, and such a delete is refused, permission-denied (0051, P5). Neither is seen or governed by the adapter',
    values: { 15: false, 16: false, 17: false, 18: true },
    source:
      'PostgreSQL 18’s release notes, under the migration to version 18: "Execute AFTER triggers as the role that was active when trigger events were queued"; before, they ran as the role active when they fired',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: the cascaded table’s AFTER DELETE trigger recorded the deleting account as current_user, its BEFORE trigger and its rule the owner; and with a trigger inserting into a table only the owner may write, the delete was refused, 42501, permission-denied, the record and its rows kept',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 15',
      17: 'every run, on the default image: as 15 (0051, P5)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: the AFTER DELETE trigger recorded the owner, as the BEFORE trigger and the rule did; and the delete whose trigger inserted where only the owner may was done, the trigger’s row the owner’s',
    },
    heldBy: {
      file: 'packages/data-postgres/src/cascade.integration.test.ts',
      test: 'a cascaded table’s AFTER trigger that writes where only the owner may refuses the delete where it runs as the deleting account, and not where it runs as the owner',
    },
  },
  restrictViolation: {
    engine: 'postgres',
    says: 'PostgreSQL refuses a delete that an ON DELETE RESTRICT key forbids with restrict_violation, 23001, "violates RESTRICT setting of foreign key constraint", the key named; a server without it refuses one with foreign_key_violation, 23503, as it refuses NO ACTION (0050, P3). The adapter answers foreign-key-violation, the key named, for both, which the server answers referenced; a NO ACTION key is 23503 on every version',
    values: { 15: false, 16: false, 17: false, 18: true },
    source:
      'PostgreSQL commit 086c84b23d, "Fix error code for referential action RESTRICT" (2024-12-02), first released in 18.0, which 18’s release notes do not list: ri_triggers.c raises ERRCODE_RESTRICT_VIOLATION on REL_18_STABLE and nowhere on REL_17_STABLE',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: the delete of a row an ON DELETE RESTRICT key refers to failed with 23503, "violates foreign key constraint", the constraint named, as under NO ACTION',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 15',
      17: 'every run, on the default image: as 15 (0050, P3)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: 23001, "violates RESTRICT setting of foreign key constraint", the constraint named; a NO ACTION key’s refusal was 23503',
    },
    heldBy: {
      file: 'packages/data-postgres/src/delete.integration.test.ts',
      test: 'restrict: a row a RESTRICT key refers to stays, refused as NO ACTION is',
    },
  },
  notNullConstraints: {
    engine: 'postgres',
    says: 'PostgreSQL files each column’s NOT NULL in pg_constraint, a row of type n for every column pg_attribute holds NOT NULL, which every role reads as it reads the rest of pg_catalog; a server without it keeps NOT NULL in pg_attribute.attnotnull alone, and pg_constraint has no row for it. Discovery reads NOT NULL from attnotnull, and a row of type n only when it is not validated, which only a NOT NULL added NOT VALID is and which it reads as a check (0077); no table of the shared model has one, so its snapshot of one table is the same on both',
    values: { 15: false, 16: false, 17: false, 18: true },
    source: 'PostgreSQL 18’s release notes, under constraints: "Store column NOT NULL specifications in pg_constraint"',
    measured: {
      15: '2026-10-16, postgres:15-alpine answering 15.19, on Docker Desktop on Windows: the restricted reader counted five pg_constraint rows on sales.order, its keys and checks, none of type n',
      16: '2026-10-16, postgres:16-alpine answering 16.15, on Docker Desktop on Windows: as 15',
      17: 'every run, on the default image: as 15 (0006)',
      18: '2026-10-16, postgres:18-alpine answering 18.6, on Docker Desktop on Windows: twelve, the same five and seven of type n, one for each of the seven columns pg_attribute holds NOT NULL; information_schema still showed the reader none',
    },
    heldBy: {
      file: 'packages/data-postgres/src/discovery.integration.test.ts',
      test: 'information_schema hides every constraint on sales.order from the reader; pg_catalog hides none',
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
      17: '2026-10-16, mcr.microsoft.com/mssql/server:2025-latest answering 17.0.5015.4 (CU9), on Docker Desktop on Windows: as 16',
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
  if (value === undefined)
    throw new Error(
      `VERSION_FACTS.${name} has no value for ${fact.engine} ${String(major)}: measure it on that version and add it, or leave the version out of the matrix`,
    )
  return value
}
