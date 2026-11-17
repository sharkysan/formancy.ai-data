import type { ActionRequest, NormalizedType } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { lockOrder, runBatch } from './statements.js'

/*
 * The order a run's batch locks a selection's records in (0165), without a
 * server: one UPDATE per record, in the order of their keys, whatever
 * order they were sent in. That two runs over overlapping selections sent
 * in opposite orders wait for each other rather than deadlock is
 * actions-selection.integration.test.ts's, against a real server; this
 * holds the order the batch is built in, which that case rests on.
 */

const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 20, lengthUnit: 'utf16-code-units', fixedLength: false }

/** A run of a procedure taking the key, over records keyed by `keys`, in the order given. */
function request(type: NormalizedType, keys: readonly string[]): ActionRequest {
  return {
    action: 'close-all',
    target: {
      table: { schema: 'actions', name: 'order' },
      identity: [{ name: 'id', type }],
      concurrency: { kind: 'version-column', column: 'version' },
    },
    records: keys.map((value) => ({ key: [{ name: 'id', type, value }], expectedVersion: '1' })),
    filters: { terms: [] },
    through: [],
    move: { kind: 'increment', column: 'version' },
    routine: {
      ref: { schema: 'actions', name: 'close_order', signature: '' },
      kind: 'procedure',
      arguments: [{ parameter: '@p_order', typeId: '127:8:19:0', type: INT64, from: { kind: 'column', column: 'id' } }],
    },
    definitions: { table: '00', routine: '00' },
  } as unknown as ActionRequest
}

/** The batch of `planned`, every record at version 1. */
function batchOf(planned: ActionRequest): string {
  return runBatch(
    planned,
    [],
    [],
    planned.records.map(() => ({ kind: 'version-column', value: '1' })),
    Buffer.alloc(32),
    Buffer.alloc(32),
    1000,
  ).sql
}

/** The positions the batch's UPDATEs OUTPUT, in the order the batch runs them. */
function updated(planned: ActionRequest): number[] {
  return [...batchOf(planned).matchAll(/^update \[r\] set .* output ([0-9]+), /gm)].map((match) => Number(match[1]))
}

describe('the order a run locks its records in', () => {
  // A whole number by its value, so 10 comes after 9 as the key's index
  // keeps them, and anything else by its canonical text: one order for
  // every run over the same rows, whatever order each was sent in. Ordered
  // by the text of a whole number, 10 would come before 9 and the order
  // would still be one, but not the key's. Watched failing on 2026-11-17
  // with a whole number ordered by its text: "expected [ +0, 1, 2 ] to
  // deeply equal [ 1, 2, +0 ]".
  test('is the order of the keys, a whole number by its value', () => {
    expect(lockOrder(request(INT64, ['10', '2', '9']).records)).toEqual([1, 2, 0])
    expect(lockOrder(request(TEXT, ['b', 'B', 'a']).records)).toEqual([1, 2, 0])
  })

  // The batch runs one UPDATE per record in that order, each OUTPUT with
  // its position: two selections sent in opposite orders lock their common
  // rows in one order. Watched failing on 2026-11-17 with the UPDATEs
  // written in the order sent: "expected [ +0, 1, 2 ] to deeply equal [ 1,
  // 2, +0 ]".
  test('is the order the batch runs its UPDATEs in, each naming its record', () => {
    expect(updated(request(INT64, ['10', '2', '9']))).toEqual([1, 2, 0])
    expect(updated(request(INT64, ['9', '2', '10']))).toEqual([1, 0, 2])
    expect(updated(request(INT64, ['7']))).toEqual([0])
  })
})

describe('what each call of a selection is given', () => {
  /** Each statement of the batch that reads a record's row, sets a call's variables from it, or calls, in the order the batch runs them. */
  function steps(planned: ActionRequest): string[] {
    return batchOf(planned)
      .split('\n')
      .flatMap((line) => {
        const read = /^insert @given \(.*\) select ([0-9]+), .* from \[actions\]\.\[order\] as \[r\] where /.exec(line)
        if (read !== null) return [`read ${String(read[1])}`, ...(/if @@rowcount <> 1 throw /.test(line) ? ['found'] : [])]
        const given = /^select @a0 = \[a0\] from @given where \[o\] = ([0-9]+);$/.exec(line)
        if (given !== null) return [`given ${String(given[1])}`]
        return /^exec @status = /.test(line) ? ['exec'] : []
      })
  }

  // Every record's arguments are read from its locked row before the first
  // EXEC, each read found exactly one row, and each EXEC is given its own
  // record's: what PostgreSQL's one call statement passes, read under one
  // snapshot. Read just before each EXEC, a record whose row an earlier
  // call deleted would leave the variables holding the previous record's
  // key, and the procedure would run twice over one row, answered done;
  // and a column an earlier call changed would reach the later call as it
  // wrote it, where PostgreSQL passes it as locked (0165).
  test('reads every record’s arguments before the first call, and gives each call its own', () => {
    expect(steps(request(INT64, ['9', '2']))).toEqual(['read 0', 'found', 'read 1', 'found', 'given 0', 'exec', 'given 1', 'exec'])
    expect(steps(request(INT64, ['7']))).toEqual(['read 0', 'found', 'given 0', 'exec'])
  })
})
