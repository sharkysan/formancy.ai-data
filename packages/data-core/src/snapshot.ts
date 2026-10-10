import { schemaHash } from '@formancy/spec'
import type {
  ColumnAccess,
  ColumnMeta,
  CoverageAspect,
  CoverageGap,
  CoverageSubject,
  Generation,
  MetadataSnapshot,
  ObjectMeta,
  ObjectRef,
  RowSecurity,
  TextLengthUnit,
} from './metadata.js'

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

function refKey(ref: ObjectRef): string {
  return `${ref.schema}\u0000${ref.name}`
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

/** Every `RowSecurity`, listed for the same reason. */
const ROW_SECURITIES: Readonly<Record<RowSecurity, true>> = { none: true, applies: true, unknown: true }

/** Every `CoverageAspect`, listed for the same reason. */
const ASPECTS: Readonly<Record<CoverageAspect, true>> = {
  objects: true,
  columns: true,
  keys: true,
  'foreign-keys': true,
  checks: true,
  defaults: true,
  comments: true,
  'row-security': true,
}

const CAPABILITIES: ReadonlyArray<keyof ColumnAccess> = ['select', 'insert', 'update']

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
  // 0027: a column without access is an adapter that forgot privileges, or a
  // snapshot stored before they were read. Either way nobody knows what the
  // account may do with it, and neither "nothing" nor "everything" is safe.
  const access = column.access as Partial<Record<keyof ColumnAccess, unknown>> | undefined
  if (typeof access !== 'object' || access === null) throw new Error(`${where}: column ${column.name} has no access; it was taken before 0027`)
  for (const capability of CAPABILITIES) {
    if (typeof access[capability] !== 'boolean') throw new Error(`${where}: column ${column.name} has an access ${capability} that is not a boolean`)
  }
}

function subjectKey(subject: CoverageSubject): string {
  switch (subject.kind) {
    case 'scope':
      return '0'
    case 'schema':
      return `1${subject.schema}`
    case 'object':
      return `2${refKey(subject.object)}`
  }
}

/** Whether a subject is one the contract names, with no name left empty. Read back from JSON, so nothing about its shape is assumed. */
function assertSubject(gap: CoverageGap): void {
  const subject = gap.subject as unknown
  if (subject === undefined) throw new Error('a gap has no subject; it was taken before 0027')
  if (!isListed(ASPECTS, gap.aspect)) throw new Error(`a gap's aspect ${JSON.stringify(gap.aspect)} is not one the contract names`)
  const shaped = (typeof subject === 'object' && subject !== null ? subject : {}) as Record<string, unknown>
  if (shaped['kind'] === 'scope') return
  if (shaped['kind'] === 'schema' && typeof shaped['schema'] === 'string') {
    if (shaped['schema'] === '') throw new Error('a gap names an empty schema')
    return
  }
  const object = shaped['object'] as Partial<ObjectRef> | undefined
  if (shaped['kind'] === 'object' && typeof object?.schema === 'string' && object.schema !== '' && typeof object.name === 'string' && object.name !== '') return
  throw new Error(`a gap's subject is not one the contract names: ${JSON.stringify(subject)}`)
}

/** Whether a gap is about `ref`: the whole scope, `ref`'s schema, or `ref` itself. */
export function gapCovers(gap: CoverageGap, ref: ObjectRef): boolean {
  const subject = gap.subject
  if (subject.kind === 'scope') return true
  if (subject.kind === 'schema') return subject.schema === ref.schema
  return subject.object.schema === ref.schema && subject.object.name === ref.name
}

/**
 * Row security is one of three answers, and "cannot tell" comes with the gap
 * that says why — about the scope, the object's schema or the object — or it
 * is an adapter that never looked, dressed as one that could not.
 */
