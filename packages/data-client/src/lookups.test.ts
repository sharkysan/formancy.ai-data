import type { FieldDef, FormSchema } from '@formancy/spec'
import { acceptRemoteAnswer, capRemoteAnswer } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { optionsPage, sourceNames } from './lookups.js'

/*
 * Which names a document asks the deployment to resolve. The renderers look a
 * name up synchronously and say "this application has not provided" it when
 * the map lacks it, so a name this walk misses is a field nobody can answer.
 */

const select = (key: string, optionsSource?: string): FieldDef => ({ key, type: 'select', ...(optionsSource === undefined ? {} : { optionsSource }) })

const schema = (fields: FieldDef[]): FormSchema => ({ specVersion: '3', id: 'f', title: 'F', model: { fields } })

describe('sourceNames', () => {
  // A walk over the top level only would leave a lookup inside a group or a
  // repeater row without a source, and that field would render "not provided".
  test('names the sources of fields inside groups and repeaters', () => {
    const form = schema([
      select('customer', 'order.customer'),
      { key: 'delivery', type: 'group', fields: [select('carrier', 'order.carrier')] },
      { key: 'lines', type: 'repeater', fields: [select('product', 'line.product'), { key: 'more', type: 'group', fields: [select('unit', 'line.unit')] }] },
    ])
    expect(sourceNames(form)).toEqual(['order.customer', 'order.carrier', 'line.product', 'line.unit'])
  })

  // One name, one source: a name listed twice would be resolved into the map
  // twice and only look harmless; listed once it is also one request per search.
  test('names each source once, where the document first uses it', () => {
    const form = schema([select('billTo', 'customer'), { key: 'g', type: 'group', fields: [select('shipTo', 'customer')] }, select('other', 'region')])
    expect(sourceNames(form)).toEqual(['customer', 'region'])
  })

  // A select with written-down options, and every other field, needs nothing
  // from the server; naming one would put a source in the map for no field.
  test('a field without optionsSource is not a source', () => {
    const form = schema([select('status'), { key: 'amount', type: 'text' }, { key: 'g', type: 'group', fields: [] }])
    expect(sourceNames(form)).toEqual([])
  })
})

describe('optionsPage', () => {
  const rows = [
    { token: 'k1:1,1', label: 'First 01' },
    { token: 'k1:1,2', label: 'First 02' },
  ]

  // A search's answer as a renderer reads it (0085): the rows as value and
  // label, `more` as the server's `hasMore` and `withheld` as its `omitted`.
  // `more` guessed from the rows -- a full page "has more" -- would call a
  // list of exactly one page unfinished and a short page that goes on
  // complete; the server read one row past the page and knows (watched
  // failing with `more` as the row count reaching 50: two rows that go on
  // were `more: false`).
  test('says the list goes on exactly when the server does, whatever the page holds', () => {
    expect(optionsPage({ rows, hasMore: true, omitted: 0 })).toEqual({
      options: [
        { value: 'k1:1,1', label: 'First 01' },
        { value: 'k1:1,2', label: 'First 02' },
      ],
      more: true,
      withheld: 0,
    })
    expect(optionsPage({ rows: [], hasMore: false, omitted: 0 })).toEqual({ options: [], more: false, withheld: 0 })
  })

  // A row the server matched and could not hand over, a key too long for a
  // token (0012), is said to the person, never offered; dropped here it is a
  // row that silently is not there (watched failing with `omitted` left
  // out: the page had no `withheld`).
  test('counts the rows the server could not offer as withheld', () => {
    const page = optionsPage({ rows, hasMore: false, omitted: 2 })
    expect(page).toEqual({ options: page.options, more: false, withheld: 2 })
    const accepted = acceptRemoteAnswer(page)
    expect(accepted === undefined ? undefined : capRemoteAnswer(accepted, 50).completeness).toEqual({ kind: 'withheld', withheld: 2 })
  })

  // Both, when the server says both: which one the person reads is the
  // control's to decide -- while more rows match, a count of withheld ones
  // covers this page only (formancy.ai 0177) -- and a page that dropped
  // either would decide it here, once for both renderers.
  test('keeps both more and withheld, and the control says that more rows match', () => {
    const page = optionsPage({ rows, hasMore: true, omitted: 1 })
    expect({ more: page.more, withheld: page.withheld }).toEqual({ more: true, withheld: 1 })
    const accepted = acceptRemoteAnswer(page)
    expect(accepted === undefined ? undefined : capRemoteAnswer(accepted, 50).completeness).toEqual({ kind: 'more', shown: 2 })
  })
})
