import { describe, expect, test } from 'vitest'
import type { NormalizedType } from '../metadata.js'
import type { FilterCondition } from '../runtime.js'
import { columnFilter, dayAfter, filterOffer, readFilter } from './filter.js'
import { AMOUNT, BOOLEAN, col, DATE, INT32, text } from './test-support.js'

/*
 * A person's conditions on a list's columns (0104), decided once for a
 * form's list, its export and a browse: what a column offers, what a body
 * may carry, and the condition an adapter compares, every value spelled as
 * its column holds it before anything is bound.
 */

const UUID: NormalizedType = { kind: 'uuid' }
const INSTANT: NormalizedType = { kind: 'timestamp', withTimeZone: true, precision: 6 }
const WALL_CLOCK: NormalizedType = { kind: 'timestamp', withTimeZone: false, precision: 3 }
const FLOAT: NormalizedType = { kind: 'float', bits: 64 }
const TIME: NormalizedType = { kind: 'time', precision: 0 }
const UNSCALED: NormalizedType = { kind: 'decimal', precision: null, scale: null }

const column = (type: NormalizedType, nullable = false) => col('c', 1, type, { nullable })
const planned = (type: NormalizedType, condition: FilterCondition) => columnFilter(column(type), condition, 'c')
const equals = (type: NormalizedType, value: string) => planned(type, { op: 'equals', value })

describe('filterOffer', () => {
  // The studio's panel and the host's grid offer what this says, and the
  // planners accept exactly that: one table, so an offer is never refused.
  test('offers each kind its own operators, and the NULL ones where the column holds NULLs', () => {
    expect(filterOffer(column(text(20)))).toEqual({ operators: ['equals', 'contains'], input: 'text', days: null })
    expect(filterOffer(column(INT32))).toEqual({ operators: ['equals', 'range'], input: 'integer', days: null })
    expect(filterOffer(column(AMOUNT))).toEqual({ operators: ['equals', 'range'], input: 'decimal', days: null })
    expect(filterOffer(column(DATE))).toEqual({ operators: ['equals', 'range'], input: 'date', days: null })
    expect(filterOffer(column(UUID))).toEqual({ operators: ['equals'], input: 'uuid', days: null })
    expect(filterOffer(column(BOOLEAN, true))).toEqual({ operators: ['equals', 'null', 'not-null'], input: 'boolean', days: null })
  })

  // A timestamp is shown cut to the second, so an equality with what a page
  // shows would miss the row holding a fraction: it offers whole days, and
  // says whose clock they are on, which a page would otherwise guess from
  // the field it draws.
  test('offers a timestamp a range of days on its own clock, and no equality', () => {
    expect(filterOffer(column(INSTANT))).toEqual({ operators: ['range'], input: 'date', days: 'utc' })
    expect(filterOffer(column(WALL_CLOCK, true))).toEqual({ operators: ['range', 'null', 'not-null'], input: 'date', days: 'wall' })
  })

  // A float is not equal to the decimal a person types and a time is read
  // cut to the minute: neither offers a value, and without NULLs, nothing.
  test('offers a float or a time only its NULLs, and nothing when it holds none', () => {
    expect(filterOffer(column(FLOAT, true))).toEqual({ operators: ['null', 'not-null'], input: null, days: null })
    expect(filterOffer(column(TIME))).toBeNull()
    expect(filterOffer(column({ kind: 'binary', maxLength: null, fixedLength: false }))).toBeNull()
  })
})

