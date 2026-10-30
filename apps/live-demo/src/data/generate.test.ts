import { LIST_PAGE_SIZE } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { generateDemoData } from './generate.js'
import { demoDataProblems } from './invariants.js'
import { ANCHOR, DEMO_SEED, PER_TENANT, RECENT_DAYS, TENANTS, dayNumber, dayOf, firstOrderDay } from './model.js'
import { seeded, stream } from './random.js'
import { COUNTRIES, STEMS, TENANT_COUNTRIES, TRADES } from './words.js'

/**
 * The live demo's sample data, as generated: every invariant invariants.ts
 * names holds on it, it is the same rows on every run, and it has every case
 * a visitor is meant to meet. The invariants are proved to refuse what they
 * name in invariants.test.ts; here they are asked of the real thing.
 */
const data = generateDemoData()

/** Map.groupBy, which ES2023's library does not declare. */
function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

describe('the demo data', () => {
  // The whole list at once, so a generator change that breaks any of them --
  // an amount a cent off its lines, a placed order with a delivery, a town in
  // the wrong country -- fails here, naming the row, before an image is built.
  test('holds every invariant', () => {
    expect(demoDataProblems(data)).toEqual([])
  })

  // The image is rebuilt on every push; a generator that read the clock or
  // Math.random would load other rows each time, and every number the
  // documents cite from them would be one build's.
  test('is the same rows every time it is generated', () => {
    expect(generateDemoData()).toEqual(data)
    expect(generateDemoData(DEMO_SEED)).toEqual(data)
  })

  // A generator that ignored its seed would pass the test above by being
  // constant; the seed must be what the rows come from.
  test('is other rows from another seed, and those hold the invariants too', () => {
    const other = generateDemoData(DEMO_SEED + 1)
    expect(other.customers.map((customer) => customer.name)).not.toEqual(data.customers.map((customer) => customer.name))
    expect(other.orders.map((order) => order.orderDate)).not.toEqual(data.orders.map((order) => order.orderDate))
    expect(demoDataProblems(other)).toEqual([])
  })

  // Two personas of two tenants see as much as each other, and an order list
  // shorter than nine pages of the host's grid would leave its pager
  // something a visitor never uses.
  test('gives both tenants as many customers and orders, more than eight pages of orders each', () => {
    for (const tenant of TENANTS) {
      expect(data.customers.filter((customer) => customer.tenantId === tenant)).toHaveLength(PER_TENANT.customers)
      const orders = data.orders.filter((order) => order.tenantId === tenant)
      expect(orders).toHaveLength(PER_TENANT.orders)
      expect(Math.ceil(orders.length / LIST_PAGE_SIZE)).toBeGreaterThanOrEqual(9)
    }
  })

  // The invariants only refuse what is wrong; they cannot say the data shows
  // anything. A generator that never drew a draft, a split delivery or a
  // customer without a credit limit would hold every invariant and leave the
  // demo without the case. Each is asked for in each tenant.
  test('has, in each tenant, every case a visitor is meant to meet', () => {
    const anchor = dayNumber(ANCHOR)
    for (const tenant of TENANTS) {
      const customers = data.customers.filter((customer) => customer.tenantId === tenant)
      const orders = data.orders.filter((order) => order.tenantId === tenant)
      const ids = new Set(orders.map((order) => order.id))
      const recent = orders.filter((order) => anchor - dayNumber(order.orderDate) <= RECENT_DAYS)
      const old = orders.filter((order) => anchor - dayNumber(order.orderDate) > RECENT_DAYS)
      const deliveries = data.deliveries.filter((delivery) => ids.has(delivery.orderId))
      const perOrder = groupBy(deliveries, (delivery) => delivery.orderId)
      const linesPerOrder = groupBy(
        data.lines.filter((line) => ids.has(line.orderId)),
        (line) => line.orderId,
      )

      expect(new Set(recent.map((order) => order.status)), `tenant ${String(tenant)}'s last three weeks`).toEqual(new Set(['draft', 'placed', 'shipped']))
      expect(
        old.some((order) => order.status === 'placed'),
        `tenant ${String(tenant)}: an old order still placed`,
      ).toBe(true)
      expect(
        [...perOrder.values()].some((list) => list.length === 2),
        `tenant ${String(tenant)}: a split delivery`,
      ).toBe(true)
      expect(new Set([...linesPerOrder.values()].map((lines) => lines.length)), `tenant ${String(tenant)}: one to six lines`).toEqual(
        new Set([1, 2, 3, 4, 5, 6]),
      )
      expect(
        orders.some((order) => order.notes !== null),
        `tenant ${String(tenant)}: a note`,
      ).toBe(true)
      expect(
        customers.some((customer) => customer.creditLimitCents === null),
        `tenant ${String(tenant)}: no credit limit`,
      ).toBe(true)
      expect(
        customers.some((customer) => !customer.active),
        `tenant ${String(tenant)}: an inactive customer`,
      ).toBe(true)
      expect(new Set(customers.map((customer) => customer.countryCode)), `tenant ${String(tenant)}'s countries`).toEqual(
        new Set(TENANT_COUNTRIES[tenant].map(([code]) => code)),
      )
      const towns = COUNTRIES.flatMap((country) => country.regions.flatMap((region) => region.towns))
      expect(
        customers.some((customer) => towns.some((town) => ` ${customer.name} `.includes(` ${town} `))),
        `tenant ${String(tenant)}: a name with a town`,
      ).toBe(true)
      expect(
        customers.some((customer) => !towns.some((town) => ` ${customer.name} `.includes(` ${town} `))),
        `tenant ${String(tenant)}: a name without one`,
      ).toBe(true)
    }
  })

  // A name is read as a town or a legal form by the words it contains
  // (invariants.ts). A family name that was also a town, or one town in two
  // countries, would make "a town of that country" undecidable from the name.
  test('draws names from words that cannot be mistaken for each other', () => {
    const towns = COUNTRIES.flatMap((country) => country.regions.flatMap((region) => region.towns))
    expect(new Set(towns).size).toBe(towns.length)
    const words = [...Object.values(STEMS).flat(), ...Object.values(TRADES).flat()]
    expect(words.filter((word) => towns.includes(word))).toEqual([])
  })
})

