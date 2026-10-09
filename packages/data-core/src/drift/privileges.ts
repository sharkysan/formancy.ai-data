import type { FormBindings } from '../generate/types.js'
import type { ColumnAccess, ColumnMeta, MetadataSnapshot, ObjectMeta, ObjectRef, RowSecurity } from '../metadata.js'
import { findObject } from '../snapshot.js'
import { allFields, type Comparison, describe, type Draft, fieldsOver, list, lookups, type Operation, objectIn, sameRef, writesOn } from './context.js'

/*
 * What a change in what the account may do means for one form (0027).
 *
 * Before 0027 a revoked grant made a table or a column vanish from a
 * privilege-filtered catalog, and only a gap told that apart from a drop. The
 * snapshot now describes what the account may do, column by column, and
 * whether row security applies to it; this compares the two, for the root and
 * each lookup's target, and says what each change stops. A column that is
 * gone is the column suites' business; one that is there and may no longer be
 * read is this file's.
 */

const CAPABILITIES: ReadonlyArray<keyof ColumnAccess> = ['select', 'insert', 'update']

/** The capabilities as the statements that need them, for a person reading the report. */
function spelled(capabilities: ReadonlyArray<keyof ColumnAccess>): string {
  return capabilities.map((capability) => capability.toUpperCase()).join(' or ')
}

/** Why a lost capability matters to this form: what it stops, and why, said once per reason. */
interface Consequence {
  stops: Set<Operation>
  breaksReads: boolean
  affects: Set<string>
  reasons: string[]
}

/** What losing `lost` on a root column does to the form: the drift table of 0027, row by row. */
function onRoot(bindings: FormBindings, column: ColumnMeta, lost: ReadonlySet<keyof ColumnAccess>, into: Consequence): void {
  const fields = fieldsOver(bindings, [column.name])
  const add = (reason: string, fieldsToo: boolean) => {
    into.reasons.push(reason)
    if (fieldsToo) for (const field of fields) into.affects.add(field)
  }
  const concurrency = bindings.concurrency
  const token = concurrency?.column === column.name
  if (lost.has('select')) {
    if (fields.length > 0) {
      into.breaksReads = true
      add(`The form reads it as ${list(fields)}, so every read fails.`, true)
    }
    if (bindings.identity?.includes(column.name) === true) {
      into.breaksReads = true
      add('It identifies a record, so no record can be read back or addressed.', true)
    }
    // Both adapters read a confirmed token with every record and return it
    // from every create (PostgreSQL's RETURNING, SQL Server's OUTPUT), so
    // losing SELECT on it fails reads and creates alike, not only updates. A
    // suggested one is named by no statement until it is confirmed.
    if (token && concurrency.confirmed) {
      into.breaksReads = true
      add("It is the form's concurrency token, read with every record and returned by every create, so every read and every write fails.", false)
    }
  }
  if (lost.has('update')) {
    if (token && concurrency?.kind === 'version-column') {
      into.stops.add('update')
      add('Every update writes it as the version column, so update is blocked.', false)
    }
    if (writesOn(bindings, column.name, 'update')) {
      into.stops.add('update')
      add(`The form writes it on update as ${list(fields)}, so update is blocked.`, true)
    }
  }
  if (lost.has('insert')) {
    if (writesOn(bindings, column.name, 'create')) {
      into.stops.add('create')
      add(`The form writes it on create as ${list(fields)}, so create is blocked.`, true)
    } else if (fields.length > 0 && column.generated === 'none') {
      // Bindings do not record which columns a policy pins and writes from
      // context on create, so a bound column is assumed to be one: blocking
      // more than needed, rather than a create the database refuses.
      into.stops.add('create')
      add('The form binds it, and a policy may write it from the trusted context on create, so create is blocked until the form is reviewed.', true)
    }
  }
}

/** What losing SELECT on a lookup target's column does: every search reads its key and its display columns. */
function onTarget(bindings: FormBindings, target: ObjectRef, column: ColumnMeta, lost: ReadonlySet<keyof ColumnAccess>, into: Consequence): void {
  if (!lost.has('select')) return
  const users = lookups(bindings).filter(
    (lookup) => sameRef(lookup.target.table, target) && (lookup.target.columns.includes(column.name) || lookup.display.includes(column.name)),
  )
  if (users.length === 0) return
  into.stops.add('create')
  into.stops.add('update')
  for (const lookup of users) into.affects.add(lookup.field)
  into.reasons.push(`${list(users.map((lookup) => lookup.field))} ${users.length === 1 ? 'reads' : 'read'} it on every search, so a selection can be neither offered nor rechecked, and writes are blocked.`)
}

/** The root, then each lookup's target once, as they were and as they are; a target no longer there is the relationship suites' business. */
function comparedObjects(comparison: Comparison): Array<{ before: ObjectMeta; after: ObjectMeta }> {
  const pairs = [{ before: comparison.before, after: comparison.after }]
  for (const lookup of lookups(comparison.bindings)) {
    const ref = lookup.target.table
    if (pairs.some((pair) => sameRef(pair.before.ref, ref))) continue
    const after = findObject(comparison.current, ref)
    if (after !== undefined) pairs.push({ before: objectIn(comparison.base, ref), after })
  }
  return pairs
}

