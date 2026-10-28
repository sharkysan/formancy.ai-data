import type { RecordFilter } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { filterSql } from '../sql/filters.js'
import { quoteIdentifier } from '../sql/identifiers.js'
import { searchSql } from '../sql/search.js'
import type { Statement } from '../sql/statement.js'
import { sqlTypeOf } from '../sql/types.js'

/**
 * One condition of a person's filter (0104) as SQL on `row`, each value
 * bound and cast to its column's type (`sql/statement.ts`), never spliced.
 * What each condition means is data-core's (`RecordFilter`); this is how
 * PostgreSQL is told it.
 *
 * - `equals` on text, an integer, a decimal, a uuid or a date is exactly a
 *   row filter's spelling (`sql/filters.ts`, 0028): the column's own
 *   equality, which keeps its index, and for text and an unscaled numeric
 *   the same again under `"C"`, which is exact whatever the column's
 *   collation -- so `ag` is not `AG` under a case-insensitive one, and
 *   `AG ` is not `AG`. On a boolean, the column's equality with `true` or
 *   `false` as `bool`.
 * - `range`: at least `from`, at most `to`, below `before`, each bound cast
 *   to the column's own type, so the comparison is that type's own
 *   operator, the one a btree index on the column is ordered by -- never
 *   the column converted to the bound's type. No plan of it is measured.
 *   A timestamp's bounds are
 *   midnights, and mean the same in every session the composition root may
 *   configure: an instant's ends in `Z`, which `timestamptz` input reads
 *   over the session's TimeZone, and is compared with the column as an
 *   instant -- cast to a zoneless `timestamp`, the bound would be read on
 *   the session's clock; a zoneless one is cast to `timestamp`, the
 *   column's own type, so it is compared on the column's clock and TimeZone
 *   never enters. Both, and a date's `YYYY-MM-DD`, are read year first
 *   under every DateStyle, which orders only the fields of input like
 *   `01/03/2026`. The list suite runs its timestamp and date cases again in
 *   a session on Pacific/Chatham with `SQL, DMY`.
 * - `contains`: the list search's own spelling (`sql/search.ts`), ILIKE
 *   with LIKE's metacharacters escaped, so it matches as a search does --
 *   through the database's default collation, so it runs on a column
 *   whose own collation is nondeterministic, which LIKE refuses (0A000).
 * - `null`, `not-null`: `is null`, `is not null`. Text of no characters is
 *   a value, as PostgreSQL always has it.
 */
export function recordFilterSql(statement: Statement, row: string, filter: RecordFilter): string {
  const column = `${row}.${quoteIdentifier(filter.column)}`
  switch (filter.op) {
    case 'equals': {
      if (filter.type.kind === 'boolean') return `${column} ${op('=')} ${statement.as(filter.value, sqlTypeOf(filter.type))}`
      return filterSql(statement, row, [{ column: filter.column, type: filter.type, value: filter.value }]).join(' and ')
    }
    case 'range': {
      const type = sqlTypeOf(filter.type)
      const bounds: string[] = []
      if (filter.from !== null) bounds.push(`${column} ${op('>=')} ${statement.as(filter.from, type)}`)
      if (filter.to !== null) bounds.push(`${column} ${op('<=')} ${statement.as(filter.to, type)}`)
      if (filter.before !== null) bounds.push(`${column} ${op('<')} ${statement.as(filter.before, type)}`)
      // listTerms refuses a range with no bound, so this is never empty.
      return bounds.join(' and ')
    }
    case 'contains':
      return searchSql(statement, row, [{ name: filter.column, type: filter.type }], filter.text)
    case 'null':
      return `${column} is null`
    case 'not-null':
      return `${column} is not null`
  }
}