function assertRowSecurity(object: ObjectMeta, gaps: readonly CoverageGap[]): void {
  const where = describe(object.ref)
  if (!isListed(ROW_SECURITIES, object.rowSecurity)) {
    throw new Error(`${where}: row security ${JSON.stringify(object.rowSecurity)} is not one the contract names`)
  }
  if (object.rowSecurity === 'unknown' && !gaps.some((gap) => gap.aspect === 'row-security' && gapCovers(gap, object.ref))) {
    throw new Error(`${where}: row security is unknown and no row-security gap covers it`)
  }
}

function assertAccount(input: Omit<MetadataSnapshot, 'fingerprint'>): void {
  const account = input.account as Partial<MetadataSnapshot['account']> | undefined
  if (typeof account !== 'object' || account === null) throw new Error('the snapshot names no account; it was taken before 0027')
  if (typeof account.user !== 'string' || account.user === '') throw new Error('the account names no user')
  if (typeof account.login !== 'string' || account.login === '') throw new Error('the account names no login')
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

/**
 * An object's columns, unique keys and foreign keys in the order a snapshot
 * holds them: columns by catalog position, keys by name in codepoint order.
 * `createSnapshot` sorts every object so, and an adapter's description of a
 * root (0041) is put in the same order, so the two read alike.
 */
export function inSnapshotOrder<T extends { columns: ReadonlyArray<{ ordinal: number }>; uniqueKeys: ReadonlyArray<{ name: string }>; foreignKeys: ReadonlyArray<{ name: string }> }>(object: T): T {
  return {
    ...object,
    columns: [...object.columns].sort((a, b) => a.ordinal - b.ordinal),
    uniqueKeys: [...object.uniqueKeys].sort((a, b) => byCodepoint(a.name, b.name)),
    foreignKeys: [...object.foreignKeys].sort((a, b) => byCodepoint(a.name, b.name)),
  }
}

function sortObject(object: ObjectMeta): ObjectMeta {
  return {
    ...inSnapshotOrder(object),
    checks: [...object.checks].sort((a, b) => byCodepoint(a.name, b.name)),
  }
}

/** Scope, then schema, then object — each by codepoint — then aspect, then detail. */
function sortGaps(gaps: readonly CoverageGap[]): CoverageGap[] {
  return [...gaps].sort(
    (a, b) => byCodepoint(subjectKey(a.subject), subjectKey(b.subject)) || byCodepoint(a.aspect, b.aspect) || byCodepoint(a.detail, b.detail),
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
 * formancy hashes a form version with — over the kind, the account's user,
 * the objects and the gaps. Reused rather than rewritten, because canonical
 * JSON is exactly the kind of thing that is subtly different the second time
 * it is written. The login and the server version are carried and not hashed
 * (0027): a login mapped to the same user is the same principal, and a patch
 * upgrade is not drift.
 *
 * A schema subject is not compared with `scope.schemas`: SQL Server matches
 * the scope by the database's collation, so `SALES` finds the schema the
 * catalog spells `sales`, and a gap carries the catalog's spelling as an
 * `ObjectRef` does.
 */
export function createSnapshot(input: Omit<MetadataSnapshot, 'fingerprint'>): MetadataSnapshot {
  const seen = new Set<string>()
  for (const object of input.objects) {
    const key = refKey(object.ref)
    if (seen.has(key)) throw new Error(`${describe(object.ref)} is reported twice`)
    seen.add(key)
    assertConsistent(object)
  }
  for (const gap of input.gaps) assertSubject(gap)
  for (const object of input.objects) assertRowSecurity(object, input.gaps)
  assertAccount(input)

  const objects = input.objects
    .map(sortObject)
    .sort((a, b) => byCodepoint(a.ref.schema, b.ref.schema) || byCodepoint(a.ref.name, b.ref.name))
  const gaps = sortGaps(input.gaps)
  const scope = { schemas: [...new Set(input.scope.schemas)].sort(byCodepoint) }

  const account = { user: input.account.user, login: input.account.login }

  return {
    kind: input.kind,
    serverVersion: input.serverVersion,
    account,
    scope,
    objects,
    gaps,
    fingerprint: schemaHash({ kind: input.kind, account: account.user, objects, gaps }),
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
