import { createSnapshot } from '@formancy/data-core'
import type { ColumnAccess, DiscoveryScope, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { Sql, TransactionSql } from 'postgres'
import { readAccess } from './access.js'
import { readAccount } from './account.js'
import { readChecks } from './checks.js'
import { readColumns, textUnitOf } from './columns.js'
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
 * every table and view in scope is described, and the account's privileges
 * are asked of the server separately, column by column (`readAccess`), with
 * whether row-level security applies to it (`readObjects`) and who it is
 * (`readAccount`) -- 0027. All three are answered for any role on any
 * relation, so nothing about an object in scope is beyond this account: the
 * only gap a PostgreSQL snapshot carries is a foreign table this release does
 * not describe.
 *
 * Every catalog query runs in one REPEATABLE READ, read-only transaction, so
 * they all see the catalog as it was at one moment: a column added between
 * the columns query and the keys query would otherwise produce a key over a
 * column the snapshot does not have, which `createSnapshot` refuses. The
 * deparsing functions (`format_type`, `pg_get_expr`), the privilege functions
 * (`readAccess`) and `row_security_active` (`readObjects`) read live catalog
 * state rather than the transaction's snapshot -- the same caveat `pg_dump`
 * lives with -- so only the catalog rows are guaranteed one moment's. A GRANT,
 * a REVOKE or an ALTER TABLE … ROW LEVEL SECURITY committed mid-read can make
 * a column's access or an object's row security an answer from a moment
 * after the rows beside it; drift review sees the change at the next
 * snapshot.
 *
 * Each schema name is a bound parameter, never spliced: the scope is an
 * administrator's configuration, and configuration is input.
 *
 * The snapshot is made by `createSnapshot` and nowhere else (0004).
 */
export async function discoverPostgres(sql: Sql, scope: DiscoveryScope): Promise<MetadataSnapshot> {
  const schemas = [...scope.schemas]
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const { version: serverVersion, encoding } = await readSettings(tx)
    const [account, inScope, columns, access, keys, foreignKeys, checks, comments] = await Promise.all([
      readAccount(tx),
      readObjects(tx, schemas),
      readColumns(tx, schemas, textUnitOf(encoding)),
      readAccess(tx, schemas),
      readKeys(tx, schemas),
      readForeignKeys(tx, schemas),
      readChecks(tx, schemas),
      readComments(tx, schemas),
    ])

    const objects = inScope.described.map((object): ObjectMeta => {
      const objectKeys = keys.get(object.oid)
      const objectComments = comments.get(object.oid)
      const objectAccess = access.get(object.oid)
      return {
        ref: object.ref,
        kind: object.kind,
        comment: objectComments?.object ?? null,
        // A table may have no columns at all: CREATE TABLE t () is legal.
        columns: (columns.get(object.oid) ?? []).map((column) => ({
          ...column,
          comment: objectComments?.columns.get(column.ordinal) ?? null,
          // Both queries read the same pg_attribute rows in one transaction,
          // so a column without an answer is not expected; if one ever were,
          // it is reported as nothing permitted, never as everything.
          access: objectAccess?.get(column.ordinal) ?? NOTHING,
        })),
        primaryKey: objectKeys?.primaryKey ?? null,
        uniqueKeys: objectKeys?.uniqueKeys ?? [],
        foreignKeys: foreignKeys.get(object.oid) ?? [],
        checks: checks.get(object.oid) ?? [],
        rowSecurity: object.rowSecurity,
      }
    })

    return createSnapshot({ kind: 'postgres', serverVersion, account, scope, objects, gaps: inScope.gaps })
  })
}

const NOTHING: ColumnAccess = { select: false, insert: false, update: false }

/**
 * The server's version — the same setting `createPostgresAdapter().ping()`
 * reports, so the two cannot disagree — and the encoding of the database this
 * connection is in, fixed when it was created, which decides what a text
 * length counts.
 */
async function readSettings(sql: TransactionSql): Promise<{ version: string; encoding: string }> {
  const [row] = await sql<{ version: string; encoding: string }[]>`
    select pg_catalog.current_setting('server_version') as version, pg_catalog.current_setting('server_encoding') as encoding`
  // Never reached: a SELECT of one row of expressions returns one row. Kept,
  // as in ping, because `row` is `T | undefined` under noUncheckedIndexedAccess.
  if (row === undefined) throw new Error('PostgreSQL answered the settings query with no row')
  return row
}
