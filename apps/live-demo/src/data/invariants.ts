import type { DemoCustomer, DemoData, DemoDelivery, DemoEmployee, DemoLine, DemoOrder } from './model.js'
import {
  ANCHOR,
  DAYS_TO_SHIP,
  DELIVERIES_PER_SHIPPED_ORDER,
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
  dayOfInstant,
  decimal,
  firstOrderDay,
  isWeekday,
} from './model.js'
import { COUNTRIES, CREDIT_LIMITS_CENTS, FIXTURE_COUNTRIES, NOTES, TENANT_COUNTRIES, UNIT_PRICES_CENTS } from './words.js'

/*
 * What the demo's data must hold, each as a sentence naming the row that
 * breaks it. One list, asked of the generated rows (generate.test.ts), of
 * the rows the database holds once loaded (load.integration.test.ts), and by
 * demoSql before it writes a byte, so an image is never built on data that
 * breaks one. Each is proved to refuse what it names in invariants.test.ts.
 */

/** Every way `data` breaks the demo's invariants; empty when it breaks none. */
export function demoDataProblems(data: DemoData): string[] {
  return [
    ...countryProblems(data),
    ...employeeProblems(data.employees),
    ...customerProblems(data),
    ...orderProblems(data),
    ...lineProblems(data),
    ...deliveryProblems(data),
    ...parcelProblems(data),
  ]
}

const customerKey = (tenantId: number, customerNo: number): string => `${String(tenantId)}/${String(customerNo)}`
const money = (cents: number): string => decimal(cents, 2)
const range = (bounds: { min: number; max: number }): string => `${String(bounds.min)} to ${String(bounds.max)}`

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group === undefined) groups.set(key(item), [item])
    else group.push(item)
  }
  return groups
}

function countryProblems(data: DemoData): string[] {
  const problems: string[] = []
  const expected = COUNTRIES.filter((country) => !FIXTURE_COUNTRIES.includes(country.isoCode)).sort((a, b) => a.isoCode.localeCompare(b.isoCode))
  const codes = (list: ReadonlyArray<{ isoCode: string }>) => list.map((country) => country.isoCode).join(', ')
  if (codes(data.countries) !== codes(expected)) problems.push(`the countries added are ${codes(expected)}, not ${codes(data.countries)}`)
  for (const country of data.countries) {
    const words = expected.find((each) => each.isoCode === country.isoCode)
    if (words !== undefined && words.name !== country.name) problems.push(`country ${country.isoCode} is named ${country.name}, not ${words.name}`)
  }
  return problems
}

/** How far below the managing director each employee is: 0 for the director, 1 for a head, 2 for staff; absent when the chain never reaches one. */
function levels(employees: readonly DemoEmployee[]): Map<number, number> {
  const byId = new Map(employees.map((employee) => [employee.id, employee]))
  const found = new Map<number, number>()
  for (const employee of employees) {
    let level = 0
    let current: DemoEmployee | undefined = employee
    const seen = new Set<number>()
    while (current !== undefined && current.managerId !== null && !seen.has(current.id)) {
      seen.add(current.id)
      current = byId.get(current.managerId)
      level += 1
    }
    if (current !== undefined && current.managerId === null) found.set(employee.id, level)
  }
  return found
}

function employeeProblems(employees: readonly DemoEmployee[]): string[] {
  const problems: string[] = []
  const ids = new Set(employees.map((employee) => employee.id))
  for (const [name, same] of groupBy(employees, (employee) => employee.name)) if (same.length > 1) problems.push(`"${name}" is the name of ${String(same.length)} employees`)
  const roots = employees.filter((employee) => employee.managerId === null)
  if (roots.length !== 1) problems.push(`${String(roots.length)} employees have no manager, where the managing director alone has none`)
  const level = levels(employees)
  for (const employee of employees) {
    if (employee.managerId !== null && !ids.has(employee.managerId)) problems.push(`employee ${String(employee.id)} reports to ${String(employee.managerId)}, who is no employee`)
    const depth = level.get(employee.id)
    if (depth === undefined) problems.push(`employee ${String(employee.id)} does not reach the managing director`)
    else if (depth > 2) problems.push(`employee ${String(employee.id)} is ${String(depth)} levels below the managing director, where staff are 2`)
  }
  return problems
}

