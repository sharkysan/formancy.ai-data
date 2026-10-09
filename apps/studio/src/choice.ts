import { findObject, gapCovers, rowFilterColumnProblem } from '@formancy/data-core'
import type { ColumnMeta, CoverageGap, ForeignKeyMeta, LookupChoice, MetadataSnapshot, ObjectMeta, ObjectRef, RowFilterRule } from '@formancy/data-core'
import type { ProposalRequest } from './api.js'

/**
 * What the administrator chooses before anything is generated (plan section 3,
 * step 3), and the facts each choice is offered from. Pure: the Choose step
 * renders it, and the suite checks it without rendering.
 */
export interface Choice {
  root: ObjectRef
  formId: string
  title: string
  /** Foreign keys of the root offered as lookups, each with the target columns a person recognises a row by. */
  lookups: LookupChoice[]
  /** A version column the administrator confirms, or `null` for none. */
  versionColumn: string | null
}

/**
 * The server's rule for a form id: a configuration id, lower case so it means
 * one thing on every filesystem (0013). The server checks it again on publish;
 * `api.test.ts` puts candidates to both and fails where they disagree.
 *
 * At most 128 characters, the store's limit. The server's router once refused
 * anything past 100 before a route ran, so an id the store accepted could be
 * generated and never published; the comparison in `api.test.ts` found it,
 * and fails again the day the two limits part.
 */
export const FORM_ID_MAX = 128

export function isFormId(id: string): boolean {
  return id.length <= FORM_ID_MAX && /^[a-z0-9][a-z0-9._-]*$/.test(id)
}

export function describeRef(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}

export function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.schema === right.schema && left.name === right.name
}

