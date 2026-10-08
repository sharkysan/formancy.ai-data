import { formatLabel } from './label.js'
import { decodeKeyToken, encodeKeyToken } from './token.js'
import type { LookupConfig, LookupResult, LookupRow } from './types.js'
import { isKeyValue } from './values.js'

/**
 * A row as an adapter read it: what each answer is built from.
 *
 * The decisions below — which tokens are asked about, how a page knows there is
 * more, when a token is a member — are the same on both engines, so they are
 * made here once. An adapter only queries and converts values with its codecs.
 */
export interface FoundRow {
  /**
   * Each target column's canonical API string, in `targetColumns` order, as
   * the row actually holds it: an integer without leading zeros, a decimal
   * padded to its scale, a UUID in lower case, a date as `YYYY-MM-DD`. Spelled
   * otherwise, a row would be offered under a token `lookupKeys` never asks about.
   */
  key: readonly string[]
  /** Each display column's canonical API string in `display` order, or `null` for SQL NULL. */
  display: ReadonlyArray<string | null>
}

function tokenFor(key: readonly string[]): string | undefined {
  const encoded = encodeKeyToken(key)
  return encoded.ok ? encoded.token : undefined
}

/** Whether decoded values are a key of this lookup: one value per key column, each spelled as that column holds it. */
function fitsKey(config: LookupConfig, values: readonly string[]): boolean {
  if (values.length !== config.targetColumns.length) return false
  // The lengths are equal, so every index has a value.
  return config.targetColumns.every((column, index) => isKeyValue(column.type, values[index] as string))
}

/**
 * The keys an adapter puts in its `IN` clause, from the tokens it was handed:
 * each distinct one that decodes to a key of this lookup, in the order it came.
 *
 * A token that does not decode, has the wrong number of columns, or holds a
 * value its column cannot hold in that spelling — `abc` or `1e3` for an
 * integer — cannot name a row, so it is not asked about and `rejectedTokens`
 * rejects it. Binding it instead would be a conversion error on one engine and
 * a quiet non-match on the other, and an error fails the whole query. An empty
 * result means: ask the database nothing — `IN ()` is a syntax error in both
 * engines. Decoding is canonical, so distinct tokens are distinct keys.
 */
export function lookupKeys(config: LookupConfig, tokens: readonly string[]): string[][] {
  const keys: string[][] = []
  for (const token of new Set(tokens)) {
    const decoded = decodeKeyToken(token)
    if (decoded.ok && fitsKey(config, decoded.values)) keys.push(decoded.values)
  }
  return keys
}

/**
 * One page, from the rows an adapter fetched for it: up to `limit + 1`, in the
 * configured order.
 *
 * The extra row says whether there is more without a `COUNT`, which on a large
 * lookup table is a scan per keystroke; it is never shown. A row whose key does
 * not fit a token is counted in `omitted`, because a row that silently is not
 * there looks like a table that does not have it. A key twice on one page is an
 * adapter that joined wrongly, and formancy would refuse the whole list for it,
 * so it is refused here, where the message can say why.
 */
export function lookupPage(fetched: readonly FoundRow[], limit: number): LookupResult {
  const rows: LookupRow[] = []
  const seen = new Set<string>()
  let omitted = 0
  for (const row of fetched.slice(0, limit)) {
    const token = tokenFor(row.key)
    if (token === undefined) {
      omitted += 1
      continue
    }
    if (seen.has(token)) throw new Error(`${token} appears twice in one page: the lookup query repeats a row`)
    seen.add(token)
    rows.push({ token, label: formatLabel(row.display, row.key) })
  }
  return { rows, hasMore: fetched.length > limit, omitted }
}

/**
 * Labels for the submitted tokens that a found row encodes to exactly, each
 * once, in the order they were submitted. A token with no such row is left
 * out, so the browser shows the stored value rather than another row's name.
 */
export function resolvedRows(tokens: readonly string[], found: readonly FoundRow[]): LookupRow[] {
  const labels = new Map<string, string>()
  for (const row of found) {
    const token = tokenFor(row.key)
    if (token !== undefined) labels.set(token, formatLabel(row.display, row.key))
  }
  const rows: LookupRow[] = []
  for (const token of new Set(tokens)) {
    const label = labels.get(token)
    if (label !== undefined) rows.push({ token, label })
  }
  return rows
}

/**
 * The submitted tokens that are not members, each once, in the order they
 * were submitted: formancy's `members` answer.
 *
 * `foundKeys` is what the adapter's query returned under the actor's filters,
 * as the rows hold it. A token is a member only when one of those re-encodes
 * to it exactly. The database's own matching is not trusted for this: under a
 * case-insensitive collation `IN ('acme')` finds the row stored as `ACME`, and
 * SQL Server's `=` ignores trailing spaces, so the database can say yes to a
 * token the lookup never offered.
 */
export function rejectedTokens(tokens: readonly string[], foundKeys: ReadonlyArray<readonly string[]>): string[] {
  const members = new Set<string>()
  for (const key of foundKeys) {
    const token = tokenFor(key)
    if (token !== undefined) members.add(token)
  }
  return [...new Set(tokens)].filter((token) => !members.has(token))
}
