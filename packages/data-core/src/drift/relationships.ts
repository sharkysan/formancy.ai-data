import type { FieldBinding } from '../generate/types.js'
import type { CheckMeta, CoverageAspect, ForeignKeyMeta, ForeignKeyTarget, KeyMeta, ObjectMeta } from '../metadata.js'
import { findObject } from '../snapshot.js'
import { absence, cite, hiding, unseen } from './access.js'
import { typeDifference } from './compare.js'
import {
  candidateKeys,
  type Comparison,
  describe,
  type Draft,
  fieldsOver,
  foreignKeyIn,
  identityKeyIn,
  list,
  lookups,
  objectIn,
  sameList,
  sameRef,
  sameSet,
} from './context.js'
import type { DriftKind, DriftSubject } from './types.js'

/*
 * The relationships a form rests on — the key that identifies a record, and
 * the foreign key, target key, target table and display columns behind each
 * lookup — and the root's other constraints, which it does not.
 *
 * Three families, because the runtime compares only the first (0041): the
 * root's own relationships, which a request's description of the root holds;
 * what lies past each lookup's foreign key, in another table; and the root's
 * checks, which are information only.
 */

type Lookup = Extract<FieldBinding, { kind: 'lookup' }>

/** A change about something with a name: a column, a key, a foreign key or a check. */
type NamedDraft = Draft & { subject: Extract<DriftSubject, { name: string }> }

/** The root's own: the identity's key, each lookup's own foreign key, and the root's keys and foreign keys nothing rests on. */
export function rootRelationshipChanges(comparison: Comparison): Draft[] {
  const identity = identityChanges(comparison)
  const reported = new Set(identity.map((draft) => draft.subject.name))
  const used = new Set(lookups(comparison.bindings).map((lookup) => lookup.foreignKey))
  return [
    ...identity,
    ...lookups(comparison.bindings).flatMap((lookup) => lookupKeyChanges(comparison, lookup)),
    ...keyChanges(comparison, reported),
    ...foreignKeyChanges(comparison, used),
  ]
}

/** The far side of every lookup whose own foreign key is unchanged: its target, the key it points at, its display and filter columns. */
export function lookupTargetChanges(comparison: Comparison): Draft[] {
  return lookups(comparison.bindings)
    .filter((lookup) => ownKeyUnchanged(comparison, lookup))
    .flatMap((lookup) => targetChanges(comparison, lookup, blockedBy(lookup)))
}

/**
 * Update finds "this record" by the identity's columns. While some primary or
 * unique key still covers exactly them, a rename or a second key changes
 * nothing; when none does, one update could change two rows.
 */
function identityChanges(comparison: Comparison): NamedDraft[] {
  const { bindings, before, after } = comparison
  if (bindings.identity === null) return []
  const key = identityKeyIn(before, bindings.identity)
  if (candidateKeys(after).some((candidate) => sameList(candidate.columns, key.columns))) return []

  const shared = { subject: { kind: 'key', object: after.ref, name: key.name } as const, affects: fieldsOver(bindings, key.columns), stops: ['update'] as const, breaksReads: false, otherwise: 'info' as const }
  const gaps = hiding(comparison.current.gaps, after.ref, 'keys')
  if (gaps.length > 0) {
    return [cite(comparison, gaps, { ...shared, kind: 'access-narrowed', message: unseen(`Key ${key.name} of ${describe(after.ref)}`, gaps) })]
  }
  const now = candidateKeys(after).find((candidate) => candidate.name === key.name)
  return [
    {
      ...shared,
      kind: 'identity-key-changed',
      message: `${now === undefined ? `${key.name} is gone` : `${key.name} is over (${list(now.columns)}) where it was over (${list(key.columns)})`}, and no key covers (${list(key.columns)}) any more. Update finds a record by those columns, so it is blocked until the form is reviewed.`,
    },
  ]
}

/**
 * One property of a constraint: what it is called, how a person reads it, and
 * whether two are the same. Sameness is decided on the values and never on the
 * reading: a schema or a table may contain a dot and a column a comma, so
 * schema a.b's table c and schema a's table b.c both read a.b.c, for the
 * reason `ObjectRef` is two strings.
 */
type Property<T> = [label: string, show: (item: T) => string, same: (before: T, after: T) => boolean]

function sameTarget(before: ForeignKeyTarget | null, after: ForeignKeyTarget | null): boolean {
  return before === null || after === null ? before === after : sameRef(before.table, after.table) && sameList(before.columns, after.columns)
}

