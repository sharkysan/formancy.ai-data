import { rowFilterTerms } from '../lookup/filters.js'
import type { RowFilterTerm } from '../lookup/types.js'
import type { ObjectRef } from '../metadata.js'
import type { DeleteAction } from '../policy/types.js'
import { throughTerms } from './through.js'
import type { ThroughTerms } from './through.js'
import type { DeleteReach, DeleteRequest, RecordValue } from './types.js'

/** A delete's reach as an adapter builds its locks and its guard from it: fresh, every part checked. */
export interface ReachTerms {
  /** The tables the delete removes rows of, the root first. */
  removed: ObjectRef[]
  /** The tables whose references it clears, each with the columns it clears. */
  cleared: Array<{ table: ObjectRef; columns: string[] }>
  /** Each key the policy accepts a delete acting through, with the table it is on and the one it refers to. */
  accepted: Array<{ from: ObjectRef; name: string; onto: ObjectRef; onDelete: DeleteAction }>
}

/**
 * A delete request as an adapter builds its statement from it (0050, 0051):
 * the key, the version, the filters and throughs as `rowFilterTerms` and
 * `throughTerms` read them, the table it deletes from, and what else it
 * reaches through the keys its policy accepts.
 */
export interface DeleteTerms {
  key: RecordValue[]
  expectedVersion: string
  terms: RowFilterTerm[]
  through: ThroughTerms[]
  /** The root: the first table of the reach. */
  root: ObjectRef
  reach: ReachTerms
}

const refuse = (why: string) => new Error(`A delete request ${why}; refusing rather than deleting something else than the planner decided.`)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''
const ACTIONS: readonly unknown[] = ['cascade', 'set-null', 'set-default'] satisfies DeleteAction[]

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isName(value['schema']) && isName(value['name'])
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.schema === right.schema && left.name === right.name
}

const copy = (ref: ObjectRef): ObjectRef => ({ schema: ref.schema, name: ref.name })

/** The key: exactly the identity's columns, in its order, each with a value. */
function keyOf(request: DeleteRequest): RecordValue[] {
  const identity = Array.isArray(request.target?.identity) ? request.target.identity.map((column) => column.name) : []
  const given: unknown = request.key
  if (identity.length === 0) throw refuse('deletes from a target with an identity')
  if (!Array.isArray(given) || given.length !== identity.length) throw refuse('names every column of the identity, in order')
  return (given as unknown[]).map((entry, index) => {
    if (!isRecord(entry) || entry['name'] !== identity[index] || !isRecord(entry['type']) || entry['value'] === null || entry['value'] === undefined) {
      throw refuse('names every column of the identity, in order, each with a value')
    }
    return { name: identity[index] as string, type: entry['type'] as RecordValue['type'], value: entry['value'] as RecordValue['value'] }
  })
}

/** Each part of the reach, read: well formed, every table once, and every column and key named. */
function partsOf(reach: Record<string, unknown>): ReachTerms {
  const removed = reach['removed'] as unknown[]
  if (!removed.every(isRef) || removed.some((table, index) => removed.findIndex((other) => sameRef(other, table)) !== index)) {
    throw refuse('names each table it removes rows of once')
  }
  const cleared = (reach['cleared'] as unknown[]).map((entry) => {
    if (!isRecord(entry) || !isRef(entry['table']) || !Array.isArray(entry['columns']) || entry['columns'].length === 0 || !entry['columns'].every(isName)) {
      throw refuse('names each table it clears with the columns it clears')
    }
    return { table: copy(entry['table']), columns: [...entry['columns']] }
  })
  if (cleared.some((entry, index) => cleared.findIndex((other) => sameRef(other.table, entry.table)) !== index))
    throw refuse('names each table it clears with the columns it clears')
  const accepted = (reach['accepted'] as unknown[]).map((entry) => {
    if (!isRecord(entry) || !isRef(entry['from']) || !isName(entry['name']) || !isRef(entry['onto']) || !ACTIONS.includes(entry['onDelete'])) {
      throw refuse('names each key it accepts by its table, its name, the table it refers to and an action that acts on delete')
    }
    return { from: copy(entry['from']), name: entry['name'], onto: copy(entry['onto']), onDelete: entry['onDelete'] as DeleteAction }
  })
  return { removed: removed.map(copy), cleared, accepted }
}

