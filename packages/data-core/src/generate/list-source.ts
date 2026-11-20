import type { ObjectRef } from '../metadata.js'

/*
 * Where a list of a column's values comes from (0152, 0170): one check of
 * the table, or of a PostgreSQL domain of the column's type, and how a
 * sentence names it. A module of its own, importing no other, so the
 * generator's notes, a default's and drift review's say a source alike.
 */

/** Where a list comes from: one check, of the table or -- `domain` -- of a domain of the column's type (0170). */
export interface ListSource {
  check: string
  domain?: ObjectRef
}

/** A list's source as a sentence names it: the table's check by its name, a domain's as that domain's (0170). */
export function listedName(source: ListSource): string {
  return source.domain === undefined ? source.check : `${source.check} of ${source.domain.schema}.${source.domain.name}`
}

/** Whether two sources are the one check: the same name, of the table or of the same domain. */
export function sameSource(left: ListSource, right: ListSource): boolean {
  return left.check === right.check && left.domain?.schema === right.domain?.schema && left.domain?.name === right.domain?.name
}