/** Each property of a foreign key. Every one counts behind a lookup. */
const FOREIGN_KEY: ReadonlyArray<Property<ForeignKeyMeta>> = [
  ['its columns', (key) => `(${list(key.columns)})`, (was, now) => sameList(was.columns, now.columns)],
  [
    'its target',
    (key) => (key.references === null ? 'not visible' : `${describe(key.references.table)} (${list(key.references.columns)})`),
    (was, now) => sameTarget(was.references, now.references),
  ],
  ['on update', (key) => key.onUpdate, (was, now) => was.onUpdate === now.onUpdate],
  ['on delete', (key) => key.onDelete, (was, now) => was.onDelete === now.onDelete],
  ['enforcement', (key) => (key.enforced ? 'enforced' : 'not enforced'), (was, now) => was.enforced === now.enforced],
  ['validation', (key) => (key.validated ? 'validated' : 'not validated'), (was, now) => was.validated === now.validated],
]

const CHECK: ReadonlyArray<Property<CheckMeta>> = [
  ['expression', (check) => check.expression ?? 'not readable', (was, now) => was.expression === now.expression],
  // A disabled SQL Server check is also untrusted; without this it read like a WITH NOCHECK one (0026).
  ['enforcement', (check) => (check.enforced ? 'enforced' : 'not enforced'), (was, now) => was.enforced === now.enforced],
  ['validation', (check) => (check.validated ? 'validated' : 'not validated'), (was, now) => was.validated === now.validated],
]

const KEY: ReadonlyArray<Property<KeyMeta & { primary: boolean }>> = [
  ['its columns', (key) => `(${list(key.columns)})`, (was, now) => sameList(was.columns, now.columns)],
  ['its role', (key) => (key.primary ? 'primary' : 'unique'), (was, now) => was.primary === now.primary],
]

function differences<T>(properties: ReadonlyArray<Property<T>>, before: T, after: T): string[] {
  return properties.flatMap(([label, show, same]) => (same(before, after) ? [] : [`${label} from ${show(before)} to ${show(after)}`]))
}

/** What a change behind a lookup does, whichever side of its foreign key it is on: the lookup is blocked. */
function blockedBy(lookup: Lookup): Pick<Draft, 'affects' | 'stops' | 'breaksReads' | 'otherwise'> {
  return { affects: [lookup.field], stops: [], breaksReads: true, otherwise: 'review' }
}

/** The lookup's foreign key as it is now, visible with its target and with every property it had: the one test both families decide by. */
function ownKeyUnchanged(comparison: Comparison, lookup: Lookup): boolean {
  const now = comparison.after.foreignKeys.find((candidate) => candidate.name === lookup.foreignKey)
  return now !== undefined && now.references !== null && differences(FOREIGN_KEY, foreignKeyIn(comparison.before, lookup.foreignKey), now).length === 0
}

/**
 * Plan section 14: a changed foreign key or candidate key behind a lookup
 * requires relationship review. Whatever moved, the lookup is blocked: a
 * selection would store a key that means something else, or one the lookup can
 * no longer resolve. This is the root's side of it; what lies past an
 * unchanged key is `lookupTargetChanges`'.
 */
function lookupKeyChanges(comparison: Comparison, lookup: Lookup): Draft[] {
  if (ownKeyUnchanged(comparison, lookup)) return []
  const { before, after } = comparison
  const blocked = blockedBy(lookup)
  const subject: DriftSubject = { kind: 'foreign-key', object: after.ref, name: lookup.foreignKey }
  const was = foreignKeyIn(before, lookup.foreignKey)
  const now = after.foreignKeys.find((candidate) => candidate.name === lookup.foreignKey)

  if (now === undefined || now.references === null) {
    const gaps = hiding(comparison.current.gaps, after.ref, 'foreign-keys')
    // A key reported with no target says by itself that the target is out of sight (0004).
    if (now !== undefined || gaps.length > 0) {
      return [cite(comparison, gaps, { ...blocked, kind: 'access-narrowed', subject, message: unseen(now === undefined ? `Foreign key ${lookup.foreignKey} of ${describe(after.ref)}` : `What ${lookup.foreignKey} references`, gaps) })]
    }
    return [{ ...blocked, kind: 'lookup-changed', subject, message: `${lookup.foreignKey} is gone, and the ${lookup.field} lookup selects through it. The lookup is blocked until the form is reviewed.` }]
  }

  const changed = differences(FOREIGN_KEY, was, now)
  return [{ ...blocked, kind: 'lookup-changed', subject, message: `${lookup.foreignKey} changed: ${changed.join('; ')}. The ${lookup.field} lookup selects through it, so it is blocked until the form is reviewed.` }]
}