/** The towns of every country but `isoCode` that `name` contains as words. */
function foreignTowns(name: string, isoCode: string): Array<{ town: string; country: string }> {
  const padded = ` ${name} `
  return COUNTRIES.filter((country) => country.isoCode !== isoCode).flatMap((country) =>
    country.regions.flatMap((region) => region.towns.filter((town) => padded.includes(` ${town} `)).map((town) => ({ town, country: country.isoCode }))),
  )
}

function customerProblems(data: DemoData): string[] {
  const problems: string[] = []
  const anchor = dayNumber(ANCHOR)
  const known = new Set([...FIXTURE_COUNTRIES, ...data.countries.map((country) => country.isoCode)])
  const ordersOf = groupBy(data.orders, (order) => customerKey(order.tenantId, order.customerNo))
  for (const tenant of TENANTS) {
    const own = data.customers.filter((customer) => customer.tenantId === tenant)
    if (own.length !== PER_TENANT.customers) problems.push(`tenant ${String(tenant)} has ${String(own.length)} customers, not ${String(PER_TENANT.customers)}`)
    const last = FIRST_CUSTOMER_NO + PER_TENANT.customers - 1
    if (own.some((customer, i) => customer.customerNo !== FIRST_CUSTOMER_NO + i)) problems.push(`tenant ${String(tenant)}'s customers are not numbered ${String(FIRST_CUSTOMER_NO)} to ${String(last)} in order`)
    const named = new Map<string, DemoCustomer>()
    for (const customer of own) {
      const earlier = named.get(customer.name.toLowerCase())
      if (earlier !== undefined) problems.push(`customers ${customerKey(tenant, earlier.customerNo)} and ${customerKey(tenant, customer.customerNo)} are both named "${customer.name}"`)
      else named.set(customer.name.toLowerCase(), customer)
    }
    const counts = groupBy(own, (customer) => customer.countryCode)
    const mostly = [...counts].sort((a, b) => b[1].length - a[1].length)[0]?.[0]
    const expected = TENANT_COUNTRIES[tenant][0]?.[0]
    if (mostly !== undefined && mostly !== expected) problems.push(`tenant ${String(tenant)}'s customers are mostly in ${mostly}, not ${String(expected)}`)
  }
  for (const customer of data.customers) {
    const key = customerKey(customer.tenantId, customer.customerNo)
    if (!(TENANTS as readonly number[]).includes(customer.tenantId)) problems.push(`customer ${key} is of no tenant of the demo's`)
    problems.push(...customerCountryProblems(customer, key, known))
    if (customer.creditLimitCents !== null && !CREDIT_LIMITS_CENTS.includes(customer.creditLimitCents)) {
      problems.push(`customer ${key} has a credit limit of ${money(customer.creditLimitCents)}, which is no step of the list`)
    }
    const dates = (ordersOf.get(key) ?? []).map((order) => order.orderDate).sort()
    const created = dayOf(dayOfInstant(customer.createdAt))
    const first = dates[0]
    if (first !== undefined && dayOfInstant(customer.createdAt) >= dayNumber(first)) problems.push(`customer ${key} was created on ${created}, not before its first order of ${first}`)
    if (dayOfInstant(customer.createdAt) > anchor) problems.push(`customer ${key} was created on ${created}, after ${ANCHOR}`)
    const latest = dates.at(-1)
    if (!customer.active && latest !== undefined && anchor - dayNumber(latest) <= INACTIVE_DAYS) {
      problems.push(`customer ${key} is inactive and ordered on ${latest}, within ${String(INACTIVE_DAYS)} days of ${ANCHOR}`)
    }
  }
  return problems
}

/** A customer's country is known, one its tenant has customers in, and its name fits it: a legal form of the country and no town of another. */
function customerCountryProblems(customer: DemoCustomer, key: string, known: ReadonlySet<string>): string[] {
  if (!known.has(customer.countryCode)) return [`customer ${key} is in ${customer.countryCode}, which is no country of the demo's`]
  const problems: string[] = []
  const tenantCountries = TENANT_COUNTRIES[customer.tenantId as 1 | 2] ?? []
  if (!tenantCountries.some(([code]) => code === customer.countryCode)) problems.push(`customer ${key} is in ${customer.countryCode}, where tenant ${String(customer.tenantId)} has no customers`)
  const country = COUNTRIES.find((each) => each.isoCode === customer.countryCode)
  const forms = country?.regions.flatMap((region) => region.forms) ?? []
  if (!forms.some((form) => customer.name.endsWith(` ${form}`))) problems.push(`customer ${key} "${customer.name}" ends in no legal form of ${customer.countryCode}`)
  for (const { town, country: other } of foreignTowns(customer.name, customer.countryCode)) {
    problems.push(`customer ${key} "${customer.name}" names ${town}, a town of ${other}, not of ${customer.countryCode}`)
  }
  return problems
}

