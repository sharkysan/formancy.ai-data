/**
 * Values the run's setup writes into both databases and the suites look for,
 * in a module of their own: the setup runs in Node and imports the fixture
 * harness, which a jsdom worker cannot load, so the suites cannot import them
 * from there.
 */

/** The second tenant-1 customer this run adds on both engines, so an order's customer can be changed to another the clerk may pick. */
export const SECOND_CUSTOMER = { no: 900, name: 'Zweite Kundin AG' } as const

/**
 * What the trigger this run adds to the orders on both engines refuses in
 * words for the person (0156): a save of an order with the first notes, and
 * a delete of one that holds the last, each with its reason after
 * `formancy: refused: `; and a save with the middle ones, its reason after
 * `formancy: refused [notes]: `, which names the column the Notes field is
 * bound to. Any other order is written as before.
 */
export const DECLINING = {
  saved: { notes: 'the books are closed', reason: 'The books for this period are closed.' },
  field: { notes: 'notes are closed', column: 'notes', reason: 'Notes are closed for this period.' },
  deleted: { notes: 'kept on file', reason: 'Orders kept on file are never deleted.' },
} as const
