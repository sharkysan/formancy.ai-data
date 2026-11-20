import type { CheckMeta, ColumnMeta, CoverageGap, InboundKey, MetadataSnapshot, NormalizedType, ObjectMeta, ObjectRef, RoutineMeta } from '@formancy/data-core'
import { describeRoutine, findObject, gapCovers } from '@formancy/data-core'
import { checkListOf, domainListOf } from './check-lists.js'
import type {
  ExpectedCheck,
  ExpectedCheckFacts,
  ExpectedColumn,
  ExpectedColumnFacts,
  ExpectedDomain,
  ExpectedObject,
  ExpectedRoutine,
  ExpectedRoutineFacts,
  ExpectedType,
  FixtureAccount,
} from './model.js'
import { FIXTURE_MODEL, FIXTURE_ROUTINES } from './model.js'

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
      if (before0049 === null && !admitsReferrers)
        out.push(`${wanted.name} of ${name(wanted.table)} refers to sales.order, and is missing with no gap that says the reader cannot see it`)
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
    if (found.columns.join() !== foreignKey.columns.join())
      out.push(`${at} columns are [${found.columns.join(', ')}], expected [${foreignKey.columns.join(', ')}]`)
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
    if (facts.enforced !== undefined && found.enforced !== facts.enforced)
      out.push(`${at} enforced is ${String(found.enforced)}, expected ${String(facts.enforced)}`)
    if (facts.validated !== undefined && found.validated !== facts.validated)
      out.push(`${at} validated is ${String(found.validated)}, expected ${String(facts.validated)}`)
    if (facts.listed !== undefined) out.push(...listDisagreements(found, facts.listed, kind, at))
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
      .map((foreignKey) => ({
        table: referrer.ref,
        name: foreignKey.name,
        columns: foreignKey.columns,
        referencedColumns: foreignKey.references.columns,
        onDelete: foreignKey.onDelete,
      })),
  )
}

/** The sentence for an object that says nothing about deleting, or `null` when it says both things 0049 records. */
function deleteFactsMissing(actual: ObjectMeta): string | null {
  return actual.access === undefined || actual.referencedBy === undefined ? `${name(actual.ref)} says nothing about deleting; it was taken before 0049` : null
}

function inboundDisagreements(found: InboundKey, wanted: ExpectedReferrer, at: string): string[] {
  const out: string[] = []
  if (found.columns.join() !== wanted.columns.join()) out.push(`${at} columns are [${found.columns.join(', ')}], expected [${wanted.columns.join(', ')}]`)
  if (found.referencedColumns.join() !== wanted.referencedColumns.join())
    out.push(`${at} refers to [${found.referencedColumns.join(', ')}], expected [${wanted.referencedColumns.join(', ')}]`)
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
  if ([...listed].sort(byCodepoint).join('\u0000') !== expected.join('\u0000'))
    return [`${where} is referred to by [${listed.join(', ')}], expected [${expected.join(', ')}]`]
  return wanted.flatMap((key) => {
    const reported = found.find((candidate) => candidate.name === key.name && same(candidate.table, key.table))
    return reported === undefined ? [] : inboundDisagreements(reported, key, `${where} ${key.name} of ${name(key.table)}`)
  })
}

/** How a type differs from the model's, for a column and for a routine's parameter alike. */
function typeDisagreements(actual: { type: NormalizedType; databaseType: string }, expected: ExpectedType, where: string): string[] {
  // A different kind is one finding. Listing every property the other kind
  // lacks would bury it under consequences.
  if (actual.type.kind !== expected.kind)
    return [`${where} type kind is ${JSON.stringify(actual.type.kind)}, expected ${JSON.stringify(expected.kind)} (database type ${actual.databaseType})`]
  const type = actual.type as unknown as Record<string, unknown>
  // An enum's name and labels are an object and a list (0170): compared as JSON, in order.
  return Object.entries(expected)
    .filter(([property, value]) =>
      typeof value === 'object' && value !== null ? JSON.stringify(type[property]) !== JSON.stringify(value) : type[property] !== value,
    )
    .map(
      ([property, value]) =>
        `${where} type ${property} is ${JSON.stringify(type[property])}, expected ${JSON.stringify(value)} (database type ${actual.databaseType})`,
    )
}

