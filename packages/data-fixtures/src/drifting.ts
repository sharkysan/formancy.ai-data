import type { DatabaseKind } from '@formancy/data-core'
import { DATABASE_KINDS } from '@formancy/data-core'

/*
 * Changes to a form's own table after the form was published, written once
 * for both adapters and the server (0041): what drift review says each one
 * stops, what the runtime refuses, and whether the table's definition -- the
 * digest each adapter writes under -- moves.
 *
 * Each case is a table of its own in schema `drifting`, made by `setUp` with
 * one row, id 1, and changed by `alter` as its owner. Every table has `memo`,
 * a nullable text no ALTER touches, so a write of it shows what the guard
 * does when nothing the write names changed; `note` is the field the
 * reproduction of 2026-10-10 wrote while drift said update was stopped. A
 * PostgreSQL table is versioned by `row_version`, a SQL Server one by its
 * rowversion `rv`.
 *
 * `verdict` is drift review's, by operation, as `diffSnapshots` gives it for
 * the form proposed over the table before the ALTER; `runtime` is what the
 * runtime refuses where that differs, which is only for a change outside the
 * form's own table. A case with a null verdict is the adapters' alone: it
 * holds the definition to what it must ignore.
 */

/** What may still be done with the published form: read it, create, update. */
export interface DriftVerdict {
  readonly read: boolean
  readonly create: boolean
  readonly update: boolean
}

/**
 * One answer an update sends: a field, by key, which for a column is its
 * name. Canonical, as a codec returns it, so an adapter suite can bind it as
 * it is: an integer or a decimal as a string, a float as a number.
 */
export interface DriftSend {
  readonly field: string
  readonly value: string | number | null
}

export interface DriftingCase {
  readonly name: string
  /** In schema `drifting`. */
  readonly table: string
  /** The engines it runs on: the keys of `setUp`. */
  readonly setUp: Partial<Record<DatabaseKind, readonly string[]>>
  readonly alter: Partial<Record<DatabaseKind, readonly string[]>>
  /** The lookups the form is proposed with. */
  readonly lookups?: ReadonlyArray<{ readonly foreignKey: string; readonly display: readonly string[] }>
  /** Whether the table's definition, as each adapter digests it, must change. */
  readonly moves: boolean
  readonly verdict: DriftVerdict | null
  /** What the runtime allows, when it is not `verdict`. */
  readonly runtime?: DriftVerdict
  /** Each update sends one answer, in this order. */
  readonly updates: readonly DriftSend[]
  /** A create's answers: every column a create must give, by field key, valid before and after the ALTER. */
  readonly insert: Readonly<Record<string, string | number | null>>
}

const NOTHING_STOPS: DriftVerdict = { read: true, create: true, update: true }
const WRITES_STOP: DriftVerdict = { read: true, create: false, update: false }
const EVERYTHING_STOPS: DriftVerdict = { read: false, create: false, update: false }

const UNTOUCHED: DriftSend = { field: 'note', value: 'an untouched field' }

/** The columns every case table ends with. */
const PG_TAIL = 'memo varchar(40), note varchar(40), row_version bigint not null default 1'
const MS_TAIL = 'memo nvarchar(40) null, note nvarchar(40) null, rv rowversion'

/** A table keyed by an identity, with `columns` between the key and the tail. */
const pgTable = (table: string, columns: string): string =>
  `create table drifting.${table} (id bigint generated always as identity constraint pk_${table} primary key, ${columns}${columns === '' ? '' : ', '}${PG_TAIL})`
const msTable = (table: string, columns: string): string =>
  `create table drifting.${table} (id bigint identity(1,1) constraint pk_${table} primary key, ${columns}${columns === '' ? '' : ', '}${MS_TAIL})`

