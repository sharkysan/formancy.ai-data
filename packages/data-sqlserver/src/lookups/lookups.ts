import type { FoundRow, LookupAdapter, LookupConfig, RowFilterTerm } from '@formancy/data-core'
import { lookupKeys, lookupPage, rejectedTokens, resolvedRows, rowFilterTerms } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { run } from '../sql/statement.js'
import { fromCanonicalText } from '../sql/values.js'
import { keyGroups, keysStatement, pageStatement } from './statements.js'

/** A row as the lookup statements select it: `k0…` the key's canonical text, `d0…` each display column's. */
type Row = Record<string, string | null>

function foundRow(config: LookupConfig, row: Row): FoundRow {
  return {
    key: config.targetColumns.map((_, index) => {
      const value = row[`k${String(index)}`]
      // The statements select only rows whose key columns are all present.
      if (typeof value !== 'string') throw new Error(`${config.source}: a key column came back without a value`)
      return value
    }),
    // Decoded as a record read decodes it, so a label is spelled from the value a record holds.
    display: config.display.map((display, index) => fromCanonicalText(display.type, row[`d${String(index)}`] ?? null)),
  }
}

/**
 * The rows under the filters whose key is one of `keys`, read in as many
 * statements as the parameter limit needs, one after another so a long list
 * holds one connection rather than the pool.
 */
async function findKeys(
  pool: ConnectionPool,
  config: LookupConfig,
  keys: readonly (readonly string[])[],
  terms: readonly RowFilterTerm[],
  withDisplay: boolean,
): Promise<FoundRow[]> {
  const found: FoundRow[] = []
  for (const group of keyGroups(config, keys, terms.length)) {
    const rows = await run<Row>(pool, keysStatement(config, group, terms, withDisplay))
    for (const row of rows) found.push(foundRow(config, row))
  }
  return found
}

/**
 * The lookup half of the SQL Server adapter, through a pool the composition
 * root connected.
 *
 * Every answer is decided by `@formancy/data-core`'s helpers — which tokens
 * are asked about, how a page knows there is more, when a token is a member —
 * and this only queries. The filters are read with `rowFilterTerms` before
 * anything is built, so a request without a policy fails instead of seeing
 * every row, and they are part of the same statement as the rest.
 *
 * What SQL Server decides on its own, and the adapter does not hide: how a
 * search matches and how text orders is the column's collation, so on a
 * case-insensitive database a search for `muster` finds `Muster AG` and
 * `apple` sorts before `Banana`; and equality ignores trailing spaces, which
 * is why membership is the re-encoded row's and never the database's match
 * (0012). A filter is the exception: it compares the column's canonical value
 * with its trusted value exactly — case, accents and trailing spaces count —
 * as PostgreSQL's does, and still seeks an nvarchar column's index
 * (../sql/filters.ts, 0028). A label is the record reader's value, spelled by
 * `displayText`, so it reads the same on both engines.
 *
 * A database error propagates: a lookup that cannot answer refuses, and
 * formancy turns that into a refused submission.
 */
export function createSqlServerLookups(pool: ConnectionPool): LookupAdapter {
  return {
    async search(config, query, filters) {
      const terms = rowFilterTerms(filters)
      const rows = await run<Row>(pool, pageStatement(config, query, terms))
      return lookupPage(
        config,
        rows.map((row) => foundRow(config, row)),
        query.limit,
      )
    },

    async resolve(config, tokens, filters) {
      const terms = rowFilterTerms(filters)
      const keys = lookupKeys(config, tokens)
      if (keys.length === 0) return []
      return resolvedRows(config, tokens, await findKeys(pool, config, keys, terms, true))
    },

    async rejects(config, tokens, filters) {
      const terms = rowFilterTerms(filters)
      const keys = lookupKeys(config, tokens)
      const found = keys.length === 0 ? [] : await findKeys(pool, config, keys, terms, false)
      return rejectedTokens(
        tokens,
        found.map((row) => row.key),
      )
    },
  }
}
