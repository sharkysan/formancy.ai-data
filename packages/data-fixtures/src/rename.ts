import type { MetadataSnapshot, ObjectMeta, ObjectRef } from '@formancy/data-core'
import { createSnapshot } from '@formancy/data-core'

const same = (left: ObjectRef, right: ObjectRef): boolean => left.schema === right.schema && left.name === right.name

/** Whatever among `objects` names `column` of `object`: its keys, foreign keys on either side, and its checks, by their text. */
function namers(objects: readonly ObjectMeta[], object: ObjectMeta, column: string): string[] {
  const out: string[] = []
  for (const key of [...(object.primaryKey === null ? [] : [object.primaryKey]), ...object.uniqueKeys]) {
    if (key.columns.includes(column)) out.push(`key ${key.name}`)
  }
  for (const foreignKey of object.foreignKeys) {
    if (foreignKey.columns.includes(column)) out.push(`foreign key ${foreignKey.name}`)
  }
  for (const other of objects) {
    for (const foreignKey of other.foreignKeys) {
      const target = foreignKey.references
      if (target !== null && same(target.table, object.ref) && target.columns.includes(column)) out.push(`foreign key ${foreignKey.name} of ${other.ref.schema}.${other.ref.name}`)
    }
  }
  for (const check of object.checks) {
    if (check.expression === null) out.push(`check ${check.name}, whose text this account could not read`)
    else if (check.expression.includes(column)) out.push(`check ${check.name}`)
  }
  return out
}

/**
 * `snapshot` as discovery reports it once `table`'s column `from` has been
 * renamed to `to` in the database: the same column -- its ordinal, type,
 * default, comment and access -- under the new name, made through
 * createSnapshot as an adapter's snapshot is, so the fingerprint follows. To
 * drift, as to a catalog, that is one column dropped and one added in its
 * place. A new snapshot; the one given is left as it was.
 *
 * Both adapters' discovery suites hold it to a real rename, as the order
 * form's account, whose column grants a rename keeps. That rename is of a
 * column nothing else names, so that is all this makes: a column that a key
 * or a foreign key names, or a check of its table -- judged by the check's
 * text, so one that only mentions the name, or whose text the account could
 * not read, counts -- is refused rather than rewritten, because what a
 * catalog reports for those after a rename has not been compared with
 * anything.
 */
export function renamedColumn(snapshot: MetadataSnapshot, table: ObjectRef, from: string, to: string): MetadataSnapshot {
  const where = `${table.schema}.${table.name}`
  const { fingerprint: _, ...contents } = structuredClone(snapshot)
  const object = contents.objects.find((candidate) => same(candidate.ref, table))
  if (object === undefined) throw new Error(`${where} is not in the snapshot`)
  const column = object.columns.find((candidate) => candidate.name === from)
  if (column === undefined) throw new Error(`${where} has no column ${from}`)
  const named = namers(contents.objects, object, from)
  if (named.length > 0) throw new Error(`${where}.${from} is named by ${named.join(', ')}; renamedColumn renames only a column nothing else names`)
  column.name = to
  return createSnapshot(contents)
}
