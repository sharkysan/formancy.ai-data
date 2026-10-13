import type { DatabaseKind } from '@formancy/data-core'
import { EDGE_VALUES } from './values.js'

/*
 * A uuid key, end to end on both engines (0056), written once for both
 * adapters' `uuid.integration.test.ts`.
 *
 * `sales.delivery` is keyed by a uuid the database fills by its default --
 * gen_random_uuid() on PostgreSQL, newsequentialid() on SQL Server -- and is
 * a child of an order with a tenant of its own; `sales.parcel` refers to it,
 * so a lookup's key is a uuid, and a parcel, which has no tenant, is reached
 * through its delivery (0043). Each suite starts its own fixture, inserts
 * UUID_ROWS as the owner, and then discovers, generates, plans and runs every
 * request as the order form's own account (WRITER), as tenant 1's clerk and
 * tenant 2's, expecting what is below. Tenant 1's three deliveries are only
 * ever read; what a case writes is tenant 2's, or a parcel, so no case
 * depends on another having run.
 *
 * One thing is not one answer on both engines, and is written per engine
 * here rather than smoothed over: the order of uuid values. PostgreSQL
 * compares a uuid's sixteen bytes in turn, which is the order of its text;
 * SQL Server compares a uniqueidentifier's last six bytes first, then the
 * two before them, then the first eight from the right. Measured on
 * postgres:17-alpine (17.11) and SQL Server 2022 (16.0.4295) on 2026-10-11,
 * with sixteen keys that each set one byte, and with 1000 random keys that
 * `uuidOrder` sorted as each server did. A list ordered by a uuid key is
 * total and stable on each engine, and in that engine's order.
 */

/** The fixture's deliveries of its order 2^53 + 1, tenant 1's, by carrier, as every read spells them: lower case. */
export const DELIVERIES = {
  express: '1d3e5a70-9c2b-4f61-8e44-3c0a7d9b2e51',
  freight: '6a9f0c12-4b8e-4d27-b3c5-0e7f1a2d4c90',
  post: 'c4b81e2f-7a3d-4e95-a06b-91d2f5e8a7c3',
} as const

/** The fixture's order, tenant 1's, which its deliveries belong to. */
const OURS = EDGE_VALUES.beyondSafeInteger
/** 2^53 + 2 and 2^53 + 3, orders of tenant 2's the suites insert: one with a delivery, which tenant 2 also creates under, and one to page. */
const THEIRS = '9007199254740994'
const PAGED = '9007199254740995'
/** The carrier of every paged delivery: a label sixteen options share, so the key alone orders them. */
const TIED = 'Paged'

