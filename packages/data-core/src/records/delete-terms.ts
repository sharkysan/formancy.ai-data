import { rowFilterTerms } from '../lookup/filters.js'
import type { RowFilterTerm } from '../lookup/types.js'
import type { ObjectRef } from '../metadata.js'
import { throughTerms } from './through.js'
import type { ThroughTerms } from './through.js'
import type { DeleteRequest, RecordValue } from './types.js'

/**
 * A delete request as an adapter builds its statement from it (0050): the
 * key, the version, the filters and throughs as `rowFilterTerms` and
 * `throughTerms` read them, and the one table it deletes from.
 */
export interface DeleteTerms {
  key: RecordValue[]
  expectedVersion: string
  terms: RowFilterTerm[]
  through: ThroughTerms[]
  /** The root: the first table of the reach, and in 0050 the only one. */
  root: ObjectRef
}

const refuse = (why: string) => new Error(`A delete request ${why}; refusing rather than deleting something else than the planner decided.`)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isName(value['schema']) && isName(value['name'])
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.schema === right.schema && left.name === right.name
}

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

/**
 * The tables the delete reaches: the root alone, in 0050. A reach that
 * names another table to delete from, clear or accept a key of is one this
 * release's statements cannot hold the database to, so it is refused before
 * anything is sent rather than deleted as though it were the root's alone.
 */
function rootOf(request: DeleteRequest): ObjectRef {
  const reach: unknown = request.reach
  const table: unknown = request.target?.table
  if (!isRef(table)) throw refuse('names the table it deletes from')
  if (!isRecord(reach) || !Array.isArray(reach['removed']) || !Array.isArray(reach['cleared']) || !Array.isArray(reach['accepted'])) {
    throw refuse('says what it reaches: the tables it removes rows of, those it clears, and the keys it accepts')
  }
  const [first] = reach['removed'] as unknown[]
  if (!isRef(first) || !sameRef(first, table)) throw refuse('removes rows of its root first')
  if (reach['removed'].length !== 1 || reach['cleared'].length > 0 || reach['accepted'].length > 0) {
    throw refuse('reaches past its root, which this release does not delete through (0050)')
  }
  return { schema: table.schema, name: table.name }
}

/**
 * The terms an adapter builds a delete statement from, read as `listTerms`
 * reads a list: at run time, where a caller in JavaScript or a request
 * rebuilt from JSON is not held to the types. A key that is not the
 * identity, a missing version, a missing filter or through, a target with
 * no concurrency, and a reach that does not begin with the root -- or goes
 * past it -- each throw before a statement is built. The result is fresh, so
 * nothing else the request carried reaches SQL.
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
    root: rootOf(request),
  }
}