describe('columnFilter', () => {
  // What a person types is spelled as the column reads it back, so the
  // adapter binds one value both engines convert alike; a number the column
  // cannot hold is refused, never rounded or clamped. Watched failing with
  // the trimming and the padding removed.
  test('spells an equality as its column holds it', () => {
    expect(equals(INT32, ' +007 ')).toMatchObject({ ok: true, filter: { op: 'equals', column: 'c', value: '7' } })
    expect(equals(INT32, '-0')).toMatchObject({ ok: true, filter: { value: '0' } })
    expect(equals(INT32, '-00012')).toMatchObject({ ok: true, filter: { value: '-12' } })
    expect(equals(AMOUNT, '5')).toMatchObject({ ok: true, filter: { value: '5.0000' } })
    expect(equals(AMOUNT, '.5')).toMatchObject({ ok: true, filter: { value: '0.5000' } })
    expect(equals(AMOUNT, '12.500000')).toMatchObject({ ok: true, filter: { value: '12.5000' } })
    expect(equals(AMOUNT, '-0.000')).toMatchObject({ ok: true, filter: { value: '0.0000' } })
    expect(equals(UNSCALED, '012.50')).toMatchObject({ ok: true, filter: { value: '12.50' } })
    expect(equals(UUID, ' 6F9619FF-8B86-D011-B42D-00CF4FC964FF ')).toMatchObject({ ok: true, filter: { value: '6f9619ff-8b86-d011-b42d-00cf4fc964ff' } })
    expect(equals(DATE, ' 2026-02-28 ')).toMatchObject({ ok: true, filter: { value: '2026-02-28' } })
    expect(equals(BOOLEAN, 'false')).toMatchObject({ ok: true, filter: { op: 'equals', type: BOOLEAN, value: 'false' } })
  })

  // Text is compared unit for unit (0028), so it is never trimmed: a
  // trailing space is part of what a varchar holds.
  test('takes text exactly as it is typed', () => {
    expect(equals(text(20), ' Muster ')).toMatchObject({ ok: true, filter: { value: ' Muster ' } })
    expect(equals(text(2, true), 'C ')).toEqual({ ok: false, message: 'A value given for c is not one it can hold.' })
  })

  // Each of these binds as something else on one engine, or fails the
  // whole statement: refused here, naming the column and never the value.
  test('refuses a value its column cannot hold', () => {
    for (const [type, value] of [
      [INT32, '2147483648'],
      [INT32, '1e3'],
      [INT32, '1.0'],
      [AMOUNT, '1.00005'],
      [AMOUNT, '12345678901234567'],
      [AMOUNT, '.'],
      [DATE, '2026-02-29'],
      [DATE, '26-02-01'],
      [UUID, 'not-a-uuid'],
      [BOOLEAN, 'TRUE'],
      [BOOLEAN, '1'],
      [text(3), 'four'],
    ] as const) {
      expect(equals(type, value), `${type.kind} ${value}`).toEqual({ ok: false, message: 'A value given for c is not one it can hold.' })
    }
  })

  // A planner that let an operator through on a kind that does not offer it
  // would hand an adapter a contains on a number, which each spells apart.
  test('refuses an operator the column does not offer', () => {
    expect(planned(INT32, { op: 'contains', text: '7' })).toEqual({ ok: false, message: 'c offers no contains condition.' })
    expect(planned(text(20), { op: 'range', from: 'a', to: 'b' })).toEqual({ ok: false, message: 'c offers no range condition.' })
    expect(planned(INSTANT, { op: 'equals', value: '2026-10-01' })).toEqual({ ok: false, message: 'c offers no equals condition.' })
    expect(planned(INT32, { op: 'null' })).toEqual({ ok: false, message: 'c offers no null condition.' })
    expect(columnFilter(column(INT32, true), { op: 'null' }, 'c')).toEqual({ ok: true, filter: { op: 'null', column: 'c' } })
    expect(planned(text(20), { op: 'contains', text: 'AG' })).toEqual({ ok: true, filter: { op: 'contains', column: 'c', type: text(20), text: 'AG' } })
  })

  // A number's and a date's bounds are values of the column, both ends
  // inclusive; a bound left out is no bound.
  test('plans a range of numbers or dates, inclusive', () => {
    expect(planned(AMOUNT, { op: 'range', from: '10', to: null })).toEqual({ ok: true, filter: { op: 'range', column: 'c', type: AMOUNT, from: '10.0000', to: null, before: null } })
    expect(planned(DATE, { op: 'range', from: '2026-01-01', to: '2026-01-31' })).toMatchObject({ ok: true, filter: { from: '2026-01-01', to: '2026-01-31', before: null } })
    expect(planned(INT32, { op: 'range', from: 'x', to: '7' })).toEqual({ ok: false, message: 'A value given for c is not one it can hold.' })
    expect(planned(INT32, { op: 'range', from: null, to: null })).toEqual({ ok: false, message: 'A range on c has a from, a to or both.' })
  })

  // A timestamp's range is whole days, compared with the stored value: a
  // row at 23:59:59.9 on the last day is inside, which an inclusive upper
  // bound at the last second would miss. An instant's days are UTC's, as a
  // page shows it. Watched failing with `before` set to `to`'s midnight.
  test('plans a range of timestamps as whole days', () => {
    expect(planned(INSTANT, { op: 'range', from: '2026-10-01', to: '2026-10-31' })).toEqual({
      ok: true,
      filter: { op: 'range', column: 'c', type: INSTANT, from: '2026-10-01T00:00:00Z', to: null, before: '2026-11-01T00:00:00Z' },
    })
    expect(planned(WALL_CLOCK, { op: 'range', from: null, to: '2024-02-28' })).toMatchObject({ ok: true, filter: { from: null, to: null, before: '2024-02-29T00:00:00' } })
    expect(planned(WALL_CLOCK, { op: 'range', from: '2026-10-01T12:00:00', to: null })).toEqual({ ok: false, message: 'A value given for c is not one it can hold.' })
  })

  // 9999-12-31 has no next midnight SQL Server stores, so a range to it has
  // no upper end; with no lower end either it holds every value there is.
  test('leaves a range to the last day open above', () => {
    expect(planned(INSTANT, { op: 'range', from: '2026-10-01', to: '9999-12-31' })).toMatchObject({ ok: true, filter: { from: '2026-10-01T00:00:00Z', to: null, before: null } })
    expect(planned(INSTANT, { op: 'range', from: null, to: '9999-12-31' })).toEqual({ ok: true, filter: { op: 'not-null', column: 'c' } })
  })
})