/** The far side of an unchanged foreign key: the target table, the key it points at, and the display columns. */
function targetChanges(comparison: Comparison, lookup: Lookup, blocked: Pick<Draft, 'affects' | 'stops' | 'breaksReads' | 'otherwise'>): Draft[] {
  const ref = lookup.target.table
  const where = describe(ref)
  const target = findObject(comparison.current, ref)
  if (target === undefined) {
    const subject: DriftSubject = { kind: 'object', object: ref }
    const absent = absence(comparison.current, ref)
    if (absent.why === 'scope') {
      return [{ ...blocked, kind: 'scope-narrowed', subject, message: `${where}, the target of the ${lookup.field} lookup, is outside the discovery scope: ${ref.schema} is no longer approved, so the lookup cannot be checked. It is blocked until the scope is restored or the form is reviewed.` }]
    }
    if (absent.why === 'access') {
      return [cite(comparison, absent.gaps, { ...blocked, kind: 'access-narrowed', subject, message: unseen(where, absent.gaps) })]
    }
    return [{ ...blocked, kind: 'lookup-changed', subject, message: `${where}, the target of the ${lookup.field} lookup, is gone. The lookup is blocked until the form is reviewed.` }]
  }

  const drafts: Draft[] = []
  const lost = (subject: DriftSubject, aspect: CoverageAspect, thing: string, gone: string) => {
    const gaps = hiding(comparison.current.gaps, ref, aspect)
    drafts.push(
      gaps.length > 0
        ? cite(comparison, gaps, { ...blocked, kind: 'access-narrowed', subject, message: unseen(thing, gaps) })
        : { ...blocked, kind: 'lookup-changed', subject, message: `${gone} The ${lookup.field} lookup rests on it, so it is blocked until the form is reviewed.` },
    )
  }

  // The base may not have seen the target's keys; a key it never saw cannot have been lost.
  const covers = (object: ObjectMeta) => candidateKeys(object).find((key) => sameSet(key.columns, lookup.target.columns))
  const key = covers(objectIn(comparison.base, ref))
  if (key !== undefined && covers(target) === undefined) {
    lost({ kind: 'key', object: ref, name: key.name }, 'keys', `Key ${key.name} of ${where}`, `No key of ${where} covers (${list(lookup.target.columns)}) any more; ${key.name} did.`)
  }
  for (const name of lookup.display) {
    if (!target.columns.some((column) => column.name === name)) {
      lost({ kind: 'column', object: ref, name }, 'columns', `Column ${name} of ${where}`, `${name} of ${where} is gone, and the lookup shows it.`)
    }
  }
  const filtered = filterColumns(comparison, lookup)
  for (const name of filtered) {
    if (!target.columns.some((column) => column.name === name)) {
      lost({ kind: 'column', object: ref, name }, 'columns', `Column ${name} of ${where}`, `${name} of ${where} is gone, and the lookup's row filter compares it.`)
    }
  }
  return [...drafts, ...retypedColumns(comparison, lookup, target, filtered, blocked)]
}

/** The target columns the policy's filter on this lookup compares, as the published policy names them. */
function filterColumns(comparison: Comparison, lookup: Lookup): string[] {
  const { lookups: rules } = comparison.policy
  const given: unknown = Object.hasOwn(rules, lookup.field) ? rules[lookup.field] : []
  const names = Array.isArray(given) ? given.map((rule: unknown) => (rule as { column?: unknown } | null)?.column) : []
  return [...new Set(names.filter((name): name is string => typeof name === 'string'))]
}

/**
 * A lookup reads its target's key, display and row filter columns by the
 * types the published snapshot gives them (0028): a key is encoded and
 * checked, a label decoded and spelled, a filter value checked and bound,
 * each by that type. A column whose type is now another — in any direction —
 * is read by the wrong reader: a display column that became a bit labelled
 * every row through its old reader, and a filter column that became varchar
 * failed every search. Each blocks the lookup until the form is reviewed and
 * published again from the snapshot as it is.
 */
