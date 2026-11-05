import { describe, expect, test } from 'vitest'
import type { GridColumn, GridRow } from './grid-datasource.js'
import { pageRecords } from './known-records.js'

/*
 * The records a grid hears of from its own pages (0135): what each lookup
 * column's cells show, by the labels the page resolved. The line, the
 * chips and the boxes say a lookup's condition by these labels; the rest of
 * what a grid hears of -- a box's pick, a cell's example, a view's tokens
 * resolved -- is the page's against the real server (filter.test.tsx).
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