/**
 * The tables the delete reaches, and the keys it may act through (0051):
 * the root first, then whatever a cascade the policy accepts removes rows
 * of, and whatever a SET NULL or SET DEFAULT it accepts clears. The parts
 * must account for each other, as the planner makes them: every table
 * past the root is one an accepted key reaches, and every accepted key
 * refers to a table the delete removes rows of and reaches a table the
 * reach names. A reach that does not agree with itself is one the adapters'
 * locks and guards could not hold the database to, so it is refused before
 * anything is sent rather than deleted as though it were the planner's.
 */
function reachOf(request: DeleteRequest): { root: ObjectRef; reach: ReachTerms } {
  const reach: unknown = request.reach
  const table: unknown = request.target?.table
  if (!isRef(table)) throw refuse('names the table it deletes from')
  if (!isRecord(reach) || !Array.isArray(reach['removed']) || !Array.isArray(reach['cleared']) || !Array.isArray(reach['accepted'])) {
    throw refuse('says what it reaches: the tables it removes rows of, those it clears, and the keys it accepts')
  }
  const [first] = reach['removed'] as unknown[]
  if (!isRef(first) || !sameRef(first, table)) throw refuse('removes rows of its root first')
  const parts = partsOf(reach)
  const removes = (ref: ObjectRef) => parts.removed.some((removed) => sameRef(removed, ref))
  const clears = (ref: ObjectRef) => parts.cleared.some((cleared) => sameRef(cleared.table, ref))
  for (const key of parts.accepted) {
    if (!removes(key.onto)) throw refuse('accepts a key onto a table it does not remove rows of')
    if (key.onDelete === 'cascade' && !removes(key.from)) throw refuse('accepts a cascade into a table it does not say it removes rows of')
    if (key.onDelete !== 'cascade' && !clears(key.from)) throw refuse('accepts a key that clears a table it does not say it clears')
  }
  if (parts.removed.slice(1).some((removed) => !parts.accepted.some((key) => key.onDelete === 'cascade' && sameRef(key.from, removed)))) {
    throw refuse('removes rows of a table no key it accepts cascades into')
  }
  if (parts.cleared.some(({ table: cleared }) => !parts.accepted.some((key) => key.onDelete !== 'cascade' && sameRef(key.from, cleared)))) {
    throw refuse('clears a table no key it accepts clears')
  }
  return { root: copy(table), reach: parts }
}

/**
 * The terms an adapter builds a delete statement from, read as `listTerms`
 * reads a list: at run time, where a caller in JavaScript or a request
 * rebuilt from JSON is not held to the types. A key that is not the
 * identity, a missing version, a missing filter or through, a target with
 * no concurrency, and a reach that does not begin with the root or does not
 * agree with itself each throw before a statement is built. The result is
 * fresh, so nothing else the request carried reaches SQL.
 */
export function deleteTerms(request: DeleteRequest): DeleteTerms {
  const concurrency: unknown = request.target?.concurrency
  if (!isRecord(concurrency) || (concurrency['kind'] !== 'rowversion' && concurrency['kind'] !== 'version-column') || !isName(concurrency['column'])) {
    throw refuse('is guarded by a concurrency token')
  }
  if (!isName(request.expectedVersion)) throw refuse('names the version its person read')
  if (request.filters === undefined) throw refuse('carries the filters, which say whose rows it may reach')
  if (request.through === undefined) throw refuse('carries its throughs, [] for none')
  return {
    key: keyOf(request),
    expectedVersion: request.expectedVersion,
    terms: rowFilterTerms(request.filters),
    through: throughTerms(request.through),
    ...reachOf(request),
  }
}

/** Whether a delete reaches past its root: it removes rows of another table, or clears one (0051). */
export function reachesPast(reach: Pick<DeleteReach, 'removed' | 'cleared'>): boolean {
  return reach.removed.length > 1 || reach.cleared.length > 0
}
