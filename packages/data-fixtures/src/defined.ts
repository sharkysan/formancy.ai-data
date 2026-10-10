import type { InsertRequest, ObjectRef, ReadRequest, RecordAdapter, RecordOutcome, UpdateRequest } from '@formancy/data-core'

/*
 * The record port as the suites written before 0041 call it, over the real
 * adapter: each write carries the definition `describe` reads just before
 * it, as the runtime's do, and a read answers its record alone.
 *
 * So those suites run unchanged otherwise, which is the evidence that the
 * guard passes on every fixture table as it is (0041): a guard that refused
 * an unchanged table would fail every write they make. The description is
 * the runtime's precondition, so a table it cannot describe is answered with
 * its failure and nothing is sent -- what a request does. A test whose
 * subject is the write itself against a table or a pool that cannot be
 * described -- a renamed table, a closed pool, a pool with no connection to
 * hand out -- passes a definition of its own, so that the write is what is
 * sent and answered: through `defined`, a failed description would answer
 * it, and the write's own handling of that failure would go unchecked.
 */

/** A write as the older suites build it: with no definition, which `defined` reads for it. */
export type Undefined<Request> = Omit<Request, 'definition'> & { definition?: string }

export function defined(records: RecordAdapter) {
  async function definitionOf(request: { target: { table: InsertRequest['target']['table'] }; definition?: string }): Promise<{ ok: true; definition: string } | Exclude<RecordOutcome, { ok: true }>> {
    if (request.definition !== undefined) return { ok: true, definition: request.definition }
    const described = await records.describe(request.target.table)
    return described.ok ? { ok: true, definition: described.described.definition } : described
  }
  return {
    describe: (table: ObjectRef) => records.describe(table),
    async read(request: ReadRequest): Promise<RecordOutcome> {
      const read = await records.read(request)
      if (!read.ok) return read
      return read.record === null ? { ok: false, code: 'not-found', message: 'No such record exists inside the filters.' } : { ok: true, ...read.record }
    },
    async insert(request: Undefined<InsertRequest>): Promise<RecordOutcome> {
      const found = await definitionOf(request)
      return found.ok ? records.insert({ ...request, definition: found.definition }) : found
    },
    async update(request: Undefined<UpdateRequest>): Promise<RecordOutcome> {
      const found = await definitionOf(request)
      return found.ok ? records.update({ ...request, definition: found.definition }) : found
    },
  }
}

/** The port as `defined` gives it to an older suite: one implementation, so its type is the function's. */
export type DefinedRecords = ReturnType<typeof defined>