function columnDisagreements(actual: ColumnMeta, expected: ExpectedColumnFacts, where: string): string[] {
  const out: string[] = expected.type === undefined ? [] : typeDisagreements(actual, expected.type, where)
  if (expected.nullable !== undefined && actual.nullable !== expected.nullable)
    out.push(`${where} nullable is ${String(actual.nullable)}, expected ${String(expected.nullable)}`)
  if (expected.generated !== undefined && actual.generated !== expected.generated)
    out.push(`${where} generated is ${actual.generated}, expected ${expected.generated}`)
  if (expected.hasDefault !== undefined && actual.hasDefault !== expected.hasDefault)
    out.push(`${where} hasDefault is ${String(actual.hasDefault)}, expected ${String(expected.hasDefault)}`)
  out.push(...domainDisagreements(actual, expected.domains, where))
  return out
}

/**
 * Whether a column's domains are the model's (0170): none where it names
 * none -- not even an empty list --, and otherwise each, outermost first, by
 * name, with its checks by name, each check's flags where the model pins
 * them, and data-core's reading of each as this engine spelled it.
 */
function domainDisagreements(actual: ColumnMeta, expected: readonly ExpectedDomain[] | undefined, where: string): string[] {
  if (expected === undefined)
    return actual.domains === undefined ? [] : [`${where} has domains [${actual.domains.map((domain) => name(domain.ref)).join(', ')}], expected none`]
  const found = actual.domains ?? []
  const names = found.map((domain) => name(domain.ref)).join(', ')
  const wanted = expected.map((domain) => name(domain.ref)).join(', ')
  if (names !== wanted) return [`${where} domains are [${names}], expected [${wanted}]`]
  return expected.flatMap((domain, index) => {
    const reported = (found[index] as NonNullable<ColumnMeta['domains']>[number]).checks
    const at = `${where} domain ${name(domain.ref)}`
    const checks = reported.map((check) => check.name).join(', ')
    const wantedChecks = domain.checks.map((check) => check.name).join(', ')
    if (checks !== wantedChecks) return [`${at} checks are [${checks}], expected [${wantedChecks}]`]
    return domain.checks.flatMap((check, position) => {
      const read = reported[position] as CheckMeta
      const out: string[] = []
      if (check.enforced !== undefined && read.enforced !== check.enforced)
        out.push(`${at} ${check.name} enforced is ${String(read.enforced)}, expected ${String(check.enforced)}`)
      if (check.validated !== undefined && read.validated !== check.validated)
        out.push(`${at} ${check.name} validated is ${String(read.validated)}, expected ${String(check.validated)}`)
      if (check.listed !== undefined) {
        const values = domainListOf(read)
        const said = (list: readonly string[] | null) => (list === null ? 'no list' : `[${list.join(', ')}]`)
        if (JSON.stringify(values) !== JSON.stringify(check.listed))
          out.push(`${at} ${check.name} reads as ${said(values)} from ${JSON.stringify(read.expression)}, expected ${said(check.listed)}`)
      }
      return out
    })
  })
}

/**
 * Whether data-core reads the list the model says out of the check as this
 * engine spelled it (0152): the spelling is the adapter's, the reading
 * data-core's, and the form one model generates on both engines rests on
 * the two agreeing. Values as a set, in codepoint order, each once.
 */
function listDisagreements(found: CheckMeta, expected: ExpectedCheckFacts['listed'], kind: MetadataSnapshot['kind'], at: string): string[] {
  if (found.expression === null) return [`${at} expression cannot be read, so whether it lists values is unknown`]
  const actual = checkListOf(kind, found)
  const said = (list: typeof actual) => (list === null ? 'no list' : `${list.column} in [${list.values.join(', ')}]`)
  const wanted = expected === undefined || expected === null ? null : { column: expected.column, values: [...expected.values] }
  return JSON.stringify(actual) === JSON.stringify(wanted)
    ? []
    : [`${at} reads as ${said(actual)} from ${JSON.stringify(found.expression)}, expected ${said(wanted)}`]
}

