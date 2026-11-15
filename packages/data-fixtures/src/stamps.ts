import type { FormPolicy, StampChoice } from '@formancy/data-core'

/*
 * What the server stamps (0153), written once for both adapters' stamps
 * suites and the server's routes.
 *
 * Each adapter suite discovers the parity schema as the owner, generates a
 * form over parity.audited with AUDITED_STAMPS -- the tenant pinned, its
 * `version` confirmed -- and one over parity.audited_price, a chain of
 * versions with AUDITED_PRICE_STAMPS; plans each write as the server does,
 * as Alice and then Bob; sends it through the adapter; and reads what the
 * table holds as the owner, in the engine's own SQL, beside the engine's
 * own clock read before and after the write.
 *
 * Where the engines differ, the difference is written here per engine and
 * named in each adapter's statement builder, not smoothed over in the core.
 */

/** Who created a row, when and at which site; who changed it last and when; the day of it; and logged_at, of the type the engines spell apart. */
export const AUDITED_STAMPS: readonly StampChoice[] = [
  { column: 'created_by', value: { kind: 'actor' }, on: 'create' },
  { column: 'created_at', value: { kind: 'time' }, on: 'create' },
  { column: 'created_in', value: { kind: 'attribute', attribute: 'site' }, on: 'create' },
  { column: 'changed_by', value: { kind: 'actor' }, on: 'update' },
  { column: 'changed_at', value: { kind: 'time' }, on: 'both' },
  { column: 'changed_on', value: { kind: 'time' }, on: 'update' },
  { column: 'logged_at', value: { kind: 'time' }, on: 'both' },
]

/** A price's creator and when it was created: the next version a change from a date inserts is a create. */
export const AUDITED_PRICE_STAMPS: readonly StampChoice[] = [
  { column: 'created_by', value: { kind: 'actor' }, on: 'create' },
  { column: 'created_at', value: { kind: 'time' }, on: 'create' },
]

const READS = ['clerk']
const READ_ONLY = { read: READS, write: [] }

/** Clerks of tenant 1 write notes and read every stamp; nothing grants a stamp's field to anybody, and no grant could. */
export const AUDITED_POLICY: FormPolicy = {
  version: 1,
  operations: { read: READS, create: READS, update: READS },
  fields: {
    id: READ_ONLY,
    tenant_id: READ_ONLY,
    note: { read: READS, write: READS },
    created_by: READ_ONLY,
    created_at: READ_ONLY,
    created_in: READ_ONLY,
    changed_by: READ_ONLY,
    changed_at: READ_ONLY,
    changed_on: READ_ONLY,
    logged_at: READ_ONLY,
    noted_at: READ_ONLY,
  },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
}

/** Clerks of tenant 1 change prices from a date; the stamps are read-only. */
export const AUDITED_PRICE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: READS, create: READS, update: READS },
  fields: {
    tenant_id: READ_ONLY,
    product_no: { read: READS, write: READS },
    valid_from: { read: READS, write: READS },
    valid_to: READ_ONLY,
    amount: { read: READS, write: READS },
    created_by: READ_ONLY,
    created_at: READ_ONLY,
  },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
}

/** Alice creates, at her site; Bob, of the same tenant and another site, changes what she created. */
export const ALICE = { actor: { id: 'alice', roles: ['clerk'] }, attributes: { tenant: '1', site: 'Bern' } }
export const BOB = { actor: { id: 'bob', roles: ['clerk'] }, attributes: { tenant: '1', site: 'Basel' } }

/**
 * What a row of parity.audited holds after a write, as each suite reads it as
 * the owner: the stamps of who as stored; the day stamped, `YYYY-MM-DD`;
 * and, about the instant the write stamped -- created_at on a create, as
 * the update compares its own -- whether it lies within the engine's own
 * clock read just before and just after the write (`within`); how it
 * stands to noted_at, which the engine's default filled in the same insert
 * (`toDefault`); the offset it is stored at, in minutes, or `null` where
 * the type stores none; whether the wall clock stamped is that instant in
 * UTC at its column's precision (`wallInUtc`) and the day its UTC day
 * (`dayInUtc`); and how far logged_at is from it, in microseconds.
 */
export interface StampedRow {
  created_by: string | null
  created_in: string | null
  changed_by: string | null
  changed_on: string | null
  within: boolean
  toDefault: 'equal' | 'earlier' | 'later'
  offsetMinutes: number | null
  wallInUtc: boolean
  dayInUtc: boolean | null
  loggedOffMicroseconds: number
}

/**
 * The shared expectations, by case. `stampCase(name)` is each one's id.
 *
 * - `created`: Alice's create stores her id and her site, the time stamps
 *   on create the engine's clock, and nothing of the update's.
 * - `updated`: Bob's update of it stores his id where the last change is,
 *   and leaves who created it, where and when as they were.
 * - `clock`: the instant a create stamps, against a default of the engine's
 *   clock in the same insert. PostgreSQL's `current_timestamp` is the
 *   transaction's start, which its `now()` default takes too: equal. SQL
 *   Server's batch reads the clock once, before the insert, and a
 *   `sysdatetimeoffset()` default reads its own as the insert runs: not
 *   later than it, and equal where the clock has not moved on.
 * - `utc`: the instant is stored at no offset on PostgreSQL, whose
 *   timestamptz keeps none, and at +00:00 on SQL Server, whatever the
 *   server's own zone; the wall clock is that instant in UTC at its
 *   column's precision, and the day its UTC day, on both.
 * - `rounded`: logged_at is the instant at its column's precision: within
 *   half a millisecond in PostgreSQL's timestamp(3), and within half of
 *   1/300 s, 1667 microseconds, in SQL Server's datetime.
 * - `superseded`: the next version a change from a date inserts is stamped
 *   as a create, Bob's; the version ended keeps Alice's, and when.
 */
export const STAMP_PARITY = {
  created: { created_by: 'alice', created_in: 'Bern', changed_by: null, changed_on: null, within: true },
  updated: { created_by: 'alice', created_in: 'Bern', changed_by: 'bob', within: true, createdKept: true },
  clock: { postgres: ['equal'], sqlserver: ['equal', 'earlier'] },
  utc: { offsetMinutes: { postgres: null, sqlserver: 0 }, wallInUtc: true, dayInUtc: true },
  rounded: { postgres: 500, sqlserver: 1667 },
  superseded: { next: 'bob', ended: 'alice', endedAt: '2026-01-01T00:00:00Z' },
} as const

export type StampCase = keyof typeof STAMP_PARITY
