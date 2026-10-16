import type { DemoCountry, DemoCustomer, DemoData, DemoDelivery, DemoEmployee, DemoLine, DemoOrder, DemoParcel, OrderStatus, Tenant } from './model.js'
import {
  ANCHOR,
  DAYS_TO_SHIP,
  DELIVERIES_PER_SHIPPED_ORDER,
  DEMO_SEED,
  FIRST_CUSTOMER_NO,
  INACTIVE_DAYS,
  LINES_PER_ORDER,
  PARCELS_PER_DELIVERY,
  PER_TENANT,
  QUANTITY,
  RECENT_DAYS,
  TENANTS,
  dayNumber,
  dayOf,
  firstOrderDay,
  isWeekday,
  startOfDay,
} from './model.js'
import type { Random } from './random.js'
import { stream } from './random.js'
import type { CountryWords, Region } from './words.js'
import { COUNTRIES, CREDIT_LIMITS_CENTS, FIRST_NAMES, FIXTURE_COUNTRIES, LAST_NAMES, NOTES, STEMS, TENANT_COUNTRIES, TRADES, UNIT_PRICES_CENTS } from './words.js'

/*
 * The live demo's sample data, generated: pure, deterministic, from a seed
 * and the word lists alone. What it must hold is invariants.ts; that it does,
 * on these rows and on the database's copy of them, is generate.test.ts and
 * load.integration.test.ts. The shares below (a tenth without a credit
 * limit, an eighth with a note, ...) are what makes the rows look like a
 * business's, and no invariant depends on their exact value.
 */

/** The seller's organisation: a managing director, heads reporting to them, staff reporting to a head. */
const HEADS = 3
const STAFF = 14

const SHARES = {
  noCreditLimit: 0.1,
  inactive: 0.1,
  /** Customers who joined during the order window rather than before it. */
  joinedLately: 0.15,
  /** A company name with its town. */
  town: 0.35,
  note: 1 / 8,
  /** An order older than three weeks that is still only placed. */
  oldPlaced: 0.06,
  /** A shipped order delivered in two parts. */
  split: 0.15,
  /** An order approved by its creator's own head rather than another. */
  ownHead: 0.85,
} as const

/** When the oldest customers were created. */
const FIRST_CUSTOMER_DAY = '2016-01-04'

/** Working hours, in minutes after midnight UTC, for when something was done. */
const HOURS = { from: 6 * 60, to: 17 * 60 + 59 } as const

/** The generated rows for `seed`. Two calls with one seed are the same rows. */
export function generateDemoData(seed: number = DEMO_SEED): DemoData {
  const employees = generateEmployees(stream(seed, 'employees'))
  const drawn = generateCustomers(stream(seed, 'customers'))
  const { orders, lines } = generateOrders(stream(seed, 'orders'), drawn, employees)
  const { deliveries, parcels } = generateDeliveries(stream(seed, 'deliveries'), orders, drawn.map(({ customer }) => customer))
  return { countries: addedCountries(), employees, customers: drawn.map(({ customer }) => customer), orders, lines, deliveries, parcels }
}

/** The countries the demo adds to the fixture's, in their code's order. */
function addedCountries(): DemoCountry[] {
  return COUNTRIES.filter((country) => !FIXTURE_COUNTRIES.includes(country.isoCode))
    .map((country) => ({ isoCode: country.isoCode, name: country.name }))
    .sort((a, b) => a.isoCode.localeCompare(b.isoCode))
}

function shuffled<T>(random: Random, list: readonly T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = random.int(0, i)
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

/** Employee 1 is the managing director, the next `HEADS` the heads, the rest staff spread over the heads. */
function generateEmployees(random: Random): DemoEmployee[] {
  const count = 1 + HEADS + STAFF
  const first = shuffled(random, FIRST_NAMES)
  const last = shuffled(random, LAST_NAMES)
  /* c8 ignore next -- the lists are longer than the organisation; this says so if one is cut */
  if (first.length < count || last.length < count) throw new Error(`${String(count)} employees need as many first and last names`)
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1
    const managerId = id === 1 ? null : id <= 1 + HEADS ? 1 : 2 + ((id - 2 - HEADS) % HEADS)
    return { id, name: `${first[i] as string} ${last[i] as string}`, managerId }
  })
}

/** A customer as drawn, with how often it orders against the tenant's others. */
interface Drawn {
  customer: DemoCustomer
  weight: number
}

