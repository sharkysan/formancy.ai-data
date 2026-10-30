/**
 * What a form over versions does on each engine (0113), by case, against
 * `parity.price` -- a product's prices per tenant, each valid from one date
 * until the next starts -- and `parity.price_declined`, whose own trigger
 * keeps the next version from being inserted. Each suite asserts every case
 * through its adapter and declares it with `covers()`.
 *
 * - `changed`: a change from a date ends the open version at the next one's
 *   start and inserts the next: the chain's key copied from the row ended,
 *   the end NULL, its own version; the version ended moved by one.
 * - `stale`: the open version changed after it was read: `stale`, nothing
 *   ended and nothing inserted.
 * - `ended`: a change of a version that has ended, at the version sent:
 *   `version-ended`, nothing written.
 * - `other-tenant`: another tenant's open version: `not-found`, nothing
 *   written.
 * - `update-ended`: an update of a version that has ended:
 *   `version-ended`, nothing written; the open one updates.
 * - `chain-exists`: a create of a chain's first version where the chain has
 *   one: `chain-exists`, nothing written; where it has none, created.
 * - `next-declined`: the database keeps the next version from being
 *   inserted after the open one was ended -- on PostgreSQL a BEFORE INSERT
 *   trigger that returns NULL, on SQL Server an AFTER UPDATE trigger that
 *   moves the ended row to another product, so the batch cannot find it
 *   again -- and the change is undone: `refused`, the open version still
 *   open and no next one.
 */
export const VERSION_PARITY = {
  changed: 'changed',
  stale: 'stale',
  ended: 'version-ended',
  'other-tenant': 'not-found',
  'update-ended': 'version-ended',
  'chain-exists': 'chain-exists',
  'next-declined': 'refused',
} as const

export type VersionCase = keyof typeof VERSION_PARITY