describe('the seeded numbers', () => {
  // The data is only as reproducible as this sequence: the same seed must
  // give the same numbers, in range, and a whole-number range must reach
  // both its ends, or a quantity of 48 or a sixth line would never appear.
  test('repeat for a seed, stay in range and reach both ends of a range', () => {
    const a = seeded(DEMO_SEED)
    const b = seeded(DEMO_SEED)
    const drawn = Array.from({ length: 2000 }, () => a.int(1, 6))
    expect(Array.from({ length: 2000 }, () => b.int(1, 6))).toEqual(drawn)
    expect(new Set(drawn)).toEqual(new Set([1, 2, 3, 4, 5, 6]))
    const fractions = Array.from({ length: 2000 }, () => a.next())
    expect(fractions.every((x) => x >= 0 && x < 1)).toBe(true)
  })

  // Each part of the data draws from a stream of its own; two parts sharing
  // one would make a change to customers redraw every order.
  test('give each part of the data a stream of its own', () => {
    expect(stream(DEMO_SEED, 'orders').uint32()).not.toBe(stream(DEMO_SEED, 'customers').uint32())
    expect(stream(DEMO_SEED, 'orders').uint32()).toBe(stream(DEMO_SEED, 'orders').uint32())
  })

  // A seed that is not a 32-bit whole number would be truncated into another
  // seed's sequence without a word.
  test('refuse a seed that is not a 32-bit whole number, and a range that is empty', () => {
    expect(() => seeded(-1)).toThrow('a seed is a whole number from 0 to 2^32 - 1, not -1')
    expect(() => seeded(2 ** 32)).toThrow('not 4294967296')
    expect(() => seeded(1.5)).toThrow('not 1.5')
    expect(() => seeded(1).int(3, 2)).toThrow('int(3, 2) is no range of whole numbers')
    expect(() => seeded(1).pick([])).toThrow('pick from an empty list')
    expect(() => seeded(1).weighted([['a', 0]])).toThrow('weighted needs a positive weight')
    expect(() =>
      seeded(1).weighted([
        ['a', 1],
        ['b', -1],
      ]),
    ).toThrow('a weight is zero or more')
  })

  // A weight is a share: a value with three times the weight comes up about
  // three times as often, and a value of weight zero never.
  test('draw a weighted value as often as its weight', () => {
    const random = seeded(DEMO_SEED)
    const counts = { a: 0, b: 0, never: 0 }
    for (let i = 0; i < 4000; i += 1)
      counts[
        random.weighted([
          ['a', 1],
          ['never', 0],
          ['b', 3],
        ] as const)
      ] += 1
    expect(counts.never).toBe(0)
    expect(counts.b / counts.a).toBeGreaterThan(2.5)
    expect(counts.b / counts.a).toBeLessThan(3.5)
  })
})

describe('the calendar', () => {
  // Every date is counted in whole UTC days from the anchor; a day that is
  // not one, read as the next month's, would move an order without a word.
  test('reads a day of the calendar and refuses anything else', () => {
    expect(dayOf(dayNumber(ANCHOR))).toBe(ANCHOR)
    expect(dayOf(dayNumber('2024-02-29'))).toBe('2024-02-29')
    expect(() => dayNumber('2026-02-30')).toThrow('2026-02-30 is no day of the calendar')
    expect(() => dayNumber('30.09.2026')).toThrow('a day is written YYYY-MM-DD, not 30.09.2026')
  })

  // Eighteen calendar months, the anchor's included: from the first of the
  // month seventeen months before it.
  test('opens the order window eighteen months before the anchor’s month ends', () => {
    expect(dayOf(firstOrderDay())).toBe('2025-04-01')
    expect(dayOf(firstOrderDay('2026-01-15'))).toBe('2024-08-01')
  })
})
