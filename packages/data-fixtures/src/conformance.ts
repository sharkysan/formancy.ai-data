import type { ColumnMeta, MetadataSnapshot, ObjectMeta, ObjectRef } from '@formancy/data-core'
import { findObject } from '@formancy/data-core'
import type { ExpectedCheck, ExpectedCheckFacts, ExpectedColumn, ExpectedColumnFacts, ExpectedObject } from './model.js'
import { FIXTURE_MODEL } from './model.js'

/**
 * How a snapshot differs from the model, as sentences, one per difference.
 *
 * It REPORTS rather than asserts, the shape `@formancy/conformance` takes
 * upstream: the caller is a test today and may be a release report tomorrow,
 * and a list of every difference is more use than the first failed `expect`.
 * Each adapter's suite asserts that the list is empty; the same list from both
 * engines is how "both adapters pass the same mandatory behaviour suite" is
 * made checkable.
 */
export function snapshotDisagreements(snapshot: MetadataSnapshot, model: readonly ExpectedObject[] = FIXTURE_MODEL): string[] {
  const out: string[] = []
  const expected = new Set(model.map((object) => key(object.ref)))

  for (const object of snapshot.objects) {
    if (!expected.has(key(object.ref))) out.push(`${name(object.ref)} is reported and the model has no such object`)
  }
  for (const entry of model) {
    const actual = findObject(snapshot, entry.ref)
    if (actual === undefined) {
      out.push(`${name(entry.ref)} is missing`)
      continue
    }
    out.push(...objectDisagreements(actual, entry, snapshot.kind))
  }
  // Discovered as the owner, the fixture is fully visible. A gap here is an
  // adapter that failed to read something it could have.
  for (const gap of snapshot.gaps) {
    out.push(`unexpected gap on ${gap.object === null ? 'the scope' : name(gap.object)} (${gap.aspect}): ${gap.detail}`)
  }
  return out
}

/**
 * The restricted reader's rule: say the right thing or say you cannot tell.
 *
 * `formancy_reader` may read sales.order only. Whatever an engine lets it see,
 * the snapshot must describe every column of sales.order, and for each of its
 * foreign keys either report it with the right target or carry a
 * `foreign-keys` gap on sales.order. The one answer that is never acceptable is
 * the silent one: a foreign key missing with no gap reads as "no relationship
 * exists", and a form generated from that is wrong in a way nobody would notice.
 */
export function restrictedDisagreements(snapshot: MetadataSnapshot, model: readonly ExpectedObject[] = FIXTURE_MODEL): string[] {
  const out: string[] = []
  const entry = model.find((object) => object.ref.schema === 'sales' && object.ref.name === 'order')
  if (entry === undefined) throw new Error('the model has no sales.order')
  const actual = findObject(snapshot, entry.ref)
  if (actual === undefined) return ['sales.order is missing, though the reader may select from it']

  const columns = actual.columns.map((column) => column.name)
  const wanted = entry.columns.map((column) => column.name)
  if (columns.join() !== wanted.join()) out.push(`sales.order columns are [${columns.join(', ')}], expected [${wanted.join(', ')}]`)

  const admitsGap = snapshot.gaps.some(
    (gap) => gap.aspect === 'foreign-keys' && gap.object !== null && key(gap.object) === key(entry.ref),
  )
  for (const foreignKey of entry.foreignKeys) {
    const reported = actual.foreignKeys.find((candidate) => candidate.name === foreignKey.name)
    if (reported === undefined) {
      if (!admitsGap) out.push(`${foreignKey.name} is missing and no gap says the reader cannot see it`)
      continue
    }
    if (reported.references === null) {
      if (!admitsGap) out.push(`${foreignKey.name} has an unknown target and no gap says why`)
      continue
    }
    if (key(reported.references.table) !== key(foreignKey.references.table)) {
      out.push(`${foreignKey.name} points at ${name(reported.references.table)}, expected ${name(foreignKey.references.table)}`)
    }
    if (reported.references.columns.join() !== foreignKey.references.columns.join()) {
      out.push(`${foreignKey.name} pairs with [${reported.references.columns.join(', ')}], expected [${foreignKey.references.columns.join(', ')}]`)
    }
  }
  return out
}

