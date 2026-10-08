import type { FieldBinding, FormBindings } from '../generate/types.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedTypeKind, ObjectMeta } from '../metadata.js'
import { findObject } from '../snapshot.js'
import type { LookupConfig, LookupSort } from './types.js'

/**
 * The page size a lookup allows unless an administrator says otherwise.
 *
 * Not measured here: it is what formancy's select asks for by default
 * (`MAX_ROWS` in `@formancy/react` and `@formancy/angular`), so a host that
 * keeps the control's default is never refused, and nothing larger is offered
 * until a measurement says it is cheap.
 */
export const DEFAULT_MAX_PAGE_SIZE = 50

/** No canonical text: nothing a token, a label or a portable order can rely on. */
const NO_TEXT: ReadonlySet<NormalizedTypeKind> = new Set(['binary', 'rowversion', 'unsupported'])
/** Kinds both engines spell alike as text, so a search over them matches what the label shows. */
const SEARCHABLE: ReadonlySet<NormalizedTypeKind> = new Set(['text', 'integer'])

export interface LookupOptions {
  /** The snapshot the bindings were generated from. Checked by fingerprint. */
  snapshot: MetadataSnapshot
  /** Display columns a typed search may match. Defaults to every displayed text or integer column. */
  search?: readonly string[]
  /** The order rows are offered in. Defaults to the display columns, ascending. The key always ends it. */
  sort?: readonly LookupSort[]
  /** Defaults to `DEFAULT_MAX_PAGE_SIZE`. */
  maxPageSize?: number
}

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/** Names one lookup in a message: the foreign key and the table it reaches. */
function describe(binding: LookupBinding): string {
  return `${binding.foreignKey} (${binding.target.table.schema}.${binding.target.table.name})`
}

function columnOf(target: ObjectMeta, where: string, name: string): ColumnMeta {
  const column = target.columns.find((candidate) => candidate.name === name)
  if (column === undefined) throw new Error(`${where}: the table has no column ${name}`)
  return column
}

function once(seen: Set<string>, where: string, name: string): void {
  if (seen.has(name)) throw new Error(`${where}: ${name} is named twice`)
  seen.add(name)
}

/**
 * A key every token can carry exactly. A float is not equal to its own
 * decimal spelling in general, so a token holding one might not find the row
 * it came from; binary and unsupported types have no text form at all.
 */
function checkKey(target: ObjectMeta, where: string, columns: readonly string[]): void {
  for (const name of columns) {
    const column = columnOf(target, where, name)
    if (column.type.kind === 'float') {
      throw new Error(`${where}: key column ${name} is ${column.databaseType}; a floating-point value cannot be referenced exactly`)
    }
    if (NO_TEXT.has(column.type.kind)) throw new Error(`${where}: key column ${name} is ${column.databaseType}, which has no text form for a token`)
  }
}

function checkDisplay(target: ObjectMeta, where: string, display: readonly string[]): void {
  if (display.length === 0) throw new Error(`${where} needs at least one display column`)
  for (const name of display) {
    const column = columnOf(target, where, name)
    if (NO_TEXT.has(column.type.kind)) throw new Error(`${where}: display column ${name} is ${column.databaseType}, which has no text form for a label`)
  }
}

/**
 * Search matches what the person sees — formancy's `narrowOptionsByLabel`
 * matches the label and nothing else — so only displayed columns, and only
 * those both engines spell alike as text. A date searched as text would match
 * PostgreSQL's spelling of it, which depends on the session's `DateStyle`.
 */
function searchFor(target: ObjectMeta, where: string, display: readonly string[], requested: readonly string[] | undefined): string[] {
  if (requested === undefined) return [...new Set(display)].filter((name) => SEARCHABLE.has(columnOf(target, where, name).type.kind))
  const seen = new Set<string>()
  for (const name of requested) {
    once(seen, where, name)
    if (!display.includes(name)) throw new Error(`${where}: ${name} is not displayed, and a search matches only what the person can see`)
    const column = columnOf(target, where, name)
    if (!SEARCHABLE.has(column.type.kind)) {
      throw new Error(`${where}: ${name} is ${column.databaseType}; only text and integer columns are searched, because the engines spell other types differently`)
    }
  }
  return [...requested]
}

/**
 * The order rows are offered in, made total by ending it with every key
 * column it does not already name. Without that, a page boundary can fall
 * between two rows that sort equal, and offset paging shows one twice and the
 * other never.
 */
function sortFor(target: ObjectMeta, where: string, binding: LookupBinding, requested: readonly LookupSort[] | undefined): LookupSort[] {
  const chosen = requested ?? [...new Set(binding.display)].map((column): LookupSort => ({ column, direction: 'asc' }))
  const seen = new Set<string>()
  const sort: LookupSort[] = []
  for (const entry of chosen) {
    if (entry.direction !== 'asc' && entry.direction !== 'desc') throw new Error(`${where}: ${entry.column} sorts asc or desc`)
    once(seen, where, entry.column)
    const column = columnOf(target, where, entry.column)
    if (NO_TEXT.has(column.type.kind)) throw new Error(`${where}: ${entry.column} is ${column.databaseType}, which has no order a lookup can rely on`)
    sort.push({ column: entry.column, direction: entry.direction })
  }
  for (const name of binding.target.columns) if (!seen.has(name)) sort.push({ column: name, direction: 'asc' })
  return sort
}

/**
 * The configuration an adapter answers one lookup with, from a form's
 * bindings and the snapshot they were generated from.
 *
 * Every name in the result is checked against that snapshot, so an adapter
 * quotes approved metadata and nothing else. It throws on a configuration
 * that cannot mean what it says — bindings from another snapshot, a key no
 * token can hold, a search over something the person cannot see — rather than
 * building a lookup that quietly does something else. Row filters are not
 * part of it: they are the actor's, and arrive with each request.
 */
export function buildLookupConfig(bindings: FormBindings, field: string, options: LookupOptions): LookupConfig {
  const { snapshot } = options
  if (bindings.version !== 1) throw new Error(`Bindings version ${String(bindings.version)} is not one this release reads`)
  if (snapshot.fingerprint !== bindings.snapshotFingerprint) {
    throw new Error('These bindings were generated from a different snapshot; review the drift before building a lookup from them')
  }

  const binding = bindings.fields.find((candidate) => candidate.field === field)
  if (binding === undefined) throw new Error(`${field} is not a field of this form`)
  if (binding.kind !== 'lookup') throw new Error(`${field} is bound to the column ${binding.column}, not to a lookup`)

  const where = describe(binding)
  const target = findObject(snapshot, binding.target.table)
  if (target === undefined) throw new Error(`${where}: ${binding.target.table.schema}.${binding.target.table.name} is outside the snapshot`)
  checkKey(target, where, binding.target.columns)
  checkDisplay(target, where, binding.display)

  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE
  if (!Number.isSafeInteger(maxPageSize) || maxPageSize < 1) throw new Error(`${where}: the page size is a whole number of at least 1`)

  return {
    source: binding.source,
    foreignKey: binding.foreignKey,
    target: { ...target.ref },
    targetColumns: [...binding.target.columns],
    display: [...binding.display],
    search: searchFor(target, where, binding.display, options.search),
    sort: sortFor(target, where, binding, options.sort),
    maxPageSize,
  }
}
