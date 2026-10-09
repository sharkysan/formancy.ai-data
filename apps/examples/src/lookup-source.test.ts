import { decodeKeyToken } from '@formancy/data-core'
import type { FieldBinding } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { generateExamples } from './examples.js'
import { CAPTURED, capturedRows, inMemorySource, lookupSources } from './lookup-source.js'
import type { CapturedRow } from './lookup-source.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

const EXAMPLES = generateExamples(FIXTURE_SNAPSHOT)

function customerLookup(): LookupBinding {
  for (const example of EXAMPLES) {
    for (const binding of example.generated.bindings.fields) if (binding.kind === 'lookup') return binding
  }
  throw new Error('no example has a lookup')
}

/** The customers captured with the snapshot, found by table rather than by a joined name. */
function customerRows(): readonly CapturedRow[] {
  const found = capturedRows(CAPTURED, { schema: 'sales', name: 'customer' })
  if (found === undefined) throw new Error('no customers were captured')
  return found
}

const request = {
  source: customerLookup().source,
  path: 'customer',
  locale: 'en',
  limit: 50,
  signal: new AbortController().signal,
}

describe('the in-memory customer source', () => {
  // A select stores the option's value, and the server decodes it as the
  // referenced key (0012). A value that was the label, or the key in the wrong
  // column order, would be stored by the browser and refused by the server --
  // or worse, resolved to another row.
  test("offers each captured customer under the token of its key, in the foreign key's column order", async () => {
    const binding = customerLookup()
    expect(binding.target.columns).toEqual(['tenant_id', 'customer_no'])

    const options = await inMemorySource(binding, customerRows()).resolve({
      ...request,
      kind: 'search',
      query: '',
      values: [],
    })

    expect(options.map((option) => ({ label: option.label, key: decodeKeyToken(option.value) }))).toEqual([
      { label: 'Muster AG', key: { ok: true, values: ['1', '1001'] } },
      { label: 'Other Tenant GmbH', key: { ok: true, values: ['2', '1001'] } },
    ])
  })

  // The two customers share a customer number in different tenants, which is
  // why the key is composite. A source that keyed on customer_no alone would
  // give both rows one value and a select could not tell them apart.
  test('gives the two tenants’ customer 1001 two different values', async () => {
    const options = await inMemorySource(customerLookup(), customerRows()).resolve({
      ...request,
      kind: 'search',
      query: '',
      values: [],
    })
    expect(new Set(options.map((option) => option.value)).size).toBe(2)
  })

  // A form reopened with a stored answer asks for that value's label only.
  // Answering with every row would show a label for a value nobody chose.
  test('names only the stored values a labels request asks about', async () => {
    const source = inMemorySource(customerLookup(), customerRows())
    const all = await source.resolve({ ...request, kind: 'search', query: '', values: [] })
    const second = all[1]?.value ?? ''
    const named = await source.resolve({ ...request, kind: 'labels', query: '', values: [second, 'k1:9,9'] })
    expect(named).toEqual([{ value: second, label: 'Other Tenant GmbH' }])
  })

  // The narrowing is the source's job, not the control's: a control that
  // re-filtered would drop rows the source matched on something not shown.
  test('narrows a search by what was typed, ignoring case, and honours the limit', async () => {
    const source = inMemorySource(customerLookup(), customerRows())
    const narrowed = await source.resolve({ ...request, kind: 'search', query: '  gmbh ', values: [] })
    expect(narrowed.map((option) => option.label)).toEqual(['Other Tenant GmbH'])
    const limited = await source.resolve({ ...request, kind: 'search', query: '', values: [], limit: 1 })
    expect(limited).toHaveLength(1)
  })

  // A captured row missing a key column has no token. Offering it with a
  // guessed one would be a select that stores a reference to nothing.
  test('refuses a captured row without a key column rather than offering it', () => {
    const broken: CapturedRow[] = [{ tenant_id: '1', name: 'No number' }]
    expect(() => inMemorySource(customerLookup(), broken)).toThrow(/customer_no/)
  })

  // A key column that is NULL in the row has no canonical text either.
  test('refuses a captured row whose key column is null', () => {
    const broken: CapturedRow[] = [{ tenant_id: '1', customer_no: null, name: 'Null number' }]
    expect(() => inMemorySource(customerLookup(), broken)).toThrow(/customer_no/)
  })

  // formancy stores a select's answer in at most 200 characters, and a token
  // that would be longer is refused by the encoder rather than truncated
  // (0012). Truncated, it would name a different key or none; offered anyway,
  // the browser would refuse the whole list. So the source refuses to exist.
  test('refuses a captured key too long to be a token, naming the foreign key', () => {
    const broken: CapturedRow[] = [{ tenant_id: '1', customer_no: '9'.repeat(300), name: 'Long number' }]
    expect(() => inMemorySource(customerLookup(), broken)).toThrow(/^fk_order_customer: /)
  })

  // An abandoned request must not be answered as though it were current.
  test('rejects a request that was already abandoned', async () => {
    const controller = new AbortController()
    controller.abort()
    const source = inMemorySource(customerLookup(), customerRows())
    await expect(
      source.resolve({ ...request, kind: 'search', query: '', values: [], signal: controller.signal }),
    ).rejects.toThrow(/abandoned/)
  })
})

describe('the options map the page hands both renderers', () => {
  // The document names a source and the deployment resolves it (formancy.ai
  // 0077). A lookup with no entry renders a message where the chooser would
  // be, so every lookup the examples generate must have one, under the exact
  // name the document carries.
  test('has a source under the name every generated lookup carries', () => {
    const sources = lookupSources(EXAMPLES, CAPTURED)
    const named = EXAMPLES.flatMap((example) =>
      example.generated.bindings.fields.flatMap((binding) => (binding.kind === 'lookup' ? [binding.source] : [])),
    )
    expect(named.length).toBeGreaterThan(0)
    expect(Object.keys(sources).sort()).toEqual([...named].sort())
  })

  // A lookup whose target has no captured rows gets no source, and the
  // renderer says so on screen. Inventing an empty list would show a chooser
  // with nothing in it and call that the feature.
  test('leaves out a lookup whose target table has no captured rows', () => {
    expect(lookupSources(EXAMPLES, [])).toEqual({})
  })
})
