import type { DiscoveryScope, RecordFailureCode } from '@formancy/data-core'

/*
 * What both adapters' parity suites expect of the parity schema (0028),
 * written once so the two engines are held to one answer.
 *
 * fixtures/postgres.parity.sql and fixtures/sqlserver.parity.sql create the
 * schema; each adapter's `parity.integration.test.ts` discovers it as the
 * owner, generates forms over it, builds lookup configs, scopes filters with
 * `scopeRowFilters`, and runs every case below.
 */

/** Where the parity schema lives: outside FIXTURE_SCOPE, so no captured snapshot of `sales` sees it. */
export const PARITY_SCOPE: DiscoveryScope = { schemas: ['parity'] }

/** A filter column of parity.tenant_item: varchar(10) under a case-insensitive collation, and char(3). */
export type ParityFilterColumn = 'tenant_code' | 'fixed_code'

/**
 * One row filter on parity.tenant_item and what it admits: the keys
 * `(tenant_code, item_no)` of the rows it selects, as canonical strings and
 * in item_no order — compare them as a set, because each engine orders text
 * its own way — or the refusal `scopeRowFilters` gives the trusted value.
 */
export type FilterParityCase =
  | { readonly column: ParityFilterColumn; readonly value: string; readonly keys: ReadonlyArray<readonly [string, string]> }
  | { readonly column: ParityFilterColumn; readonly value: string; readonly refused: 'invalid-context' }

/** The four named rows' keys, in item_no order. `ACME`'s fixed_code is `ab`; the others' `AB`. */
const ACME = ['acme', '1'] as const
const ACME_UPPER = ['ACME', '2'] as const
const ACME_TRAILING = ['acme ', '3'] as const
const ACME_ACCENT = ['Acmé', '4'] as const

/**
 * Exact equality of canonical values: case, accents and trailing spaces all
 * count, and the column's collation is not consulted. Before 0028, tenant
 * `acme` also read `ACME`'s row on PostgreSQL (C3c) and `acme `'s on SQL
 * Server (C2-table). A fixed-length column's canonical value has no padding,
 * so `AB` selects every named row that holds it and `AB ` is refused before
 * any SQL is built; `ab` selects only the row holding `ab`, which a char(n)
 * compared under SQL Server's case-insensitive collation alone would not.
 */
export const FILTER_PARITY: readonly FilterParityCase[] = [
  { column: 'tenant_code', value: 'acme', keys: [ACME] },
  { column: 'tenant_code', value: 'acme ', keys: [ACME_TRAILING] },
  { column: 'tenant_code', value: 'ACME', keys: [ACME_UPPER] },
  { column: 'tenant_code', value: 'Acmé', keys: [ACME_ACCENT] },
  { column: 'tenant_code', value: 'Acme', keys: [] },
  { column: 'fixed_code', value: 'AB', keys: [ACME, ACME_TRAILING, ACME_ACCENT] },
  { column: 'fixed_code', value: 'ab', keys: [ACME_UPPER] },
  { column: 'fixed_code', value: 'AB ', refused: 'invalid-context' },
]

/**
 * The label each column of parity.display_kinds' one row shows, by column:
 * `displayText` of the value the adapter's record reader returns, whatever
 * the session's TimeZone, DateStyle, float digits or language. An instant is
 * in UTC to the second; a time to the minute; a double to its 17 digits, which
 * PostgreSQL prints as 0.3 at extra_float_digits 0; a real at its shortest,
 * which it prints as 1.23457e+06 there; a uuid is lower case though SQL
 * Server's row was inserted upper case.
 */
export const DISPLAY_PARITY: Readonly<Record<string, string>> = {
  t: 'Text',
  fixed: 'AB',
  i: '9007199254740993',
  d: '12.50',
  b: 'true',
  f: '0.30000000000000004',
  r: '1234567.9',
  dt: '2026-10-08',
  tm: '10:34',
  ts: '2026-10-08T08:34:56Z',
  tz: '2026-10-08T10:34:56',
  u: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
}

/**
 * What the record reader returns for parity.display_kinds' time and instant
 * (0040): each cut to formancy's shape, a time to the minute and an instant
 * to the second in UTC, though the row holds milliseconds of both and the
 * instant was written at +02:00. Cut, never rounded: `.789` does not carry
 * into the next second or minute. Before 0040 PostgreSQL read both
 * faithfully, `10:34:56.789` and `2026-10-08T08:34:56.789Z`, which no form
 * field accepts, and SQL Server read them as they are here.
 */
export const TEMPORAL_PARITY: Readonly<Record<'tm' | 'ts', string>> = {
  tm: '10:34',
  ts: '2026-10-08T08:34:56Z',
}

/** A write against the parity schema whose refusal both engines must name alike. */
export type RefusalParityCase = 'guardedInsert' | 'guardedUpdate' | 'oddInsert' | 'declinedInsert' | 'generatedInsert' | 'deadlockVictim'

/**
 * The `RecordFailureCode` each refusal is, on both engines.
 *
 * - `guardedInsert`, `guardedUpdate`: parity.guarded with note `'refuse'`,
 *   the engine's ordinary trigger error (PostgreSQL RAISE, P0001; SQL Server
 *   THROW 50001). Not `check-violation`: no constraint the form could have
 *   checked was named.
 * - `oddInsert`: note `'odd'`, an error no adapter recognises (PostgreSQL
 *   38000; SQL Server RAISERROR, 50000).
 * - `declinedInsert`: parity.declined, whose trigger writes nothing and
 *   raises nothing.
 * - `generatedInsert`: parity.generated, naming its identity column `id`.
 * - `deadlockVictim`: an update of parity.contended's row 1, chosen as the
 *   victim of a deadlock with a session holding row 2. The one refusal that
 *   passes, so the one that is `unavailable`.
 *
 * In every case nothing is written.
 */
export const REFUSAL_PARITY: Readonly<Record<RefusalParityCase, RecordFailureCode>> = {
  guardedInsert: 'refused',
  guardedUpdate: 'refused',
  oddInsert: 'refused',
  declinedInsert: 'refused',
  generatedInsert: 'schema-changed',
  deadlockVictim: 'unavailable',
}
