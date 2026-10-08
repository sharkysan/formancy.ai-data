import type { ObjectRef, RowFilterTerm } from '@formancy/data-core'
import { quoteIdentifier, quoteTable } from './identifiers.js'
import type { Statement } from './statement.js'

/** What the trusted filters add to a statement: relations to join, and conditions on them. */
export interface FilterSql {
  from: string[]
  where: string[]
}

/**
 * The actor's row filters (0011) as SQL: one equality per term, between the
 * column and the term's text read as that column's own type.
 *
 * A term carries a column and text, not a type, and an untyped parameter
 * goes through the driver's serializer for whatever type the server infers:
 * its boolean serializer turns 'true' into 'f', and a tenant filter on a
 * boolean column would select the other rows. So the text travels as text,
 * and `jsonb_populate_record` over the table's own row type parses it with
 * the column's input function. Nothing is spelled here, nothing is trusted
 * to the driver, and the comparison is between two values of one type,
 * which the column's index serves.
 *
 * One record per term, so two terms on one column are both applied and
 * contradict each other, as they should, rather than one replacing the other.
 */
export function filterSql(statement: Statement, table: ObjectRef, row: string, terms: readonly RowFilterTerm[]): FilterSql {
  const from: string[] = []
  const where: string[] = []
  terms.forEach((term, index) => {
    const alias = `"f${String(index)}"`
    const column = quoteIdentifier(term.column)
    const record = statement.text(JSON.stringify({ [term.column]: term.value }))
    from.push(`jsonb_populate_record(null::${quoteTable(table)}, ${record}::jsonb) as ${alias}`)
    where.push(`${row}.${column} = ${alias}.${column}`)
  })
  return { from, where }
}
