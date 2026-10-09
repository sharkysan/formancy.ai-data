import { schemaHash } from '@formancy/spec'
import type { ColumnMeta, CoverageGap, Generation, MetadataSnapshot, ObjectMeta, ObjectRef, TextLengthUnit } from './metadata.js'

/**
 * Codepoint order, deliberately not `localeCompare`.
 *
 * The fingerprint is a hash of a sorted structure, and `localeCompare` sorts by
 * the host's locale: the same catalog would hash differently on a server set to
 * German and one set to Swedish, and drift review would report a change nobody
 * made.
 */
function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function refKey(ref: ObjectRef | null): string {
  return ref === null ? '' : `${ref.schema}\u0000${ref.name}`
}

function describe(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}

/** Every `Generation`, as a record so that a sixth one is a compile error here until it is listed. */
const GENERATIONS: Readonly<Record<Generation, true>> = {
  none: true,
  'identity-always': true,
  'identity-by-default': true,
  computed: true,
  rowversion: true,
}

/** Every `TextLengthUnit`, listed for the same reason. */
const TEXT_LENGTH_UNITS: Readonly<Record<TextLengthUnit, true>> = {
  'code-points': true,
  'utf16-code-units': true,
  'utf8-bytes': true,
  'code-page-bytes': true,
}

const isListed = (record: Readonly<Record<string, true>>, value: unknown): boolean =>
  typeof value === 'string' && Object.hasOwn(record, value)

/**
 * The column facts contract v2 added (0026), which a snapshot stored before it
 * lacks. Such a snapshot — a published bundle, a captured example — is read
 * back from JSON, so the types above promise nothing about it; checked here, it
 * is refused rather than handed to a codec that would count in no unit.
 */
function assertContractColumn(where: string, column: ColumnMeta): void {
  if (!isListed(GENERATIONS, column.generated)) {
    throw new Error(`${where}: column ${column.name} has generation ${JSON.stringify(column.generated)}, which is not one the contract names`)
  }
  const type = column.type
  if (type.kind === 'text' && !isListed(TEXT_LENGTH_UNITS, type.lengthUnit)) {
    throw new Error(`${where}: column ${column.name} has no text length unit`)
  }
  if (type.kind === 'binary' && typeof (type.fixedLength as unknown) !== 'boolean') {
    throw new Error(`${where}: column ${column.name} is binary with no fixedLength flag`)
  }
}

/**
 * Refuse what no catalog could have produced.
 *
 * An adapter that reports a key over a column the table does not have, or a
 * composite foreign key whose two sides have different lengths, has a bug —
 * and everything downstream would bind a form to it. Failing here names the
 * object, where failing later names a form field.
 */
function assertConsistent(object: ObjectMeta): void {
  const where = describe(object.ref)
  const columns = new Set<string>()
  for (const column of object.columns) {
    if (columns.has(column.name)) throw new Error(`${where}: column ${column.name} is reported twice`)
    columns.add(column.name)
    assertContractColumn(where, column)
  }
  for (const check of object.checks) {
    if (typeof (check.enforced as unknown) !== 'boolean') throw new Error(`${where}: check ${check.name} has no enforced flag`)
  }

  const keys = [...(object.primaryKey === null ? [] : [object.primaryKey]), ...object.uniqueKeys]
  for (const key of keys) {
    if (key.columns.length === 0) throw new Error(`${where}: key ${key.name} has no columns`)
    for (const name of key.columns) {
      if (!columns.has(name)) throw new Error(`${where}: key ${key.name} names ${name}, which the table does not have`)
    }
  }

  for (const foreignKey of object.foreignKeys) {
    if (foreignKey.columns.length === 0) throw new Error(`${where}: foreign key ${foreignKey.name} has no columns`)
    for (const name of foreignKey.columns) {
      if (!columns.has(name)) {
        throw new Error(`${where}: foreign key ${foreignKey.name} names ${name}, which the table does not have`)
      }
    }
    if (foreignKey.references !== null && foreignKey.references.columns.length !== foreignKey.columns.length) {
      throw new Error(
        `${where}: foreign key ${foreignKey.name} pairs ${String(foreignKey.columns.length)} columns with ${String(foreignKey.references.columns.length)}`,
      )
    }
  }
}

function sortObject(object: ObjectMeta): ObjectMeta {
  return {
    ...object,
    columns: [...object.columns].sort((a, b) => a.ordinal - b.ordinal),
    uniqueKeys: [...object.uniqueKeys].sort((a, b) => byCodepoint(a.name, b.name)),
    foreignKeys: [...object.foreignKeys].sort((a, b) => byCodepoint(a.name, b.name)),
    checks: [...object.checks].sort((a, b) => byCodepoint(a.name, b.name)),
  }
}

function sortGaps(gaps: readonly CoverageGap[]): CoverageGap[] {
  return [...gaps].sort(
    (a, b) =>
      byCodepoint(refKey(a.object), refKey(b.object)) || byCodepoint(a.aspect, b.aspect) || byCodepoint(a.detail, b.detail),
  )
}

/**
 * The one way a snapshot is made: sorted, checked and fingerprinted here, so
 * two adapters cannot disagree about order or hash.
 *
 * Every adapter returns its catalog through this rather than building a
 * `MetadataSnapshot` itself. If the PostgreSQL adapter sorted columns by name
 * and the SQL Server one by ordinal, the same table would fingerprint
 * differently on the two engines and nobody would find out until a drift
 * report disagreed with itself.
 *
 * The fingerprint is `@formancy/spec`'s canonical SHA-256 — the function
 * formancy hashes a form version with — over the kind, the objects and the
 * gaps. Reused rather than rewritten, because canonical JSON is exactly the
 * kind of thing that is subtly different the second time it is written.
 */
export function createSnapshot(input: Omit<MetadataSnapshot, 'fingerprint'>): MetadataSnapshot {
  const seen = new Set<string>()
  for (const object of input.objects) {
    const key = refKey(object.ref)
    if (seen.has(key)) throw new Error(`${describe(object.ref)} is reported twice`)
    seen.add(key)
    assertConsistent(object)
  }

  const objects = input.objects
    .map(sortObject)
    .sort((a, b) => byCodepoint(a.ref.schema, b.ref.schema) || byCodepoint(a.ref.name, b.ref.name))
  const gaps = sortGaps(input.gaps)
  const scope = { schemas: [...new Set(input.scope.schemas)].sort(byCodepoint) }

  return {
    kind: input.kind,
    serverVersion: input.serverVersion,
    scope,
    objects,
    gaps,
    fingerprint: schemaHash({ kind: input.kind, objects, gaps }),
  }
}

/** Whether this connection could establish everything in scope. */
export function isComplete(snapshot: MetadataSnapshot): boolean {
  return snapshot.gaps.length === 0
}

/** The object at `ref`, or `undefined`. */
export function findObject(snapshot: MetadataSnapshot, ref: ObjectRef): ObjectMeta | undefined {
  return snapshot.objects.find((object) => object.ref.schema === ref.schema && object.ref.name === ref.name)
}
