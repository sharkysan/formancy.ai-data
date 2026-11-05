import { describe, expect, test } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { DataClient, ListFilterTerm, PublishedForm } from '@formancy/data-client'
import type { GridColumn, GridRow } from './grid-datasource.js'
import { pageRecords, useKnownRecords } from './known-records.js'

/*
 * The records a grid hears of (0135): what each lookup column's cells show,
 * by the labels the page resolved, and the records its filter names, which
 * a view brings without labels and the grid asks the server for -- here of
 * a stand-in for the client's resolve, which rejects what is abandoned as
 * the client does. The line, the chips and the boxes say a lookup's
 * condition by these labels; a box's pick and a cell's example are the
 * page's against the real server (lookup-filter.test.tsx).
 */

const column = (key: string, source: string | null): GridColumn => ({ key, label: key, sortable: false, source })
const row = (answers: Record<string, unknown>, labels: Record<string, string>): GridRow => ({ id: 'k1:1', record: 'k1:1', version: null, answers, labels })

describe('the records a page shows', () => {
  // Each lookup column's tokens with the labels its cells show; a token
  // the server gave no label for is no record the line could name by one,
  // an empty cell none at all, and a column that is no lookup's never one
  // (watched failing with a token heard by itself where it had no label:
  // the second row's customer was a record called k1:1,1002).
  test('are each lookup column’s tokens, by the labels its cells show', () => {
    const rows = [
      row({ customer: 'k1:1,1001', order_date: '2026-10-08' }, { customer: 'Muster AG' }),
      row({ customer: 'k1:1,1002', order_date: '2026-10-09' }, {}),
      row({ customer: null, order_date: '2026-10-10' }, {}),
    ]
    expect(pageRecords([column('customer', 'pg-order.customer'), column('order_date', null)], rows)).toEqual([
      ['customer', [{ token: 'k1:1,1001', label: 'Muster AG' }]],
    ])
    expect(pageRecords([column('order_date', null)], rows)).toEqual([])
  })
})

describe('the records a filter names', () => {
  // A view's records come without labels: the grid resolves them, and a
  // resolve the filter changed under is abandoned, its rejection heard and
  // dropped (watched failing: the abandoned resolve was an unhandled
  // rejection), and the one asked after it is heard.
  test('are resolved by their labels, an abandoned resolve dropped', async () => {
    const asked: string[][] = []
    const client = {
      resolve: (_form: string, _source: string, request: { tokens: readonly string[] }, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          asked.push([...request.tokens])
          signal?.addEventListener('abort', () => reject(new DOMException('The resolve was abandoned.', 'AbortError')))
          setTimeout(() => resolve({ ok: true, value: request.tokens.map((token) => ({ token, label: token === 'k1:1' ? 'Ada' : 'Grace' })) }), 20)
        }),
    } as unknown as DataClient
    const definition = {
      form: { model: { fields: [{ key: 'approved_by', type: 'select', optionsSource: 'pg-order.approved_by' }] } },
    } as unknown as PublishedForm
    const on = (value: string): ListFilterTerm[] => [{ field: 'approved_by', op: 'equals', value }]
    const { result, rerender } = renderHook(({ filter }) => useKnownRecords(client, 'pg-order', definition, filter), { initialProps: { filter: on('k1:1') } })
    rerender({ filter: on('k1:2') })
    await waitFor(() => expect(result.current.known.get('approved_by')?.get('k1:2')).toBe('Grace'))
    expect(asked).toEqual([['k1:1'], ['k1:2']])
  })
})
