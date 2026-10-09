import type { ColumnMeta, CoverageGap, ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { gapCovers } from '../snapshot.js'
import type { FieldWrites, GenerationNote } from './types.js'

/*
 * What the account that took the snapshot may do, applied to a form (0027).
 *
 * The snapshot says, column by column, what the database's own privilege
 * check answered at discovery, and whether row security applies. The
 * generator offers nothing the account cannot do: no field over a column it
 * may not read, no write it may not perform, no operation the database would
 * refuse on every request. What it cannot know — which rows a policy hides —
 * it says, as a note.
 */

function describe(object: ObjectMeta): string {
  return `${object.ref.schema}.${object.ref.name}`
}

const unreadable = (column: ColumnMeta): boolean => !column.access.select

/** The note for a column the account may not read, which gets no field. */
export const UNREADABLE = "This connection's account may not read it."

/** A form that cannot read its root cannot show a record: refused, naming the table. */
export function assertReadableRoot(root: ObjectMeta): void {
  if (root.columns.every(unreadable)) {
    throw new Error(`${describe(root)} cannot be read by this connection: its account may SELECT none of its columns.`)
  }
}

/**
 * A lookup reads the root's foreign-key columns, and on every search the
 * target's key and display columns. One the account cannot read would fail
 * each search after the form was published, so it is refused now, by name.
 */
export function assertReadableLookup(root: ObjectMeta, foreignKey: ForeignKeyMeta, target: ObjectMeta, display: readonly string[]): void {
  const references = foreignKey.references
  const wanted: Array<[ObjectMeta, string]> = [
    ...foreignKey.columns.map((name): [ObjectMeta, string] => [root, name]),
    ...(references?.columns ?? []).map((name): [ObjectMeta, string] => [target, name]),
    ...display.map((name): [ObjectMeta, string] => [target, name]),
  ]
  for (const [object, name] of wanted) {
    if (object.columns.find((column) => column.name === name)?.access.select === false) {
      throw new Error(`${foreignKey.name}: this connection's account may not read ${describe(object)}.${name}`)
    }
  }
}

/**
 * What a field writes on each operation, and the note when privilege alone
 * stops one: `possible` is every other reason a field may be written — not a
 * view, not generated, not pinned, a control that can write it — already
 * decided by the caller, which notes those itself.
 */
export function writesFor(columns: readonly ColumnMeta[], possible: boolean, subject: string, notes: GenerationNote[]): FieldWrites {
  const writes = {
    create: possible && columns.every((column) => column.access.insert),
    update: possible && columns.every((column) => column.access.update),
  }
  if (!possible || (writes.create && writes.update)) return writes
  // A column field says "it"; a lookup names the columns that lack the privilege.
  const lacking = (capability: 'insert' | 'update') =>
    columns.length === 1 ? 'it' : columns.filter((column) => !column.access[capability]).map((column) => column.name).join(', ')
  let message: string
  if (!writes.create && !writes.update) message = `Read-only: this connection's account may neither INSERT nor UPDATE ${lacking('insert')}.`
  else if (!writes.update) message = `Read-only on update: this connection's account may not UPDATE ${columns.filter((column) => !column.access.update).map((column) => column.name).join(', ')}.`
  else message = `Not written on create: this connection's account may not INSERT ${lacking('insert')}.`
  notes.push({ subject, kind: 'read-only', message })
  return writes
}

/**
 * The pinned columns, each held to what the policy does with it: it is in
 * the WHERE of every read and update, so one the account cannot read fails
 * each of them, and that throws; it is written from the trusted context on
 * every create, so one it may not INSERT makes create impossible, and is
 * returned for the caller to block create with.
 */
export function uninsertablePins(root: ObjectMeta, pinned: ReadonlySet<string>): ColumnMeta[] {
  const columns = root.columns.filter((column) => pinned.has(column.name))
  for (const column of columns) {
    if (unreadable(column)) {
      throw new Error(`${column.name} is pinned by the policy, and this connection's account may not read it: the tenant filter would fail every read and update`)
    }
  }
  return columns.filter((column) => !column.access.insert)
}

/**
 * The columns that identify one record: the primary key if the account may
 * read all of it, else the first unique key it may. A key it cannot read
 * cannot be read back into a record token, so it addresses nothing; when no
 * key is readable, the note names the column that stopped the first one.
 */
export function identityFor(root: ObjectMeta, notes: GenerationNote[]): string[] | null {
  const keys = [...(root.primaryKey === null ? [] : [root.primaryKey]), ...root.uniqueKeys]
  const readable = (name: string) => root.columns.find((column) => column.name === name)?.access.select === true
  const usable = keys.find((key) => key.columns.every(readable))
  if (usable !== undefined) return [...usable.columns]
  const first = keys[0]
  if (first !== undefined) {
    const hidden = first.columns.find((name) => !readable(name)) as string
    notes.push({ subject: root.ref.name, kind: 'blocked', message: `Records cannot be read back or updated: this connection's account may not read key column ${hidden}.` })
  }
  return null
}

/** Why the account cannot use a column as the version column, or `null`. Read for the check, written on every update (0015). */
export function versionAccessProblem(column: ColumnMeta): string | null {
  if (!column.access.select) return "this connection's account may not read it"
  if (!column.access.update) return "this connection's account may not UPDATE it"
  return null
}

const NO_SESSION_STATE = 'records outside its policies read as not found, a write its policies refuse is refused, and this module sets no session state a policy may read (0011)'

/** Why row security on `object` cannot be established: the details of the row-security gaps that cover it. */
function whyUnknown(snapshot: MetadataSnapshot, object: ObjectMeta): string {
  const covering = snapshot.gaps.filter((gap: CoverageGap) => gap.aspect === 'row-security' && gapCovers(gap, object.ref))
  return covering.map((gap) => gap.detail).join('; ')
}

/**
 * What the database itself limits for this connection on the tables a form
 * reads — its root, then each lookup target once — as `access` notes.
 *
 * Row security that applies is said with what it means for the form; one that
 * cannot be established is said with the gap that says why. A view is not
 * followed to its tables, whose policies SQL Server applies through it and
 * PostgreSQL does for a security_invoker view (B16), and whose privileges a
 * read through it may need -- on PostgreSQL the view owner's, or the
 * reader's for a security_invoker view, measured refused while the view's
 * own columns say SELECT -- so a view always gets a note, whatever its own
 * row security and grants say.
 */
export function rowSecurityNotes(snapshot: MetadataSnapshot, objects: readonly ObjectMeta[], notes: GenerationNote[]): void {
  const seen = new Set<string>()
  for (const object of objects) {
    const where = describe(object)
    if (seen.has(where)) continue
    seen.add(where)
    const subject = object.ref.name
    if (object.rowSecurity === 'applies') notes.push({ subject, kind: 'access', message: `Row-level security applies to this connection on ${where}: ${NO_SESSION_STATE}.` })
    if (object.rowSecurity === 'unknown') {
      notes.push({ subject, kind: 'access', message: `This connection cannot tell whether row-level security applies to ${where}: ${whyUnknown(snapshot, object)}` })
    }
    if (object.kind === 'view') {
      notes.push({
        subject,
        kind: 'access',
        message: `This snapshot does not follow ${where} to the tables behind it: SQL Server applies their row-level security through a view, and PostgreSQL does when the view is security_invoker, so rows they hide read as not found; and a read through it may need privileges on those tables that this snapshot does not describe, and be refused.`,
      })
    }
  }
}
