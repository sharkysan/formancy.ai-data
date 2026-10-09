/**
 * Values the run's setup writes into both databases and the suites look for,
 * in a module of their own: the setup runs in Node and imports the fixture
 * harness, which a jsdom worker cannot load, so the suites cannot import them
 * from there.
 */

/** The second tenant-1 customer this run adds on both engines, so an order's customer can be changed to another the clerk may pick. */
export const SECOND_CUSTOMER = { no: 900, name: 'Zweite Kundin AG' } as const
