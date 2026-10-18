import { decodeKeyToken } from '@formancy/data-core'
import type { FieldBinding } from '@formancy/data-core'
import type { RemoteOption, RemoteOptionsAnswer, RemoteOptionsPage } from '@formancy/spec'
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

/**
 * A search's answer: one page and whether the list goes on, as the runtime
 * plane's source answers it (0085), so the page shows what a host's control
 * says over a database. A list is refused here: it is every matching row,
 * which this source cuts to the limit it is asked for.
 */
async function paged(answer: Promise<RemoteOptionsAnswer>): Promise<RemoteOptionsPage> {
  const resolved = await answer
  if (Array.isArray(resolved)) throw new Error(`the in-memory source answered a search with a list: ${JSON.stringify(resolved)}`)
  return resolved as RemoteOptionsPage
}

/** A label request's answer: the rows it names, as a list, which says nothing of a page. */
async function listed(answer: Promise<RemoteOptionsAnswer>): Promise<readonly RemoteOption[]> {
  const resolved = await answer
  if (!Array.isArray(resolved)) throw new Error(`the in-memory source answered labels with a page: ${JSON.stringify(resolved)}`)
  return resolved
}

/** `count` customers of tenant 1, numbered from 1, each named for its number. */
function customersOf(count: number): CapturedRow[] {
  return Array.from({ length: count }, (_, index) => ({ tenant_id: '1', customer_no: String(index + 1), name: `Customer ${String(index + 1).padStart(3, '0')}` }))
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

    const { options } = await paged(
      inMemorySource(binding, customerRows()).resolve({
        ...request,
        kind: 'search',
        query: '',
        values: [],
      }),
    )

    expect(options.map((option) => ({ label: option.label, key: decodeKeyToken(option.value) }))).toEqual([
      { label: 'Muster AG', key: { ok: true, values: ['1', '1001'] } },
      { label: 'Other Tenant GmbH', key: { ok: true, values: ['2', '1001'] } },
    ])
  })

  // The two customers share a customer number in different tenants, which is
  // why the key is composite. A source that keyed on customer_no alone would
  // give both rows one value and a select could not tell them apart.
  test('gives the two tenants’ customer 1001 two different values', async () => {
    const { options } = await paged(
      inMemorySource(customerLookup(), customerRows()).resolve({
        ...request,
        kind: 'search',
        query: '',
        values: [],
      }),
    )
    expect(new Set(options.map((option) => option.value)).size).toBe(2)
  })

  // A form reopened with a stored answer asks for that value's label only.
  // Answering with every row would show a label for a value nobody chose.
  test('names only the stored values a labels request asks about', async () => {
    const source = inMemorySource(customerLookup(), customerRows())
    const all = (await paged(source.resolve({ ...request, kind: 'search', query: '', values: [] }))).options
    const second = all[1]?.value ?? ''
    const named = await listed(source.resolve({ ...request, kind: 'labels', query: '', values: [second, 'k1:9,9'] }))
    expect(named).toEqual([{ value: second, label: 'Other Tenant GmbH' }])
  })

  // The narrowing is the source's job, not the control's: a control that
  // re-filtered would drop rows the source matched on something not shown.
  test('narrows a search by what was typed, ignoring case, and honours the limit', async () => {
    const source = inMemorySource(customerLookup(), customerRows())
    const narrowed = await paged(source.resolve({ ...request, kind: 'search', query: '  gmbh ', values: [] }))
    expect(narrowed.options.map((option) => option.label)).toEqual(['Other Tenant GmbH'])
    const limited = await paged(source.resolve({ ...request, kind: 'search', query: '', values: [], limit: 1 }))
    expect(limited.options).toHaveLength(1)
  })

  // The page says whether the list goes on, as the runtime plane's does
  // (0085): cut to the limit, a list of more rows than the limit looks
  // complete, and the person is never told to keep typing. A page of
  // exactly the limit does not go on. Watched failing with the search
  // answering `.slice(0, limit)`, as it did: "the in-memory source answered
  // a search with a list".
  test('says the list goes on past the limit, and not at exactly the limit', async () => {
    const limit = request.limit
    const longer = await paged(inMemorySource(customerLookup(), customersOf(limit + 10)).resolve({ ...request, kind: 'search', query: 'customer', values: [] }))
    expect({ options: longer.options.length, more: longer.more }).toEqual({ options: limit, more: true })
    const exact = await paged(inMemorySource(customerLookup(), customersOf(limit)).resolve({ ...request, kind: 'search', query: 'customer', values: [] }))
    expect({ options: exact.options.length, more: exact.more }).toEqual({ options: limit, more: false })
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
