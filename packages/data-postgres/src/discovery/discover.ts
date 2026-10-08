import { createSnapshot } from '@formancy/data-core'
import type { DiscoveryScope, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { Sql, TransactionSql } from 'postgres'
import { readChecks } from './checks.js'
import { readColumns } from './columns.js'
import { readComments } from './comments.js'
import { readForeignKeys } from './foreign-keys.js'
import { readKeys } from './keys.js'
import { readObjects } from './objects.js'

/**
 * A metadata snapshot of the schemas in scope, read from pg_catalog (0006).
 *
 * pg_catalog rather than information_schema, because information_schema is
 * filtered by privilege: a SELECT-only account sees none of the constraints on
 * the very table it reads, and an adapter built on it would report that table
 * with no key and no relationships. pg_catalog shows every role everything, so
 * this adapter asks separately what the account may USE, and reports each
 * object in scope it cannot use as a gap rather than describing it or
 * dropping it (see `readObjects`).
 *
 * Every catalog query runs in one REPEATABLE READ, read-only transaction, so
 * they all see the catalog as it was at one moment: a column added between
 * the columns query and the keys query would otherwise produce a key over a
 * column the snapshot does not have, which `createSnapshot` refuses. The
 * deparsing functions (`format_type`, `pg_get_expr`) read the catalog caches
 * rather than the transaction's snapshot -- the same caveat `pg_dump` lives
 * with -- so only the rows, not those spellings, are guaranteed one moment's.
 *
 * Each schema name is a bound parameter, never spliced: the scope is an
 * administrator's configuration, and configuration is input.
 *
 * The snapshot is made by `createSnapshot` and nowhere else (0004).
 */
export async function discoverPostgres(sql: Sql, scope: DiscoveryScope): Promise<MetadataSnapshot> {
  const schemas = [...scope.schemas]
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const [inScope, columns, keys, foreignKeys, checks, comments, serverVersion] = await Promise.all([
      readObjects(tx, schemas),
      readColumns(tx, schemas),
      readKeys(tx, schemas),
      readForeignKeys(tx, schemas),
      readChecks(tx, schemas),
      readComments(tx, schemas),
      readServerVersion(tx),
    ])

    const objects = inScope.usable.map((object): ObjectMeta => {
      const objectKeys = keys.get(object.oid)
      const objectComments = comments.get(object.oid)
      return {
        ref: object.ref,
        kind: object.kind,
        comment: objectComments?.object ?? null,
        // A table may have no columns at all: CREATE TABLE t () is legal.
        columns: (columns.get(object.oid) ?? []).map((column) => ({
          ...column,
          comment: objectComments?.columns.get(column.ordinal) ?? null,
        })),
        primaryKey: objectKeys?.primaryKey ?? null,
        uniqueKeys: objectKeys?.uniqueKeys ?? [],
        foreignKeys: foreignKeys.get(object.oid) ?? [],
        checks: checks.get(object.oid) ?? [],
      }
    })

    return createSnapshot({ kind: 'postgres', serverVersion, scope, objects, gaps: inScope.gaps })
  })
}

/** The same setting `createPostgresAdapter().ping()` reports, so the two cannot disagree. */
async function readServerVersion(sql: TransactionSql): Promise<string> {
  const [row] = await sql<{ version: string }[]>`select pg_catalog.current_setting('server_version') as version`
  // Never reached: a SELECT of one expression returns one row. Kept, as in
  // ping, because `row` is `T | undefined` under noUncheckedIndexedAccess.
  if (row === undefined) throw new Error('PostgreSQL answered the version query with no row')
  return row.version
}
