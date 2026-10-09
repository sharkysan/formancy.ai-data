/**
 * Every function, operator, type and collation this adapter's SQL names is
 * PostgreSQL's own, and is named in pg_catalog (0016).
 *
 * An unqualified name is resolved through the session's `search_path`, which
 * is the composition root's to set, and which anybody may write into who can
 * CREATE in a schema on it: every login role on PostgreSQL 14 and earlier,
 * through `public`. pg_catalog is searched first unless the path names it
 * later, and that is not enough. A function or operator in a later schema
 * that matches the arguments exactly still wins over pg_catalog's candidate
 * when that one needs an implicit cast or is polymorphic: pg_catalog has no
 * `=(bigint, numeric)`, and a planted one accepted a stale write; it has only
 * a polymorphic `jsonb_populate_record`, and a planted one returned another
 * tenant's rows through the tenant filter. Qualified, a name means
 * PostgreSQL's own whatever the path says.
 *
 * What the grammar spells by itself is already qualified, and is written as
 * it is: `extract`, `at time zone`, `is not null`, and the sort operators of
 * `order by`, which come from the type's default operator class.
 */

/** The operators the adapter compares, computes and searches with. */
type Operator = '=' | '>=' | '<=' | '%' | '+' | '~~*' | '#>>'

/**
 * An operator in pg_catalog: `a operator(pg_catalog.=) b`.
 *
 * Every `OPERATOR()` has the one precedence of "any other operator" —
 * above comparison and AND, below `+` and `::` — whatever the symbol inside
 * it, so an expression mixing two of them is parenthesised where it is built.
 */
export function op(symbol: Operator): string {
  return `operator(pg_catalog.${symbol})`
}
