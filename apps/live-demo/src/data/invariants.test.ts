import { describe, expect, test } from 'vitest'
import { generateDemoData } from './generate.js'
import { demoDataProblems } from './invariants.js'
import type { DemoCustomer, DemoData, DemoOrder } from './model.js'
import { ANCHOR, DEMO_SEED, FIRST_CUSTOMER_NO, PER_TENANT, RECENT_DAYS, dayNumber, dayOf, decimal, startOfDay } from './model.js'

/**
 * Each invariant refuses what it names. A check that never fails proves
 * nothing about the rows it passes, so every one is broken here in a copy of
 * the generated data and must name the row it was broken on. The generated
 * data itself is held to all of them in generate.test.ts, and the database's
 * copy in load.integration.test.ts.
 */
const data = generateDemoData(DEMO_SEED)

function problemsAfter(change: (copy: DemoData) => void): string[] {
  const copy = structuredClone(data)
  change(copy)
  return demoDataProblems(copy)
}

function find<T>(items: readonly T[], keep: (item: T) => boolean, what: string): T {
  const found = items.find(keep)
  if (found === undefined) throw new Error(`the generated data has no ${what}`)
  return found
}

const linesOf = (order: DemoOrder) => data.lines.filter((line) => line.orderId === order.id)
const deliveriesOf = (order: DemoOrder) => data.deliveries.filter((delivery) => delivery.orderId === order.id)
const key = (customer: DemoCustomer) => `${String(customer.tenantId)}/${String(customer.customerNo)}`
const anchor = dayNumber(ANCHOR)

const shipped = find(data.orders, (order) => order.status === 'shipped' && linesOf(order).length >= 2 && deliveriesOf(order).length === 1, 'shipped order of two lines and one delivery')
const placed = find(data.orders, (order) => order.status === 'placed', 'placed order')
const draft = find(data.orders, (order) => order.status === 'draft', 'draft')
const swiss = find(data.customers, (customer) => customer.countryCode === 'CH' && customer.name.endsWith(' AG'), 'Swiss AG')
const german = find(data.customers, (customer) => customer.countryCode === 'DE' && customer.tenantId === 2, 'German customer of tenant 2')

