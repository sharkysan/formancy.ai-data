import type { RowFilterTerm } from '@formancy/data-core'
import { op } from './catalog.js'
import { quoteIdentifier } from './identifiers.js'
import type { Statement } from './statement.js'
import { sqlTypeOf } from './types.js'

/**
 * The actor's row filters (0011) as SQL conditions on `row`: one equality per
 * term, true when the column's canonical value is exactly the term's value
 * (0028), whatever the column's collation.
 *
 * A term carries its column's type, so its value is bound as text and cast
 * to that type, like every other value (`statement.ts`). Text is compared
 * twice, from one parameter:
 *
 *   "c" = $n::text                                   -- char(n): $n::text::bpchar
 *   and ("c"::text collate "C") = ($n::text collate "C")
 *
 * The first is in the column's own type and collation, which keeps its index
 * usable: on PostgreSQL 17, a lookup filtered by tenant reads the primary key
 * with `Index Cond: tenant_code = 'acme'` and applies the second as a Filter
 * (C4). It only ever admits too much — under a case-insensitive collation
 * `acme` equals `ACME`; a char(n) ignores its padding — because an exactly
 * equal pair is equal under every collation. The second is exact: `"C"`
 * compares bytes, and a char(n) read as text has no padding, which is its
 * canonical value. A term ending in a space never reaches a char(n) column:
 * `scopeRowFilters` and `rowFilterTerms` refuse it, since no canonical value
 * of that column could equal it.
 *
 * Before 0028 a term had no type and was a parameter declared `unknown`, so
 * the server compared it in the column's collation: tenant `acme` read
 * `ACME`'s rows under a nondeterministic one (C3c), where SQL Server read
 * `acme `'s instead. Its first spelling, `jsonb_populate_record(null::<table>,
 * …)`, ran every other column through its input function as NULL, and a NOT
 * NULL domain anywhere in the table failed every filtered statement on it.
 *
 * A `numeric` with no scale — PostgreSQL's alone; every SQL Server decimal
 * has one — keeps the scale each value was given, so `12.5` and `12.50` are
 * two canonical values that numeric equality calls equal. It is compared
 * twice too: as a number, for the index, and as its text, which numeric_out
 * writes the same under every setting. Any other kind has one spelling per
 * value, so equality in its own type is exact.
 *
 * One equality per term, so two terms on one column are both applied and
 * contradict each other, as they should, rather than one replacing the other.
 */
export function filterSql(statement: Statement, row: string, terms: readonly RowFilterTerm[]): string[] {
  return terms.map((term) => {
    const column = `${row}.${quoteIdentifier(term.column)}`
    if (term.type.kind === 'decimal' && term.type.scale === null) {
      const value = statement.text(term.value)
      return `${column} ${op('=')} ${value}::${sqlTypeOf(term.type)} and (${column}::pg_catalog.text collate pg_catalog."C") ${op('=')} (${value} collate pg_catalog."C")`
    }
    if (term.type.kind !== 'text') return `${column} ${op('=')} ${statement.as(term.value, sqlTypeOf(term.type))}`
    const value = statement.text(term.value)
    const own = term.type.fixedLength ? `${value}::pg_catalog.bpchar` : value
    return `${column} ${op('=')} ${own} and (${column}::pg_catalog.text collate pg_catalog."C") ${op('=')} (${value} collate pg_catalog."C")`
  })
}