function objectDisagreements(actual: ObjectMeta, entry: ExpectedObject, kind: MetadataSnapshot['kind']): string[] {
  const out: string[] = []
  const where = name(entry.ref)

  if (actual.kind !== entry.kind) out.push(`${where} is a ${actual.kind}, expected a ${entry.kind}`)
  if (entry.comment !== undefined && actual.comment !== entry.comment) {
    out.push(`${where} comment is ${JSON.stringify(actual.comment)}, expected ${JSON.stringify(entry.comment)}`)
  }

  const names = actual.columns.map((column) => column.name)
  const wanted = entry.columns.map((column) => column.name)
  if (names.join() !== wanted.join()) out.push(`${where} columns are [${names.join(', ')}], expected [${wanted.join(', ')}]`)

  for (const column of entry.columns) {
    const found = actual.columns.find((candidate) => candidate.name === column.name)
    if (found !== undefined) out.push(...columnDisagreements(found, resolve(column, kind), `${where}.${column.name}`))
  }

  const primaryKey = actual.primaryKey?.columns ?? null
  if (JSON.stringify(primaryKey) !== JSON.stringify(entry.primaryKey)) {
    out.push(`${where} primary key is ${JSON.stringify(primaryKey)}, expected ${JSON.stringify(entry.primaryKey)}`)
  }

  const uniqueKeys = Object.fromEntries(actual.uniqueKeys.map((unique) => [unique.name, unique.columns]))
  if (JSON.stringify(sortKeys(uniqueKeys)) !== JSON.stringify(sortKeys(entry.uniqueKeys))) {
    out.push(`${where} unique keys are ${JSON.stringify(uniqueKeys)}, expected ${JSON.stringify(entry.uniqueKeys)}`)
  }

  const foreignNames = actual.foreignKeys.map((foreignKey) => foreignKey.name).sort()
  const wantedForeign = entry.foreignKeys.map((foreignKey) => foreignKey.name).sort()
  if (foreignNames.join() !== wantedForeign.join()) {
    out.push(`${where} foreign keys are [${foreignNames.join(', ')}], expected [${wantedForeign.join(', ')}]`)
  }
  for (const foreignKey of entry.foreignKeys) {
    const found = actual.foreignKeys.find((candidate) => candidate.name === foreignKey.name)
    if (found === undefined) continue
    const at = `${where} ${foreignKey.name}`
    if (found.columns.join() !== foreignKey.columns.join()) out.push(`${at} columns are [${found.columns.join(', ')}], expected [${foreignKey.columns.join(', ')}]`)
    if (found.references === null) {
      out.push(`${at} has an unknown target`)
    } else {
      if (key(found.references.table) !== key(foreignKey.references.table)) {
        out.push(`${at} points at ${name(found.references.table)}, expected ${name(foreignKey.references.table)}`)
      }
      if (found.references.columns.join() !== foreignKey.references.columns.join()) {
        out.push(`${at} pairs with [${found.references.columns.join(', ')}], expected [${foreignKey.references.columns.join(', ')}]`)
      }
    }
    if (found.onDelete !== foreignKey.onDelete) out.push(`${at} on delete is ${found.onDelete}, expected ${foreignKey.onDelete}`)
    if (found.validated !== foreignKey.validated) out.push(`${at} validated is ${String(found.validated)}, expected ${String(foreignKey.validated)}`)
    if (!found.enforced) out.push(`${at} is not enforced`)
  }

  const checks = actual.checks.map((check) => check.name).sort()
  const wantedChecks = entry.checks.map((check) => check.name).sort()
  if (checks.join() !== wantedChecks.join()) out.push(`${where} checks are [${checks.join(', ')}], expected [${wantedChecks.join(', ')}]`)
  for (const check of entry.checks) {
    const found = actual.checks.find((candidate) => candidate.name === check.name)
    if (found === undefined) continue
    const facts = resolveCheck(check, kind)
    const at = `${where} ${check.name}`
    if (facts.enforced !== undefined && found.enforced !== facts.enforced) out.push(`${at} enforced is ${String(found.enforced)}, expected ${String(facts.enforced)}`)
    if (facts.validated !== undefined && found.validated !== facts.validated) out.push(`${at} validated is ${String(found.validated)}, expected ${String(facts.validated)}`)
  }

  return out
}

function columnDisagreements(actual: ColumnMeta, expected: ExpectedColumnFacts, where: string): string[] {
  const out: string[] = []
  if (expected.type !== undefined && actual.type.kind !== expected.type.kind) {
    // A different kind is one finding. Listing every property the other kind
    // lacks would bury it under consequences.
    out.push(`${where} type kind is ${JSON.stringify(actual.type.kind)}, expected ${JSON.stringify(expected.type.kind)} (database type ${actual.databaseType})`)
  } else if (expected.type !== undefined) {
    const type = actual.type as unknown as Record<string, unknown>
    for (const [property, value] of Object.entries(expected.type)) {
      if (type[property] !== value) {
        out.push(`${where} type ${property} is ${JSON.stringify(type[property])}, expected ${JSON.stringify(value)} (database type ${actual.databaseType})`)
      }
    }
  }
  if (expected.nullable !== undefined && actual.nullable !== expected.nullable) out.push(`${where} nullable is ${String(actual.nullable)}, expected ${String(expected.nullable)}`)
  if (expected.generated !== undefined && actual.generated !== expected.generated) out.push(`${where} generated is ${actual.generated}, expected ${expected.generated}`)
  if (expected.hasDefault !== undefined && actual.hasDefault !== expected.hasDefault) out.push(`${where} hasDefault is ${String(actual.hasDefault)}, expected ${String(expected.hasDefault)}`)
  return out
}

function resolve(column: ExpectedColumn, kind: MetadataSnapshot['kind']): ExpectedColumnFacts {
  const { name: _name, byKind, ...facts } = column
  return { ...facts, ...(byKind?.[kind] ?? {}) }
}

function resolveCheck(check: ExpectedCheck, kind: MetadataSnapshot['kind']): ExpectedCheckFacts {
  const { name: _name, byKind, ...facts } = check
  return { ...facts, ...(byKind?.[kind] ?? {}) }
}

function sortKeys(record: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function key(ref: ObjectRef): string {
  return `${ref.schema}\u0000${ref.name}`
}

function name(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}