function orderProblems(data: DemoData): string[] {
  const problems: string[] = []
  const anchor = dayNumber(ANCHOR)
  const windowStart = firstOrderDay()
  const customers = new Set(data.customers.map((customer) => customerKey(customer.tenantId, customer.customerNo)))
  const level = levels(data.employees)
  const linesOf = groupBy(data.lines, (line) => line.orderId)
  for (const tenant of TENANTS) {
    const count = data.orders.filter((order) => order.tenantId === tenant).length
    if (count !== PER_TENANT.orders) problems.push(`tenant ${String(tenant)} has ${String(count)} orders, not ${String(PER_TENANT.orders)}`)
  }
  const inOrder = data.orders.every((order, i) => {
    const before = data.orders[i - 1]
    return order.id === i + 1 && (before === undefined || before.tenantId < order.tenantId || (before.tenantId === order.tenantId && before.orderDate <= order.orderDate))
  })
  if (!inOrder) problems.push('the orders are not numbered from 1 in order of tenant and date')
  for (const order of data.orders) {
    const id = String(order.id)
    if (!customers.has(customerKey(order.tenantId, order.customerNo))) {
      problems.push(`order ${id} is for ${customerKey(order.tenantId, order.customerNo)}, who is no customer of tenant ${String(order.tenantId)}`)
    }
    const day = dayNumber(order.orderDate)
    if (day < windowStart || day > anchor) problems.push(`order ${id} is dated ${order.orderDate}, outside ${dayOf(windowStart)} to ${ANCHOR}`)
    if (!isWeekday(day)) problems.push(`order ${id} is dated ${order.orderDate}, a weekend day`)
    if (order.status === 'draft' && anchor - day > RECENT_DAYS) problems.push(`order ${id} is a draft of ${order.orderDate}, older than ${String(RECENT_DAYS)} days`)
    if (level.get(order.createdBy) !== 2) problems.push(`order ${id} was created by employee ${String(order.createdBy)}, who is not staff`)
    if (order.status === 'draft' && order.approvedBy !== null) problems.push(`order ${id} is a draft and approved by employee ${String(order.approvedBy)}`)
    if (order.status !== 'draft' && (order.approvedBy === null || level.get(order.approvedBy) !== 1)) problems.push(`order ${id} is ${order.status} and not approved by a head`)
    const sum = (linesOf.get(order.id) ?? []).reduce((total, line) => total + line.quantity * line.unitPriceCents, 0)
    if (sum !== order.amountCents) problems.push(`order ${id}: amount ${money(order.amountCents)} is not its lines' sum ${money(sum)}`)
    if (order.notes !== null && !NOTES.includes(order.notes)) problems.push(`order ${id}'s note "${order.notes}" is none of the list`)
  }
  return problems
}

