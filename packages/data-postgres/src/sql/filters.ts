import type { RowFilterTerm } from '@formancy/data-core'
import { op } from './catalog.js'
import { quoteIdentifier } from './identifiers.js'
import type { Statement } from './statement.js'

/**
 * The actor's row filters (0011) as SQL conditions on `row`: one equality per
 * term, between the column and the term's text read as that column's type.
 *
 * A term carries a column and text, not a type, so no cast can be written
 * for it. Its parameter is declared `unknown` (`Statement.inferred`): the
 * server types it from the column it is compared with and parses the text
 * with that type's input function, so 'true' is true for a boolean column,
 * and the comparison is between two values of one type, which the column's
 * index serves. Left untyped instead, the driver would serialise the text
 * for the type the server reported, and its boolean serializer turns 'true'
 * into 'f': a tenant filter on a boolean column selected the other rows.
 *
 * Not `jsonb_populate_record(null::<table>, …)`, which parsed the text with
 * the same input function and was used here first: from a NULL base row it
 * runs every column the JSON leaves out through its input function as NULL,
 * so that a domain can check it, and a NOT NULL domain anywhere in the table
 * failed every filtered statement on it.
 *
 * One equality per term, so two terms on one column are both applied and
 * contradict each other, as they should, rather than one replacing the other.
 */
export function filterSql(statement: Statement, row: string, terms: readonly RowFilterTerm[]): string[] {
  return terms.map((term) => `${row}.${quoteIdentifier(term.column)} ${op('=')} ${statement.inferred(term.value)}`)
}
