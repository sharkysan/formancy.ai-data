/*
 * What deleting (0173) or changing (0175) the chosen records of a page does
 * on both engines, written once for data-server's
 * `e2e-bulk.integration.test.ts`, which asks it of both through the real
 * server, its drivers and the shared fixture: each record of a request a
 * write of its own, in its own transaction, in the order sent, and each
 * answered with what a write of it alone would have been.
 *
 * Not a family of `sharedCases()`. The release report holds a shared case
 * on every image of the matrix (0067), and the server's suites run on the
 * default images alone -- the image legs run data-fixtures and each
 * adapter -- so a case only they declared would be missing on every other
 * image and fail the run. What each record's write does on every image is
 * DELETE_PARITY's, CASCADE_PARITY's and the adapters' update cases', held
 * there; what these add is the server's loop over such writes, one code on
 * either engine, asked of the default images by one suite with both
 * engines in it.
 *
 * The outcome of each case is a record's as the trail names it: `done`,
 * or the code its write was refused with.
 *
 * A delete of chosen records, over the parity schema's removable tables:
 *
 * - `deleted`: a row of tenant 1 at the version read is deleted, and gone.
 * - `stale`: a row updated after it was read is kept, and the request
 *   goes on to the records after it. A change's too: one updated since is
 *   not changed.
 * - `not-found`: a row deleted since it was read. A change's too, of a
 *   field other than the state field, whose move a record nobody could
 *   read is refused (0127).
 * - `other-tenant`: tenant 2's row, sent by tenant 1's clerk at its true
 *   version, is not found, and stays. A change's too.
 * - `referenced`: a row a NO ACTION key's row still refers to is kept.
 * - `cascade`: a parent whose rows cascade from it, through keys the
 *   policy names, is deleted with them, two levels down.
 * - `cascade-taken`: a row a cascade of another form's delete took after
 *   the page read it is not found, and the record after it is deleted. A
 *   cascade of one record onto another of the same form is not a case:
 *   SQL Server refuses a key that cascades onto its own table, and every
 *   cycle of cascading keys (error 1785), and the parity schema has none.
 *
 * A change of chosen records, over the shared fixture's orders:
 *
 * - `changed`: an order of tenant 1 at the version read takes the answers
 *   given, its status moved as its own state allows, and reads them back.
 * - `spelled`: an amount sent as `12.5` is answered, and read back, as the
 *   column holds it, `12.5000`, on both engines.
 * - `move-refused`: an order whose own state the policy lets no move start
 *   from to the status given is refused, and the request goes on.
 * - `declined`: an order the deployment's trigger keeps as it is, raising
 *   its refusal worded for the person (0156), is refused with those words,
 *   and the request goes on.
 */

/** A record's outcome as the trail names it: `done`, or the code its write was refused with. */
export type BulkOutcome = 'done' | 'stale' | 'not-found' | 'referenced' | 'transition-denied' | 'declined'

export const BULK_PARITY = {
  deleted: 'done',
  stale: 'stale',
  'not-found': 'not-found',
  'other-tenant': 'not-found',
  referenced: 'referenced',
  cascade: 'done',
  'cascade-taken': 'not-found',
  changed: 'done',
  spelled: 'done',
  'move-refused': 'transition-denied',
  declined: 'declined',
} as const satisfies Readonly<Record<string, BulkOutcome>>

export type BulkCase = keyof typeof BULK_PARITY
