import type { NormalizedType, ObjectRef } from '../metadata.js'

/**
 * The kinds a lookup's key may have: those whose values have one spelling,
 * which `lookupKeys` can check before anything is bound. A boolean, a time or
 * a timestamp has no settled one, and a float is not equal to its own
 * decimal spelling, so `buildLookupConfig` refuses a key of any other kind.
 */
export type LookupKeyType = Extract<NormalizedType, { kind: 'text' | 'integer' | 'decimal' | 'uuid' | 'date' }>

/** One column of the referenced key. */
export interface LookupKeyColumn {
  name: string
  type: LookupKeyType
}

/** One column of the order rows are offered in. */
export interface LookupSort {
  column: string
  direction: 'asc' | 'desc'
  /**
   * Where a NULL goes, whichever the direction. Stated rather than left to the
   * engine, because PostgreSQL puts NULLs last in an ascending order and SQL
   * Server puts them first. PostgreSQL spells it `NULLS FIRST` or `NULLS LAST`;
   * SQL Server has no such clause, so it orders by
   * `CASE WHEN column IS NULL THEN … END` before the column.
   */
  nulls: 'first' | 'last'
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
  /** The root's foreign key this lookup stands for, and whose target the snapshot confirms. */
  foreignKey: string
  /** The table the foreign key references. */
  target: ObjectRef
  /**
   * The columns the foreign key references — a primary or unique key of the
   * target, which the database itself requires — with their types, in the
   * foreign key's order: the order of a token's values.
   */
  targetColumns: readonly LookupKeyColumn[]
  /** The columns a label is made of, in order. */
  display: readonly string[]
  /** Display columns a typed search may match. Empty: the lookup lists but cannot be searched. */
  search: readonly string[]
  /**
   * A total order: the key columns always end it, so paging never repeats or
   * skips a row, and every column says where its NULLs go.
   */
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

/** One equality from trusted context: a column of the target table, and the canonical text of the value it must hold. */
export interface RowFilterTerm {
  readonly column: string
  readonly value: string
}

/**
 * Which rows of the target table this actor may see, from trusted context —
 * the actor's tenant, a record policy — and never from a token or a request.
 * A token names a row; these decide whether this actor may name it.
 *
 * `restricted` holds one or more equalities, all required. `unrestricted` is
 * the only way to say "every row", and somebody has to write it: an empty
 * list is what `policy?.filters ?? []` produces when there is no policy, so
 * it cannot also be the spelling of "no restriction". An adapter reads these
 * with `rowFilterTerms`, which refuses every other shape at run time, where a
 * caller in JavaScript or a policy read from JSON is not held to this type.
 *
 * Structural on purpose: the policy that produces these is defined elsewhere,
 * and this port depends on its shape, not its type.
 */
export type RowFilters = { readonly kind: 'unrestricted' } | { readonly kind: 'restricted'; readonly equal: readonly [RowFilterTerm, ...RowFilterTerm[]] }

/**
 * The lookup half of the database port, which both adapters implement and one
 * conformance suite holds them to.
 *
 * Every method takes the trusted filters, reads them with `rowFilterTerms`, and
 * applies them as part of the same query: a row outside them does not exist
 * for this call. A row whose key holds a NULL is never offered, because no
 * foreign key value can reference it. Where NULLs sort is the config's, and
 * each adapter spells it. The order of text — and of UUIDs on SQL Server — is
 * each engine's own; that is a real difference between the engines and the
 * adapters say so rather than hide it.
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
