import type { DiscoveryScope, ObjectRef } from '@formancy/data-core'
import type { ExpectedObject, ExpectedType } from './model.js'

/*
 * An enum, and a domain whose check lists its values, are selects (0170):
 * what discovery of fixtures/postgres.states.sql must report, and what the
 * PostgreSQL suites over it expect, written once.
 *
 * PostgreSQL's alone. SQL Server has no enum, and its alias types carry no
 * check, so this is no shared case of 0005: no SQL Server suite runs it,
 * none asserts it with `covers()`, and the report's rule that a shared case
 * passes on both engines does not reach it. The comparator is the shared
 * one (`snapshotDisagreements`), handed this model and this scope, so the
 * engine's reading of an enum and a domain is held as the shared fixture's
 * every column is.
 */

/** The scope the states schema lives in, outside every other. */
export const STATES_SCOPE: DiscoveryScope = { schemas: ['states'] }

const states = (name: string): ObjectRef => ({ schema: 'states', name })

const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const INT64 = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const
const text = (maxLength: number | null): ExpectedType => ({ kind: 'text', maxLength, fixedLength: false, lengthUnit: 'code-points' })
const enumOf = (name: string, labels: readonly string[]): ExpectedType => ({ kind: 'enum', name: states(name), labels })

const ORDER_STATE = enumOf('order_state', ['draft', 'placed', 'shipped'])
/** Out of the alphabet's order: the type's is low, high, urgent. */
const PRIORITY = enumOf('priority', ['low', 'high', 'urgent'])

/** colour's one check, as data-core reads `value in ('red', 'green', 'blue')` out of the spelling PostgreSQL deparses it to. */
const COLOUR = { ref: states('colour'), checks: [{ name: 'colour_check', enforced: true, validated: true, listed: ['blue', 'green', 'red'] }] }

/**
 * What discovery of the states schema must report, as its owner. Each
 * domain of a column's type, outermost first, with what data-core reads of
 * each of its checks -- the values as a set in codepoint order, or `null`,
 * no list -- and a column of no domain with none: an adapter that wrote an
 * empty list on every column would move every fingerprint.
 */
export const STATES_MODEL: readonly ExpectedObject[] = [
  {
    ref: states('stage'),
    kind: 'table',
    columns: [
      // An enum in a key: a record addressed by its label.
      { name: 'state', type: ORDER_STATE, nullable: false, hasDefault: false },
      { name: 'title', type: text(null), nullable: false },
    ],
    primaryKey: ['state'],
    uniqueKeys: {},
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
  },
  {
    ref: states('ticket'),
    kind: 'table',
    columns: [
      { name: 'id', type: INT32, nullable: false, generated: 'identity-always', hasDefault: false },
      // Its labels in pg_enum.enumsortorder, and its default `'placed'::states.order_state`.
      { name: 'state', type: ORDER_STATE, nullable: false, hasDefault: true },
      { name: 'priority', type: PRIORITY, nullable: true, hasDefault: false },
      // The domain's base type with the domain's own modifier: a column of a domain declares none.
      { name: 'colour', type: text(10), nullable: true, hasDefault: false, domains: [COLOUR] },
      {
        name: 'size',
        type: INT32,
        nullable: true,
        domains: [{ ref: states('size'), checks: [{ name: 'size_check', enforced: true, validated: true, listed: ['1', '2', '3'] }] }],
      },
      // A domain whose check is no list is its base type, the check the database's.
      {
        name: 'code',
        type: text(null),
        nullable: true,
        domains: [{ ref: states('code'), checks: [{ name: 'code_check', enforced: true, validated: true, listed: null }] }],
      },
      // Over colour, NOT NULL with a default of its own: the column holds no NULL and has a default, though it declares neither.
      { name: 'tone', type: text(10), nullable: false, hasDefault: true, domains: [{ ref: states('tone'), checks: [] }, COLOUR] },
      // A domain over an enum is the enum.
      { name: 'stated', type: ORDER_STATE, nullable: true, domains: [{ ref: states('stated'), checks: [] }] },
      // A domain over numeric: nothing has proved an operation over one, so it is unsupported, its domain still read.
      { name: 'amount', type: { kind: 'unsupported' }, nullable: true, domains: [{ ref: states('amount'), checks: [{ name: 'amount_check', listed: null }] }] },
      // An array of an enum is an array.
      { name: 'tags', type: { kind: 'unsupported' }, nullable: true },
      { name: 'title', type: text(null), nullable: true },
      { name: 'version', type: INT64, nullable: false, hasDefault: true },
    ],
    primaryKey: ['id'],
    uniqueKeys: {},
    foreignKeys: [
      { name: 'fk_ticket_stage', columns: ['state'], references: { table: states('stage'), columns: ['state'] }, onDelete: 'no-action', validated: true },
    ],
    checks: [],
    rowSecurity: 'none',
  },
]

