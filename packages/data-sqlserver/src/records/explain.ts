import type { ClockColumn, RecordColumn, RecordConcurrency, RecordFailure, RecordRead, RecordTarget, RecordValue } from '@formancy/data-core'
import { decodeRowversion, encodeRowversion } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { prepare, send } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { fromCanonicalText } from '../sql/values.js'
import { failureFor } from './errors.js'
import type { Phase } from './errors.js'
import type { ExpectedVersion } from './statements.js'

/*
 * What a write on SQL Server is checked by before anything is sent, and
 * answered with once it changed nothing, shared by a single write
 * (records.ts) and every step of a save (save.ts, 0155): the key and the
 * columns a write names, the version a token is compared as, the read that
 * tells a stale write from one aimed at nothing, and a row read back. One
 * copy, so a save's step and a write alone cannot answer one outcome two
 * ways.
 */
/** A row as every record statement selects it: `[found]`, `[c0]…` canonical text, and `[version]`. */
export type Row = Record<string, unknown>

export const NOT_FOUND: RecordFailure = { ok: false, code: 'not-found', message: 'No such record is visible to this request.' }
export const STALE: RecordFailure = { ok: false, code: 'stale', message: 'The record has changed since it was read.' }
const VERSION_ENDED: RecordFailure = {
  ok: false,
  code: 'version-ended',
  message: 'The version has ended, at the version sent: only the open version of a chain is changed (0113).',
}
/** The table moved under an update that matched nothing, or that was never sent (0041). */
export const DEFINITION_MOVED: RecordFailure = {
  ok: false,
  code: 'schema-changed',
  message: "The table's definition is not the one this write was decided over; nothing was written.",
}
/** The largest bigint: a version column's token is compared as one. */
const BIGINT_MAX = 9223372036854775807n
const CANONICAL_INTEGER = /^-?(?:0|[1-9][0-9]*)$/

export function names(values: readonly RecordColumn[]): string[] {
  return values.map((value) => value.name)
}

/**
 * The key names exactly the target's identity, each column once. Anything
 * else could match several records — or, with no identity at all, every
 * record — so it is a programming error, refused before anything is sent.
 */
export function checkKey(target: RecordTarget, key: readonly RecordValue[]): void {
  const identity = names(target.identity)
  const given = names(key)
  if (identity.length === 0 || given.length !== identity.length || new Set(given).size !== given.length || !identity.every((name) => given.includes(name))) {
    throw new Error(`A record key names exactly its identity (${identity.join(', ')}), and this one names (${given.join(', ')})`)
  }
}

/** The values a write assigns: each column once, which SQL Server would otherwise refuse with an error that is not a refusal. */
export function checkAssigned(values: readonly RecordValue[], reserved: string | null, clock: readonly ClockColumn[] = []): void {
  // A column stamped with the clock (0153) is a column the write names too.
  const given = [...names(values), ...clock.map((entry) => entry.name)]
  if (new Set(given).size !== given.length) throw new Error('A write names each column once')
  if (reserved !== null && given.includes(reserved)) throw new Error(`${reserved} is the concurrency column; the database or the adapter writes it`)
}

/**
 * The version as it is compared, or `undefined` for a token no record can
 * hold — not 16 lower-case hex digits for a rowversion, not a canonical
 * integer within bigint for a version column. Such a token is never bound; it
 * gets the answer a token that does not match gets.
 */
export function expectedVersion(concurrency: RecordConcurrency, token: string): ExpectedVersion | undefined {
  if (concurrency.kind === 'rowversion') {
    const bytes = decodeRowversion(token)
    return bytes === undefined ? undefined : { kind: 'rowversion', bytes: Buffer.from(bytes) }
  }
  if (typeof token !== 'string' || !CANONICAL_INTEGER.test(token) || token === '-0') return undefined
  const value = BigInt(token)
  return value > BIGINT_MAX || value < -BIGINT_MAX - 1n ? undefined : { kind: 'version-column', value: token }
}

/**
 * Why an update or a change from a date changed nothing, from one more read
 * inside the same filters and throughs (0043): the table moved, a version
 * that had ended at the version sent (0113), the version moved, or no such
 * record for this actor -- in that order. The write changed nothing, so the
 * read's failure is the answer.
 */
export async function whyNothingChanged(pool: ConnectionPool, statement: Statement): Promise<RecordFailure> {
  const found = await attempt(pool, statement, 'read')
  if (!Array.isArray(found)) return found
  if (Number(found[0]?.same ?? 0) !== 1) return DEFINITION_MOVED
  if (Number(found[0]?.ended ?? 0) > 0) return VERSION_ENDED
  return Number(found[0]?.found ?? 0) > 0 ? STALE : NOT_FOUND
}

/** The token for the version a row came back with: `encodeRowversion`'s hex, or a version column's decimal string. */
function versionToken(concurrency: RecordConcurrency | null, row: Row): string | null {
  if (concurrency === null) return null
  const version = row.version
  if (concurrency.kind === 'rowversion') {
    if (!(version instanceof Uint8Array)) throw new Error(`${concurrency.column} did not come back as a rowversion`)
    return encodeRowversion(version)
  }
  if (typeof version !== 'string') throw new Error(`${concurrency.column} did not come back as a version`)
  return version
}

export function recordFrom(row: Row, columns: readonly RecordColumn[], concurrency: RecordConcurrency | null): Omit<RecordRead, 'ok'> {
  return {
    // fromEntries, so a column called __proto__ is a value like any other.
    values: Object.fromEntries(
      columns.map((column, index) => {
        const text = row[`c${String(index)}`]
        return [column.name, fromCanonicalText(column.type, typeof text === 'string' ? text : null)]
      }),
    ),
    version: versionToken(concurrency, row),
  }
}

/** Runs one statement, and turns what the driver rejected it with into a failure. A request it would not even take is thrown. */
export async function attempt(pool: ConnectionPool, statement: Statement, phase: Phase, written: readonly RecordValue[] = []): Promise<Row[] | RecordFailure> {
  const request = prepare(pool, statement)
  try {
    return await send<Row>(request, statement)
  } catch (error) {
    return failureFor(error, phase, written)
  }
}

export function onlyRow(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) throw new Error('The record identity matched more than one row: the bindings do not name a key.')
  return rows[0]
}