function countryWords(isoCode: string): CountryWords {
  const country = COUNTRIES.find((each) => each.isoCode === isoCode)
  /* c8 ignore next -- TENANT_COUNTRIES names only COUNTRIES; invariants.ts refuses a row in any other */
  if (country === undefined) throw new Error(`no words for country ${isoCode}`)
  return country
}

/**
 * A company name from its region's words: family name and trade in the
 * order the language puts them ("Huber Holzbau", "Transports Dubois"),
 * sometimes the town, and a legal form of the country.
 */
function companyName(random: Random, region: Region): string {
  const stem = random.pick(STEMS[region.language])
  const trade = random.pick(TRADES[region.language])
  const words = region.language === 'fr' || region.language === 'it' ? [trade, stem] : [stem, trade]
  if (random.chance(SHARES.town)) words.push(random.pick(region.towns))
  words.push(random.pick(region.forms))
  return words.join(' ')
}

/** The instant a working minute of `day` falls on. */
function during(random: Random, day: number): number {
  return startOfDay(day) + random.int(HOURS.from, HOURS.to) * 60_000
}

function generateCustomers(random: Random): Drawn[] {
  const windowStart = firstOrderDay()
  const anchor = dayNumber(ANCHOR)
  const drawn: Drawn[] = []
  for (const tenant of TENANTS) {
    // Every country of the tenant's list at least once, the rest by weight,
    // then shuffled, so the numbers do not run through the countries in order.
    const weights = TENANT_COUNTRIES[tenant]
    const codes = shuffled(random, [...weights.map(([code]) => code), ...Array.from({ length: PER_TENANT.customers - weights.length }, () => random.weighted(weights))])
    const taken = new Set<string>()
    codes.forEach((countryCode, i) => {
      const country = countryWords(countryCode)
      const region = random.weighted(country.regions.map((each) => [each, each.weight] as const))
      let name = companyName(random, region)
      while (taken.has(name.toLowerCase())) name = companyName(random, region)
      taken.add(name.toLowerCase())
      const joined = random.chance(SHARES.joinedLately) ? random.int(windowStart, anchor - 30) : random.int(dayNumber(FIRST_CUSTOMER_DAY), windowStart - 1)
      drawn.push({
        customer: {
          tenantId: tenant,
          customerNo: FIRST_CUSTOMER_NO + i,
          name,
          countryCode,
          creditLimitCents: random.chance(SHARES.noCreditLimit) ? null : random.pick(CREDIT_LIMITS_CENTS),
          active: !random.chance(SHARES.inactive),
          createdAt: during(random, joined),
        },
        // Most customers order now and then, a few often.
        weight: 1 + Math.floor(random.next() ** 3 * 12),
      })
    })
  }
  return drawn
}

/**
 * Old orders are shipped, now and then still placed. Recent ones are drafts,
 * placed or shipped, a draft the likelier the younger the order; and nothing
 * ships before the day after it was ordered, nor after the anchor.
 */
function statusFor(random: Random, age: number): OrderStatus {
  if (age > RECENT_DAYS) return random.chance(SHARES.oldPlaced) ? 'placed' : 'shipped'
  const week = age <= 7
  return random.weighted<OrderStatus>([
    ['draft', week ? 3 : 1],
    ['placed', 4],
    ['shipped', age < DAYS_TO_SHIP.min ? 0 : week ? 3 : 6],
  ])
}

/** An order before its id: drawn in any order, numbered once sorted. */
interface Unnumbered {
  tenantId: Tenant
  day: number
  customerNo: number
  status: OrderStatus
  notes: string | null
  createdBy: number
  approvedBy: number | null
  lines: Array<{ quantity: number; unitPriceCents: number }>
}