function retypedColumns(comparison: Comparison, lookup: Lookup, target: ObjectMeta, filtered: readonly string[], blocked: Pick<Draft, 'affects' | 'stops' | 'breaksReads' | 'otherwise'>): Draft[] {
  const before = objectIn(comparison.base, lookup.target.table)
  const uses = new Map<string, string[]>()
  const use = (names: readonly string[], role: string) => {
    for (const name of names) uses.set(name, [...(uses.get(name) ?? []), role])
  }
  use(lookup.target.columns, 'key')
  use(lookup.display, 'label')
  use(filtered, 'row filter')

  const drafts: Draft[] = []
  for (const [name, roles] of uses) {
    const was = before.columns.find((column) => column.name === name)
    const now = target.columns.find((column) => column.name === name)
    const difference = was === undefined || now === undefined ? null : typeDifference(was, now)
    if (difference === null) continue
    drafts.push({
      ...blocked,
      kind: 'lookup-changed',
      subject: { kind: 'column', object: target.ref, name },
      message: `${name} of ${describe(target.ref)}: ${difference}. The ${lookup.field} lookup reads it as its ${roles.join(' and ')} by the type it was published with, so it is blocked until the form is reviewed.`,
    })
  }
  return drafts
}

interface Unbound<T> {
  kind: Extract<DriftKind, 'key-changed' | 'foreign-key-changed' | 'check-changed'>
  subject: 'key' | 'foreign-key' | 'check'
  aspect: CoverageAspect
  properties: ReadonlyArray<Property<T>>
  columns: (item: T) => string[]
  added: (item: T) => string
  /** What the form has to do with it: nothing, said in a way that fits the kind. */
  tail: string
}

/**
 * Constraints of the root the form does not rest on, by name: added, gone or
 * changed, and only ever noted. The database enforces them, and a save one
 * refuses fails with the database's error. One that vanished behind a gap is
 * left to the gap, which is reported on its own.
 */
function unboundChanges<T extends { name: string }>(comparison: Comparison, before: readonly T[], after: readonly T[], skip: ReadonlySet<string>, rules: Unbound<T>): Draft[] {
  const root = comparison.after.ref
  const hidden = hiding(comparison.current.gaps, root, rules.aspect).length > 0
  const note = (item: T, message: string): Draft => ({
    kind: rules.kind,
    subject: { kind: rules.subject, object: root, name: item.name },
    affects: fieldsOver(comparison.bindings, rules.columns(item)),
    stops: [],
    breaksReads: false,
    otherwise: 'info',
    message: `${message} ${rules.tail}`,
  })

  const drafts: Draft[] = []
  for (const was of before) {
    if (skip.has(was.name)) continue
    const now = after.find((item) => item.name === was.name)
    if (now === undefined) {
      if (!hidden) drafts.push(note(was, `${was.name} is gone.`))
      continue
    }
    const changed = differences(rules.properties, was, now)
    if (changed.length > 0) drafts.push(note(now, `${was.name} changed: ${changed.join('; ')}.`))
  }
  for (const now of after) {
    if (!skip.has(now.name) && !before.some((item) => item.name === now.name)) drafts.push(note(now, rules.added(now)))
  }
  return drafts
}

function keysOf(object: ObjectMeta): Array<KeyMeta & { primary: boolean }> {
  return [...(object.primaryKey === null ? [] : [{ ...object.primaryKey, primary: true }]), ...object.uniqueKeys.map((key) => ({ ...key, primary: false }))]
}

function keyChanges(comparison: Comparison, reported: ReadonlySet<string>): Draft[] {
  return unboundChanges(comparison, keysOf(comparison.before), keysOf(comparison.after), reported, {
    kind: 'key-changed',
    subject: 'key',
    aspect: 'keys',
    properties: KEY,
    columns: (key) => key.columns,
    added: (key) => `${key.name} is a new ${key.primary ? 'primary' : 'unique'} key over (${list(key.columns)}); the database will refuse a save that duplicates it.`,
    tail: 'The identity does not rest on it.',
  })
}

function foreignKeyChanges(comparison: Comparison, used: ReadonlySet<string>): Draft[] {
  return unboundChanges(comparison, comparison.before.foreignKeys, comparison.after.foreignKeys, used, {
    kind: 'foreign-key-changed',
    subject: 'foreign-key',
    aspect: 'foreign-keys',
    properties: FOREIGN_KEY,
    columns: (key) => key.columns,
    added: (key) => `${key.name} is a new foreign key over (${list(key.columns)}); it could be offered as a lookup.`,
    tail: 'No lookup of this form uses it.',
  })
}

/** The root's checks: information only, and a family of its own, which the runtime does not compare (0041). */
export function checkChanges(comparison: Comparison): Draft[] {
  return unboundChanges(comparison, comparison.before.checks, comparison.after.checks, new Set(), {
    kind: 'check-changed',
    subject: 'check',
    aspect: 'checks',
    properties: CHECK,
    columns: () => [],
    added: (check) => `${check.name} is a new check.`,
    tail: 'The form does not translate checks; the database enforces them, with its own error.',
  })
}
