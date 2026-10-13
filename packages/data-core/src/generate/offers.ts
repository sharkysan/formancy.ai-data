import type { DatabaseKind } from '../adapter.js'
import type { ColumnMeta, Generation, ObjectMeta } from '../metadata.js'
import type { ConcurrencyBinding, FormBindings } from './types.js'

/** A write a form may offer, as its bindings say: the operations other than read, which every form offers. */
export type OfferedOperation = 'create' | 'update' | 'delete'

/**
 * Whether the bindings offer `operation` (0050): exactly when they say
 * `true` for it. One function for every reader -- the planners, the policy's
 * fit, drift review, the published bundle's check, the form route and the
 * menu -- so none of them can offer what another refuses.
 *
 * An absent flag is `false`. The generator writes `delete` since 0050, and
 * the bindings are compared with the generator at publish only, so every
 * form published before then is read with no `delete` at all, and must keep
 * offering what it offered: no delete. Read as `!== false`, as the form route
 * read every flag before, it would offer one to every such form.
 */
export function offers(bindings: Pick<FormBindings, 'operations'>, operation: OfferedOperation): boolean {
  const operations: unknown = bindings.operations
  return typeof operations === 'object' && operations !== null && Object.hasOwn(operations, operation) && (operations as Record<string, unknown>)[operation] === true
}

/** How a column's value is numbered by the database, for a key no form writes (0026). */
const NUMBERED: ReadonlySet<Generation> = new Set(['identity-always', 'identity-by-default'])

/**
 * The default each engine fills a key with that never hands out one value
 * twice (0057), as discovery spells it -- PostgreSQL's `pg_get_expr`, read
 * with pg_catalog searched first; SQL Server's
 * `object_definition(default_object_id)`, which spells every way of writing
 * the call alike -- and what a note calls it. `gen_random_uuid()` draws 122
 * random bits; `newsequentialid()` rises for the server and is documented
 * unique across restarts (0056 saw it rise across one). Compared whole: a
 * part of a name is somebody's to choose, and a function of a schema's own
 * named like one of these is another function, which the catalog spells with
 * its schema. Nothing else counts -- a constant fills one record and then the
 * same key again, and uuid_generate_v4() or newid() are not named here --
 * until a record says so.
 */
const NEVER_REPEATING: Readonly<Record<DatabaseKind, { spelled: string; named: string }>> = {
  postgres: { spelled: 'gen_random_uuid()', named: 'gen_random_uuid()' },
  sqlserver: { spelled: '(newsequentialid())', named: 'newsequentialid()' },
}

/**
 * Whether the database numbers `column` of `root` for a record's key, so
 * that no form ever hands it out again: an identity of either kind (0026),
 * or (0057) the whole key, filled by the engine's default that never
 * repeats, where no foreign key of the table includes it. A lookup over
 * such a key writes it from the record a person chooses, and any form over
 * the table may offer that lookup, so a record deleted would be created
 * again under its key the next time that record is chosen. Beside another
 * key column it is not numbered either: a form that pins nothing writes it
 * (0056). An identity is never written by any form, a lookup's included.
 */
export function numbersKey(
  kind: DatabaseKind,
  root: Pick<ObjectMeta, 'foreignKeys'>,
  column: Pick<ColumnMeta, 'name' | 'generated' | 'defaultExpression'>,
  identity: readonly string[],
): boolean {
  if (NUMBERED.has(column.generated)) return true
  return (
    identity.length === 1 &&
    column.generated === 'none' &&
    column.defaultExpression === NEVER_REPEATING[kind].spelled &&
    !root.foreignKeys.some((key) => key.columns.includes(column.name))
  )
}

/**
 * Whether a version names one state of one record for good (0050): a
 * rowversion, which SQL Server never hands out twice in a database, or a
 * version column on a table whose identity includes a column the database
 * numbers (`numbersKey`).
 *
 * A version column starts at its default on every insert, so on a table
 * whose key people type a record deleted at version 1 and created again
 * under its key is at version 1 too, and a stale update, a stale delete or a
 * delete sent again after a lost answer would land on the new record. No
 * form writes a numbered column (0026), so a key this module deletes is
 * never created again by this module. Both identities count: they differ
 * only in what another application may do, which is outside a version
 * column's guarantee already (0016), and leaving out by-default would leave
 * out PostgreSQL's `serial`. A sequence restarted, or one that cycles, numbers
 * a key again: said in 0050, not held. A key of one column that the
 * engine's never-repeating default fills, and no foreign key includes,
 * counts too (0057): no form writes it (0056), and the default does not
 * hand out a key it handed out before; another application that inserts a
 * deleted record's key by hand is outside the guarantee, as it is over a
 * by-default identity.
 */
export function versionProvesRecord(
  kind: DatabaseKind,
  root: Pick<ObjectMeta, 'columns' | 'foreignKeys'>,
  identity: readonly string[],
  concurrency: Pick<ConcurrencyBinding, 'kind'>,
): boolean {
  if (concurrency.kind === 'rowversion') return true
  return identity.some((name) => {
    const column = root.columns.find((candidate) => candidate.name === name)
    return column !== undefined && numbersKey(kind, root, column, identity)
  })
}

/**
 * Why a table with an identity and a confirmed token offers no delete, as the
 * generator's blocked note, or `null` when it does (0050): the snapshot does
 * not say whether its account may delete (taken before 0049), the account
 * may not, or a version cannot tell a record from one created again under
 * its key. The generator writes the note, and the planner refuses bindings
 * that offer a delete this says no to, so the two cannot disagree.
 *
 * What a delete also does to other tables is not asked: that is the
 * policy's to accept (`deleteProblems`), and a form whose root other keys
 * act on still offers delete in its bindings.
 */
export function deleteUnoffered(
  kind: DatabaseKind,
  root: Pick<ObjectMeta, 'ref' | 'columns' | 'foreignKeys' | 'access'>,
  identity: readonly string[],
  concurrency: Pick<ConcurrencyBinding, 'kind' | 'column'>,
): string | null {
  const table = `${root.ref.schema}.${root.ref.name}`
  if (root.access === undefined) return 'Delete is not offered: this snapshot was taken before it recorded whether its account may delete. Discover again.'
  if (!root.access.delete) return `Delete is not offered: this connection's account may not DELETE from ${table}.`
  if (!versionProvesRecord(kind, root, identity, concurrency)) {
    return `Delete is not offered: a record of ${table} created again with a deleted record's key starts its ${concurrency.column} where the deleted one did, so a version cannot tell the two apart. A key with an identity column, a key of one column that ${NEVER_REPEATING[kind].named} fills and no foreign key includes, or SQL Server's rowversion, can.`
  }
  return null
}
