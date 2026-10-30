import type { InsertRequest, RecordTarget, RecordValue, RowFilterTerm, SupersedeRequest, UpdateRequest } from '@formancy/data-core'

/**
 * Checks on the shape of a record request, made before anything is sent.
 *
 * A request is built by the host from bindings and policy, so one that fails
 * here is a programming error and is thrown: answering it with a
 * `RecordFailure` would dress a bug as something the database said.
 */

/** A version column's token: a decimal number, as the column's text gives it, and nothing a cast could read differently. */
const VERSION = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/

export function isVersion(token: string): boolean {
  return typeof token === 'string' && VERSION.test(token)
}

function once(values: readonly RecordValue[], what: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value.name)) throw new Error(`${value.name} is named twice in ${what}.`)
    seen.add(value.name)
  }
}

/** The key names the target's identity, column for column, in key order. */
export function checkKey(target: RecordTarget, key: readonly RecordValue[]): void {
  const matches = key.length === target.identity.length && key.every((value, index) => value.name === target.identity[index]?.name)
  if (target.identity.length === 0 || !matches) throw new Error('The key does not name the columns of the target identity, in order.')
}

export function checkInsert(request: InsertRequest): void {
  once(request.values, 'the values to insert')
  for (const name of request.fresh ?? []) {
    if (!request.values.some((value) => value.name === name)) throw new Error(`${name} is part of the chain a create starts, and the create does not write it.`)
  }
}

/**
 * An update sets at least one column, each once, and never the version
 * column or a filter column: the first would set what the guard compares,
 * the second could move the record out of the actor's rows. A target whose
 * concurrency is a `rowversion` has no meaning on PostgreSQL.
 */
export function checkUpdate(request: UpdateRequest, terms: readonly RowFilterTerm[]): void {
  checkKey(request.target, request.key)
  const concurrency = request.target.concurrency
  if (concurrency.kind !== 'version-column') throw new Error('PostgreSQL has no rowversion; an update here is guarded by a version column.')
  if (request.set.length === 0) throw new Error('An update with nothing to set would only move the version, and tell every other editor the record changed.')
  once(request.set, 'the values to set')
  for (const value of request.set) {
    if (value.name === concurrency.column) throw new Error(`${value.name} is the version column; an update moves it, and never sets it.`)
    if (terms.some((term) => term.column === value.name))
      throw new Error(`${value.name} is a filter column; setting it could move the record out of the rows this actor may write.`)
    if (value.name === request.open) throw new Error(`${value.name} is where a version ends; an update of a version never sets it (0113).`)
  }
}

/**
 * A change from a date (0113) locates its open version as an update does
 * and writes the next one's columns each once: the chain's key from the row
 * ended, the start, and the values -- never the end, which the change sets
 * on the version ended, nor the version column, which the insert leaves to
 * its default.
 */
export function checkSupersede(request: SupersedeRequest): void {
  checkKey(request.target, request.key)
  const concurrency = request.target.concurrency
  if (concurrency.kind !== 'version-column') throw new Error('PostgreSQL has no rowversion; a change here is guarded by a version column.')
  if (request.chain.length === 0) throw new Error('A change from a date copies the chain it follows, and this one names no column of it.')
  const written = [...request.chain.map((column) => column.name), request.start.name, ...request.values.map((value) => value.name)]
  const seen = new Set<string>()
  for (const name of written) {
    if (seen.has(name)) throw new Error(`${name} is written twice in the next version.`)
    if (name === request.ends || name === concurrency.column)
      throw new Error(`${name} is not the next version's to be given: the change ends one version and the insert leaves its version to the default.`)
    seen.add(name)
  }
}