function lineProblems(data: DemoData): string[] {
  const problems: string[] = []
  const orders = new Set(data.orders.map((order) => order.id))
  const linesOf = groupBy(data.lines, (line) => line.orderId)
  for (const line of data.lines) {
    const key = `${String(line.orderId)}/${String(line.lineNo)}`
    if (!orders.has(line.orderId)) problems.push(`line ${key} is of no order`)
    if (!Number.isInteger(line.quantity) || line.quantity < QUANTITY.min || line.quantity > QUANTITY.max) problems.push(`line ${key} has quantity ${String(line.quantity)}, not ${range(QUANTITY)}`)
    if (!UNIT_PRICES_CENTS.includes(line.unitPriceCents)) problems.push(`line ${key} costs ${money(line.unitPriceCents)} each, which is no price of the list`)
  }
  for (const order of data.orders) {
    const own: readonly DemoLine[] = linesOf.get(order.id) ?? []
    if (own.length < LINES_PER_ORDER.min || own.length > LINES_PER_ORDER.max) problems.push(`order ${String(order.id)} has ${String(own.length)} lines, not ${range(LINES_PER_ORDER)}`)
    const numbers = own.map((line) => line.lineNo).sort((a, b) => a - b)
    if (numbers.some((number, i) => number !== i + 1)) problems.push(`order ${String(order.id)}'s lines are numbered ${numbers.join(', ')}, not 1 to ${String(own.length)}`)
  }
  return problems
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function deliveryProblems(data: DemoData): string[] {
  const problems: string[] = []
  const anchor = dayNumber(ANCHOR)
  const orders = new Map(data.orders.map((order) => [order.id, order]))
  const customers = new Map(data.customers.map((customer) => [customerKey(customer.tenantId, customer.customerNo), customer]))
  const deliveriesOf = groupBy(data.deliveries, (delivery) => delivery.orderId)
  for (const [id, same] of groupBy(data.deliveries, (delivery) => delivery.id)) if (same.length > 1) problems.push(`delivery id ${id} is given twice`)
  for (const delivery of data.deliveries) {
    if (!UUID_V4.test(delivery.id)) problems.push(`delivery id ${delivery.id} is not a lower-case version-4 uuid`)
    const order = orders.get(delivery.orderId)
    if (order === undefined) problems.push(`delivery ${delivery.id} is of no order`)
    else problems.push(...deliveryOfOrderProblems(delivery, order, customers.get(customerKey(order.tenantId, order.customerNo)), anchor))
  }
  for (const order of data.orders) {
    const count = (deliveriesOf.get(order.id) ?? []).length
    if (order.status !== 'shipped' && count > 0) problems.push(`order ${String(order.id)} is ${order.status} and has a delivery`)
    if (order.status === 'shipped' && count === 0) problems.push(`order ${String(order.id)} is shipped and has no delivery`)
    if (order.status === 'shipped' && count > DELIVERIES_PER_SHIPPED_ORDER.max) problems.push(`order ${String(order.id)} has ${String(count)} deliveries, not ${range(DELIVERIES_PER_SHIPPED_ORDER)}`)
  }
  return problems
}

/** A delivery agrees with its order: the tenant, a carrier of the customer's country, shipped days after the order and not after the anchor. */
function deliveryOfOrderProblems(delivery: DemoDelivery, order: DemoOrder, customer: DemoCustomer | undefined, anchor: number): string[] {
  const problems: string[] = []
  if (delivery.tenantId !== order.tenantId) problems.push(`delivery ${delivery.id} is of tenant ${String(delivery.tenantId)}, its order ${String(order.id)} of tenant ${String(order.tenantId)}`)
  const carriers = COUNTRIES.find((country) => country.isoCode === customer?.countryCode)?.carriers ?? []
  if (customer !== undefined && !carriers.includes(delivery.carrier)) problems.push(`delivery ${delivery.id} is carried by ${delivery.carrier}, who does not deliver to ${customer.countryCode}`)
  const shipped = dayOfInstant(delivery.shippedAt)
  const after = shipped - dayNumber(order.orderDate)
  if (after < DAYS_TO_SHIP.min || after > DAYS_TO_SHIP.max) problems.push(`delivery ${delivery.id} shipped ${String(after)} days after its order, not ${range(DAYS_TO_SHIP)}`)
  if (shipped > anchor) problems.push(`delivery ${delivery.id} shipped on ${dayOf(shipped)}, after ${ANCHOR}`)
  return problems
}

function parcelProblems(data: DemoData): string[] {
  const problems: string[] = []
  const deliveries = new Set(data.deliveries.map((delivery) => delivery.id))
  if (data.parcels.some((parcel, i) => parcel.id !== i + 1)) problems.push('the parcels are not numbered from 1 in order')
  const parcelsOf = groupBy(data.parcels, (parcel) => parcel.deliveryId)
  for (const parcel of data.parcels) if (!deliveries.has(parcel.deliveryId)) problems.push(`parcel ${String(parcel.id)} is of no delivery`)
  for (const delivery of data.deliveries) {
    const own = [...(parcelsOf.get(delivery.id) ?? [])].sort((a, b) => a.id - b.id)
    if (own.length < PARCELS_PER_DELIVERY.min || own.length > PARCELS_PER_DELIVERY.max) problems.push(`delivery ${delivery.id} has ${String(own.length)} parcels, not ${range(PARCELS_PER_DELIVERY)}`)
    own.forEach((parcel, i) => {
      const label = `Parcel ${String(i + 1)} of ${String(own.length)}`
      if (parcel.label !== label) problems.push(`parcel ${String(parcel.id)} is labelled "${parcel.label}", not "${label}"`)
    })
  }
  return problems
}