/** `sales.order` becomes `sales-order`: a form id the server accepts, where the names allow one. */
export function formIdFor(ref: ObjectRef): string {
  const id = `${ref.schema}-${ref.name}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '')
  return id.slice(0, FORM_ID_MAX)
}

/** `order_line` becomes `Order line`, the way the generator writes a label. */
export function titleFor(ref: ObjectRef): string {
  const words = ref.name.replace(/[_-]+/g, ' ').trim()
  return words === '' ? ref.name : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** A fresh choice for `ref`: nothing offered, nothing confirmed. */
export function choiceFor(ref: ObjectRef): Choice {
  return { root: { ...ref }, formId: formIdFor(ref), title: titleFor(ref), lookups: [], versionColumn: null }
}

/** The gaps about one object itself, which are what "cannot tell" is made of (0004). */
export function gapsAbout(snapshot: MetadataSnapshot, ref: ObjectRef): CoverageGap[] {
  return snapshot.gaps.filter((gap) => gap.subject.kind === 'object' && sameRef(gap.subject.object, ref))
}

/**
 * The gaps that could hide an object the snapshot does not describe: one about
 * it, or one about the objects of its schema or of the whole scope (0027).
 * Drift review asks the same question of the same gaps.
 */
export function gapsHiding(snapshot: MetadataSnapshot, ref: ObjectRef): CoverageGap[] {
  return snapshot.gaps.filter((gap) => gapCovers(gap, ref) && (gap.subject.kind === 'object' || gap.aspect === 'objects'))
}

const readable = (column: ColumnMeta): boolean => column.access.select

/**
 * Why a table or view cannot be a form's root, or `null`: the generator
 * refuses one of whose columns the account may SELECT none (0027), so the
 * studio does not offer it as if it could.
 */
export function rootBlocker(object: ObjectMeta): string | null {
  return object.columns.some(readable) ? null : 'This connection cannot read it: its account may SELECT none of its columns.'
}

/**
 * Whether a foreign key can be offered as a lookup, and why not.
 *
 * The generator refuses one whose target this connection cannot see, or
 * whose own columns on the root or target key it may not read (0027); the
 * studio says so before anybody asks, with the gap that explains it when
 * there is one, because "the target is not visible" and "there is no target"
 * are different findings. The display columns are the administrator's
 * choice, and `displayBlocker` says which of them cannot be chosen.
 */
export function lookupBlocker(snapshot: MetadataSnapshot, root: ObjectMeta, foreignKey: ForeignKeyMeta): string | null {
  const unreadable = foreignKey.columns.find((name) => root.columns.find((column) => column.name === name)?.access.select === false)
  if (unreadable !== undefined) return `${unreadable} of ${describeRef(root.ref)} cannot be read by this connection, so the lookup cannot be offered.`
  if (foreignKey.references === null) {
    return 'This connection can see that the key exists but not what it references, so it cannot be offered.'
  }
  const target = foreignKey.references.table
  const found = findObject(snapshot, target)
  if (found !== undefined) {
    const hidden = foreignKey.references.columns.find((name) => found.columns.find((column) => column.name === name)?.access.select === false)
    return hidden === undefined ? null : `${hidden} of ${describeRef(target)} cannot be read by this connection, so its rows cannot be offered.`
  }
  const gaps = gapsHiding(snapshot, target)
  if (gaps.length > 0) return `${describeRef(target)} is not visible to this connection: ${gaps.map((gap) => gap.detail).join('; ')}.`
  return `${describeRef(target)} is outside the schemas this connection discovers, so its rows cannot be offered.`
}

/** Why a target column cannot be shown by a lookup, or `null`: the generator refuses a display column the account may not read (0027). */
export function displayBlocker(column: ColumnMeta): string | null {
  return readable(column) ? null : 'This connection may not read it, so it cannot be shown.'
}

/**
 * A suggested display column for a lookup's target: the first text column that
 * is not part of the key it points at, else its first column. A suggestion,
 * shown checked for the administrator to confirm or change (plan section 3).
 */
export function suggestedDisplay(target: ObjectMeta, keyColumns: readonly string[]): string[] {
  // Only a column the account may read: a label of one it may not fails every search (0027).
  const shown = target.columns.filter(readable)
  const text = shown.find((column) => column.type.kind === 'text' && !keyColumns.includes(column.name))
  const first = text ?? shown[0]
  return first === undefined ? [] : [first.name]
}

/**
 * Columns that could be confirmed as a version column: a non-nullable integer
 * the database does not generate, outside the key, that the account may read
 * and UPDATE (0027). The generator holds a confirmed column to the same rule
 * and refuses one that fails it.
 */
export function versionCandidates(root: ObjectMeta): ColumnMeta[] {
  const key = new Set(root.primaryKey?.columns ?? root.uniqueKeys[0]?.columns ?? [])
  return root.columns.filter(
    (column) => column.type.kind === 'integer' && !column.nullable && column.generated === 'none' && !key.has(column.name) && column.access.select && column.access.update,
  )
}

/** The root's rowversion column, which the database maintains and nobody confirms. */
export function rowversionOf(root: ObjectMeta): ColumnMeta | undefined {
  return root.columns.find((column) => column.type.kind === 'rowversion')
}

/**
 * Columns a policy could pin: ones the person would otherwise write, and that
 * a row filter can compare. A generated column has its value already; one the
 * account may not read would fail every read the pin filters (0027); and a
 * boolean, float, time or timestamp has no spelling both engines compare
 * alike, so the server refuses the filter at publish (0028).
 */
export function pinCandidates(root: ObjectMeta): ColumnMeta[] {
  return root.columns.filter((column) => column.generated === 'none' && rowFilterColumnProblem(root, column.name) === null)
}

/**
 * The proposal to ask for. The pinned columns are the policy's root row
 * filters -- one list, so the generator and the policy cannot disagree about
 * which column the tenant comes from (0011).
 */
export function proposalFor(connection: string, choice: Choice, rowFilters: readonly RowFilterRule[]): ProposalRequest {
  return {
    connection,
    root: { ...choice.root },
    formId: choice.formId,
    title: choice.title,
    lookups: choice.lookups.map((lookup) => ({ foreignKey: lookup.foreignKey, display: [...lookup.display] })),
    pinned: rowFilters.map((rule) => rule.column),
    ...(choice.versionColumn === null ? {} : { versionColumn: choice.versionColumn }),
  }
}

/** What is wrong with a choice before it is sent, in words; the server and the generator check again. */
export function choiceProblems(choice: Choice, rowFilters: readonly RowFilterRule[]): string[] {
  const problems: string[] = []
  if (!isFormId(choice.formId)) problems.push(`The form id must start with a lower-case letter or digit and hold only those, dot, hyphen or underscore, up to ${String(FORM_ID_MAX)} characters.`)
  if (choice.title.trim() === '') problems.push('The form needs a title.')
  for (const lookup of choice.lookups) {
    if (lookup.display.length === 0) problems.push(`${lookup.foreignKey} needs at least one column to show.`)
  }
  for (const rule of rowFilters) {
    if (rule.attribute.trim() === '') problems.push(`Name the trusted attribute ${rule.column} is pinned to.`)
  }
  return problems
}
