import type { CheckMeta, DomainMeta } from '@formancy/data-core'
import { op } from '../sql/catalog.js'

/*
 * What a column of pg_attribute `a` holds when its type is a domain, or an
 * enum (0170): the facts discovery reads of it, and that the root's
 * description reads again (0041), from one join, so the two cannot read a
 * domain apart.
 *
 * A domain's `typbasetype` is the type it was declared over, which may be
 * another domain, so the chain is walked to the first type that is not one,
 * as `checks.ts` walks it for a row type. What the column holds is that
 * type's: its name and schema, and the modifier the innermost domain was
 * declared with -- a column of a domain carries none of its own (`-1`), and
 * no domain over a domain may declare one. Every domain of the chain holds
 * every row to its checks; one declared NOT NULL refuses NULL however the
 * column is declared; and the nearest with a default gives it where the
 * column has none of its own. An enum's labels are `pg_enum`'s rows for the
 * base type, in `enumsortorder`, the order the engine sorts and compares
 * them in; an enum of no labels is `[]`, and a type that is no enum, NULL.
 *
 * Everything is named in pg_catalog and every operator spelled with its
 * schema (`catalog.ts`): the description runs under the session's own
 * search_path. pg_type and pg_enum show every role every type, as pg_class
 * shows it every table (0006), so nothing here is ever out of sight.
 */

/**
 * The join, aliased `dom`: `base`, the oid of the type at the chain's end
 * -- the column's own type where it is no domain --; `is_domain`, whether
 * it is one; `modifier`, the innermost domain's, NULL where there is none;
 * `not_null`, whether a domain of the chain is NOT NULL; `default_bin`, the
 * nearest domain's default as its node tree; and `domains`, the chain
 * outermost first with each domain's checks, as jsonb text, NULL where the
 * type is no domain. A domain's NOT NULL is read as a column's is
 * (`NOT_NULL` in `columns.ts`, 0077): one PostgreSQL 18 catalogs as added
 * NOT VALID, with rows it never checked, is none. Joined after pg_attribute
 * `a`, it joins the base type as `bt`, in namespace `bn`.
 */
export const DOMAIN_CHAIN = `left join lateral (
  with recursive chain(oid, depth) as (
    select a.atttypid, 0
    union all
    select t.typbasetype, chain.depth ${op('+')} 1
    from chain join pg_catalog.pg_type t on t.oid ${op('=')} chain.oid
    where t.typtype ${op('=')} 'd'
  ),
  domains(oid, depth, nspname, typname, modifier, not_null, default_bin) as (
    select t.oid, chain.depth, n.nspname, t.typname, t.typtypmod,
      t.typnotnull and not exists (
        select from pg_catalog.pg_constraint nn
        where nn.contypid ${op('=')} t.oid and nn.contype ${op('=')} 'n' and not nn.convalidated),
      t.typdefaultbin
    from chain
    join pg_catalog.pg_type t on t.oid ${op('=')} chain.oid
    join pg_catalog.pg_namespace n on n.oid ${op('=')} t.typnamespace
    where t.typtype ${op('=')} 'd'
  )
  select
    (select chain.oid from chain order by chain.depth desc limit 1) as base,
    (select domains.modifier from domains order by domains.depth desc limit 1) as modifier,
    exists (select from domains) as is_domain,
    coalesce((select pg_catalog.bool_or(domains.not_null) from domains), false) as not_null,
    (select domains.default_bin from domains where domains.default_bin is not null order by domains.depth limit 1) as default_bin,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'schema', domains.nspname,
        'name', domains.typname,
        'checks', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', k.conname,
            'expression', pg_catalog.pg_get_expr(k.conbin, 0),
            'enforced', coalesce((pg_catalog.to_jsonb(k) operator(pg_catalog.->>) 'conenforced')::pg_catalog.bool, true),
            'validated', k.convalidated) order by k.conname)
          from pg_catalog.pg_constraint k
          where k.contypid ${op('=')} domains.oid and k.contype ${op('=')} 'c'), '[]'::pg_catalog.jsonb)
      ) order by domains.depth)
      from domains)::pg_catalog.text as domains
) dom on true
join pg_catalog.pg_type bt on bt.oid ${op('=')} dom.base
join pg_catalog.pg_namespace bn on bn.oid ${op('=')} bt.typnamespace`

/** The modifier of what column `a` holds: the innermost domain's, or the column's own. */
export const HELD_MODIFIER = `coalesce(dom.modifier, a.atttypmod)`

/** The base type's labels, in the engine's order, as jsonb text: `[]` for an enum of none, NULL for a type that is no enum. */
export const LABELS = `case when bt.typtype ${op('=')} 'e' then coalesce((
    select pg_catalog.jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid ${op('=')} bt.oid
  ), '[]'::pg_catalog.jsonb)::pg_catalog.text end`

/** What `DOMAIN_CHAIN`'s `domains` text holds for one domain. */
interface DomainRow {
  schema: string
  name: string
  checks: CheckMeta[]
}

/** The labels `LABELS` read, or `null` where the type is no enum. */
export function labelsOf(text: string | null): string[] | null {
  if (text === null) return null
  const labels: unknown = JSON.parse(text)
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === 'string')) throw new Error("pg_enum's labels did not read as a list of text")
  return labels
}

/** The chain `DOMAIN_CHAIN` read, outermost first, or `undefined` where the type is no domain. */
export function domainsOf(text: string | null): DomainMeta[] | undefined {
  if (text === null) return undefined
  const rows = JSON.parse(text) as DomainRow[]
  return rows.map((row) => ({
    ref: { schema: row.schema, name: row.name },
    checks: row.checks.map((check) => ({ name: check.name, expression: check.expression, enforced: check.enforced, validated: check.validated })),
  }))
}
