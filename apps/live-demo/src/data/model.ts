/*
 * The live demo's sample sales data: what it is, as types and constants.
 *
 * The rows go into the fixture's own schema (packages/data-fixtures/fixtures/
 * postgres.sql), which is loaded unchanged; the demo's SQL then replaces the
 * fixture's rows with these. Every column below is one of that schema's, in
 * the unit the generator works in: whole cents for money, a day as
 * `YYYY-MM-DD` for a date, milliseconds since the epoch for an instant.
 * Nothing is a float, so nothing is rounded on the way to the SQL.
 */

/** The day the data is as of. Every date counts back from it, never from "now", so two builds load the same rows. */
export const ANCHOR = '2026-09-30'

/** The seed the image's data is generated from. Another seed is other rows (generate.test.ts). */
export const DEMO_SEED = 0x5eed_0070

/** Each tenant's share of the data, the same for both, so either persona sees as much as the other. */
export const PER_TENANT = {
  customers: 120,
  /** More than eight pages of the host's grid (LIST_PAGE_SIZE), so paging is something a visitor does. */
  orders: 420,
} as const

export const TENANTS = [1, 2] as const
export type Tenant = (typeof TENANTS)[number]

/** Where each tenant's customer numbers start. */
export const FIRST_CUSTOMER_NO = 10_001

/** How far back the orders go: eighteen months up to the anchor. */
export const ORDER_MONTHS = 18

/** An order younger than this many days may still be a draft, placed or shipped; an older one is shipped or, now and then, placed. */
export const RECENT_DAYS = 21

/** A customer who is no longer active has ordered nothing for this many days. */
export const INACTIVE_DAYS = 180

/** How many of each an order or a delivery holds. */
export const LINES_PER_ORDER = { min: 1, max: 6 } as const
export const QUANTITY = { min: 1, max: 48 } as const
export const DELIVERIES_PER_SHIPPED_ORDER = { min: 1, max: 2 } as const
export const PARCELS_PER_DELIVERY = { min: 1, max: 3 } as const
/** Days from an order's date to a delivery's. */
export const DAYS_TO_SHIP = { min: 1, max: 6 } as const

export type OrderStatus = 'draft' | 'placed' | 'shipped'

export interface DemoCountry {
  isoCode: string
  name: string
}

export interface DemoEmployee {
  id: number
  name: string
  managerId: number | null
}

export interface DemoCustomer {
  tenantId: Tenant
  customerNo: number
  name: string
  countryCode: string
  /** Whole cents, or null for none. */
  creditLimitCents: number | null
  active: boolean
  /** Milliseconds since the epoch. */
  createdAt: number
}

export interface DemoOrder {
  id: number
  tenantId: Tenant
  customerNo: number
  /** `YYYY-MM-DD`. */
  orderDate: string
  status: OrderStatus
  /** Whole cents: the sum of the lines' quantity × unit price. */
  amountCents: number
  notes: string | null
  createdBy: number
  approvedBy: number | null
}

export interface DemoLine {
  orderId: number
  lineNo: number
  quantity: number
  unitPriceCents: number
}

export interface DemoDelivery {
  /** A version-4-shaped uuid, lower case, drawn from the seed. */
  id: string
  tenantId: Tenant
  orderId: number
  carrier: string
  /** Milliseconds since the epoch. */
  shippedAt: number
}

export interface DemoParcel {
  id: number
  deliveryId: string
  label: string
}

/** Every row the demo's SQL inserts, each list in the order it is inserted. */
export interface DemoData {
  /** The countries added to the fixture's two. */
  countries: DemoCountry[]
  employees: DemoEmployee[]
  customers: DemoCustomer[]
  orders: DemoOrder[]
  lines: DemoLine[]
  deliveries: DemoDelivery[]
  parcels: DemoParcel[]
}

const DAY_MS = 86_400_000

/** Whole cents as an exact decimal of `scale` places, two or more: 123456 at 4 is `1234.5600`. */
export function decimal(cents: number, scale: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`an amount is a whole, non-negative number of cents, not ${String(cents)}`)
  if (!Number.isInteger(scale) || scale < 2) throw new Error(`cents have two places at least, not ${String(scale)}`)
  return `${String(Math.trunc(cents / 100))}.${String(cents % 100).padStart(2, '0')}${'0'.repeat(scale - 2)}`
}

/** Days since 1970-01-01 of a `YYYY-MM-DD` day, in UTC. */
export function dayNumber(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (match === null) throw new Error(`a day is written YYYY-MM-DD, not ${day}`)
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (new Date(time).toISOString().slice(0, 10) !== day) throw new Error(`${day} is no day of the calendar`)
  return time / DAY_MS
}

/** The `YYYY-MM-DD` of a day number. */
export function dayOf(number: number): string {
  return new Date(number * DAY_MS).toISOString().slice(0, 10)
}

/** The day number an instant falls on, in UTC. */
export function dayOfInstant(instant: number): number {
  return Math.floor(instant / DAY_MS)
}

/** The instant a day number starts, in UTC. */
export function startOfDay(number: number): number {
  return number * DAY_MS
}

/** Monday to Friday. */
export function isWeekday(number: number): boolean {
  const weekday = new Date(number * DAY_MS).getUTCDay()
  return weekday !== 0 && weekday !== 6
}

/** The first day of the order window: the first of the month, `ORDER_MONTHS` calendar months back, the anchor's month counted. */
export function firstOrderDay(anchor: string = ANCHOR): number {
  const end = new Date(dayNumber(anchor) * DAY_MS)
  return Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (ORDER_MONTHS - 1), 1) / DAY_MS
}
