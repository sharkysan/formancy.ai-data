import type { ObjectRef } from '../metadata.js'

/** One column of the order rows are offered in. */
export interface LookupSort {
  column: string
  direction: 'asc' | 'desc'
}

/**
 * Everything an adapter needs to answer for one lookup, and nothing it may
 * take from a request.
 *
 * Built by `buildLookupConfig` from a form's bindings and the snapshot they
 * were generated from, so every identifier in it is approved metadata. An
 * adapter quotes these names; it never receives one from the browser.
 */
export interface LookupConfig {
  /** The option-source name the form document carries, which the deployment resolves to this. */
  source: string
  /** The root's foreign key this lookup stands for. */
  foreignKey: string
  /** The table the foreign key references. */
  target: ObjectRef
  /** The referenced columns, in the foreign key's order: the order of a token's values. */
  targetColumns: readonly string[]
  /** The columns a label is made of, in order. */
  display: readonly string[]
  /** Display columns a typed search may match. Empty: the lookup lists but cannot be searched. */
  search: readonly string[]
  /** A total order: the key columns always end it, so paging never repeats or skips a row. */
  sort: readonly LookupSort[]
  maxPageSize: number
}

/** A search, as `validateLookupQuery` returns it: trimmed, bounded and checked. */
export interface LookupQuery {
  /** Literal text; empty lists every row. */
  search: string
  offset: number
  limit: number
}

/** One option: the token a select stores, and the plain-text label a person reads. */
export interface LookupRow {
  token: string
  label: string
}

export interface LookupResult {
  rows: LookupRow[]
  /** Whether rows exist past this page. The next page starts at `offset + limit`, not at `offset + rows.length`. */
  hasMore: boolean
  /**
   * Rows on this page that matched and cannot be offered, because their key
   * does not fit in a token formancy can store. Counted rather than dropped
   * silently, so an operator can tell "not there" from "not representable".
   */
  omitted: number
}

/**
 * A row restriction from trusted context — the actor's tenant, a record
 * policy — as an equality on a column of the target table. Several are all
 * required.
 *
 * Structural on purpose: the policy that produces these is defined elsewhere,
 * and this port depends on its shape, not its type. They are never read from a
 * token or a request; a token names a row, and these decide whether this actor
 * may name it. An empty list means the policy restricts no rows; it is never
 * the default for a missing policy.
 */
export type RowFilters = ReadonlyArray<{ readonly column: string; readonly value: string }>

/**
 * The lookup half of the database port, which both adapters implement and one
 * conformance suite holds them to.
 *
 * Every method takes the trusted filters, and applies them as part of the same
 * query: a row outside them does not exist for this call. A row whose key holds
 * a NULL is never offered, because no foreign key value can reference it. The
 * order of text — and of UUIDs on SQL Server — is each engine's own; that is a
 * real difference between the engines and the adapters say so rather than hide it.
 */
export interface LookupAdapter {
  /**
   * One page of rows whose search columns contain `query.search`, taken as a
   * literal: `%`, `_` and `[` match themselves. How case and accents compare is
   * each engine's collation, written down in the adapter. Built with `lookupPage`.
   */
  search(config: LookupConfig, query: LookupQuery, filters: RowFilters): Promise<LookupResult>

  /**
   * Labels for tokens a form already holds and the current page does not show.
   * A token that names no row this actor may see is left out, not an error:
   * formancy then shows the stored value. Built with `lookupKeys` and `resolvedRows`.
   */
  resolve(config: LookupConfig, tokens: readonly string[], filters: RowFilters): Promise<LookupRow[]>

  /**
   * The tokens that are NOT members: invented, malformed, another tenant's, or
   * spelled differently from the row the database matched. The shape formancy's
   * server-side `members` port asks for, so an adapter answers from an `IN`
   * clause. Built with `lookupKeys` and `rejectedTokens`. Throws when the
   * database cannot answer, which formancy turns into a refused submission.
   */
  rejects(config: LookupConfig, tokens: readonly string[], filters: RowFilters): Promise<string[]>
}

export type LookupSearch = LookupAdapter['search']
export type LookupResolve = LookupAdapter['resolve']
export type LookupMembership = LookupAdapter['rejects']
