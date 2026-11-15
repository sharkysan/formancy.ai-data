import type { ClockColumn, InsertRequest, UpdateRequest } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { clockSql, insertStatement, NOW, updateStatement } from './statements.js'

/*
 * The SQL a stamp of the time is written with (0153), as text: what the
 * server then does with it is `stamps.integration.test.ts`'s, against a
 * real server. Here: that the batch reads the clock once, and every stamp
 * of the write is that reading, as fixed SQL -- never a bound value, never
 * anything of the request but the column's quoted name.
 */

const INSTANT: ClockColumn['type'] = { kind: 'timestamp', withTimeZone: true, precision: 7 }
const WALL: ClockColumn['type'] = { kind: 'timestamp', withTimeZone: false, precision: 3 }
const DAY: ClockColumn['type'] = { kind: 'date' }
const DEFINITION = Buffer.alloc(32)
const ID = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const TARGET = { table: { schema: 'parity', name: 'audited' }, identity: [{ name: 'id', type: ID }] } as const
const TEXT = { kind: 'text', maxLength: 40, lengthUnit: 'utf16-code-units', fixedLength: false } as const

describe('a stamp of the time on SQL Server', () => {
  // One reading, in UTC: an instant at +00:00, never the server's own
  // offset; the wall clock the reading itself; the day its UTC day.
  // Watched failing with `sysdatetimeoffset()` for an instant, which is a
  // reading of its own at the server's offset.
  test("is the batch's one reading of the clock, in the column's own type", () => {
    expect(clockSql(INSTANT)).toBe(`todatetimeoffset(${NOW}, 0)`)
    expect(clockSql(WALL)).toBe(NOW)
    expect(clockSql(DAY)).toBe(`convert(date, ${NOW})`)
  })

  // The batch declares the reading once, before the statement, and the
  // insert and the update name each stamped column, quoted, and write the
  // reading in the statement itself: no parameter carries a time (formancy.ai
  // 0019). Watched failing with the declaration left out of a batch that
  // stamps, which SQL Server would refuse: an undeclared variable, 137.
  test('is read once, and written by the insert and the update themselves', () => {
    const insert: InsertRequest = {
      target: { ...TARGET, concurrency: null },
      values: [{ name: 'created_by', type: TEXT, value: 'alice' }],
      clock: [
        { name: 'created_at', type: INSTANT },
        { name: 'odd]name', type: WALL },
      ],
      returning: [],
      definition: 'unused',
    }
    const inserted = insertStatement(insert, DEFINITION).sql
    expect(inserted.split(`declare ${NOW} datetime2(7) = sysutcdatetime();`)).toHaveLength(2)
    expect(inserted.indexOf(`declare ${NOW}`)).toBeLessThan(inserted.indexOf('insert into [parity].[audited]'))
    expect(inserted).toContain('insert into [parity].[audited] ([created_by], [created_at], [odd]]name])')
    expect(inserted).toContain(`values (@p`)
    expect(inserted).toContain(`, todatetimeoffset(${NOW}, 0), ${NOW})`)

    const update: UpdateRequest = {
      target: { ...TARGET, concurrency: { kind: 'version-column', column: 'version' } },
      key: [{ name: 'id', type: ID, value: '5' }],
      set: [{ name: 'changed_by', type: TEXT, value: 'bob' }],
      clock: [{ name: 'changed_on', type: DAY }],
      expectedVersion: '1',
      filters: { kind: 'unrestricted' },
      through: [],
      returning: [],
      definition: 'unused',
    }
    const updated = updateStatement(update, [], [], { kind: 'version-column', value: '1' }, DEFINITION).sql
    expect(updated).toContain(`, [changed_on] = convert(date, ${NOW}), [version] = [r].[version] + 1`)
    expect(updated).toContain(`declare ${NOW} datetime2(7) = sysutcdatetime();`)
  })

  // A request that stamps nothing is the batch it was before 0153.
  test('is nowhere in a write that stamps nothing', () => {
    const plain = insertStatement({ target: { ...TARGET, concurrency: null }, values: [], returning: [], definition: 'unused' }, DEFINITION).sql
    expect(plain).not.toContain(NOW)
  })
})
