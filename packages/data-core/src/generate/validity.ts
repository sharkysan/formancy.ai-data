import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import type { ConcurrencyBinding, FieldBinding, FormBindings, GenerationNote, GenerationRequest, ValidityBinding } from './types.js'

/*
 * A root whose rows are versions of one thing (0113): a price valid from one
 * date until the next of the same product starts. The generation request
 * names the columns a version starts and ends at; this file holds the pair
 * to what a chain needs, says which columns one thing's versions share, and
 * narrows what the form writes so a version's place in its chain is never
 * moved by a save.
 */

/** Whether a column can hold where a version starts or ends: a date, or an instant. */
function isPoint(column: ColumnMeta): boolean {
  return column.type.kind === 'date' || (column.type.kind === 'timestamp' && column.type.withTimeZone)
}

/**
 * The chain `chosen` names, or `undefined` when it names none.
 *
 * Throws on a pair no chain can be held to, as the generator throws on
 * every request it cannot honour: a column the root lacks, cannot read, or
 * computes; a pinned one, whose value is the context's; a pair not both
 * dates or both instants; a start that may be NULL or an end that may not,
 * NULL in `to` being the open version; no version column, since a change
 * names the version its person read (0015); and no primary or unique key
 * holding `from`, not `to`, and another column -- that key less `from` is
 * what one thing's versions share, and without it nothing says which rows
 * are one chain. The primary key is asked first, then each unique key in
 * catalog order, as the identity is.
 */
export function validityFor(
  root: ObjectMeta,
  chosen: GenerationRequest['validity'],
  concurrency: ConcurrencyBinding | null,
  pinned: ReadonlySet<string>,
): ValidityBinding | undefined {
  if (chosen === undefined) return undefined
  const named = (name: string, role: string): ColumnMeta => {
    const column = root.columns.find((entry) => entry.name === name)
    if (column === undefined) throw new Error(`${root.ref.name} has no column ${name} for a version to ${role} at`)
    if (!column.access.select) throw new Error(`${name} cannot say where a version ${role}s: this connection's account may not read it`)
    if (column.generated !== 'none') throw new Error(`${name} cannot say where a version ${role}s: the database computes it`)
    if (pinned.has(name)) throw new Error(`${name} cannot say where a version ${role}s: the policy pins it to the trusted context`)
    if (!isPoint(column)) throw new Error(`${name} is ${column.databaseType}: a version ${role}s at a date or at an instant`)
    return column
  }
  const from = named(chosen.from, 'start')
  const to = named(chosen.to, 'end')
  if (from.name === to.name) throw new Error(`a version cannot start and end at one column, ${from.name}`)
  if (from.type.kind !== to.type.kind) throw new Error(`${from.name} and ${to.name} are not both dates or both instants`)
  if (from.nullable) throw new Error(`${from.name} may be NULL, and every version starts somewhere`)
  if (!to.nullable) throw new Error(`${to.name} may not be NULL, and the open version holds NULL there`)
  if (concurrency === null)
    throw new Error(`a version is changed by naming the one its person read, and ${root.ref.name} has no rowversion and no version column: confirm one`)
  const keys = [...(root.primaryKey === null ? [] : [root.primaryKey]), ...root.uniqueKeys]
  const key = keys.find((entry) => entry.columns.includes(from.name) && !entry.columns.includes(to.name) && entry.columns.length > 1)
  if (key === undefined) {
    throw new Error(
      `no primary or unique key of ${root.ref.name} holds ${from.name} with another column and not ${to.name}, so nothing says which versions are one thing's`,
    )
  }
  const chain = key.columns.filter((name) => name !== from.name)
  for (const name of chain) {
    if (root.columns.find((column) => column.name === name)?.access.select !== true) {
      throw new Error(`${name} says which thing a version belongs to, and this connection's account may not read it`)
    }
  }
  return { from: from.name, to: to.name, key: chain }
}

/** The root's columns a field stands for. */
function columnsOf(binding: FieldBinding): readonly string[] {
  return binding.kind === 'lookup' ? binding.columns : [binding.column]
}

/**
 * What the form writes once its rows are versions: `to` never -- the server
 * writes it, ending a version -- and `from` and the chain's key on create
 * only, since an update that moved either would move the version to another
 * place in its chain, or to another chain. Each narrowing is a note.
 */
export function narrowForValidity(validity: ValidityBinding, planned: ReadonlyArray<{ binding: FieldBinding }>, notes: GenerationNote[]): void {
  for (const { binding } of planned) {
    const columns = columnsOf(binding)
    if (columns.includes(validity.to)) {
      if (binding.writes.create || binding.writes.update) {
        notes.push({
          subject: binding.field,
          kind: 'read-only',
          message: 'Shown, never written: a version ends when it is changed from a date, and the server writes its end (0113).',
        })
      }
      binding.writes = { create: false, update: false }
    } else if (binding.writes.update && columns.some((name) => name === validity.from || validity.key.includes(name))) {
      const what = columns.includes(validity.from) ? "a version's start is its place in its chain" : 'it says which thing this is a version of'
      notes.push({ subject: binding.field, kind: 'read-only', message: `Written on create only: ${what} (0113).` })
      binding.writes = { create: binding.writes.create, update: false }
    }
  }
}

/**
 * The operations of a form over versions: no delete, which would leave a
 * gap or open the version before again, and a change from a date where the
 * form offers both create and update and the account may UPDATE `to` --
 * the change ends one version and starts the next. Each one not offered is
 * a note.
 */
export function validityOperations(
  root: ObjectMeta,
  validity: ValidityBinding,
  operations: FormBindings['operations'],
  notes: GenerationNote[],
): FormBindings['operations'] {
  const blocked = (message: string) => notes.push({ subject: root.ref.name, kind: 'blocked', message })
  if (operations.delete === true) blocked('Delete is not offered: removing a version of a chain leaves a gap, or opens the version before it again (0113).')
  const to = root.columns.find((column) => column.name === validity.to)
  let supersede = operations.create && operations.update
  if (!supersede) blocked('Change from a date is not offered: it ends a version and starts the next, and this form offers no create or no update.')
  else if (to?.access.update !== true) {
    supersede = false
    blocked(`Change from a date is not offered: it ends a version by writing ${validity.to}, and this connection's account may not UPDATE it.`)
  }
  return { create: operations.create, update: operations.update, delete: false, supersede }
}
