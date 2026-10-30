import type { DriftingCase } from './drifting.js'
import { msTable, PG_TAIL, pgTable, UNTOUCHED } from './drifting-tables.js'

/*
 * The cases of `DRIFTING` (drifting.ts) that are the adapters' alone: their
 * verdict is null, so drift review and the runtime are not held to them.
 * Each holds the table's definition, the digest each adapter writes under,
 * to whether the change moves it.
 */
export const DEFINITION_CASES: readonly DriftingCase[] = [
  // The adapters' alone: the table dropped and created again under the same
  // name and definition, its row inserted again, as a restore does. Review
  // compares names and definitions, and sees nothing; a write decided before
  // it is refused on both engines, by the relation's own identity in the
  // facts -- a SQL Server object_id, a PostgreSQL oid -- which no DDL short
  // of a drop changes. The version starts again at its default, as for
  // `readded-same-definition` (drifting.ts).
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
