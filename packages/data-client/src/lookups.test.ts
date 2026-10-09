import type { FieldDef, FormSchema } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { sourceNames } from './lookups.js'

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
