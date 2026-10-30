import type { DriftSend } from './drifting.js'

/*
 * What every case table of `DRIFTING` (drifting.ts) is made of, on each
 * engine: the update of `note` every case sends, the columns every table
 * ends with, the table keyed by an identity, and a lookup's target with the
 * column that refers to it. Shared by the cases drift review and the runtime
 * judge, in drifting.ts, and the adapters' own, in drifting-definition.ts.
 */

export const UNTOUCHED: DriftSend = { field: 'note', value: 'an untouched field' }

/** The columns every case table ends with. */
export const PG_TAIL = 'memo varchar(40), note varchar(40), row_version bigint not null default 1'
export const MS_TAIL = 'memo nvarchar(40) null, note nvarchar(40) null, rv rowversion'

/** A table keyed by an identity, with `columns` between the key and the tail. */
export const pgTable = (table: string, columns: string): string =>
  `create table drifting.${table} (id bigint generated always as identity constraint pk_${table} primary key, ${columns}${columns === '' ? '' : ', '}${PG_TAIL})`
export const msTable = (table: string, columns: string): string =>
  `create table drifting.${table} (id bigint identity(1,1) constraint pk_${table} primary key, ${columns}${columns === '' ? '' : ', '}${MS_TAIL})`

/** A lookup's target, keyed by `id`, with one row: 1, 'one'. */
export const pgTarget = (table: string): string[] => [
  `create table drifting.${table}_target (id integer constraint pk_${table}_target primary key, label varchar(40) not null)`,
  `insert into drifting.${table}_target values (1, 'one')`,
]
export const msTarget = (table: string): string[] => [
  `create table drifting.${table}_target (id int constraint pk_${table}_target primary key, label nvarchar(40) not null)`,
  `insert into drifting.${table}_target values (1, N'one')`,
]
export const targetColumn = (table: string): string => `target_id integer null constraint fk_${table}_target references drifting.${table}_target (id)`
export const lookupOf = (table: string) => [{ foreignKey: `fk_${table}_target`, display: ['label'] }]
