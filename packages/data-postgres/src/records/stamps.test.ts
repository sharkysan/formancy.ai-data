import type { ClockColumn, InsertRequest, UpdateRequest } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { clockSql, insertStatement, updateStatement } from './sql.js'

/*
 * The SQL a stamp of the time is written with (0153), as text: what the
 * database then does with it is `stamps.integration.test.ts`'s, against a
 * real server. Here: that the clock is fixed SQL in the statement, never a
 * bound value or anything of the request but the column's quoted name.
 */

const INSTANT: ClockColumn['type'] = { kind: 'timestamp', withTimeZone: true, precision: 6 }
const WALL: ClockColumn['type'] = { kind: 'timestamp', withTimeZone: false, precision: 3 }
const DAY: ClockColumn['type'] = { kind: 'date' }
const DEFINITION = { digest: '0'.repeat(64), isolation: 'read committed' }
const TARGET = {
  table: { schema: 'parity', name: 'audited' },
  identity: [{ name: 'id', type: { kind: 'integer', min: '-2147483648', max: '2147483647' } }],
} as const
const TEXT = { kind: 'text', maxLength: 40, lengthUnit: 'code-points', fixedLength: false } as const

describe('a stamp of the time on PostgreSQL', () => {
  // `current_timestamp` for an instant, the transaction's start, as a
  // `now()` default takes it; UTC's wall clock and day otherwise, whatever
  // the session's zone. Watched failing with `localtimestamp` for the wall
  // clock, which is the session's.
  test("is the clock in the column's own type, in UTC where the type keeps no zone", () => {
    expect(clockSql(INSTANT)).toBe('current_timestamp')
    expect(clockSql(WALL)).toBe(`(current_timestamp at time zone 'UTC')`)
    expect(clockSql(DAY)).toBe(`(current_timestamp at time zone 'UTC')::pg_catalog.date`)
  })

  // The insert names each stamped column, quoted, and writes the clock in
  // the statement itself: no parameter carries a time, so nothing of this
  // process's clock reaches the row (formancy.ai 0019). Watched failing
  // with the clock columns left out of the column list.
  test('is written by the insert and the update themselves, the column quoted', () => {
    const insert: InsertRequest = {
      target: { ...TARGET, concurrency: null },
      values: [{ name: 'created_by', type: TEXT, value: 'alice' }],
      clock: [
        { name: 'created_at', type: INSTANT },
        { name: 'odd"name', type: WALL },
      ],
      returning: [],
      definition: 'unused',
    }
    const inserted = insertStatement(insert, DEFINITION, 'read-committed')
    expect(inserted.text).toContain(`insert into "parity"."audited" as "r" ("created_by", "created_at", "odd""name")`)
    expect(inserted.text).toContain(`, current_timestamp, (current_timestamp at time zone 'UTC')\nwhere`)
    expect(inserted.params.filter((param) => param !== null && /^\d{4}-\d{2}-\d{2}/.test(param))).toEqual([])

    const update: UpdateRequest = {
      target: { ...TARGET, concurrency: { kind: 'version-column', column: 'version' } },
      key: [{ name: 'id', type: TARGET.identity[0].type, value: '5' }],
      set: [{ name: 'changed_by', type: TEXT, value: 'bob' }],
      clock: [{ name: 'changed_on', type: DAY }],
      expectedVersion: '1',
      filters: { kind: 'unrestricted' },
      through: [],
      returning: [],
      definition: 'unused',
    }
    const updated = updateStatement(update, [], [], DEFINITION, 'read-committed')
    expect(updated.text).toContain(`, "changed_on" = (current_timestamp at time zone 'UTC')::pg_catalog.date, "version" = `)
    expect(updated.text).toMatch(/^set "changed_by" = \$1::/m)
  })

  // A request that stamps nothing is the statement it was before 0153.
  test('is nowhere in a write that stamps nothing', () => {
    const plain = insertStatement({ target: { ...TARGET, concurrency: null }, values: [], returning: [], definition: 'unused' }, DEFINITION, 'read-committed')
    expect(plain.text).not.toContain('current_timestamp')
  })
})
