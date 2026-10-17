import { createSnapshot } from '@formancy/data-core'
import type { ColumnAccess, DiscoveryScope, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import type { Sql, TransactionSql } from 'postgres'
import { readAccess, readObjectAccess } from './access.js'
import { readAccount } from './account.js'
import { readChecks } from './checks.js'
import { readColumns, textUnitOf } from './columns.js'
import { readComments } from './comments.js'
import { readForeignKeys } from './foreign-keys.js'
import { readKeys } from './keys.js'
import { readObjects } from './objects.js'
import { readKeysBelow, readReferencedBy } from './referenced-by.js'
import { readServer } from '../server.js'

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
 * (`readAccount`) -- 0027 -- and, table by table, whether it may delete
 * (`readObjectAccess`), beside every key from any schema that refers to the
 * table (`readReferencedBy`) -- 0049. All of them are answered for any role
 * on any relation, so nothing about an object in scope is beyond this
 * account: the gaps a PostgreSQL snapshot carries are what this release does
 * not describe -- a foreign table, and a key that names a partition or an
 * inheriting table rather than the table a delete names (`readKeysBelow`).
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
    await searchCatalogFirst(tx)
    const [{ kind: _kind, version: serverVersion, ...server }, encoding] = await Promise.all([readServer(tx), readEncoding(tx)])
    const [account, inScope, columns, access, deletes, keys, foreignKeys, referencedBy, keysBelow, checks, comments] = await Promise.all([
      readAccount(tx),
      readObjects(tx, schemas),
      readColumns(tx, schemas, textUnitOf(encoding)),
      readAccess(tx, schemas),
      readObjectAccess(tx, schemas),
      readKeys(tx, schemas),
      readForeignKeys(tx, schemas),
      readReferencedBy(tx, schemas),
      readKeysBelow(tx, schemas),
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
        // Both queries read the same pg_class rows in one transaction; an
        // object without an answer is reported as nothing permitted.
        access: deletes.get(object.oid) ?? { delete: false },
        referencedBy: referencedBy.get(object.oid) ?? [],
      }
    })

    return createSnapshot({ kind: 'postgres', serverVersion, server, account, scope, objects, gaps: [...inScope.gaps, ...keysBelow] })
  })
}

const NOTHING: ColumnAccess = { select: false, insert: false, update: false }

/**
 * Puts pg_catalog first in this transaction's search_path, before the
 * session's own path, which is the composition root's (0057).
 *
 * `pg_get_expr` and `format_type` leave an object's schema out where the
 * path finds it by its bare name. PostgreSQL searches pg_catalog first unless
 * the path names it later, so under a path that does not name it -- the
 * default, `"$user", public`, among them -- this spells nothing otherwise,
 * and no snapshot's fingerprint moves. Under one that names it after another
 * schema, a function of that schema named like PostgreSQL's own was spelled
 * bare and PostgreSQL's with its schema; and a key's default is told apart
 * by its spelling, whole (`numbersKey`), so whoever may CREATE in that schema
 * chose which key counted as numbered. With pg_catalog first, PostgreSQL's
 * own is the one spelled bare, whatever else the path holds. Local to the
 * transaction: the session's path is the composition root's again after it.
 *
 * A request's description of the root is read in the request's own
 * statement, under the session's path (`records/definition.ts`): there such a
 * path still spells PostgreSQL's own with its schema, and the runtime reads
 * a key's default as changed and refuses a delete -- it withdraws an offer,
 * and never makes one.
 */
async function searchCatalogFirst(sql: TransactionSql): Promise<void> {
  await sql`select pg_catalog.set_config('search_path', pg_catalog.concat_ws(', ', 'pg_catalog', nullif(pg_catalog.current_setting('search_path'), '')), true)`
}

/**
 * The encoding of the database this connection is in, fixed when it was
 * created, which decides what a text length counts. The server itself is
 * `readServer`'s, the query `createPostgresAdapter().ping()` runs, so the
 * two cannot disagree.
 */
async function readEncoding(sql: TransactionSql): Promise<string> {
  const [row] = await sql<{ encoding: string }[]>`select pg_catalog.current_setting('server_encoding') as encoding`
  // Never reached: a SELECT of one row of expressions returns one row. Kept,
  // as in readServer, because `row` is `T | undefined` under noUncheckedIndexedAccess.
  if (row === undefined) throw new Error('PostgreSQL answered the encoding query with no row')
  return row.encoding
}