/** Sixteen keys, the n-th with byte n set and every other byte zero: listed, they are an engine's order of the bytes. */
const ONE_BYTE: readonly string[] = Array.from({ length: 16 }, (_, at) => {
  const hex = Array.from({ length: 16 }, (__, byte) => (byte === at ? '01' : '00')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
})

/** The delivery of tenant 2's order: a row that exists, which no request of tenant 1's may find, and tenant 2 updates. */
const THEIRS_DELIVERY = 'f00dfeed-0000-4000-8000-000000000002'

/** The rows each uuid suite inserts as the fixture's owner, before it asks anything. */
export const UUID_ROWS = {
  /** `id`, `tenant_id`; customer 1001 of that tenant. */
  orders: [
    [THEIRS, '2'],
    [PAGED, '2'],
  ],
  /** `id`, `tenant_id`, `order_id`, `carrier`. The sixteen paged deliveries share one carrier, so a lookup's options tie on it. */
  deliveries: [[THEIRS_DELIVERY, '2', THEIRS, 'Theirs'], ...ONE_BYTE.map((key) => [key, '2', PAGED, TIED])],
} as const

/**
 * The 16 bytes of a uuid in the order SQL Server compares them, by their
 * position in its text: bytes 10 to 15, then 8 and 9, then 7 down to 0. SQL
 * Server stores the first three groups little-endian and compares its stored
 * bytes 10-15, 8-9, 6-7, 4-5, 0-3; spelled through the text, the first eight
 * bytes come from the right.
 */
const SQLSERVER_BYTES = [10, 11, 12, 13, 14, 15, 8, 9, 7, 6, 5, 4, 3, 2, 1, 0]

function bytesOf(key: string): string[] {
  const hex = key.replaceAll('-', '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`${key} is not a uuid`)
  return Array.from({ length: 16 }, (_, at) => hex.slice(at * 2, at * 2 + 2))
}

/** What `kind` orders a uuid by, as text that sorts in that order. */
function sortKey(kind: DatabaseKind, key: string): string {
  const bytes = bytesOf(key)
  return kind === 'postgres' ? bytes.join('') : SQLSERVER_BYTES.map((at) => bytes[at]).join('')
}

/** `keys` ascending as `kind` orders a uuid column: PostgreSQL by its bytes in turn, SQL Server by its byte groups. */
export function uuidOrder(kind: DatabaseKind, keys: readonly string[]): string[] {
  return keys
    .map((key) => ({ key, by: sortKey(kind, key) }))
    .sort((left, right) => (left.by < right.by ? -1 : left.by > right.by ? 1 : 0))
    .map((entry) => entry.key)
}

const token = (key: string): string => `k1:${key}`

/** The schema of the uuid suites' own whose tables differ in their key's default (0057). */
const MINTED = 'minted'
/** The constant one of them fills its key with, and the lookalike function returns. */
const FIXED = '2b7e1516-28ae-4d2a-a6f7-15880945cf4f'

/**
 * The shared expectations, by case. `uuidCase(name)` is each one's id.
 *
 * - `discovered`: the delivery's key is its uuid `id`, filled by a default
 *   the snapshot spells as the engine does; the model's comparator holds the
 *   rest (`MODEL_CASES.owner`).
 * - `generated`: the generator shows the key in the Record section, never
 *   writes or requires it, and offers create, update and delete on both
 *   engines: on SQL Server by the delivery's rowversion, which proves a
 *   record whatever its key, and on PostgreSQL by its version column over a
 *   key of one column that gen_random_uuid() fills, which never hands out
 *   one value twice, so a record deleted is never created again under its
 *   key (0057).
 * - `token`: a delivery's record token spells its key in lower case on both
 *   engines, though SQL Server prints a uniqueidentifier in upper case
 *   (0017); a read by it finds the row, and the same key in upper case is
 *   no token -- refused before anything is asked.
 * - `create`: tenant 2's create that leaves the key out, under its own
 *   order, is answered with the key the database chose, in lower case, and a
 *   read by its token finds the row; an answer for the key is over-posting,
 *   because the form never writes it.
 * - `update`: tenant 2's update of its delivery with the version read is
 *   written and moves the version; the version read before it is stale.
 * - `tenant`: tenant 2's clerk finds none of tenant 1's deliveries, by token
 *   or by update with its version, and tenant 1's clerk not tenant 2's,
 *   which exists.
 * - `parent`: deliveries listed under the fixture's order are its three, in
 *   the engine's order of their keys; listed under tenant 2's order by
 *   tenant 1's clerk, none, though one is there.
 * - `order`: sixteen deliveries keyed one byte each, listed `size` to a
 *   page under their order by tenant 2's clerk, come in each engine's order
 *   -- the same rows, each once, paged without a gap or a repeat -- and the
 *   two orders differ.
 * - `lookup`: a parcel's delivery lookup offers tenant 1's clerk tenant 1's
 *   deliveries by carrier, each by its uuid token; finds one by a part of
 *   its carrier; resolves a token to its carrier; rejects another tenant's
 *   delivery, a key nobody has and a key in upper case; offers tenant 2's
 *   clerk the sixteen paged deliveries, tied on their carrier, in each
 *   engine's order of their keys, which ends a lookup's order; and a parcel
 *   created with a delivery chosen holds its key and is read through it.
 * - `delete`: what a policy that lets tenant 1's clerk delete is told, by
 *   the publish check's two halves -- the policy's fit and what a delete
 *   also does. Granted on the delivery form, which offers delete on both
 *   engines, both say only that the delete would reach the delivery's
 *   parcels through their cascading key, which 0050 does not let a delete
 *   do; granted on the order form, both say it would reach the order's
 *   deliveries and its lines, each through its cascading key, so no order
 *   is deleted yet. A parcel has no version column, so its form offers
 *   neither update nor delete.
 * - `defaults`: which default makes a uuid key one a version column proves
 *   a record over (0057). In a schema of the suites' own, tables keyed by a
 *   uuid, each guarded by a version column, differ in the default that
 *   fills the key: the engine's own that never repeats; a constant; another
 *   function that makes uuids, uuid_generate_v4() and newid(), which this
 *   release has not named; a function of the schema's own named like the
 *   engine's. Two differ in one more thing and fill their key with the
 *   engine's own: one has a tenant beside it in its key, pinned; one's key
 *   refers to the first's, a foreign key any form may look up through and
 *   so write. And the engine's own written three other ways in the DDL --
 *   in upper case, in mixed case, in parentheses -- is spelled as the first.
 *   Discovered as the order form's account, each default is spelled as
 *   `spelled` says, and a form offers delete as `offered` says. A row of the
 *   first, inserted by the owner, is read by its token at version 1, the
 *   version column's default, deleted at that version, answered with its
 *   key in lower case and gone; the same delete again is not found.
 */
export const UUID_PARITY = {
  discovered: {
    table: { schema: 'sales', name: 'delivery' },
    key: ['id'],
    default: { postgres: 'gen_random_uuid()', sqlserver: '(newsequentialid())' },
  },
  generated: {
    field: 'id',
    writes: { create: false, update: false },
    sections: ['Delivery', 'Record'],
    operations: { create: true, update: true, delete: true },
  },
  token: {
    record: token(DELIVERIES.express),
    carrier: 'Express',
    upper: token(DELIVERIES.express.toUpperCase()),
    refused: 'invalid-record-token',
  },
  create: {
    order: token(THEIRS),
    carrier: 'Courier',
    /** What a create that sends the key is told: by the form, which never writes it, not only by a policy that withholds it. */
    given: { code: 'over-posting', message: 'id is never written by this form on create' },
  },
  update: {
    record: token(THEIRS_DELIVERY),
    carrier: 'Theirs, insured',
    stale: 'stale',
  },
  tenant: {
    ours: token(DELIVERIES.post),
    theirs: token(THEIRS_DELIVERY),
    refused: 'not-found',
  },
  parent: {
    ours: { order: token(OURS), keys: Object.values(DELIVERIES) },
    theirs: { order: token(THEIRS), keys: [] },
  },
  order: {
    parent: token(PAGED),
    size: 5,
    keys: ONE_BYTE,
  },
  lookup: {
    field: 'delivery',
    offered: [
      { token: token(DELIVERIES.express), label: 'Express' },
      { token: token(DELIVERIES.freight), label: 'Freight' },
      { token: token(DELIVERIES.post), label: 'Post' },
    ],
    search: { text: 'reig', tokens: [token(DELIVERIES.freight)] },
    resolved: { token: token(DELIVERIES.post), label: 'Post' },
    rejected: [token(THEIRS_DELIVERY), token('00000000-0000-4000-8000-000000000000'), token(DELIVERIES.express.toUpperCase())],
    tied: { search: TIED, label: TIED, keys: ONE_BYTE },
    parcel: { label: 'Box 3', delivery: token(DELIVERIES.freight) },
  },
  delete: {
    delivery: [
      'operations.delete grants roles, and deleting a record of sales.delivery also deletes rows of sales.parcel (fk_parcel_delivery, ON DELETE CASCADE), which this release does not offer',
    ],
    parcel: { update: false, delete: false },
    order: [
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.delivery (fk_delivery_order, ON DELETE CASCADE), which this release does not offer',
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.order_line (fk_order_line_order, ON DELETE CASCADE), which this release does not offer',
    ],
  },
  defaults: {
    schema: MINTED,
    /** The uuid the `fixed` table's default and the lookalike function hand out, every time. */
    constant: FIXED,
    /** Each table's key default as discovery spells it, by engine: the suites create each table with the default its name says. */
    spelled: {
      postgres: {
        never_repeating: 'gen_random_uuid()',
        fixed: `'${FIXED}'::uuid`,
        other_function: 'uuid_generate_v4()',
        lookalike: `${MINTED}.gen_random_uuid()`,
        two_columns: 'gen_random_uuid()',
        foreign_key: 'gen_random_uuid()',
        upper_case: 'gen_random_uuid()',
        mixed_case: 'gen_random_uuid()',
        parenthesised: 'gen_random_uuid()',
      },
      sqlserver: {
        never_repeating: '(newsequentialid())',
        fixed: `('${FIXED}')`,
        other_function: '(newid())',
        lookalike: `([${MINTED}].[newsequentialid]())`,
        two_columns: '(newsequentialid())',
        foreign_key: '(newsequentialid())',
        upper_case: '(newsequentialid())',
        mixed_case: '(newsequentialid())',
        parenthesised: '(newsequentialid())',
      },
    },
    /** Whether a form over each, its version column confirmed, offers delete. */
    offered: {
      never_repeating: true,
      fixed: false,
      other_function: false,
      lookalike: false,
      two_columns: false,
      foreign_key: false,
      upper_case: true,
      mixed_case: true,
      parenthesised: true,
    },
    /** A row of `never_repeating` read at `version`, the version column's default, and deleted at it; then the same delete sent again. */
    deleted: { version: '1', again: 'not-found' },
  },
} as const

export type UuidCase = keyof typeof UUID_PARITY