/**
 * How a snapshot's routines differ from the model's (0158), discovered as
 * `account`, as sentences, one per difference.
 *
 * Every routine the model gives this engine is reported with the model's
 * facts and whether this account may execute it -- or, for an account that
 * is not the owner, is absent behind a `routines` gap that covers it: say
 * the right thing or say you cannot tell (0004). Never missing with nothing
 * said, which reads as a routine that does not exist; and never missing at
 * all where the model says the account may execute it, gap or not: SQL
 * Server lists a routine to an account that holds EXECUTE on it (0158, R3),
 * and PostgreSQL every routine to every role, so a gap covering one would
 * be an adapter hiding what it was shown. A routine the model
 * does not have is one from nowhere, and a snapshot whose scope did not ask
 * for routines says nothing about any. The owner sees every routine, so a
 * `routines` gap on its snapshot is an adapter that failed to read what it
 * could.
 */
export function routineDisagreements(
  snapshot: MetadataSnapshot,
  account: FixtureAccount = 'owner',
  model: readonly ExpectedRoutine[] = FIXTURE_ROUTINES,
): string[] {
  const routines = snapshot.routines
  if (routines === undefined) return ['the snapshot records no routines: its scope did not ask for them']
  const expected = model.flatMap((entry) => {
    const facts = entry.byKind[snapshot.kind]
    return facts === undefined ? [] : [{ entry, facts, ref: { ...entry.ref, signature: facts.signature } }]
  })
  const named = (routine: RoutineMeta, ref: RoutineMeta['ref']) => same(routine.ref, ref) && routine.ref.signature === ref.signature
  const out = routines
    .filter((routine) => !expected.some(({ ref }) => named(routine, ref)))
    .map((routine) => `${describeRoutine(routine.ref)} is reported and the model has no such routine`)
  for (const { entry, facts, ref } of expected) {
    const found = routines.find((routine) => named(routine, ref))
    if (found !== undefined) out.push(...routineFacts(found, entry, facts, account))
    else if (account === 'owner') out.push(`${describeRoutine(ref)} is missing`)
    else if (entry.executable[account]) out.push(`${describeRoutine(ref)} is missing, and the ${account} may execute it, which lists it`)
    else if (!snapshot.gaps.some((gap) => gap.aspect === 'routines' && gapCovers(gap, entry.ref)))
      out.push(`${describeRoutine(ref)} is missing, and no gap says the ${account} cannot see it`)
  }
  if (account === 'owner') {
    for (const gap of snapshot.gaps) if (gap.aspect === 'routines') out.push(`unexpected gap on ${placeOf(gap)} (routines): ${gap.detail}`)
  }
  return out
}

function routineFacts(found: RoutineMeta, entry: ExpectedRoutine, facts: ExpectedRoutineFacts, account: FixtureAccount): string[] {
  const where = describeRoutine(found.ref)
  const out: string[] = []
  const compare = (what: string, actual: unknown, wanted: unknown) => {
    if (actual !== wanted) out.push(`${where} ${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`)
  }
  compare('kind', found.kind, facts.kind)
  compare('reach', found.reach, facts.reach)
  compare('effects', found.effects, entry.effects)
  compare('returns', found.returns, entry.returns)
  // Absent is a discovery that did not read it (0167): the model says, so absent is a disagreement.
  compare('onNull', found.onNull ?? null, entry.onNull)
  compare(`executable as the ${account}`, found.executable, entry.executable[account])
  const names = found.parameters.map((parameter) => parameter.name)
  if (names.join('\u0000') !== facts.names.join('\u0000')) out.push(`${where} parameters are [${names.join(', ')}], expected [${facts.names.join(', ')}]`)
  entry.parameters.forEach((wanted, index) => {
    const parameter = found.parameters[index]
    if (parameter === undefined) return
    const at = `${where} parameter ${parameter.name}`
    compare(`parameter ${parameter.name} mode`, parameter.mode, wanted.mode)
    compare(`parameter ${parameter.name} hasDefault`, parameter.hasDefault, facts.defaults[index])
    out.push(...typeDisagreements(parameter, wanted.type, at))
  })
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