describe('dayAfter', () => {
  // Counted by hand, where a Date would put the year 1 in 1901.
  test('counts months, leap years and the edges of the calendar', () => {
    expect(dayAfter('2026-01-31')).toBe('2026-02-01')
    expect(dayAfter('2024-02-28')).toBe('2024-02-29')
    expect(dayAfter('2023-02-28')).toBe('2023-03-01')
    expect(dayAfter('1900-02-28')).toBe('1900-03-01')
    expect(dayAfter('2000-02-28')).toBe('2000-02-29')
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(dayAfter('0001-01-01')).toBe('0001-01-02')
    expect(dayAfter('9999-12-31')).toBeNull()
  })
})

describe('readFilter', () => {
  // A body names each condition's column once, by the key the caller uses,
  // with exactly its operator's properties; what contains finds is read as
  // a search is, trimmed.
  test('reads a filter by field or by column, and fills nothing in', () => {
    expect(readFilter(undefined, 'field')).toEqual({ ok: true, filter: [] })
    const body = [
      { field: 'name', op: 'contains', text: '  AG ' },
      { field: 'amount', op: 'range', from: '10', to: null },
      { field: 'paid', op: 'equals', value: 'true' },
      { field: 'notes', op: 'not-null' },
    ]
    expect(readFilter(body, 'field')).toEqual({
      ok: true,
      filter: [
        { field: 'name', op: 'contains', text: 'AG' },
        { field: 'amount', op: 'range', from: '10', to: null },
        { field: 'paid', op: 'equals', value: 'true' },
        { field: 'notes', op: 'not-null' },
      ],
    })
    expect(readFilter([{ column: 'notes', op: 'null' }], 'column')).toEqual({ ok: true, filter: [{ column: 'notes', op: 'null' }] })
  })

  // Anything else would be half-read, and a property ignored today is one
  // somebody reads tomorrow; a column twice would read as one condition
  // where the person set two.
  test('refuses a condition that is not exactly its operator’s shape', () => {
    for (const filter of [
      'name',
      { field: 'name', op: 'null' },
      [null],
      [{ op: 'null' }],
      [{ field: '', op: 'null' }],
      [{ column: 'name', op: 'null' }],
      [{ field: 'name', op: 'like', text: 'a' }],
      [{ field: 'name', op: 'null', value: 'x' }],
      [{ field: 'name', op: 'equals' }],
      [{ field: 'name', op: 'equals', value: 7 }],
      [{ field: 'name', op: 'range', from: '1' }],
      [{ field: 'name', op: 'range', from: 1, to: null }],
      [{ field: 'name', op: 'range', from: null, to: null }],
      [{ field: 'name', op: 'contains', text: '   ' }],
      [{ field: 'name', op: 'contains', text: 7 }],
      [{ field: 'name', op: 'sql', where: '1=1' }],
      [{ field: 'name', op: 'null' }, { field: 'name', op: 'not-null' }],
    ]) {
      expect(readFilter(filter, 'field'), JSON.stringify(filter)).toMatchObject({ ok: false, code: 'malformed' })
    }
  })

  // What contains finds is held to a search's limits, and refused as the
  // condition it is: a page that heard a search's code would offer to ask
  // again, or blame a search box the person never typed in.
  test('holds what contains finds to a search’s rules, refused as a condition', () => {
    expect(readFilter([{ field: 'name', op: 'contains', text: 'x'.repeat(201) }], 'field')).toEqual({
      ok: false,
      code: 'not-filterable',
      message: 'What a contains condition on name finds is at most 200 characters, and this has 201.',
    })
    expect(readFilter([{ field: 'name', op: 'contains', text: 'a\u0007b' }], 'field')).toEqual({ ok: false, code: 'not-filterable', message: 'What a contains condition on name finds cannot contain a control character.' })
    expect(readFilter([{ field: 'name', op: 'contains', text: 'a\ud800b' }], 'field')).toEqual({ ok: false, code: 'not-filterable', message: 'What a contains condition on name finds cannot contain an unpaired UTF-16 surrogate.' })
    expect(readFilter([{ field: 'name', op: 'contains', text: 7 }], 'field')).toMatchObject({ ok: false, code: 'malformed' })
  })
})
