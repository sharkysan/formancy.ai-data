import { describe, expect, test } from 'vitest'
import { COLUMN_FILTER_PARITY, COLUMN_FILTER_ROWS } from './column-filters.js'
import { LIST_ROWS } from './lists.js'
import { FIXTURE_CUSTOMERS } from './sized.js'

/*
 * The column filters' expectations (0104), held to the rows they are about
 * before any suite holds an adapter to them: an instant's day worked out by
 * hand in the wrong offset would fail both engines' suites for the
 * fixture's mistake, and look like the adapters agreeing on a wrong answer.
 */

const DAY = 24 * 60 * 60 * 1000

/** The midnight starting `day` on a clock read as UTC, in milliseconds. */
const midnight = (day: string): number => Date.parse(`${day}T00:00:00Z`)

/** Whether `at` is in the whole days from `from` to `to`, either end left open by `null`. */
const within = (at: number, from: string | null, to: string | null): boolean => (from === null || at >= midnight(from)) && (to === null || at < midnight(to) + DAY)

describe('COLUMN_FILTER_ROWS', () => {
  // The suites update these customers rather than insert them; a number
  // that is not tenant 1's would update nothing, and its expectation would
  // be about a row no suite has.
  test("gives values to tenant 1's customers, each once", () => {
    const tenant = [...FIXTURE_CUSTOMERS.filter((row) => row.tenantId === 1).map((row) => String(row.customerNo)), ...LIST_ROWS.customers.map(([number]) => number)]
    expect(COLUMN_FILTER_ROWS.customers.map(([number]) => number)).toEqual(tenant)
  })

  // A tracking number twice in one tenant is uq_shipment_tracking's
  // violation before anything is filtered, and one in upper case would be
  // read back in lower and match no expectation spelled as written.
  test('inserts shipments with tracking numbers of their own, in lower case', () => {
    const numbers = COLUMN_FILTER_ROWS.shipments.map(([, tracking]) => tracking)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers.filter((number) => number !== number.toLowerCase())).toEqual([])
  })
})

describe('COLUMN_FILTER_PARITY', () => {
  // The instants are written in three offsets: the day each is in is UTC's,
  // which Date.parse reads them in, never the day their own clock shows.
  test('instant: each range holds the customers whose instant is in its days in UTC', () => {
    for (const { from, to, keys } of COLUMN_FILTER_PARITY.instant.entries) {
      const inside = COLUMN_FILTER_ROWS.customers.filter(([, at]) => within(Date.parse(at), from, to)).map(([number]) => number)
      expect(inside, `${String(from)}..${String(to)}`).toEqual(keys)
    }
  })

  // A zoneless timestamp is compared on its own clock: read as UTC here,
  // which moves nothing, and NULL in no range.
  test('zoneless: each range holds the shipments dispatched in its days on their own clock', () => {
    for (const { from, to, references } of COLUMN_FILTER_PARITY.zoneless.entries) {
      const inside = COLUMN_FILTER_ROWS.shipments.filter(([, , at]) => at !== null && within(Date.parse(`${at}Z`), from, to)).map(([reference]) => reference)
      expect(inside, `${String(from)}..${String(to)}`).toEqual(references)
    }
  })

  // Text equals exactly: every unit counts, a trailing space included.
  test('text and uuid: each value names the shipments that hold it exactly', () => {
    for (const { value, references } of COLUMN_FILTER_PARITY.text.entries) {
      expect(COLUMN_FILTER_ROWS.shipments.filter(([reference]) => reference === value).map(([reference]) => reference), JSON.stringify(value)).toEqual(references)
    }
    const { value, references } = COLUMN_FILTER_PARITY.uuid
    expect(value).not.toBe(value.toLowerCase())
    expect(COLUMN_FILTER_ROWS.shipments.filter(([, tracking]) => tracking === value.toLowerCase()).map(([reference]) => reference)).toEqual(references)
  })

  // The flags are set by the update the instants are: an expectation typed
  // from memory of which customer is inactive would hold the adapters to it.
  test('boolean: each value names the customers that hold it', () => {
    for (const { condition, keys } of COLUMN_FILTER_PARITY.boolean.entries) {
      expect(COLUMN_FILTER_ROWS.customers.filter(([, , active]) => String(active) === condition.value).map(([number]) => number)).toEqual(keys)
    }
  })
})