/** A lookup's target, keyed by `id`, with one row: 1, 'one'. */
const pgTarget = (table: string): string[] => [
  `create table drifting.${table}_target (id integer constraint pk_${table}_target primary key, label varchar(40) not null)`,
  `insert into drifting.${table}_target values (1, 'one')`,
]
const msTarget = (table: string): string[] => [
  `create table drifting.${table}_target (id int constraint pk_${table}_target primary key, label nvarchar(40) not null)`,
  `insert into drifting.${table}_target values (1, N'one')`,
]
const targetColumn = (table: string): string => `target_id integer null constraint fk_${table}_target references drifting.${table}_target (id)`
const lookupOf = (table: string) => [{ foreignKey: `fk_${table}_target`, display: ['label'] }]

export const DRIFTING: readonly DriftingCase[] = [
  // The four cases of the reproduction, with its DDL and its sends.
  {
    name: 'tightened-text',
    table: 'tightened_text',
    setUp: {
      postgres: [pgTable('tightened_text', 'code varchar(20) not null'), "insert into drifting.tightened_text (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('tightened_text', 'code nvarchar(20) not null'), "insert into drifting.tightened_text (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['alter table drifting.tightened_text alter column code type varchar(8)'], sqlserver: ['alter table drifting.tightened_text alter column code nvarchar(8) not null'] },
    moves: true,
    verdict: WRITES_STOP,
    updates: [{ field: 'code', value: 'ABCDEFG' }, { field: 'code', value: 'ABCDEFGHIJ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    name: 'narrowed-decimal',
    table: 'narrowed_decimal',
    setUp: {
      postgres: [pgTable('narrowed_decimal', 'amount numeric(12, 4) not null'), "insert into drifting.narrowed_decimal (amount, note) values (10.0000, 'seed')"],
      sqlserver: [msTable('narrowed_decimal', 'amount decimal(12, 4) not null'), "insert into drifting.narrowed_decimal (amount, note) values (10.0000, N'seed')"],
    },
    alter: { postgres: ['alter table drifting.narrowed_decimal alter column amount type numeric(8, 2)'], sqlserver: ['alter table drifting.narrowed_decimal alter column amount decimal(8, 2) not null'] },
    moves: true,
    verdict: WRITES_STOP,
    updates: [{ field: 'amount', value: '1234.5678' }, { field: 'amount', value: '12345678.1234' }, UNTOUCHED],
    insert: { amount: '1.5000' },
  },
  {
    name: 'retyped-integer',
    table: 'retyped_integer',
    setUp: {
      postgres: [pgTable('retyped_integer', 'quantity varchar(10) not null'), "insert into drifting.retyped_integer (quantity, note) values ('42', 'seed')"],
      sqlserver: [msTable('retyped_integer', 'quantity nvarchar(10) not null'), "insert into drifting.retyped_integer (quantity, note) values (N'42', N'seed')"],
    },
    alter: {
      postgres: ['alter table drifting.retyped_integer alter column quantity type integer using quantity::integer'],
      sqlserver: ['alter table drifting.retyped_integer alter column quantity int not null'],
    },
    moves: true,
    verdict: EVERYTHING_STOPS,
    updates: [{ field: 'quantity', value: '43' }, { field: 'quantity', value: 'many' }, UNTOUCHED],
    insert: { quantity: '7' },
  },
  {
    name: 'retyped-real',
    table: 'retyped_real',
    setUp: {
      postgres: [pgTable('retyped_real', 'amount numeric(12, 4) not null'), "insert into drifting.retyped_real (amount, note) values (10.0000, 'seed')"],
      sqlserver: [msTable('retyped_real', 'amount decimal(12, 4) not null'), "insert into drifting.retyped_real (amount, note) values (10.0000, N'seed')"],
    },
    alter: { postgres: ['alter table drifting.retyped_real alter column amount type real'], sqlserver: ['alter table drifting.retyped_real alter column amount real not null'] },
    moves: true,
    verdict: EVERYTHING_STOPS,
    updates: [{ field: 'amount', value: '1234.5678' }, { field: 'amount', value: '12345678.1234' }, UNTOUCHED],
    insert: { amount: '2.2500' },
  },

  // More that stop, each silent or refused by the database alone before 0041.
  {
    name: 'narrowed-float',
    table: 'narrowed_float',
    setUp: {
      postgres: [pgTable('narrowed_float', 'amount double precision not null'), "insert into drifting.narrowed_float (amount, note) values (1.5, 'seed')"],
      sqlserver: [msTable('narrowed_float', 'amount float not null'), "insert into drifting.narrowed_float (amount, note) values (1.5, N'seed')"],
    },
    alter: { postgres: ['alter table drifting.narrowed_float alter column amount type real'], sqlserver: ['alter table drifting.narrowed_float alter column amount real not null'] },
    moves: true,
    verdict: WRITES_STOP,
    // Seventeen significant digits a double holds and a real does not.
    updates: [{ field: 'amount', value: 1234.5678901234567 }, UNTOUCHED],
    insert: { amount: 2.5 },
  },
  {
    name: 'instant-to-wall-clock',
    table: 'instant_to_wall_clock',
    setUp: {
      postgres: [
        pgTable('instant_to_wall_clock', 'happened_at timestamp with time zone not null'),
        "insert into drifting.instant_to_wall_clock (happened_at, note) values ('2026-10-10T10:00:00Z', 'seed')",
      ],
      sqlserver: [
        msTable('instant_to_wall_clock', 'happened_at datetimeoffset(7) not null'),
        "insert into drifting.instant_to_wall_clock (happened_at, note) values ('2026-10-10T10:00:00Z', N'seed')",
      ],
    },
    alter: {
      postgres: ['alter table drifting.instant_to_wall_clock alter column happened_at type timestamp without time zone'],
      sqlserver: ['alter table drifting.instant_to_wall_clock alter column happened_at datetime2(7) not null'],
    },
    moves: true,
    verdict: EVERYTHING_STOPS,
    updates: [{ field: 'happened_at', value: '2026-10-10T12:34:56Z' }, UNTOUCHED],
    insert: { happened_at: '2026-10-11T08:00:00Z' },
  },
  {
    // Drift's verdict stands, and since 0040 it is no silent loss: the field's
    // instant has whole seconds, so the narrowed column holds every value it sends.
    name: 'narrowed-instant',
    table: 'narrowed_instant',
    setUp: {
      postgres: [pgTable('narrowed_instant', 'happened_at timestamp(6) with time zone not null'), "insert into drifting.narrowed_instant (happened_at, note) values ('2026-10-10T10:00:00Z', 'seed')"],
      sqlserver: [msTable('narrowed_instant', 'happened_at datetimeoffset(7) not null'), "insert into drifting.narrowed_instant (happened_at, note) values ('2026-10-10T10:00:00Z', N'seed')"],
    },
    alter: {
      postgres: ['alter table drifting.narrowed_instant alter column happened_at type timestamp(0) with time zone'],
      sqlserver: ['alter table drifting.narrowed_instant alter column happened_at datetimeoffset(0) not null'],
    },
    moves: true,
    verdict: WRITES_STOP,
    updates: [{ field: 'happened_at', value: '2026-10-10T12:34:56Z' }, UNTOUCHED],
    insert: { happened_at: '2026-10-11T08:00:00Z' },
  },
  {
    // Refused by the database before 0041 (42703, 207), after the update was sent.
    name: 'dropped-bound',
    table: 'dropped_bound',
    setUp: {
      postgres: [pgTable('dropped_bound', 'code varchar(20) not null'), "insert into drifting.dropped_bound (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('dropped_bound', 'code nvarchar(20) not null'), "insert into drifting.dropped_bound (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['alter table drifting.dropped_bound drop column note'], sqlserver: ['alter table drifting.dropped_bound drop column note'] },
    moves: true,
    verdict: EVERYTHING_STOPS,
    updates: [{ field: 'code', value: 'XYZ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    // A generation change of a written column. On SQL Server as the owner: an
    // account without VIEW DEFINITION reads the default as hidden, and review
    // and the runtime alike call it loosened (0026's limitation).
    name: 'sequence-default',
    table: 'sequence_default',
    setUp: {
      postgres: [pgTable('sequence_default', 'quantity integer not null'), "insert into drifting.sequence_default (quantity, note) values (5, 'seed')"],
      sqlserver: [msTable('sequence_default', 'quantity int not null'), "insert into drifting.sequence_default (quantity, note) values (5, N'seed')"],
    },
    alter: {
      postgres: ['create sequence drifting.sequence_default_seq start with 100', "alter table drifting.sequence_default alter column quantity set default nextval('drifting.sequence_default_seq')"],
      sqlserver: [
        'create sequence drifting.sequence_default_seq as int start with 100',
        'alter table drifting.sequence_default add constraint df_sequence_default_quantity default (next value for drifting.sequence_default_seq) for quantity',
      ],
    },
    moves: true,
    verdict: WRITES_STOP,
    updates: [{ field: 'quantity', value: '6' }, UNTOUCHED],
    insert: { quantity: '9' },
  },
  {
    name: 'set-not-null',
    table: 'set_not_null',
    setUp: {
      postgres: [pgTable('set_not_null', 'code varchar(20) not null'), "insert into drifting.set_not_null (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('set_not_null', 'code nvarchar(20) not null'), "insert into drifting.set_not_null (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['alter table drifting.set_not_null alter column note set not null'], sqlserver: ['alter table drifting.set_not_null alter column note nvarchar(40) not null'] },
    moves: true,
    verdict: WRITES_STOP,
    updates: [{ field: 'code', value: 'XYZ' }, UNTOUCHED],
    insert: { code: 'NEW', note: 'created' },
  },
  {
    // The identity's only key gone: one update could change two rows.
    name: 'dropped-identity-key',
    table: 'dropped_identity_key',
    setUp: {
      postgres: [pgTable('dropped_identity_key', 'code varchar(20) not null'), "insert into drifting.dropped_identity_key (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('dropped_identity_key', 'code nvarchar(20) not null'), "insert into drifting.dropped_identity_key (code, note) values (N'ABC', N'seed')"],
    },
    alter: {
      postgres: ['alter table drifting.dropped_identity_key drop constraint pk_dropped_identity_key'],
      sqlserver: ['alter table drifting.dropped_identity_key drop constraint pk_dropped_identity_key'],
    },
    moves: true,
    verdict: { read: true, create: true, update: false },
    updates: [UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    // The foreign key behind the form's lookup gone.
    name: 'dropped-lookup-fk',
    table: 'dropped_lookup_fk',
    setUp: {
      postgres: [...pgTarget('dropped_lookup_fk'), pgTable('dropped_lookup_fk', targetColumn('dropped_lookup_fk')), "insert into drifting.dropped_lookup_fk (target_id, note) values (1, 'seed')"],
      sqlserver: [...msTarget('dropped_lookup_fk'), msTable('dropped_lookup_fk', targetColumn('dropped_lookup_fk')), "insert into drifting.dropped_lookup_fk (target_id, note) values (1, N'seed')"],
    },
    alter: {
      postgres: ['alter table drifting.dropped_lookup_fk drop constraint fk_dropped_lookup_fk_target'],
      sqlserver: ['alter table drifting.dropped_lookup_fk drop constraint fk_dropped_lookup_fk_target'],
    },
    lookups: lookupOf('dropped_lookup_fk'),
    moves: true,
    verdict: EVERYTHING_STOPS,
    updates: [UNTOUCHED],
    insert: { note: 'created' },
  },
  {
    // The foreign key behind the lookup no longer enforced: PostgreSQL 17 by
    // its triggers, as a bulk load disables them; SQL Server by NOCHECK.
    name: 'disabled-lookup-fk',
    table: 'disabled_lookup_fk',
    setUp: {
      postgres: [...pgTarget('disabled_lookup_fk'), pgTable('disabled_lookup_fk', targetColumn('disabled_lookup_fk')), "insert into drifting.disabled_lookup_fk (target_id, note) values (1, 'seed')"],
      sqlserver: [...msTarget('disabled_lookup_fk'), msTable('disabled_lookup_fk', targetColumn('disabled_lookup_fk')), "insert into drifting.disabled_lookup_fk (target_id, note) values (1, N'seed')"],
    },
    alter: {
      postgres: ['alter table drifting.disabled_lookup_fk disable trigger all'],
      sqlserver: ['alter table drifting.disabled_lookup_fk nocheck constraint fk_disabled_lookup_fk_target'],
    },
    lookups: lookupOf('disabled_lookup_fk'),
    moves: true,
    verdict: EVERYTHING_STOPS,
    updates: [UNTOUCHED],
    insert: { note: 'created' },
  },

  // Allowed: what 0010 calls information or review, which keeps the form saving.
  {
    name: 'widened-text',
    table: 'widened_text',
    setUp: {
      postgres: [pgTable('widened_text', 'code varchar(20) not null'), "insert into drifting.widened_text (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('widened_text', 'code nvarchar(20) not null'), "insert into drifting.widened_text (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['alter table drifting.widened_text alter column code type varchar(40)'], sqlserver: ['alter table drifting.widened_text alter column code nvarchar(40) not null'] },
    moves: true,
    verdict: NOTHING_STOPS,
    updates: [{ field: 'code', value: 'ABCDEFGHIJ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    name: 'added-nullable',
    table: 'added_nullable',
    setUp: {
      postgres: [pgTable('added_nullable', 'code varchar(20) not null'), "insert into drifting.added_nullable (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('added_nullable', 'code nvarchar(20) not null'), "insert into drifting.added_nullable (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['alter table drifting.added_nullable add column extra integer'], sqlserver: ['alter table drifting.added_nullable add extra int null'] },
    moves: true,
    verdict: NOTHING_STOPS,
    updates: [{ field: 'code', value: 'XYZ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    name: 'default-added',
    table: 'default_added',
    setUp: {
      postgres: [pgTable('default_added', 'code varchar(20) not null'), "insert into drifting.default_added (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('default_added', 'code nvarchar(20) not null'), "insert into drifting.default_added (code, note) values (N'ABC', N'seed')"],
    },
    alter: {
      postgres: ["alter table drifting.default_added alter column note set default 'by default'"],
      sqlserver: ["alter table drifting.default_added add constraint df_default_added_note default (N'by default') for note"],
    },
    moves: true,
    verdict: NOTHING_STOPS,
    updates: [{ field: 'code', value: 'XYZ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    // A key the identity does not rest on: noted, and the database refuses a duplicate itself.
    // SQL Server's keys are its constraints (a unique index may be filtered), so there it is one.
    name: 'unique-key-added',
    table: 'unique_key_added',
    setUp: {
      postgres: [pgTable('unique_key_added', 'code varchar(20) not null'), "insert into drifting.unique_key_added (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('unique_key_added', 'code nvarchar(20) not null'), "insert into drifting.unique_key_added (code, note) values (N'ABC', N'seed')"],
    },
    alter: {
      postgres: ['create unique index uq_unique_key_added_code on drifting.unique_key_added (code)'],
      sqlserver: ['alter table drifting.unique_key_added add constraint uq_unique_key_added_code unique (code)'],
    },
    moves: true,
    verdict: NOTHING_STOPS,
    updates: [{ field: 'code', value: 'XYZ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },

  // Review blocks it and the runtime does not: the change is in the lookup's table, which only review compares.
  {
    name: 'retyped-lookup-display',
    table: 'retyped_lookup_display',
    setUp: {
      postgres: [
        ...pgTarget('retyped_lookup_display'),
        pgTable('retyped_lookup_display', targetColumn('retyped_lookup_display')),
        "insert into drifting.retyped_lookup_display (target_id, note) values (1, 'seed')",
      ],
      sqlserver: [
        ...msTarget('retyped_lookup_display'),
        msTable('retyped_lookup_display', targetColumn('retyped_lookup_display')),
        "insert into drifting.retyped_lookup_display (target_id, note) values (1, N'seed')",
      ],
    },
    alter: {
      postgres: ['alter table drifting.retyped_lookup_display_target alter column label type varchar(80)'],
      sqlserver: ['alter table drifting.retyped_lookup_display_target alter column label nvarchar(80) not null'],
    },
    lookups: lookupOf('retyped_lookup_display'),
    moves: false,
    verdict: EVERYTHING_STOPS,
    runtime: NOTHING_STOPS,
    updates: [UNTOUCHED],
    insert: { note: 'created' },
  },

  // A limitation, held: dropped and added again under the same definition,
  // which drift review compares by name and does not see. On PostgreSQL the
  // version column too, so every row's version starts again at its default.
  {
    name: 'readded-same-definition',
    table: 'readded_same_definition',
    setUp: {
      postgres: [pgTable('readded_same_definition', 'code varchar(20) not null'), "insert into drifting.readded_same_definition (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('readded_same_definition', 'code nvarchar(20) not null'), "insert into drifting.readded_same_definition (code, note) values (N'ABC', N'seed')"],
    },
    alter: {
      postgres: [
        'alter table drifting.readded_same_definition drop column note',
        'alter table drifting.readded_same_definition add column note varchar(40)',
        'alter table drifting.readded_same_definition drop column row_version',
        'alter table drifting.readded_same_definition add column row_version bigint not null default 1',
      ],
      sqlserver: ['alter table drifting.readded_same_definition drop column note', 'alter table drifting.readded_same_definition add note nvarchar(40) null'],
    },
    moves: true,
    verdict: NOTHING_STOPS,
    updates: [{ field: 'code', value: 'XYZ' }, UNTOUCHED],
    insert: { code: 'NEW' },
  },

  // The adapters' alone: the table dropped and created again under the same
  // name and definition, its row inserted again, as a restore does. Review
  // compares names and definitions, and sees nothing; a write decided before
  // it is refused on both engines, by the relation's own identity in the
  // facts -- a SQL Server object_id, a PostgreSQL oid -- which no DDL short
  // of a drop changes. The version starts again at its default, as above.
  {
    name: 'recreated-same-definition',
    table: 'recreated_same_definition',
    setUp: {
      postgres: [pgTable('recreated_same_definition', 'code varchar(20) not null'), "insert into drifting.recreated_same_definition (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('recreated_same_definition', 'code nvarchar(20) not null'), "insert into drifting.recreated_same_definition (code, note) values (N'ABC', N'seed')"],
    },
    alter: {
      postgres: [
        'drop table drifting.recreated_same_definition',
        pgTable('recreated_same_definition', 'code varchar(20) not null'),
        "insert into drifting.recreated_same_definition (code, note) values ('ABC', 'seed')",
      ],
      sqlserver: [
        'drop table drifting.recreated_same_definition',
        msTable('recreated_same_definition', 'code nvarchar(20) not null'),
        "insert into drifting.recreated_same_definition (code, note) values (N'ABC', N'seed')",
      ],
    },
    moves: true,
    verdict: null,
    updates: [UNTOUCHED],
    insert: { code: 'NEW' },
  },

  // The adapters' alone: DDL that changes nothing the definition holds.
  {
    name: 'unmoved-comment',
    table: 'unmoved_comment',
    setUp: {
      postgres: [pgTable('unmoved_comment', 'code varchar(20) not null'), "insert into drifting.unmoved_comment (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('unmoved_comment', 'code nvarchar(20) not null'), "insert into drifting.unmoved_comment (code, note) values (N'ABC', N'seed')"],
    },
    alter: {
      postgres: ["comment on table drifting.unmoved_comment is 'a table'", "comment on column drifting.unmoved_comment.note is 'a column'"],
      sqlserver: [
        "exec sp_addextendedproperty N'MS_Description', N'a table', N'SCHEMA', N'drifting', N'TABLE', N'unmoved_comment'",
        "exec sp_addextendedproperty N'MS_Description', N'a column', N'SCHEMA', N'drifting', N'TABLE', N'unmoved_comment', N'COLUMN', N'note'",
      ],
    },
    moves: false,
    verdict: null,
    updates: [UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    name: 'unmoved-index',
    table: 'unmoved_index',
    setUp: {
      postgres: [pgTable('unmoved_index', 'code varchar(20) not null'), "insert into drifting.unmoved_index (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('unmoved_index', 'code nvarchar(20) not null'), "insert into drifting.unmoved_index (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['create index ix_unmoved_index_note on drifting.unmoved_index (note)'], sqlserver: ['create index ix_unmoved_index_note on drifting.unmoved_index (note)'] },
    moves: false,
    verdict: null,
    updates: [UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    // A grant to another principal: nothing the writing account sees changes.
    name: 'unmoved-grant',
    table: 'unmoved_grant',
    setUp: {
      postgres: [pgTable('unmoved_grant', 'code varchar(20) not null'), "insert into drifting.unmoved_grant (code, note) values ('ABC', 'seed')"],
      sqlserver: [msTable('unmoved_grant', 'code nvarchar(20) not null'), "insert into drifting.unmoved_grant (code, note) values (N'ABC', N'seed')"],
    },
    alter: { postgres: ['grant select on drifting.unmoved_grant to formancy_reader'], sqlserver: ['grant select on drifting.unmoved_grant to formancy_reader'] },
    moves: false,
    verdict: null,
    updates: [UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    // A limitation, held, SQL Server's alone: dynamic data masking added to a
    // written column after publication. Neither discovery nor the definition
    // reads masking, so nothing moves and review sees nothing, while an
    // account without UNMASK reads the mask -- and a save that sends every
    // field, as a renderer does (0022), writes it over the stored value.
    name: 'masked-after-publication',
    table: 'masked_after_publication',
    setUp: {
      sqlserver: [msTable('masked_after_publication', 'code nvarchar(20) not null'), "insert into drifting.masked_after_publication (code, note) values (N'ABC', N'seed')"],
    },
    alter: { sqlserver: ["alter table drifting.masked_after_publication alter column note add masked with (function = 'default()')"] },
    moves: false,
    verdict: null,
    updates: [UNTOUCHED],
    insert: { code: 'NEW' },
  },
  {
    // A partition is storage for its parent, and discovery describes it through
    // the parent: the root is gone as discovery reports it, and so for `describe`.
    name: 'replaced-by-partition',
    table: 'replaced_by_partition',
    setUp: {
      postgres: [
        `create table drifting.replaced_by_partition (id bigint constraint pk_replaced_by_partition primary key, code varchar(20) not null, ${PG_TAIL})`,
        "insert into drifting.replaced_by_partition (id, code, note) values (1, 'ABC', 'seed')",
      ],
    },
    alter: {
      postgres: [
        `create table drifting.replaced_by_partition_parent (id bigint not null, code varchar(20) not null, ${PG_TAIL}) partition by range (id)`,
        'alter table drifting.replaced_by_partition_parent attach partition drifting.replaced_by_partition for values from (minvalue) to (maxvalue)',
      ],
    },
    moves: true,
    verdict: null,
    updates: [UNTOUCHED],
    insert: { id: '2', code: 'NEW' },
  },
]

/** The cases `engine` runs. */
export function driftingOn(engine: DatabaseKind): DriftingCase[] {
  return DRIFTING.filter((entry) => entry.setUp[engine] !== undefined)
}

/**
 * The cases both engines run, which are shared cases (0035): a case one
 * engine alone runs would be `missing` on the other in every release report,
 * so it is that adapter's own test and declares no case.
 */
export function sharedDrifting(): DriftingCase[] {
  return DRIFTING.filter((entry) => DATABASE_KINDS.every((engine) => entry.setUp[engine] !== undefined))
}

/** What the runtime allows for a case: its own verdict where review's is not the runtime's. */
export function runtimeOf(entry: DriftingCase): DriftVerdict | null {
  return entry.runtime ?? entry.verdict
}
