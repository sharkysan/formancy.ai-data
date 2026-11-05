import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DataClient, ListFilterTerm, LookupRow, PublishedForm } from '@formancy/data-client'
import type { GridColumn, GridRow } from './grid-datasource.js'

/*
 * The records a grid has heard of, for each of its lookup fields (0135):
 * those its rows showed, those picked in a lookup column's box or taken
 * from a cell, and those its filter names, which a view or a person's own
 * view brings without a label and which are resolved here, as a page's
 * rows are. The filter line reads and writes a lookup's condition by these
 * labels, a chip says them, and a token the page has heard no label for is
 * said as itself. A lookup's box searches the lookup through `records`.
 */

/** Each lookup field's records the grid has heard of: by field, each record's token and the label it is shown by. */
export type Known = ReadonlyMap<string, ReadonlyMap<string, string>>

export interface KnownRecords {
  known: Known
  /** Records heard of: the page's, a box's, a cell's. */
  heard: (field: string, rows: readonly LookupRow[]) => void
  /** A lookup field's records whose labels match `search`, as the person may read them, or the server's sentence. */
  records: (field: string, search: string, signal: AbortSignal) => Promise<readonly LookupRow[] | string>
}

/** Each lookup field of `definition` and the option source the server searches it by. */
function sourcesOf(definition: PublishedForm): ReadonlyMap<string, string> {
  const sources = new Map<string, string>()
  for (const field of definition.form.model.fields) {
    const source = (field as { optionsSource?: unknown }).optionsSource
    if (typeof source === 'string') sources.set(field.key, source)
  }
  return sources
}

/** `known` with `rows` heard of on `field`, or `known` itself when they say nothing new, so a page heard again renders nothing. */
function withHeard(known: Known, field: string, rows: readonly LookupRow[]): Known {
  const had = known.get(field)
  if (rows.every((row) => had?.get(row.token) === row.label)) return known
  const next = new Map(known)
  next.set(field, new Map([...(had ?? []), ...rows.map((row) => [row.token, row.label] as const)]))
  return next
}

/** The records `formId`'s grid under `filter` has heard of, and the way to hear and to search more. */
export function useKnownRecords(client: DataClient, formId: string, definition: PublishedForm, filter: readonly ListFilterTerm[]): KnownRecords {
  const sources = useMemo(() => sourcesOf(definition), [definition])
  const [known, setKnown] = useState<Known>(new Map())
  const heard = useCallback((field: string, rows: readonly LookupRow[]) => setKnown((before) => withHeard(before, field, rows)), [])

  // The filter's records the page has no label for: a view's, a person's own view's.
  const unheard = filter.flatMap((term) =>
    term.op === 'equals' && sources.has(term.field) && known.get(term.field)?.has(term.value) !== true ? [[term.field, term.value] as const] : [],
  )
  // Compared as text, so a render that asks the same is no new request.
  const asked = JSON.stringify(unheard)
  useEffect(() => {
    const pairs = JSON.parse(asked) as Array<[string, string]>
    if (pairs.length === 0) return
    const controller = new AbortController()
    const byField = new Map<string, string[]>()
    for (const [field, token] of pairs) byField.set(field, [...(byField.get(field) ?? []), token])
    for (const [field, tokens] of byField) {
      client.resolve(formId, sources.get(field) as string, { operation: 'read', tokens }, controller.signal).then(
        (named) => {
          // A label the server does not give leaves the token said as itself.
          if (named.ok) heard(field, named.value)
        },
        // Abandoned as the filter changed: the one asked after it answers.
        () => {},
      )
    }
    return () => controller.abort()
  }, [asked, client, formId, sources, heard])

  const records = useCallback(
    async (field: string, search: string, signal: AbortSignal): Promise<readonly LookupRow[] | string> => {
      const source = sources.get(field)
      if (source === undefined) return []
      const found = await client.query(formId, source, { operation: 'read', search }, signal)
      return found.ok ? found.value.rows : found.message
    },
    [client, formId, sources],
  )
  return { known, heard, records }
}

/** The records a page's rows show in each lookup column, by the labels the page resolved; a token with no label is none. */
export function pageRecords(columns: readonly GridColumn[], rows: readonly GridRow[]): Array<[string, LookupRow[]]> {
  return columns.flatMap((column): Array<[string, LookupRow[]]> => {
    if (column.source === null) return []
    const named = rows.flatMap((row) => {
      const token = row.answers[column.key]
      const label = row.labels[column.key]
      return typeof token === 'string' && label !== undefined ? [{ token, label }] : []
    })
    return named.length === 0 ? [] : [[column.key, named]]
  })
}
