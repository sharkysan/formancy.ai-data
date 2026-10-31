import type { CoverageGap, DiscoveryScope, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { createSnapshot } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { readAccount } from './account.js'
import type { ObjectGap } from './catalog.js'
import { readChecks } from './checks.js'
import { readColumns } from './columns.js'
import { readForeignKeys } from './foreign-keys.js'
import { readKeys } from './keys.js'
import type { ObjectFound } from './objects.js'
import { readObjects } from './objects.js'
import { readReferencedBy, referencedByGaps } from './referenced-by.js'
import { readPolicies, rowSecurityOf } from './row-security.js'
import { readObjectVisibility } from './visibility.js'
import { discoveryRefusal, readServer } from '../server.js'

/**
 * What this connection's account can see of the tables and views in `scope`,
 * what it may do with each column, whether a security policy filters each
 * object for it -- and, as gaps, what it cannot establish (0007, 0027) --
 * whether it may delete from each, and every key it can see that refers to
 * each, from any schema (0049).
 *
 * Read from SQL Server's catalog views, never INFORMATION_SCHEMA, which carries
 * neither the trust and disable flags of a key nor rowversion nor extended
 * properties (0004). One catalog concern per query, each bound to the scope by
 * parameters; they run side by side and are not one consistent read. A
 * concurrent ALTER can tear the result, in which case createSnapshot refuses
 * what no catalog could produce, or drift review sees the change next time.
 * A column and its privileges are one read (access.ts), so no column lacks
 * an answer; a concurrent rename can still make that answer a false "no".
 *
 * Unlike PostgreSQL's, this catalog is filtered by permission: an object the
 * account holds nothing on is absent, behind a schema gap, a security policy
 * it cannot see leaves row security `unknown`, behind a scope gap, and a key
 * on a table it cannot see is missing from what refers to a table, behind
 * another. A graph edge constraint, which is not a foreign key, is a gap on
 * each node table it connects, for any account (referenced-by.ts).
 *
 * A server without sys.edge_constraints -- every SQL Server before 2019 -- is
 * refused before the catalog is read, naming the release it answered (0068):
 * the one refusal a version meets, and decided by that view, not by a major.
 *
 * The pool is the caller's. Nothing here opens a connection or reads
 * configuration, and nothing here closes the pool.
 */
export async function discoverSqlServer(pool: ConnectionPool, scope: DiscoveryScope): Promise<MetadataSnapshot> {
  const schemas = [...new Set(scope.schemas)]
  // The same query ping runs, so the server a snapshot records and the one
  // a ping reports cannot differ. The account before the early return: an
  // empty snapshot is still somebody's.
  const [read, account] = await Promise.all([readServer(pool), readAccount(pool)])
  const refusal = discoveryRefusal(read)
  if (refusal !== undefined) throw new Error(refusal)
  const { kind: _kind, version, ...server } = read.identity
  if (schemas.length === 0) return createSnapshot({ kind: 'sqlserver', serverVersion: version, server, account, scope, objects: [], gaps: [] })

  const [objects, columns, keys, foreignKeys, referencedBy, checks, visibility, policed] = await Promise.all([
    readObjects(pool, schemas),
    readColumns(pool, schemas),
    readKeys(pool, schemas),
    readForeignKeys(pool, schemas),
    readReferencedBy(pool, schemas),
    readChecks(pool, schemas),
    readObjectVisibility(pool, schemas),
    readPolicies(pool, schemas),
  ])
  const rowSecurity = rowSecurityOf(objects.keys(), policed, visibility)

  const assembled: ObjectMeta[] = []
  for (const [objectId, object] of objects) {
    const objectKeys = keys.get(objectId)
    assembled.push({
      ...object,
      columns: columns.byObject.get(objectId) ?? [],
      primaryKey: objectKeys?.primaryKey ?? null,
      uniqueKeys: objectKeys?.uniqueKeys ?? [],
      foreignKeys: foreignKeys.byObject.get(objectId) ?? [],
      checks: checks.byObject.get(objectId) ?? [],
      rowSecurity: rowSecurity.of(objectId),
      referencedBy: referencedBy.byObject.get(objectId) ?? [],
    })
  }

  return createSnapshot({
    kind: 'sqlserver',
    serverVersion: version,
    server,
    account,
    scope,
    objects: assembled,
    gaps: [
      ...visibility.gaps,
      ...rowSecurity.gaps,
      ...referencedByGaps(objects.size, visibility),
      ...named(objects, [...columns.gaps, ...foreignKeys.gaps, ...referencedBy.gaps, ...checks.gaps]),
    ],
  })
}

/**
 * Gaps with the object's name in place of its id. A gap on an object the
 * objects query did not return belongs to a table created between the two
 * reads, and is left out with the table.
 */
function named(objects: ReadonlyMap<number, ObjectFound>, gaps: readonly ObjectGap[]): CoverageGap[] {
  return gaps.flatMap((gap) => {
    const object = objects.get(gap.objectId)
    return object === undefined ? [] : [{ subject: { kind: 'object', object: object.ref }, aspect: gap.aspect, detail: gap.detail }]
  })
}
