import { lookupKeys, lookupPage, rejectedTokens, resolvedRows, rowFilterTerms } from '@formancy/data-core'
import type { FoundRow, LookupAdapter, LookupConfig } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { run } from '../sql/statement.js'
import type { TextRow } from '../sql/statement.js'
import { decodeCanonical } from '../sql/values.js'
import { keysStatement, searchStatement } from './sql.js'

/**
 * The rows a lookup query returned: the key as canonical text, and each
 * display value decoded by its column's type, as a record read decodes it,
 * for `displayText` to spell (0028).
 *
 * A key column is never NULL here — searches exclude such rows, and an `IN`
 * never matches one — but a NULL that arrived anyway is kept as one, and
 * `lookupPage` counts it as a row that cannot be offered rather than this
 * inventing a value for it.
 */
function foundRows(config: LookupConfig, rows: readonly TextRow[]): FoundRow[] {
  const width = config.targetColumns.length
  return rows.map((row) => ({
    key: row.slice(0, width) as string[],
    display: config.display.map((column, index) => decodeCanonical(column.type, row[width + index] ?? null)),
  }))
}

/**
 * The lookup half of the operations port on PostgreSQL (0012, 0016).
 *
 * Each method reads the actor's filters with `rowFilterTerms` before
 * anything else, so filters that say nothing throw before the database is
 * asked, and applies them in the same statement as everything else. Which
 * tokens are asked about, how a page knows there is more, how a label is
 * spelled and membership are the core's helpers, so this adapter decides
 * none of them.
 *
 * A database error is thrown, not answered: formancy refuses a submission
 * whose membership check throws (formancy.ai 0022), and a search that throws
 * shows the person an error rather than an empty list.
 */
export function createPostgresLookups(sql: Sql): LookupAdapter {
  return {
    async search(config, query, filters) {
      const statement = searchStatement(config, query, rowFilterTerms(filters))
      const result = await run(sql, statement.text, statement.params)
      return lookupPage(config, foundRows(config, result.rows), query.limit)
    },

    async resolve(config, tokens, filters) {
      const terms = rowFilterTerms(filters)
      const keys = lookupKeys(config, tokens)
      if (keys.length === 0) return []
      const statement = keysStatement(config, keys, terms, true)
      const result = await run(sql, statement.text, statement.params)
      return resolvedRows(config, tokens, foundRows(config, result.rows))
    },

    async rejects(config, tokens, filters) {
      const terms = rowFilterTerms(filters)
      const keys = lookupKeys(config, tokens)
      if (keys.length === 0) return rejectedTokens(tokens, [])
      const statement = keysStatement(config, keys, terms, false)
      const result = await run(sql, statement.text, statement.params)
      return rejectedTokens(
        tokens,
        foundRows(config, result.rows).map((row) => row.key),
      )
    },
  }
}
