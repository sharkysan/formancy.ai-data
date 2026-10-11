import { FIXTURE_CUSTOMERS, SIZED_CUSTOMERS, sizedResolveKeys, sizedRowsRead } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import { CATALOGUE } from './catalogue.js'

describe('the catalogue', () => {
  // The page prints these as what the database reads; both adapters' sized
  // suites pin `sizedRowsRead()`, so the catalogue must print exactly that,
  // per form, and per key for the resolves. One the catalogue typed for
  // itself would go on printing an old count after a suite's expectation
  // changed. And the counts are the generator's, as it lays out the table.
  test("prints, per search and per resolve, the rows the adapters' sized suites pin", () => {
    const read = sizedRowsRead()
    for (const scenario of CATALOGUE.scenarios.filter((entry) => entry.name.startsWith('lookup-'))) {
      expect(scenario.rowsRead, scenario.name).toEqual({ exactly: scenario.form === 'order-unfiltered' ? read.table : read.tenant })
    }
    expect(CATALOGUE.scenarios.find((entry) => entry.name === 'resolve-100')?.rowsRead).toEqual({ atMost: read.perKey * sizedResolveKeys(100).length })
    expect(CATALOGUE.scenarios.find((entry) => entry.name === 'resolve-1')?.rowsRead).toEqual({ atMost: read.perKey })
    expect(read).toMatchObject({ tenant: (SIZED_CUSTOMERS.tenants.find((entry) => entry.tenantId === 1)?.rows ?? 0) + FIXTURE_CUSTOMERS.filter((row) => row.tenantId === 1).length, table: SIZED_CUSTOMERS.rows + FIXTURE_CUSTOMERS.length })
  })

  // The unfiltered form reads the whole table per search: at eight in
  // flight a sample batch would take minutes, and the added-latency block
  // is about round trips, which it shares with the filtered form.
  test('runs the form with no tenant row filter one request at a time, outside the latency block', () => {
    for (const scenario of CATALOGUE.scenarios.filter((entry) => entry.form === 'order-unfiltered')) {
      expect({ name: scenario.name, inFlight: scenario.inFlight, latency: scenario.latency }).toEqual({ name: scenario.name, inFlight: 'one', latency: false })
    }
    expect(CATALOGUE.scenarios.filter((entry) => entry.form === 'order-unfiltered')).toHaveLength(4)
  })

  // A name is a key in the results; two entries with one name would be one row measured twice.
  test('names each scenario once', () => {
    const names = CATALOGUE.scenarios.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