describe('the demo data’s invariants refuse', () => {
  // The order form shows `amount` beside the lines; a generator that rounded
  // a line, or summed one twice, would show a total its own lines deny.
  test('an amount a cent off its lines', () => {
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === shipped.id)!.amountCents += 1))).toEqual([
      `order ${String(shipped.id)}: amount ${decimal(shipped.amountCents + 1, 2)} is not its lines' sum ${decimal(shipped.amountCents, 2)}`,
    ])
  })

  // Deliveries are what shipping an order made: one on a placed order, or
  // none on a shipped one, is a story the demo's records contradict.
  test('a placed order with a delivery, and a shipped order without one', () => {
    const moved = deliveriesOf(shipped)[0]!
    expect(problemsAfter((copy) => void (copy.deliveries.find((delivery) => delivery.id === moved.id)!.orderId = placed.id))).toEqual(
      expect.arrayContaining([`order ${String(placed.id)} is placed and has a delivery`, `order ${String(shipped.id)} is shipped and has no delivery`]),
    )
  })

  // "a city of that country": Hamburg in a Swiss company's name is the kind
  // of slip a reader of the demo notices first.
  test('a town of another country in a name, and a legal form of another country', () => {
    const stem = swiss.name.split(' ')[0]!
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(swiss))!.name = `${stem} Logistik Hamburg AG`))).toEqual([
      `customer ${key(swiss)} "${stem} Logistik Hamburg AG" names Hamburg, a town of DE, not of CH`,
    ])
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(german))!.name = `${german.name} B.V.`))).toEqual([
      `customer ${key(german)} "${german.name} B.V." ends in no legal form of DE`,
    ])
  })

  // The customer lookup lists names; two alike in one tenant, whatever their
  // case, are two entries a clerk cannot tell apart.
  test('two customers of a tenant with one name, whatever its case', () => {
    const first = data.customers.filter((customer) => customer.tenantId === 1)[0]!
    const second = data.customers.filter((customer) => customer.tenantId === 1)[1]!
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(second))!.name = first.name.toUpperCase()))).toEqual(
      expect.arrayContaining([`customers ${key(first)} and ${key(second)} are both named "${first.name.toUpperCase()}"`]),
    )
  })

  // Tenant isolation is the demo's point: a tenant short of a customer, a
  // customer of a third tenant, or numbers with a gap say the generator lost
  // track of whose row it was writing.
  test('a tenant short of a customer, a third tenant, numbers out of order, a country nobody may be in', () => {
    const last = data.customers.filter((customer) => customer.tenantId === 1).at(-1)!
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(last))!.tenantId = 3 as 1))).toEqual(
      expect.arrayContaining([`tenant 1 has ${String(PER_TENANT.customers - 1)} customers, not ${String(PER_TENANT.customers)}`, `customer 3/${String(last.customerNo)} is of no tenant of the demo's`]),
    )
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(last))!.customerNo += 1))).toEqual(
      expect.arrayContaining([`tenant 1's customers are not numbered ${String(FIRST_CUSTOMER_NO)} to ${String(FIRST_CUSTOMER_NO + PER_TENANT.customers - 1)} in order`]),
    )
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(swiss))!.countryCode = 'NL'))).toEqual(
      expect.arrayContaining([`customer ${key(swiss)} is in NL, where tenant 1 has no customers`]),
    )
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(swiss))!.countryCode = 'XX'))).toEqual(
      expect.arrayContaining([`customer ${key(swiss)} is in XX, which is no country of the demo's`]),
    )
  })

  // A customer created after its first order, or an inactive one who ordered
  // last week, is a record that contradicts another; a limit off the list is
  // a number the generator never meant.
  test('a customer created after its first order, an inactive one ordering lately, a credit limit off the steps', () => {
    const order = find(data.orders, (each) => anchor - dayNumber(each.orderDate) < 30, 'order of the last month')
    const buyer = find(data.customers, (customer) => customer.tenantId === order.tenantId && customer.customerNo === order.customerNo, 'buyer')
    const first = data.orders.filter((each) => each.tenantId === buyer.tenantId && each.customerNo === buyer.customerNo).map((each) => each.orderDate).sort()[0]!
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(buyer))!.createdAt = startOfDay(dayNumber(first)) + 3_600_000))).toEqual([
      `customer ${key(buyer)} was created on ${first}, not before its first order of ${first}`,
    ])
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(buyer))!.active = false))).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^customer ${key(buyer)} is inactive and ordered on \\d{4}-\\d{2}-\\d{2}, within 180 days of ${ANCHOR}$`))]),
    )
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(swiss))!.creditLimitCents = 12_345_00))).toEqual([
      `customer ${key(swiss)} has a credit limit of 12345.00, which is no step of the list`,
    ])
  })

  // The hierarchy is one tree under one managing director, which is what
  // validating fk_employee_manager is meant to show; a cycle or a second
  // root is no organisation.
  test('an employee whose manager does not exist, a second root, a cycle, a fourth level', () => {
    const staff = find(data.employees, (employee) => employee.managerId !== null && data.employees.find((manager) => manager.id === employee.managerId)?.managerId !== null, 'staff member')
    const other = find(data.employees, (employee) => employee.id !== staff.id && employee.managerId === staff.managerId, 'colleague')
    expect(problemsAfter((copy) => void (copy.employees.find((employee) => employee.id === staff.id)!.managerId = 999))).toEqual(
      expect.arrayContaining([`employee ${String(staff.id)} reports to 999, who is no employee`]),
    )
    expect(problemsAfter((copy) => void (copy.employees.find((employee) => employee.id === staff.id)!.managerId = null))).toEqual(
      expect.arrayContaining(['2 employees have no manager, where the managing director alone has none']),
    )
    expect(problemsAfter((copy) => void (copy.employees.find((employee) => employee.id === staff.id)!.managerId = other.id))).toEqual(
      expect.arrayContaining([`employee ${String(staff.id)} is 3 levels below the managing director, where staff are 2`]),
    )
    expect(
      problemsAfter((copy) => {
        copy.employees.find((employee) => employee.id === staff.id)!.managerId = other.id
        copy.employees.find((employee) => employee.id === other.id)!.managerId = staff.id
      }),
    ).toEqual(expect.arrayContaining([`employee ${String(staff.id)} does not reach the managing director`, `employee ${String(other.id)} does not reach the managing director`]))
  })

  // Who created and who approved an order are lookups on the order form; a
  // draft approved, a placed order approved by nobody, or a head creating
  // orders breaks the roles the data is drawn to show.
  test('a draft approved, a placed order unapproved, an order created by a head', () => {
    const head = find(data.employees, (employee) => employee.managerId !== null && data.employees.find((manager) => manager.id === employee.managerId)?.managerId === null, 'head')
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === draft.id)!.approvedBy = head.id))).toEqual([
      `order ${String(draft.id)} is a draft and approved by employee ${String(head.id)}`,
    ])
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === placed.id)!.approvedBy = null))).toEqual([`order ${String(placed.id)} is placed and not approved by a head`])
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === placed.id)!.createdBy = head.id))).toEqual([
      `order ${String(placed.id)} was created by employee ${String(head.id)}, who is not staff`,
    ])
  })

  // Dates are what makes the statuses believable: a draft older than three
  // weeks, an order on a Sunday or before the window, ids out of date order.
  test('an old draft, a weekend order, an order outside the window, ids out of order', () => {
    const old = dayOf(anchor - RECENT_DAYS - 7)
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === draft.id)!.orderDate = old))).toEqual(
      expect.arrayContaining([`order ${String(draft.id)} is a draft of ${old}, older than ${String(RECENT_DAYS)} days`]),
    )
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === shipped.id)!.orderDate = '2026-09-27'))).toEqual(
      expect.arrayContaining([`order ${String(shipped.id)} is dated 2026-09-27, a weekend day`]),
    )
    // Not the first order: moved earlier, the first would still be in order.
    const later = data.orders[100]!
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === later.id)!.orderDate = '2024-01-02'))).toEqual(
      expect.arrayContaining([`order ${String(later.id)} is dated 2024-01-02, outside 2025-04-01 to ${ANCHOR}`, 'the orders are not numbered from 1 in order of tenant and date']),
    )
  })

  // An order of another tenant's customer is the leak the row filters exist
  // to prevent; the data must not contain one for them to hide.
  test('an order for a customer of another tenant, and a note off the list', () => {
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === placed.id)!.customerNo = 99_999))).toEqual([
      `order ${String(placed.id)} is for ${String(placed.tenantId)}/99999, who is no customer of tenant ${String(placed.tenantId)}`,
    ])
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === placed.id)!.notes = 'Leave it anywhere'))).toEqual([`order ${String(placed.id)}'s note "Leave it anywhere" is none of the list`])
  })

  // Lines: numbered from one without a gap, one to six of them, a quantity
  // and a price the list allows.
  test('a gap in the line numbers, a seventh line, a quantity or a price off the list', () => {
    const [line] = linesOf(shipped)
    expect(problemsAfter((copy) => void (copy.lines.find((each) => each.orderId === shipped.id && each.lineNo === 1)!.lineNo = 9))).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^order ${String(shipped.id)}'s lines are numbered [\\d, ]+, not 1 to \\d$`))]),
    )
    expect(problemsAfter((copy) => void (copy.lines.find((each) => each.orderId === shipped.id && each.lineNo === 1)!.quantity = 49))).toEqual(
      expect.arrayContaining([`line ${String(shipped.id)}/1 has quantity 49, not 1 to 48`]),
    )
    expect(problemsAfter((copy) => void (copy.lines.find((each) => each.orderId === shipped.id && each.lineNo === 1)!.unitPriceCents = 123))).toEqual(
      expect.arrayContaining([`line ${String(shipped.id)}/1 costs 1.23 each, which is no price of the list`]),
    )
    expect(problemsAfter((copy) => copy.lines.push(...Array.from({ length: 7 }, (_, i) => ({ ...line!, orderId: 99_999, lineNo: i + 1 }))))).toEqual(
      expect.arrayContaining(['line 99999/1 is of no order']),
    )
    const lines = linesOf(shipped).length
    expect(
      problemsAfter((copy) => copy.lines.push(...Array.from({ length: 7 - lines }, (_, i) => ({ ...line!, lineNo: lines + i + 1, quantity: 1, unitPriceCents: 390 })))),
    ).toEqual(expect.arrayContaining([`order ${String(shipped.id)} has 7 lines, not 1 to 6`]))
  })

  // A delivery's tenant is pinned on the delivery form; one that differs
  // from its order's is a delivery the other tenant's clerk would see.
  test('a delivery of another tenant, a carrier of another country, a ship date out of range, a malformed or repeated id', () => {
    const [delivery] = deliveriesOf(shipped)
    const buyer = find(data.customers, (customer) => customer.tenantId === shipped.tenantId && customer.customerNo === shipped.customerNo, 'buyer')
    const change = (edit: (copy: NonNullable<typeof delivery>) => void) => problemsAfter((copy) => edit(copy.deliveries.find((each) => each.id === delivery!.id)!))
    expect(change((copy) => void (copy.tenantId = shipped.tenantId === 1 ? 2 : 1))).toEqual([
      `delivery ${delivery!.id} is of tenant ${String(shipped.tenantId === 1 ? 2 : 1)}, its order ${String(shipped.id)} of tenant ${String(shipped.tenantId)}`,
    ])
    expect(change((copy) => void (copy.carrier = 'Pony Express'))).toEqual([`delivery ${delivery!.id} is carried by Pony Express, who does not deliver to ${buyer.countryCode}`])
    expect(change((copy) => void (copy.shippedAt = startOfDay(dayNumber(shipped.orderDate)) + 3_600_000))).toEqual([
      `delivery ${delivery!.id} shipped 0 days after its order, not 1 to 6`,
    ])
    expect(change((copy) => void (copy.shippedAt = startOfDay(anchor + 1) + 3_600_000))).toEqual(expect.arrayContaining([`delivery ${delivery!.id} shipped on ${dayOf(anchor + 1)}, after ${ANCHOR}`]))
    const upper = delivery!.id.toUpperCase()
    expect(problemsAfter((copy) => {
      copy.deliveries.find((each) => each.id === delivery!.id)!.id = upper
      for (const parcel of copy.parcels) if (parcel.deliveryId === delivery!.id) parcel.deliveryId = upper
    })).toEqual([`delivery id ${upper} is not a lower-case version-4 uuid`])
    const other = data.deliveries.find((each) => each.id !== delivery!.id)!
    expect(problemsAfter((copy) => void (copy.deliveries.find((each) => each.id === other.id)!.id = delivery!.id))).toEqual(expect.arrayContaining([`delivery id ${delivery!.id} is given twice`]))
  })

  // Parcels: one to three per delivery, numbered from one, labelled as the
  // count of their delivery's.
  test('a fourth parcel, a parcel of no delivery, a label that miscounts, ids out of order', () => {
    const [delivery] = deliveriesOf(shipped)
    const own = data.parcels.filter((parcel) => parcel.deliveryId === delivery!.id)
    const next = data.parcels.length + 1
    expect(problemsAfter((copy) => copy.parcels.push(...Array.from({ length: 4 - own.length }, (_, i) => ({ id: next + i, deliveryId: delivery!.id, label: 'Parcel 4 of 4' }))))).toEqual(
      expect.arrayContaining([`delivery ${delivery!.id} has 4 parcels, not 1 to 3`]),
    )
    expect(problemsAfter((copy) => void (copy.parcels[0]!.deliveryId = '00000000-0000-4000-8000-000000000000'))).toEqual(
      expect.arrayContaining([`parcel ${String(data.parcels[0]!.id)} is of no delivery`]),
    )
    expect(problemsAfter((copy) => void (copy.parcels.find((parcel) => parcel.id === own[0]!.id)!.label = 'Box'))).toEqual([
      `parcel ${String(own[0]!.id)} is labelled "Box", not "Parcel 1 of ${String(own.length)}"`,
    ])
    expect(problemsAfter((copy) => void (copy.parcels[0]!.id = 0))).toEqual(['the parcels are not numbered from 1 in order'])
  })

  // A tenant mostly elsewhere than its list says is a tenant the personas'
  // sentences no longer describe; an employee name given twice is two people
  // a lookup cannot tell apart; a customer created after the anchor is one
  // the data says does not exist yet.
  test('a tenant mostly in another country, an employee name given twice, a customer created after the anchor', () => {
    expect(problemsAfter((copy) => copy.customers.forEach((customer) => void (customer.tenantId === 1 && customer.countryCode === 'CH' && (customer.countryCode = 'DE'))))).toEqual(
      expect.arrayContaining(["tenant 1's customers are mostly in DE, not CH"]),
    )
    expect(problemsAfter((copy) => void (copy.employees[1]!.name = copy.employees[0]!.name))).toEqual([`"${data.employees[0]!.name}" is the name of 2 employees`])
    expect(problemsAfter((copy) => void (copy.customers.find((customer) => key(customer) === key(swiss))!.createdAt = startOfDay(anchor + 1) + 3_600_000))).toEqual(
      expect.arrayContaining([`customer ${key(swiss)} was created on ${dayOf(anchor + 1)}, after ${ANCHOR}`]),
    )
  })

  // Each tenant's orders fill its pages; an order moved to the other tenant
  // leaves one short and the other over.
  test('a tenant an order short, an order with no lines', () => {
    expect(problemsAfter((copy) => void (copy.orders.find((order) => order.id === placed.id)!.tenantId = placed.tenantId === 1 ? 2 : 1))).toEqual(
      expect.arrayContaining([
        `tenant ${String(placed.tenantId)} has ${String(PER_TENANT.orders - 1)} orders, not ${String(PER_TENANT.orders)}`,
        `tenant ${String(placed.tenantId === 1 ? 2 : 1)} has ${String(PER_TENANT.orders + 1)} orders, not ${String(PER_TENANT.orders)}`,
      ]),
    )
    expect(problemsAfter((copy) => void (copy.lines = copy.lines.filter((line) => line.orderId !== placed.id)))).toEqual([
      `order ${String(placed.id)}: amount ${decimal(placed.amountCents, 2)} is not its lines' sum 0.00`,
      `order ${String(placed.id)} has 0 lines, not 1 to 6`,
    ])
  })

  // A delivery whose order is gone, a third delivery of one order, a
  // delivery with no parcels: each is a child grid that contradicts its row.
  test('a delivery of no order, a third delivery, a delivery with no parcels', () => {
    const [delivery] = deliveriesOf(shipped)
    expect(problemsAfter((copy) => void (copy.deliveries.find((each) => each.id === delivery!.id)!.orderId = 99_999))).toEqual(
      expect.arrayContaining([`delivery ${delivery!.id} is of no order`, `order ${String(shipped.id)} is shipped and has no delivery`]),
    )
    const extra = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
    expect(problemsAfter((copy) => copy.deliveries.push(...extra.map((id) => ({ ...delivery!, id }))))).toEqual(
      expect.arrayContaining([`order ${String(shipped.id)} has 3 deliveries, not 1 to 2`]),
    )
    expect(problemsAfter((copy) => void (copy.parcels = copy.parcels.filter((parcel) => parcel.deliveryId !== delivery!.id)))).toEqual(
      expect.arrayContaining([`delivery ${delivery!.id} has 0 parcels, not 1 to 3`]),
    )
  })

  // A country the words do not know has no legal forms: a customer there is
  // refused by its name as well as by its tenant.
  test('a customer in a country the words do not know', () => {
    expect(
      problemsAfter((copy) => {
        copy.countries.push({ isoCode: 'PL', name: 'Poland' })
        copy.customers.find((customer) => key(customer) === key(swiss))!.countryCode = 'PL'
      }),
    ).toEqual(
      expect.arrayContaining([
        'the countries added are AT, BE, FR, IT, LI, LU, NL, not AT, BE, FR, IT, LI, LU, NL, PL',
        `customer ${key(swiss)} is in PL, where tenant 1 has no customers`,
        `customer ${key(swiss)} "${swiss.name}" ends in no legal form of PL`,
      ]),
    )
  })

  // The countries the demo adds are its whole list: one missing is a
  // customer whose country the lookup cannot show.
  test('a country left out, or misnamed', () => {
    expect(problemsAfter((copy) => void copy.countries.pop())).toEqual(expect.arrayContaining(['the countries added are AT, BE, FR, IT, LI, LU, NL, not AT, BE, FR, IT, LI, LU']))
    expect(problemsAfter((copy) => void (copy.countries[0]!.name = 'Österreich'))).toEqual(['country AT is named Österreich, not Austria'])
  })
})
