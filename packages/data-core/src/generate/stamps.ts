import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import type { GenerationRequest, StampBinding, StampChoice, StampOn, StampValue } from './types.js'

/*
 * The columns the server stamps (0153): who created or changed a row, and
 * when, filled by the server on create, on update or on both, from the
 * verified context or the database's own clock and never from the request.
 * The generation request names them, as an administrator confirmed them;
 * this file holds each to what it can be, and says what the form does with
 * it. The planner asks `stampProblem` of a bindings file again, so a form
 * the one makes the other never refuses.
 */

/** The operations a stamp writes, in the order a sentence says them. */
const WRITTEN: Readonly<Record<StampOn, ReadonlyArray<'create' | 'update'>>> = { create: ['create'], update: ['update'], both: ['create', 'update'] }

/** The stamps `operation` writes (0153), in the order they were given. */
export function stampedOn<Stamp extends StampChoice>(stamps: readonly Stamp[] | undefined, operation: 'create' | 'update'): Stamp[] {
  return (stamps ?? []).filter((stamp) => WRITTEN[stamp.on].includes(operation))
}

/** Whether a value is a stamp's `value` as a request spells it: the actor, a named attribute, or the time. */
function isStampValue(value: unknown): value is StampValue {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'actor' || kind === 'time') return Object.keys(value).length === 1
  return kind === 'attribute' && Object.keys(value).length === 2 && typeof (value as { attribute?: unknown }).attribute === 'string'
}

/** Whether a value is a stamp choice of a request: a column, a value and when, and nothing else. */
export function isStampChoice(value: unknown): value is StampChoice {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 3) return false
  const { column, value: filled, on } = value as Record<string, unknown>
  return typeof column === 'string' && isStampValue(filled) && (on === 'create' || on === 'update' || on === 'both')
}

/**
 * Why `column` cannot take what a stamp fills it with, or `null`: a column
 * the database generates refuses a value; a person -- their id or an
 * attribute, both text in the verified context -- needs a text column,
 * since a number or a uuid column would make the server convert the
 * identity it was given; the time needs a column that holds an instant, a
 * wall clock or a date, which the database's clock is written into in its
 * own type. A time of day says not which day, and is refused.
 */
export function stampProblem(column: Pick<ColumnMeta, 'type' | 'databaseType' | 'generated'>, value: StampValue): string | null {
  if (column.generated !== 'none') return `the database generates it (${column.generated})`
  if (value.kind === 'attribute' && value.attribute.trim() === '') return 'the attribute it is stamped with has no name'
  if (value.kind === 'time') {
    return column.type.kind === 'timestamp' || column.type.kind === 'date'
      ? null
      : `it is ${column.databaseType}, and the time is stamped into an instant, a wall clock or a date`
  }
  return column.type.kind === 'text' ? null : `it is ${column.databaseType}, and a person is stamped as text`
}

/** What else a column is to the form, which a stamp may be none of. */
export interface StampRoles {
  /** The record's key: its address, which no write may move. */
  identity: readonly string[]
  /** The version column every update increments itself. */
  versionColumn: string | undefined
  /** Columns a row filter pins to the context: their value is the policy's, and they filter what a stamp must not. */
  pinned: ReadonlySet<string>
  /** Columns a lookup sets, from a person's selection. */
  lookupColumns: ReadonlySet<string>
  /** A chain's columns (0113): where a version starts and ends, and the key one thing's versions share. */
  chain: readonly string[]
}

/** Why `name` cannot be stamped because of what else it is to the form, or `null`. */
export function stampRoleProblem(name: string, roles: StampRoles): string | null {
  if (roles.identity.includes(name)) return "it is part of the record's key"
  if (roles.versionColumn === name) return 'it is the version column, which every update moves itself'
  if (roles.pinned.has(name)) return 'a row filter pins it, and a stamp filters nothing: a person sees the records others wrote'
  if (roles.lookupColumns.has(name)) return 'a lookup sets it from what the person selects'
  if (roles.chain.includes(name)) return "it is part of a version's place in its chain"
  return null
}

/**
 * The stamps `request` names, as the bindings keep them, in the root's
 * catalog order -- or a throw naming the one that cannot be honoured, as the
 * generator throws on every request it cannot: a malformed choice, a column
 * the root lacks, one stamped twice, one of a view, one `stampProblem` or
 * `stampRoleProblem` refuses. What the account may not write is not a throw
 * but an operation not offered (`unstampable`), as a pinned column is.
 */
export function stampsFor(root: ObjectMeta, request: GenerationRequest, roles: StampRoles): StampBinding[] {
  const chosen: unknown = request.stamps ?? []
  if (!Array.isArray(chosen)) throw new Error('stamps must be a list of { column, value, on }')
  const seen = new Set<string>()
  const stamps: StampBinding[] = []
  for (const entry of chosen as unknown[]) {
    if (!isStampChoice(entry))
      throw new Error(
        "each stamp is { column, value: { kind: 'actor' } | { kind: 'attribute', attribute } | { kind: 'time' }, on: 'create' | 'update' | 'both' }",
      )
    const column = root.columns.find((candidate) => candidate.name === entry.column)
    if (column === undefined) throw new Error(`${root.ref.name} has no column ${entry.column} to stamp`)
    if (root.kind === 'view') throw new Error(`${entry.column} cannot be stamped: ${root.ref.name} is a view, which no form writes`)
    if (seen.has(entry.column)) throw new Error(`${entry.column} is stamped twice; stamp it once, on both create and update if it is both`)
    seen.add(entry.column)
    const problem = stampProblem(column, entry.value) ?? stampRoleProblem(entry.column, roles)
    if (problem !== null) throw new Error(`${entry.column} cannot be stamped: ${problem}`)
    stamps.push({ column: entry.column, value: { ...entry.value }, on: entry.on, type: column.type })
  }
  const position = new Map(root.columns.map((column, index) => [column.name, index]))
  return stamps.sort((left, right) => (position.get(left.column) as number) - (position.get(right.column) as number))
}

/** What a stamp is filled with, as a sentence says it. */
function filledWith(value: StampValue): string {
  switch (value.kind) {
    case 'actor':
      return "the signed-in person's id"
    case 'attribute':
      return `the signed-in person's ${value.attribute}`
    case 'time':
      return "the time the save runs, by the database's clock"
  }
}

const WHEN: Readonly<Record<StampOn, string>> = { create: 'on create', update: 'on update', both: 'on create and on update' }

/** The note a stamped column's field carries: what fills it, and when, and that the person never does. */
export function stampNote(stamp: StampChoice): string {
  return `Stamped by the server ${WHEN[stamp.on]} with ${filledWith(stamp.value)}, never by the person filling the form (0153).`
}

/**
 * The notes of each stamp `operation` writes whose column this connection's
 * account may not write on it (0027): the database would refuse every such
 * write, so the operation is not offered, as a pinned column the account
 * may not INSERT stops create.
 */
export function unstampable(root: ObjectMeta, stamps: readonly StampBinding[], operation: 'create' | 'update'): string[] {
  const privilege = operation === 'create' ? 'insert' : 'update'
  return stampedOn(stamps, operation)
    .filter((stamp) => root.columns.find((column) => column.name === stamp.column)?.access[privilege] !== true)
    .map(
      (stamp) =>
        `${operation === 'create' ? 'Create' : 'Update'} is not offered: ${stamp.column} is stamped by the server on ${operation}, and this connection's account may not ${privilege.toUpperCase()} it.`,
    )
}
