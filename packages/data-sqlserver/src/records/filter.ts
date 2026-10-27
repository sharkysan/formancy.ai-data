import type { NormalizedType, RecordFilter } from '@formancy/data-core'
import mssql from 'mssql'
import { filterPredicate } from '../sql/filters.js'
import { quoteName } from '../sql/quote.js'
import { searchPredicate } from '../sql/search.js'
import type { Parameters } from '../sql/statement.js'
import { bindValue } from '../sql/values.js'

/** datetime2's largest scale: seven fractional digits. */
const MAX_SCALE = 7

/**
 * A zoneless timestamp's bound, a midnight `YYYY-MM-DDT00:00:00`, as
 * datetime2 of the column's scale, through style 126, which reads ISO 8601
 * whatever the session's language and DATEFORMAT. `bindValue` has no case
 * for it: a zoneless timestamp is never written (0009).
 *
 * datetime2, never the column's own type when that is datetime or
 * smalldatetime, which the snapshot cannot tell from datetime2(3) and
 * datetime2(0) (`discovery/types.ts`). It needs to be none of them: a
 * midnight is exact at every scale, and each of the three converts to
 * datetime2 exactly, a datetime's 1/300 s included -- 23:59:59.997 is
 * below the next midnight however it is carried -- so the comparison holds
 * at midnight on every column. A bound converted to the column's type
 * would round it to what that type keeps, and a smalldatetime would
 * overflow outside 1900 to 2079, failing the statement where datetime2
 * holds every day both engines store. The scale is the column's, so a
 * datetime2 column meets a bound of its own type; it is spliced, because
 * SQL Server takes no parameter there, and checked to be one before it is.
 */
function zonelessBound(parameters: Parameters, type: Extract<NormalizedType, { kind: 'timestamp' }>, value: string): string {
  const scale = type.precision ?? MAX_SCALE
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) throw new Error(`A SQL Server datetime2's scale is 0 to ${String(MAX_SCALE)}`)
  return `convert(datetime2(${String(scale)}), ${parameters.add(mssql.NVarChar(mssql.MAX), value)}, 126)`
}

/** One bound of a range, typed as its column: as a value is bound (`sql/values.ts`), or a zoneless timestamp's midnight. */
function boundOf(parameters: Parameters, type: Extract<RecordFilter, { op: 'range' }>['type'], value: string): string {
  return type.kind === 'timestamp' && !type.withTimeZone ? zonelessBound(parameters, type, value) : bindValue(parameters, type, value)
}

/**
 * One condition of a person's filter (0104) as a predicate on `row`, each
 * value bound, never spliced. What each condition means is data-core's
 * (`RecordFilter`); this is how SQL Server is told it, and where it would
 * otherwise mean something else than PostgreSQL does, that is said.
 *
 * - `equals` on text, an integer, a decimal, a uuid or a date is exactly a
 *   row filter's predicate (`sql/filters.ts`, 0028): `=` in the column's
 *   own collation, for its index, then BIN2 and the byte lengths, so under
 *   the fixture's case-insensitive collation `ag` is not `AG`, and `AG ` is
 *   not `AG` though `=` ignores trailing spaces. On a boolean, bit
 *   equality.
 * - `range`: at least `from`, at most `to`, below `before`, each bound
 *   typed as its column (`boundOf`). An instant's bound ends in `Z` and is
 *   a datetimeoffset in UTC; datetimeoffset compares instants, whatever
 *   offset each row was written in, as PostgreSQL's timestamptz does.
 * - `contains`: the list search's own predicate (`sql/search.ts`), LIKE
 *   with `%`, `_` and `[` escaped. It folds case and accents as the
 *   column's collation does, where PostgreSQL's ILIKE folds case alone and
 *   under any collation: the search's difference, which the README names.
 * - `null`, `not-null`: `is null`, `is not null`. A varchar of no
 *   characters is a value, as PostgreSQL's is.
 */
export function recordFilterPredicate(parameters: Parameters, row: string, filter: RecordFilter): string {
  const column = `${row}.${quoteName(filter.column)}`
  switch (filter.op) {
    case 'equals':
      if (filter.type.kind === 'boolean') return `${column} = ${bindValue(parameters, filter.type, filter.value === 'true')}`
      return filterPredicate(parameters, column, { column: filter.column, type: filter.type, value: filter.value })
    case 'range': {
      const bounds: string[] = []
      if (filter.from !== null) bounds.push(`${column} >= ${boundOf(parameters, filter.type, filter.from)}`)
      if (filter.to !== null) bounds.push(`${column} <= ${boundOf(parameters, filter.type, filter.to)}`)
      if (filter.before !== null) bounds.push(`${column} < ${boundOf(parameters, filter.type, filter.before)}`)
      // listTerms refuses a range with no bound, so this is never empty.
      return bounds.join(' and ')
    }
    case 'contains':
      return searchPredicate(parameters, row, [{ name: filter.column, type: filter.type }], filter.text)
    case 'null':
      return `${column} is null`
    case 'not-null':
      return `${column} is not null`
  }
}
