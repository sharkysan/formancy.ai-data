import type { LookupConfig, LookupQuery, RowFilterTerm } from '@formancy/data-core'
import mssql from 'mssql'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { bindFilterValue, bindValue, canonicalText } from '../sql/values.js'

/**
 * The parameters one statement may bind. SQL Server's message says "a maximum
 * of 2100 parameters", and a request with 2099 is refused with 8003: the
 * driver sends every parameterised statement through `sp_executesql`, whose
 * own `@stmt` and `@params` are two of the 2100. Measured against SQL Server
 * 2022 through `tedious` on 2026-10-09; the lookup suite holds the edge.
 */
export const PARAMETER_LIMIT = 2098

/** The table, under one alias every column is qualified with, so a column called `v` or `k0` cannot be mistaken for the key list's. */
const TARGET = '[target]'

function column(name: string): string {
  return `${TARGET}.${quoteName(name)}`
}

/** The key, each column as the canonical text a token is made of: `[k0]`, `[k1]`, … */
function keySelect(config: LookupConfig): string[] {
  return config.targetColumns.map((key, index) => `${canonicalText(key.type, column(key.name))} as [k${String(index)}]`)
}

/**
 * The display columns as text, `[d0]`, `[d1]`, … The configuration names
 * them without their types — it carries types for the key alone — so they
 * are spelled by SQL Server's ISO style 126, which is exact for text,
 * integers, decimals and dates and is not the canonical spelling of a bit, a
 * uuid or a timestamp (0017). A label is for recognising a row; the token
 * identifies it.
 */
function displaySelect(config: LookupConfig): string[] {
  return config.display.map((name, index) => `convert(nvarchar(max), ${column(name)}, 126) as [d${String(index)}]`)
}

/** A row whose key holds a NULL cannot be referenced by any foreign key value, so it is never offered. */
function keysPresent(config: LookupConfig): string[] {
  return config.targetColumns.map((key) => `${column(key.name)} is not null`)
}

/** The actor's trusted filters, in the same WHERE as everything else: a row outside them does not exist for this call. */
function filtered(parameters: Parameters, terms: readonly RowFilterTerm[]): string[] {
  return terms.map((term) => `${column(term.column)} = ${bindFilterValue(parameters, term.value)}`)
}

/**
 * The search as a LIKE pattern that matches only itself: `\` is the escape,
 * and the escape, `%`, `_` and `[` are escaped by it. `[` too, because
 * SQL Server reads `[a-c]` as a character class; `]`, `^` and `-` mean
 * something only inside one.
 */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_[]/g, (character) => `\\${character}`)}%`
}

/**
 * The configured order, made explicit about NULLs: SQL Server puts them first
 * in an ascending order and has no NULLS LAST, so each column is preceded by
 * a CASE that places them where the configuration says. Text is ordered by
 * the column's collation — the server's rule, not code-point order — and the
 * key that ends every order makes it total, because a key is unique under that
 * same collation.
 *
 * The direction is spliced, because SQL Server takes no parameter for ASC or
 * DESC, so it is checked to be one of the two first: `buildLookupConfig` only
 * writes those, but this is handed a configuration, and one read from a
 * bundle altered where it is stored must not run as a statement.
 */
function orderBy(config: LookupConfig): string {
  return config.sort
    .flatMap((sort) => {
      if (sort.direction !== 'asc' && sort.direction !== 'desc') throw new Error(`${config.source}: ${sort.column} sorts asc or desc`)
      const name = column(sort.column)
      const [nullRank, valueRank] = sort.nulls === 'first' ? ['0', '1'] : ['1', '0']
      return [`case when ${name} is null then ${nullRank} else ${valueRank} end`, `${name} ${sort.direction}`]
    })
    .join(', ')
}

/**
 * One page: up to `limit + 1` rows, so `lookupPage` can tell whether there is
 * more without a COUNT. The search is one parameter, matched against each
 * search column with LIKE; an integer column is converted by the server to
 * the same decimal text a label shows.
 */
export function pageStatement(config: LookupConfig, query: LookupQuery, terms: readonly RowFilterTerm[]): Statement {
  const parameters = new Parameters()
  const where = [...keysPresent(config), ...filtered(parameters, terms)]
  if (query.search !== '') {
    if (config.search.length === 0) throw new Error(`${config.source} has no searchable column`)
    const pattern = parameters.add(mssql.NVarChar(mssql.MAX), containsPattern(query.search))
    where.push(`(${config.search.map((name) => `${column(name)} like ${pattern} escape N'\\'`).join(' or ')})`)
  }
  const offset = parameters.add(mssql.BigInt, query.offset)
  const fetch = parameters.add(mssql.Int, query.limit + 1)
  return parameters.statement(
    `select ${[...keySelect(config), ...displaySelect(config)].join(', ')} from ${quoteTable(config.target)} as ${TARGET}
    where ${where.join(' and ')}
    order by ${orderBy(config)}
    offset ${offset} rows fetch next ${fetch} rows only`,
  )
}

/**
 * The rows, under the filters, whose key is one of `keys`. The keys travel as
 * a table value constructor joined by EXISTS, so a composite key is compared
 * column by column, each value converted to its key column's type, and a row
 * is returned at most once however many keys the database finds equal to it.
 */
export function keysStatement(config: LookupConfig, keys: readonly (readonly string[])[], terms: readonly RowFilterTerm[], withDisplay: boolean): Statement {
  const parameters = new Parameters()
  const where = filtered(parameters, terms)
  const rows = keys.map((key) => `(${config.targetColumns.map((target, index) => bindValue(parameters, target.type, key[index] ?? null)).join(', ')})`)
  const names = config.targetColumns.map((_, index) => `[k${String(index)}]`)
  const matches = config.targetColumns.map((target, index) => `${column(target.name)} = [v].[k${String(index)}]`)
  where.push(`exists (select 1 from (values ${rows.join(', ')}) as [v] (${names.join(', ')}) where ${matches.join(' and ')})`)
  const select = withDisplay ? [...keySelect(config), ...displaySelect(config)] : keySelect(config)
  return parameters.statement(`select ${select.join(', ')} from ${quoteTable(config.target)} as ${TARGET} where ${where.join(' and ')}`)
}

/**
 * The keys in groups that each fit one statement: every key binds one
 * parameter per key column, and the filters bind theirs in every group.
 * Splitting makes resolve and rejects several reads rather than one, so a row
 * changed between two of them is seen as it was when its own group ran.
 */
export function keyGroups(config: LookupConfig, keys: readonly (readonly string[])[], filterCount: number): (readonly string[])[][] {
  const size = Math.floor((PARAMETER_LIMIT - filterCount) / config.targetColumns.length)
  if (size < 1) throw new Error(`${config.source}: ${String(filterCount)} filters leave no parameter for a key`)
  const groups: (readonly string[])[][] = []
  for (let start = 0; start < keys.length; start += size) groups.push(keys.slice(start, start + size))
  return groups
}