function columnDrafts(comparison: Comparison, before: ObjectMeta, after: ObjectMeta): Draft[] {
  const { bindings } = comparison
  const isRoot = sameRef(before.ref, bindings.root)
  const drafts: Draft[] = []
  for (const was of before.columns) {
    const is = after.columns.find((column) => column.name === was.name)
    if (is === undefined) continue
    const subject = { kind: 'column', object: after.ref, name: is.name } as const
    const lost = CAPABILITIES.filter((capability) => was.access[capability] && !is.access[capability])
    const gained = CAPABILITIES.filter((capability) => !was.access[capability] && is.access[capability])
    if (lost.length > 0) {
      const consequence: Consequence = { stops: new Set(), breaksReads: false, affects: new Set(), reasons: [] }
      if (isRoot) onRoot(bindings, is, new Set(lost), consequence)
      onTarget(bindings, after.ref, is, new Set(lost), consequence)
      const matters = consequence.reasons.length > 0
      drafts.push({
        kind: 'privilege-narrowed',
        subject,
        affects: allFields(bindings).filter((field) => consequence.affects.has(field)),
        stops: [...consequence.stops],
        breaksReads: consequence.breaksReads,
        otherwise: matters ? 'review' : 'info',
        message: `This connection's account may no longer ${spelled(lost)} ${is.name} of ${describe(after.ref)}. ${
          matters ? consequence.reasons.join(' ') : 'Nothing this form does rests on it.'
        } This is a privilege change, not a schema change: restore the grant, or review the form.`,
      })
    }
    if (gained.length > 0) {
      drafts.push({
        kind: 'privilege-widened',
        subject,
        affects: [],
        stops: [],
        breaksReads: false,
        otherwise: 'info',
        message: `This connection's account may now ${spelled(gained)} ${is.name} of ${describe(after.ref)}, which it could not when the form was generated. Regenerating may offer more; the published form is unchanged.`,
      })
    }
  }
  return drafts
}

const STATE: Record<RowSecurity, string> = { none: 'does not apply', applies: 'applies', unknown: 'cannot be established' }

function rowSecurityDraft(comparison: Comparison, before: ObjectMeta, after: ObjectMeta): Draft[] {
  if (before.rowSecurity === after.rowSecurity) return []
  const { bindings } = comparison
  const isRoot = sameRef(after.ref, bindings.root)
  const fields = isRoot ? allFields(bindings) : lookups(bindings).filter((lookup) => sameRef(lookup.target.table, after.ref)).map((lookup) => lookup.field)
  return [
    {
      kind: 'row-security-changed',
      subject: { kind: 'object', object: after.ref },
      affects: fields,
      stops: [],
      breaksReads: false,
      otherwise: 'review',
      message: `Row-level security on ${describe(after.ref)} now ${STATE[after.rowSecurity]} for this connection; when the form was generated it ${STATE[before.rowSecurity].replace('does not', 'did not').replace('applies', 'applied').replace('cannot', 'could not')}. Which rows this form shows may differ from what was reviewed; nothing is stopped, because neither adapter reports a write done that the table does not hold.`,
    },
  ]
}

/**
 * The snapshot was taken as another principal: grants and policies are
 * evaluated for somebody else (0027). Blocking while row security is in play
 * on the root or a lookup's target in either snapshot, because a policy picks
 * rows by the principal it sees (B5) and the reviewed form showed another's;
 * for review otherwise. Never a throw: rotating an account is ordinary.
 */
export function accountChanges(base: MetadataSnapshot, current: MetadataSnapshot, bindings: FormBindings): Draft[] {
  if (base.account.user === current.account.user) return []
  const refs = [bindings.root, ...lookups(bindings).map((lookup) => lookup.target.table)]
  const inPlay = [base, current].some((snapshot) => refs.some((ref) => (findObject(snapshot, ref)?.rowSecurity ?? 'none') !== 'none'))
  return [
    {
      kind: 'account-changed',
      subject: { kind: 'scope' },
      affects: inPlay ? allFields(bindings) : [],
      stops: [],
      breaksReads: inPlay,
      otherwise: 'review',
      message: `The form was generated from a snapshot taken as ${base.account.user}; this one was taken as ${current.account.user}, so privileges and row-level security are evaluated for another principal. ${
        inPlay
          ? 'Row-level security is in play on what this form reads, so the records it shows are chosen for another principal: the form is blocked until it is reviewed.'
          : 'No row-level security applies to what this form reads; review that the form should run as this account.'
      }`,
    },
  ]
}

/** Every privilege, row-security and account change the form rests on, for the root and each lookup's target. */
export function privilegeChanges(comparison: Comparison): Draft[] {
  return [
    ...comparedObjects(comparison).flatMap(({ before, after }) => [...columnDrafts(comparison, before, after), ...rowSecurityDraft(comparison, before, after)]),
    ...accountChanges(comparison.base, comparison.current, comparison.bindings),
  ]
}
