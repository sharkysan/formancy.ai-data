import type { RowFilterTerm, SupersedeRequest, ThroughTerms } from '@formancy/data-core'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { bindValue } from '../sql/values.js'
import { column, keyPredicates, located, NEXT_NOT_INSERTED, NEXT_NOT_INSERTED_MESSAGE, NOT_ONE_ROW, NOT_ONE_ROW_MESSAGE, ROW, selection, versionIs, writeBatch } from './statements.js'
import type { Assigned, ExpectedVersion } from './statements.js'

/*
 * A change from a date on SQL Server (0113). No one statement here both
 * updates a row and inserts another -- no data-modifying CTE, and a MERGE
 * would hold its guard only in a locked read of its source -- so the change
 * is two statements in the one transaction every write's batch already is
 * (`writeBatch`), committed together or rolled back together.
 */

/**
 * The open version ended -- under the key, the trusted filters, every
 * through, the version read and an end still NULL, its version column moved
 * by one -- and, only when exactly one row was, the next version inserted
 * from it: its chain's key as the ended row holds it, found again by its
 * key inside the transaction that holds it, then the start and the values.
 *
 * Two rows ended is an identity that is not a key, rolled back as an
 * update's is; one ended and none inserted -- the row not found again, which
 * a trigger that changed its key would do -- is rolled back too, so the
 * chain is never left without its open version. Nothing ended is no row
 * from the batch, which the adapter reads once more to say why. The
 * batch's guards are the INSERT's: what it stored, its text, the version
 * read back after triggers; and no INSTEAD OF trigger on either statement.
 */
export function supersedeStatement(request: SupersedeRequest, terms: readonly RowFilterTerm[], through: readonly ThroughTerms[], expected: ExpectedVersion, definition: Buffer): Statement {
  const parameters = new Parameters()
  const { target } = request
  const table = quoteTable(target.table)
  const assigned: Assigned[] = [request.start, ...request.values].map((value) => ({ value, sql: bindValue(parameters, value.type, value.value) }))
  const start = (assigned[0] as Assigned).sql
  const set = [`${quoteName(request.ends)} = ${start}`]
  if (target.concurrency.kind === 'version-column') set.push(`${quoteName(target.concurrency.column)} = ${column(target.concurrency.column)} + 1`)
  const where = [...located(parameters, request.key, terms, through), versionIs(parameters, target.concurrency, expected)]
  const names = [...request.chain.map((entry) => quoteName(entry.name)), ...assigned.map(({ value }) => quoteName(value.name))]
  const selected = [...request.chain.map((entry) => column(entry.name)), ...assigned.map(({ sql }) => sql)]
  const again = keyPredicates(parameters, request.key)
  const sql = writeBatch(parameters, {
    target,
    definition,
    operation: 'SUPERSEDE',
    counted: true,
    statement: (output) =>
      [
        'declare @ending int;',
        `update ${ROW} set ${set.join(', ')} from ${table} as ${ROW} where ${where.join(' and ')};`,
        'set @ending = @@rowcount;',
        `if @ending > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`,
        'set @rows = 0;',
        `if @ending = 1 begin insert into ${table} (${names.join(', ')}) ${output} select ${selected.join(', ')} from ${table} as ${ROW} where ${again.join(' and ')}; set @rows = @@rowcount; end;`,
        'set @ending = @ending',
      ].join('\n'),
    assigned,
    returned: selection(request.returning, target.concurrency, 'inserted.'),
    afterWrite: [],
  })
  return parameters.statement(sql)
}
