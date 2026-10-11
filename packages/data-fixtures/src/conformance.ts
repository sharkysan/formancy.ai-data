import type { ColumnMeta, CoverageGap, InboundKey, MetadataSnapshot, ObjectMeta, ObjectRef } from '@formancy/data-core'
import { findObject, gapCovers } from '@formancy/data-core'
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
 *
 * Discovered as the owner, every column grants every privilege and each
 * object's row security is the model's (0027), and the owner may delete from
 * every object (0049).
 */
export function snapshotDisagreements(snapshot: MetadataSnapshot, model: readonly ExpectedObject[] = FIXTURE_MODEL): string[] {
  return disagreements(snapshot, model, true)
}

/**
 * The structure only — objects, columns, keys, constraints, the keys that
 * refer to each object, and no gap but one about row security or about what
 * refers to an object — ignoring what the account may do and whether row
 * security applies to it. For an account that sees every catalog entry in
 * scope and is not the owner: the PostgreSQL reader, a SQL Server account
 * with VIEW DEFINITION on the schema or the database (0027). On SQL Server
 * only the database grant shows a key on a table outside the scope, so
 * whether one refers to a table in scope is beyond the schema grant (0049);
 * the fixture has none, so its keys are the model's either way.
 */
export function structuralDisagreements(snapshot: MetadataSnapshot, model: readonly ExpectedObject[] = FIXTURE_MODEL): string[] {
  return disagreements(snapshot, model, false)
}

/** Where a gap is, for a sentence: the scope, a schema, or an object. */
function placeOf(gap: CoverageGap): string {
  const subject = gap.subject
  if (subject.kind === 'scope') return 'the scope'
  return subject.kind === 'schema' ? `schema ${subject.schema}` : name(subject.object)
}

function disagreements(snapshot: MetadataSnapshot, model: readonly ExpectedObject[], asOwner: boolean): string[] {
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
    out.push(...objectDisagreements(actual, entry, snapshot.kind, model))
    if (asOwner) out.push(...ownerDisagreements(actual, entry, snapshot.kind))
  }
  // Discovered as the owner, the fixture is fully visible. A gap here is an
  // adapter that failed to read something it could have. Structurally, only
  // whether row security applies, and whether a key outside the scope refers
  // to a table in it, may be beyond the account.
  for (const gap of snapshot.gaps) {
    if (!asOwner && (gap.aspect === 'row-security' || gap.aspect === 'referenced-by')) continue
    out.push(`unexpected gap on ${placeOf(gap)} (${gap.aspect}): ${gap.detail}`)
  }
  return out
}

