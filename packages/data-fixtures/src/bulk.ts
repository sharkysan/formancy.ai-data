/*
 * What deleting the chosen records of a page does on both engines (0173),
 * written once for data-server's `e2e-bulk.integration.test.ts`, which
 * asks it of both through the real server, its drivers and the parity
 * schema: each record of a request a delete of its own, in its own
 * transaction, in the order sent, and each answered with what a delete of
 * it alone would have been.
 *
 * Not a family of `sharedCases()`. The release report holds a shared case
 * on every image of the matrix (0067), and the server's suites run on the
 * default images alone -- the image legs run data-fixtures and each
 * adapter -- so a case only they declared would be missing on every other
 * image and fail the run. What each record's delete does on every image is
 * DELETE_PARITY's and CASCADE_PARITY's, held there; what these add is the
 * server's loop over such deletes, one code on either engine, asked of the
 * default images by one suite with both engines in it.
 *
 * The outcome of each case is a record's as the trail names it: `done`,
 * or the code its delete was refused with.
 *
 * - `deleted`: a row of tenant 1 at the version read is deleted, and gone.
 * - `stale`: a row updated after it was read is kept, and the request
 *   goes on to the records after it.
 * - `not-found`: a row deleted since it was read.
 * - `other-tenant`: tenant 2's row, sent by tenant 1's clerk at its true
 *   version, is not found, and stays.
 * - `referenced`: a row a NO ACTION key's row still refers to is kept.
 * - `cascade`: a parent whose rows cascade from it, through keys the
 *   policy names, is deleted with them, two levels down.
 * - `cascade-taken`: a row a cascade of another form's delete took after
 *   the page read it is not found, and the record after it is deleted. A
 *   cascade of one record onto another of the same form is not a case:
 *   SQL Server refuses a key that cascades onto its own table, and every
 *   cycle of cascading keys (error 1785), and the parity schema has none.
 */

/** A record's outcome as the trail names it: `done`, or the code its delete was refused with. */
export type BulkOutcome = 'done' | 'stale' | 'not-found' | 'referenced'

export const BULK_PARITY = {
  deleted: 'done',
  stale: 'stale',
  'not-found': 'not-found',
  'other-tenant': 'not-found',
  referenced: 'referenced',
  cascade: 'done',
  'cascade-taken': 'not-found',
} as const satisfies Readonly<Record<string, BulkOutcome>>

export type BulkCase = keyof typeof BULK_PARITY
