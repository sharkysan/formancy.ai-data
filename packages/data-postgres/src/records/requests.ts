import type { InsertRequest, RecordTarget, RecordValue, RowFilterTerm, UpdateRequest } from '@formancy/data-core'

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
    if (terms.some((term) => term.column === value.name)) throw new Error(`${value.name} is a filter column; setting it could move the record out of the rows this actor may write.`)
  }
}