/** What only the owner's snapshot says: every privilege on every column, deleting from every object, and the model's row security. */
function ownerDisagreements(actual: ObjectMeta, entry: ExpectedObject, kind: MetadataSnapshot['kind']): string[] {
  const out: string[] = []
  const where = name(entry.ref)
  if (actual.access?.delete === false) out.push(`${where} access says it may not delete, expected that the owner may`)
  for (const column of actual.columns) {
    const { select, insert, update } = column.access
    if (!(select && insert && update)) {
      const said = (capability: string, held: boolean) => `${held ? '' : 'not '}${capability}`
      out.push(`${where}.${column.name} access is ${said('select', select)}, ${said('insert', insert)} and ${said('update', update)}, expected every privilege`)
    }
  }
  const rowSecurity = typeof entry.rowSecurity === 'string' ? entry.rowSecurity : entry.rowSecurity[kind]
  if (actual.rowSecurity !== rowSecurity) out.push(`${where} row security is ${actual.rowSecurity}, expected ${rowSecurity}`)
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
 *
 * The same for the keys that refer to sales.order, which are on tables the
 * reader may not use (0049): each reported right, or a `referenced-by` gap
 * covering sales.order -- never missing with nothing said, which reads as a
 * delete that reaches nothing else.
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

  const before0049 = deleteFactsMissing(actual)
  if (before0049 !== null) out.push(before0049)
  // The keys onto sales.order are on tables the reader may not see: each is
  // reported right, or a referenced-by gap says the list may be short (0049).
  const admitsReferrers = snapshot.gaps.some((gap) => gap.aspect === 'referenced-by' && gapCovers(gap, entry.ref))
  for (const wanted of expectedReferrers(model, entry.ref)) {
    const reported = actual.referencedBy?.find((key) => key.name === wanted.name && same(key.table, wanted.table))
    if (reported === undefined) {
      if (before0049 === null && !admitsReferrers) out.push(`${wanted.name} of ${name(wanted.table)} refers to sales.order, and is missing with no gap that says the reader cannot see it`)
      continue
    }
    out.push(...inboundDisagreements(reported, wanted, `sales.order ${wanted.name} of ${name(wanted.table)}`))
  }

  const admitsGap = snapshot.gaps.some((gap) => gap.aspect === 'foreign-keys' && gapCovers(gap, entry.ref))
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

function objectDisagreements(actual: ObjectMeta, entry: ExpectedObject, kind: MetadataSnapshot['kind'], model: readonly ExpectedObject[]): string[] {
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

  out.push(...referrerDisagreements(actual, model, where))

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

/** A key that refers to an object, as the model's foreign keys say it: the fixture has no key from outside the approved schemas (0049). */
interface ExpectedReferrer {
  table: ObjectRef
  name: string
  columns: readonly string[]
  referencedColumns: readonly string[]
  onDelete: InboundKey['onDelete']
}

/**
 * The keys that refer to `ref`, derived from the model's foreign keys rather
 * than written a second time, so the two cannot disagree: every key of the
 * fixture is on a table in `sales`.
 */
function expectedReferrers(model: readonly ExpectedObject[], ref: ObjectRef): ExpectedReferrer[] {
  return model.flatMap((referrer) =>
    referrer.foreignKeys
      .filter((foreignKey) => same(foreignKey.references.table, ref))
      .map((foreignKey) => ({ table: referrer.ref, name: foreignKey.name, columns: foreignKey.columns, referencedColumns: foreignKey.references.columns, onDelete: foreignKey.onDelete })),
  )
}

/** The sentence for an object that says nothing about deleting, or `null` when it says both things 0049 records. */
function deleteFactsMissing(actual: ObjectMeta): string | null {
  return actual.access === undefined || actual.referencedBy === undefined ? `${name(actual.ref)} says nothing about deleting; it was taken before 0049` : null
}

function inboundDisagreements(found: InboundKey, wanted: ExpectedReferrer, at: string): string[] {
  const out: string[] = []
  if (found.columns.join() !== wanted.columns.join()) out.push(`${at} columns are [${found.columns.join(', ')}], expected [${wanted.columns.join(', ')}]`)
  if (found.referencedColumns.join() !== wanted.referencedColumns.join()) out.push(`${at} refers to [${found.referencedColumns.join(', ')}], expected [${wanted.referencedColumns.join(', ')}]`)
  if (found.onDelete !== wanted.onDelete) out.push(`${at} on delete is ${found.onDelete}, expected ${wanted.onDelete}`)
  if (!found.enforced) out.push(`${at} is not enforced`)
  return out
}

/**
 * Whether the object says what refers to it, exactly the model's keys: one
 * missing reads as a delete that reaches nothing else, and one the fixture
 * does not have is a key from nowhere (0049).
 */
function referrerDisagreements(actual: ObjectMeta, model: readonly ExpectedObject[], where: string): string[] {
  const missing = deleteFactsMissing(actual)
  if (missing !== null) return [missing]
  const label = (key: { table: ObjectRef; name: string }) => `${name(key.table)} ${key.name}`
  const found = actual.referencedBy ?? []
  const wanted = expectedReferrers(model, actual.ref)
  const listed = found.map(label)
  const expected = wanted.map(label).sort(byCodepoint)
  if ([...listed].sort(byCodepoint).join('\u0000') !== expected.join('\u0000')) return [`${where} is referred to by [${listed.join(', ')}], expected [${expected.join(', ')}]`]
  return wanted.flatMap((key) => {
    const reported = found.find((candidate) => candidate.name === key.name && same(candidate.table, key.table))
    return reported === undefined ? [] : inboundDisagreements(reported, key, `${where} ${key.name} of ${name(key.table)}`)
  })
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

const same = (left: ObjectRef, right: ObjectRef): boolean => key(left) === key(right)

/** Codepoint order, as createSnapshot sorts. */
const byCodepoint = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

function name(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}