function generateOrders(random: Random, customers: readonly Drawn[], employees: readonly DemoEmployee[]): { orders: DemoOrder[]; lines: DemoLine[] } {
  const anchor = dayNumber(ANCHOR)
  const days: number[] = []
  for (let day = firstOrderDay(); day <= anchor; day += 1) if (isWeekday(day)) days.push(day)
  const director = employees.find((employee) => employee.managerId === null)
  const heads = employees.filter((employee) => employee.managerId === director?.id)
  const staff = employees.filter((employee) => heads.some((head) => head.id === employee.managerId))

  const drawn: Unnumbered[] = []
  for (const tenant of TENANTS) {
    const own = customers.filter(({ customer }) => customer.tenantId === tenant)
    for (let i = 0; i < PER_TENANT.orders; i += 1) {
      const day = random.pick(days)
      // Only a customer who existed that day, and not one who has since
      // stopped being active if the day is recent.
      const eligible = own.filter(({ customer }) => customer.createdAt < startOfDay(day) && (customer.active || anchor - day > INACTIVE_DAYS))
      /* c8 ignore next -- most customers predate the window and are active; this says so if the shares change */
      if (eligible.length === 0) throw new Error(`no customer of tenant ${String(tenant)} could order on day ${String(day)}`)
      const { customer } = random.weighted(eligible.map((each) => [each, each.weight] as const))
      const status = statusFor(random, anchor - day)
      const creator = random.pick(staff)
      const approvedBy = status === 'draft' ? null : random.chance(SHARES.ownHead) ? (creator.managerId as number) : random.pick(heads).id
      drawn.push({
        tenantId: tenant,
        day,
        customerNo: customer.customerNo,
        status,
        notes: random.chance(SHARES.note) ? random.pick(NOTES) : null,
        createdBy: creator.id,
        approvedBy,
        lines: Array.from({ length: random.int(LINES_PER_ORDER.min, LINES_PER_ORDER.max) }, () => ({
          // Small quantities are the common ones.
          quantity: QUANTITY.min + Math.floor(random.next() ** 2 * (QUANTITY.max - QUANTITY.min + 1)),
          unitPriceCents: random.pick(UNIT_PRICES_CENTS),
        })),
      })
    }
  }

  // Numbered in order of tenant and date, as the identity would have numbered them.
  const sorted = drawn.map((order, index) => ({ order, index })).sort((a, b) => a.order.tenantId - b.order.tenantId || a.order.day - b.order.day || a.index - b.index)
  const orders: DemoOrder[] = []
  const lines: DemoLine[] = []
  sorted.forEach(({ order }, i) => {
    const id = i + 1
    orders.push({
      id,
      tenantId: order.tenantId,
      customerNo: order.customerNo,
      orderDate: dayOf(order.day),
      status: order.status,
      amountCents: order.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0),
      notes: order.notes,
      createdBy: order.createdBy,
      approvedBy: order.approvedBy,
    })
    order.lines.forEach((line, n) => lines.push({ orderId: id, lineNo: n + 1, ...line }))
  })
  return { orders, lines }
}

/** A version-4-shaped uuid from four draws: the version nibble 4, the variant bits 10. */
function uuid(random: Random): string {
  const hex = [random.uint32(), random.uint32(), random.uint32(), random.uint32()].map((word) => word.toString(16).padStart(8, '0')).join('')
  const variant = (8 + (Number.parseInt(hex.charAt(16), 16) & 3)).toString(16)
  const digits = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17)}`
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`
}

/** One delivery per shipped order, sometimes two, each of one to three parcels; none for any other order. */
function generateDeliveries(random: Random, orders: readonly DemoOrder[], customers: readonly DemoCustomer[]): { deliveries: DemoDelivery[]; parcels: DemoParcel[] } {
  const anchor = dayNumber(ANCHOR)
  const deliveries: DemoDelivery[] = []
  const parcels: DemoParcel[] = []
  const ids = new Set<string>()
  for (const order of orders) {
    if (order.status !== 'shipped') continue
    const customer = customers.find((each) => each.tenantId === order.tenantId && each.customerNo === order.customerNo)
    /* c8 ignore next -- orders are drawn from these customers */
    if (customer === undefined) throw new Error(`order ${String(order.id)} has no customer`)
    const carriers = countryWords(customer.countryCode).carriers
    const day = dayNumber(order.orderDate)
    const latest = Math.min(DAYS_TO_SHIP.max, anchor - day)
    const count = random.chance(SHARES.split) ? DELIVERIES_PER_SHIPPED_ORDER.max : DELIVERIES_PER_SHIPPED_ORDER.min
    const offsets = Array.from({ length: count }, () => random.int(DAYS_TO_SHIP.min, latest)).sort((a, b) => a - b)
    for (const offset of offsets) {
      let id = uuid(random)
      /* c8 ignore next -- 122 random bits; a repeat would break the primary key, so it is drawn again */
      while (ids.has(id)) id = uuid(random)
      ids.add(id)
      deliveries.push({ id, tenantId: order.tenantId, orderId: order.id, carrier: random.pick(carriers), shippedAt: during(random, day + offset) })
      const n = random.int(PARCELS_PER_DELIVERY.min, PARCELS_PER_DELIVERY.max)
      for (let i = 1; i <= n; i += 1) parcels.push({ id: parcels.length + 1, deliveryId: id, label: `Parcel ${String(i)} of ${String(n)}` })
    }
  }
  return { deliveries, parcels }
}