/**
 * What the PostgreSQL suites expect of the states schema, by case.
 *
 * - `form`: the ticket form, generated with `version` its version column:
 *   each select's options in the order drawn -- an enum's in its type's
 *   order, a domain's list in codepoint order, as 0152 orders a check's --,
 *   the fields a text box, the columns left out, and each field's default.
 * - `rows`: the fixture's tickets by title, as their id orders them.
 * - `sorted`: the tickets' titles by priority, in the type's order, NULLs
 *   last both ways, as a page lists them; never the alphabet's, which puts
 *   high first.
 * - `search`: what a list's search finds, matched against an enum's label.
 * - `filter`: what a filter on priority equal to a label narrows a list to.
 * - `stored`: a create's answers, a label of every select, read back as
 *   given; `updated`, an update's.
 * - `exported`: the file's records for id, state, priority and title, a
 *   label as its cell and NULL as an empty one.
 * - `domains`: the same over a domain over varchar and one over an
 *   integer, each whose check lists its values, and one over text whose
 *   check is no list -- colour, size and code --, each operation its base
 *   type's: the titles by each, NULLs last both ways; what a filter equal
 *   to one value narrows a list to; and the file's records for id, the
 *   three and title.
 */
export const STATES = {
  form: {
    selects: {
      state: ['draft', 'placed', 'shipped'],
      priority: ['low', 'high', 'urgent'],
      colour: ['blue', 'green', 'red'],
      size: ['1', '2', '3'],
      tone: ['blue', 'green', 'red'],
      stated: ['draft', 'placed', 'shipped'],
    },
    boxes: { code: 'textarea', title: 'textarea' },
    excluded: ['amount', 'tags'],
    defaults: { state: 'placed', tone: 'red' },
  },
  rows: ['first', 'second', 'third', 'fourth'],
  sorted: { asc: ['first', 'third', 'second', 'fourth'], desc: ['second', 'third', 'first', 'fourth'] },
  search: { text: 'urg', titles: ['second'] },
  filter: { priority: 'high', titles: ['third'] },
  stored: { state: 'shipped', priority: 'urgent', colour: 'green', size: '3', code: 'Z', tone: 'blue', stated: 'draft', title: 'stored' },
  updated: { priority: 'low', colour: 'red', stated: 'shipped' },
  exported: ['1,shipped,low,first', '2,draft,urgent,second', '3,placed,high,third', '4,draft,,fourth'],
  domains: {
    sorted: {
      colour: { asc: ['second', 'third', 'first', 'fourth'], desc: ['first', 'third', 'second', 'fourth'] },
      size: { asc: ['first', 'third', 'second', 'fourth'], desc: ['second', 'third', 'first', 'fourth'] },
      code: { asc: ['first', 'second', 'third', 'fourth'], desc: ['third', 'second', 'first', 'fourth'] },
    },
    filter: [
      { field: 'colour', value: 'blue', titles: ['second'] },
      { field: 'size', value: '1', titles: ['first'] },
      { field: 'code', value: 'C', titles: ['third'] },
    ],
    exported: ['1,red,1,A,first', '2,blue,3,B,second', '3,green,2,C,third', '4,,,,fourth'],
  },
} as const
