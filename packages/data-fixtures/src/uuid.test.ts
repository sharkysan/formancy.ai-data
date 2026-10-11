import { describe, expect, test } from 'vitest'
import { DELIVERIES, UUID_PARITY, uuidOrder } from './uuid.js'

/*
 * The shared uuid expectations (0056) as data. What each engine does with
 * them is the adapters' uuid suites'; these hold the data to what those
 * suites need it to show.
 */

describe('uuidOrder', () => {
  // The fixture's deliveries are listed under their order on both engines
  // (`uuid: parent`). Keys both engines order alike would make that case
  // compare one order, and nothing would show that the two differ.
  test("orders the fixture's deliveries differently on each engine", () => {
    const keys = Object.values(DELIVERIES)
    expect(uuidOrder('postgres', keys)).toEqual([DELIVERIES.express, DELIVERIES.freight, DELIVERIES.post])
    expect(uuidOrder('sqlserver', keys)).toEqual([DELIVERIES.freight, DELIVERIES.express, DELIVERIES.post])
  })

  // The paged keys each set one byte, so the order an engine lists them in
  // is the order of significance it gives the sixteen bytes -- the whole
  // rule, measured on every run. A key with two bytes set, or none, would
  // leave a position the case says nothing about.
  test('pages sixteen keys, each setting a different one of the sixteen bytes', () => {
    const set = UUID_PARITY.order.keys.map((key) => {
      const bytes = key.replaceAll('-', '').match(/../g) ?? []
      return bytes.flatMap((byte, at) => (byte === '00' ? [] : [[at, byte]]))
    })
    expect(set).toEqual(Array.from({ length: 16 }, (_, at) => [[at, '01']]))
    // Ascending, the least significant byte first: PostgreSQL's last byte, SQL Server's first.
    const position = (order: string[]) => order.map((key) => UUID_PARITY.order.keys.indexOf(key))
    expect(position(uuidOrder('postgres', UUID_PARITY.order.keys))).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(position(uuidOrder('sqlserver', UUID_PARITY.order.keys))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9, 8, 15, 14, 13, 12, 11, 10])
  })

  // A value that is not a uuid has no place in either order; sorting it
  // anywhere would make an expectation of a typo.
  test('refuses a value that is not a uuid', () => {
    expect(() => uuidOrder('postgres', ['not-a-uuid'])).toThrow(/is not a uuid/)
  })
})
