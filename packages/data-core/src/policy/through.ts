import type { FormBindings } from '../generate/types.js'
import { buildLookupConfig } from '../lookup/config.js'
import type { LookupKeyType } from '../lookup/types.js'
import { isLookupKeyType } from '../lookup/values.js'
import type { MetadataSnapshot, NormalizedType } from '../metadata.js'
import { findObject } from '../snapshot.js'
import type { FormPolicy } from './types.js'

/**
 * The kinds a through's key may have (0043): those a lookup's key may have,
 * less text.
 *
 * A through compares the root's foreign-key columns with the target's key
 * columns directly, in the database's own equality, as the foreign key
 * itself does. PostgreSQL lets a foreign key join two text columns of
 * different collations, and then a direct comparison of the two cannot
 * resolve a collation unless it names one. Measured on 17.11 (2026-10-11):
 * a foreign key from a column under a nondeterministic ICU collation to one
 * under "C" was created, and so was one from "POSIX" to "C", two
 * deterministic collations; the EXISTS a through builds over either pair
 * failed with 42P22, "could not determine which collation to use for string
 * hashing". A snapshot records no collation to name, on either engine, so a
 * text key is refused on both until one does.
 */
export type ThroughKeyType = Exclude<LookupKeyType, { kind: 'text' }>

export function isThroughKeyType(type: NormalizedType): type is ThroughKeyType {
  return isLookupKeyType(type) && type.kind !== 'text'
}

/** The lookup keys a stored policy's through names, whatever shape a hand edit left it in; `validatePolicy` reports a bad shape. */
function namedThrough(policy: FormPolicy): string[] {
  const through: unknown = (policy as { through?: unknown }).through
  return Array.isArray(through) ? through.filter((key): key is string => typeof key === 'string') : []
}

/**
 * Everything about a policy's through that only the snapshot can tell
 * (0043): each lookup it names must configure, as `buildLookupConfig`
 * builds it, and every column of its foreign key, on both sides, must be of
 * a kind `isThroughKeyType` accepts. The data server's publish check, its
 * regeneration report and every read of a published form ask this, and so
 * does the planner, so the two cannot disagree.
 *
 * Whether a through names a lookup of the form at all, and one whose filter
 * says something, is `validatePolicy`'s question, and an entry it refuses is
 * passed over here. The target filter's columns are checked where every
 * lookup's are (0028).
 */
export function throughProblems(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string[] {
  const problems: string[] = []
  const fields = Array.isArray(bindings.fields) ? bindings.fields : []
  for (const key of namedThrough(policy)) {
    const binding = fields.find((candidate) => candidate.field === key)
    if (binding?.kind !== 'lookup') continue
    let targetColumns: ReadonlyArray<{ name: string; type: NormalizedType }>
    try {
      targetColumns = buildLookupConfig(bindings, key, { snapshot }).targetColumns
    } catch (error) {
      // buildLookupConfig throws an Error naming what it refused, and nothing else.
      problems.push(`through: ${key} cannot scope this form: ${(error as Error).message}`)
      continue
    }
    const root = findObject(snapshot, bindings.root)
    const rootColumns = binding.columns.map((name) => ({ name, type: root?.columns.find((column) => column.name === name)?.type }))
    const target = `${binding.target.table.schema}.${binding.target.table.name}`
    const text = [
      ...rootColumns.filter((column) => column.type === undefined || !isThroughKeyType(column.type)).map((column) => `${bindings.root.schema}.${bindings.root.name}.${column.name}`),
      ...targetColumns.filter((column) => !isThroughKeyType(column.type)).map((column) => `${target}.${column.name}`),
    ]
    if (text.length > 0) {
      problems.push(
        `through: ${key} joins ${text.join(' and ')}, which a through cannot compare: only integer, decimal, uuid and date keys are compared without a collation, and the snapshot records none`,
      )
    }
  }
  return problems
}
