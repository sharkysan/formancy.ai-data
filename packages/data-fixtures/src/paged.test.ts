import { DEFAULT_MAX_PAGE_SIZE } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { PAGED_LATER, PAGED_ORDERS, pagedCustomers, pagedOrderNotes } from './paged.js'

/*
 * Tenant 3's customers and orders (0085) as pure functions: one lookup
 * page of each and more, from which the suites that load them into both
 * engines compute what a search answers. Nothing here touches a database;
 * the client's and the host page's suites hold both engines to it.
 */

const names = (): string[] => pagedCustomers().map((customer) => customer.name)

/** What a lookup's contains search for `search` matches, folded as both engines fold it. */
const matching = (search: string): string[] => names().filter((name) => name.toLowerCase().includes(search.toLowerCase()))

describe('the paged customers', () => {
  // The rows are defined by the page size: a full first page of `First NN`,
  // numbered from 1, and the rest `Later NN`, numbered after them. A page
  // size the rows were not made from would make "exactly one page" and "more
  // than a page" two claims about the wrong number.
  test('are one page of First and ten more of Later, numbered from 1, from the page size', () => {
    const customers = pagedCustomers()
    expect(customers).toHaveLength(DEFAULT_MAX_PAGE_SIZE + PAGED_LATER)
    expect(customers.map((customer) => customer.customerNo)).toEqual(customers.map((_, index) => index + 1))
    expect(customers.slice(0, DEFAULT_MAX_PAGE_SIZE).every((customer) => customer.name.startsWith('First '))).toBe(true)
    expect(customers.slice(DEFAULT_MAX_PAGE_SIZE).every((customer) => customer.name.startsWith('Later '))).toBe(true)
    expect(new Set(names()).size).toBe(customers.length)
  })

  // PostgreSQL on musl orders text by code point and SQL Server's CI
  // collation case-insensitively; a lookup orders by its label. The two
  // first pages equal one expectation only if both orders agree on every
  // pair, and agree with the numbers, so that the first page is the First
  // rows: ASCII words in Title Case and numbers padded to one width do that.
  // A name starting in lower case breaks it (watched failing with "later 07":
  // "later 07 is not ASCII Title Case", and with that check left out, "first
  // disagreement: Later 08 against later 07").
  test('are ASCII Title Case, and sort the same by code point, case-insensitively and by number', () => {
    for (const name of names()) expect(name, `${name} is not ASCII Title Case`).toMatch(/^[A-Z][a-z]+ [0-9]+$/)
    const byCodePoint = [...names()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const folded = (name: string): string => name.toLowerCase()
    const byFolded = [...names()].sort((a, b) => (folded(a) < folded(b) ? -1 : folded(a) > folded(b) ? 1 : 0))
    const firstDifference = byCodePoint.findIndex((name, index) => name !== byFolded[index])
    expect(firstDifference, `first disagreement: ${String(byCodePoint[firstDifference])} against ${String(byFolded[firstDifference])}`).toBe(-1)
    expect(byCodePoint).toEqual(names())
  })

  // What the suites search for: the empty search lists the First rows and
  // there are more; `First` fills exactly one page, which a source that
  // guessed "more" from a full page would call more; `Later 07` is one row
  // past the first page, reached only by typing.
  test('give a first page of First rows, exactly one page for First and one row for Later 07', () => {
    expect(names().slice(0, DEFAULT_MAX_PAGE_SIZE)).toEqual(matching('First'))
    expect(matching('First')).toHaveLength(DEFAULT_MAX_PAGE_SIZE)
    expect(matching('').length).toBeGreaterThan(DEFAULT_MAX_PAGE_SIZE)
    expect(matching('Later 07')).toEqual(['Later 07'])
  })

  // The tenant's orders are for its first customer, so a record of one
  // shows a label from the first page whatever the page size; they are a
  // page and one more, so the order line's lookup over them goes on; and
  // their notes number them, so the first is found among what an insert
  // returns.
  test("hold a page of the tenant's orders and one more, each for First 01, noted in order", () => {
    expect(pagedCustomers().find((customer) => customer.customerNo === PAGED_ORDERS.customerNo)?.name).toBe('First 01')
    expect(PAGED_ORDERS.count).toBe(DEFAULT_MAX_PAGE_SIZE + 1)
    const notes = pagedOrderNotes()
    expect({ count: notes.length, unique: new Set(notes).size, first: notes[0], sorted: [...notes].sort() }).toEqual({
      count: PAGED_ORDERS.count,
      unique: PAGED_ORDERS.count,
      first: 'paged 01',
      sorted: notes,
    })
  })
})
