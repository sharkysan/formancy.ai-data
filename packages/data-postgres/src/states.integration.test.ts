import { findObject, generateForm } from '@formancy/data-core'
import type { GeneratedForm, GenerationRequest, MetadataSnapshot, ObjectRef } from '@formancy/data-core'
import { snapshotDisagreements, startPostgresFixture, STATES, STATES_MODEL, STATES_SCOPE } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * An enum, and a domain whose check lists its values, read as selects
 * (0170), against REAL PostgreSQL: the shared fixture's states schema,
 * discovered as its owner and held to STATES_MODEL by the shared
 * comparator, and a probe schema of this file's own for what the model
 * does not hold -- labels a person types awkwardly, an empty label and
 * none, a type in a schema whose name needs quoting, a domain's list added
 * NOT VALID, a domain over a domain, an array of an enum, a domain's default
 * set or dropped after one was declared over it, and an enum in a schema
 * the account may not use. PostgreSQL's alone: SQL Server has no enum, so
 * no case here is a shared one.
 *
 * Written on 2026-11-20 without a server to run it on; its first run is in
 * CI, on every image of the matrix (0067).
 */

let fixture: PostgresFixture
let owner: Sql
let states: MetadataSnapshot
let probe: MetadataSnapshot

const TICKET: ObjectRef = { schema: 'states', name: 'ticket' }
const PROBE: ObjectRef = { schema: 'states_probe', name: 'probe' }
const DEFAULTS: ObjectRef = { schema: 'states_probe', name: 'defaults' }
const REQUEST: GenerationRequest = { connection: 'test', root: TICKET, formId: 'ticket', title: 'Ticket', lookups: [], versionColumn: 'version' }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  // Declared here and nowhere else: what the model does not hold, each a
  // near miss of one rule. `blank` holds the empty label, which PostgreSQL
  // takes; `nothing` no label at all. CREATE DOMAIN copies the default of
  // the domain it is declared over, once: `tint` took shade's 'red' and
  // dropped it, and `plain_outer` was declared before `plain_base` had one.
  await owner.unsafe(`
    create schema states_probe;
    create schema "Odd States";
    create type states_probe.awkward as enum ('it''s', 'a, b', ' spaced ', 'Zürich');
    create type states_probe.blank as enum ('', 'x');
    create type states_probe.nothing as enum ();
    create type "Odd States"."Ticket Kind" as enum ('bug', 'idea');
    create domain states_probe.loose as text;
    alter domain states_probe.loose add constraint loose_values check (value in ('a', 'b')) not valid;
    create domain states_probe.inner_list as text check (value in ('x', 'y'));
    create domain states_probe.outer_plain as states_probe.inner_list;
    create table states_probe.probe (
      id integer primary key,
      awkward states_probe.awkward,
      blank states_probe.blank,
      nothing states_probe.nothing,
      kind "Odd States"."Ticket Kind" default 'idea',
      loose states_probe.loose,
      nested states_probe.outer_plain,
      moods states_probe.awkward[]
    );
    create domain states_probe.shade as varchar(10) default 'red';
    create domain states_probe.tint as states_probe.shade not null;
    alter domain states_probe.tint drop default;
    create domain states_probe.plain_base as text;
    create domain states_probe.plain_outer as states_probe.plain_base;
    alter domain states_probe.plain_base set default 'x';
    create table states_probe.defaults (id integer primary key, tint states_probe.tint, plain states_probe.plain_outer);
  `)
  states = await discoverPostgres(owner, STATES_SCOPE)
  probe = await discoverPostgres(owner, { schemas: ['states_probe'] })
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

/** Each select of a form, by key, its options' values in the order drawn. */
const selectsOf = ({ form }: GeneratedForm): Record<string, string[]> =>
  Object.fromEntries(form.model.fields.flatMap((field) => (field.type === 'select' ? [[field.key, (field.options ?? []).map((option) => option.value)]] : [])))

const fieldOf = ({ form }: GeneratedForm, key: string) => form.model.fields.find((field) => field.key === key)

describe('discovery of the states schema', () => {
  // The model's every column: an enum's labels in enumsortorder, a domain's
  // base type with the innermost domain's modifier, its NOT NULL and its
  // default folded into the column's, each domain of the chain outermost
  // first with what data-core reads of its checks, and no domains on a
  // column of none. A failure names the column and what was read.
  test('reports what STATES_MODEL says, as the owner', () => {
    expect(snapshotDisagreements(states, STATES_MODEL)).toEqual([])
  })

  // The root's description (0041) reads a column of an enum or a domain as
  // discovery does -- its type, nullability, default and domains -- so a
  // request over a form published from discovery finds nothing changed.
  test("the root's description reads every column as discovery does", async () => {
    const described = await createPostgresRecords(owner).describe(TICKET)
    if (!described.ok) throw new Error(`expected a description, got ${described.code}`)
    const discovered = findObject(states, TICKET)?.columns.map(({ access: _access, comment: _comment, ...column }) => column)
    expect(described.described.columns).toEqual(discovered)
  })
})

describe('the ticket form', () => {
  // Every enum a select of its labels in the type's order, every domain's
  // list a select of its values, a domain over a domain its inner list's,
  // a domain over an enum the enum's, the base type's box where a domain's
  // check is no list, and a domain over numeric and an array of an enum
  // left out. A column's default, its own or its domain's, starts its
  // field. To be watched failing in CI with the labels sorted as 0152
  // sorts a list: priority offering high first.
  test('draws each enum and each listed domain as a select', () => {
    const generated = generateForm(states, REQUEST)
    expect(selectsOf(generated)).toEqual(STATES.form.selects)
    for (const [key, type] of Object.entries(STATES.form.boxes)) expect(fieldOf(generated, key)?.type, key).toBe(type)
    for (const key of STATES.form.excluded) expect(fieldOf(generated, key), key).toBeUndefined()
    for (const [key, value] of Object.entries(STATES.form.defaults)) expect(fieldOf(generated, key)?.default, key).toBe(value)
  })

  // A ticket's state is a key of stage: a lookup onto a table keyed by a
  // label, which the generator offers as it offers any key it can spell.
  test('offers a lookup onto a table keyed by an enum', () => {
    const generated = generateForm(states, { ...REQUEST, lookups: [{ foreignKey: 'fk_ticket_stage', display: ['title'] }] })
    expect(generated.bindings.fields.find((binding) => binding.kind === 'lookup' && binding.foreignKey === 'fk_ticket_stage')).toMatchObject({
      columns: ['state'],
      display: ['title'],
    })
  })
})

describe('the near misses', () => {
  const generated = () => generateForm(probe, { connection: 'test', root: PROBE, formId: 'probe', title: 'Probe', lookups: [] })
  const notes = (subject: string) =>
    generated()
      .notes.filter((note) => note.subject === subject)
      .map((note) => note.message)

  // pg_enum keeps each label as it was written: a quote, a comma, blanks
  // and letters past ASCII are each one option, in the order declared.
  test('labels with a quote, a comma, blanks and letters past ASCII are each one option', () => {
    expect(selectsOf(generated())['awkward']).toEqual(["it's", 'a, b', ' spaced ', 'Zürich'])
  })

  // An empty label is one a select cannot tell from no answer, and an enum
  // of no labels holds nothing but NULL: shown, never written.
  test('an empty label, or none at all, is shown and never written', () => {
    expect(findObject(probe, PROBE)?.columns.find((column) => column.name === 'blank')?.type).toEqual({
      kind: 'enum',
      name: { schema: 'states_probe', name: 'blank' },
      labels: ['', 'x'],
    })
    expect(findObject(probe, PROBE)?.columns.find((column) => column.name === 'nothing')?.type).toMatchObject({ kind: 'enum', labels: [] })
    expect(notes('blank')).toContain('Shown, never written: states_probe.blank has an empty label, which a select cannot tell from no answer.')
    expect(notes('nothing')).toContain('Shown, never written: states_probe.nothing has no labels, so nothing but NULL can be written.')
  })

  // A type in a schema whose name needs quoting: named so in the snapshot,
  // and its default -- `'idea'::"Odd States"."Ticket Kind"`, as format_type
  // quotes it -- read as its label.
  test('a type in a schema whose name needs quoting, and its default', () => {
    expect(findObject(probe, PROBE)?.columns.find((column) => column.name === 'kind')).toMatchObject({
      type: { kind: 'enum', name: { schema: 'Odd States', name: 'Ticket Kind' }, labels: ['bug', 'idea'] },
      defaultExpression: `'idea'::"Odd States"."Ticket Kind"`,
    })
    expect(fieldOf(generated(), 'kind')).toMatchObject({ type: 'select', default: 'idea' })
  })

  // NOT VALID: rows from before the list may hold another value, which a
  // select could not show. The base type's box, and the note says why.
  test("a domain's list added NOT VALID is no select, and says why", () => {
    const loose = findObject(probe, PROBE)?.columns.find((column) => column.name === 'loose')
    expect(loose?.domains).toEqual([
      {
        ref: { schema: 'states_probe', name: 'loose' },
        checks: [{ name: 'loose_values', expression: "(VALUE = ANY (ARRAY['a'::text, 'b'::text]))", enforced: true, validated: false }],
      },
    ])
    expect(fieldOf(generated(), 'loose')?.type).toBe('textarea')
    expect(notes('loose')).toContain(
      'Not a select of the values loose_values of states_probe.loose lists: it was not validated, so a row from before it may hold a value it does not list, which a select could not show.',
    )
  })

  // A domain over a domain: the chain is walked, and the inner list holds
  // every value of the outer one.
  test('a domain over a domain is a select of the inner one’s list', () => {
    const nested = findObject(probe, PROBE)?.columns.find((column) => column.name === 'nested')
    expect(nested?.domains?.map((domain) => domain.ref.name)).toEqual(['outer_plain', 'inner_list'])
    expect(selectsOf(generated())['nested']).toEqual(['x', 'y'])
  })

  // An array of an enum is an array, unsupported as every array is.
  test('an array of an enum is left out', () => {
    expect(findObject(probe, PROBE)?.columns.find((column) => column.name === 'moods')?.type).toEqual({ kind: 'unsupported' })
    expect(fieldOf(generated(), 'moods')).toBeUndefined()
  })

  // An INSERT that leaves a column out stores its type's own default, the
  // domain it is declared with, never one further down the chain
  // (`get_typdefault`): tint, whose default was dropped, has none, and
  // its NOT NULL refuses the row (23502); plain, over a domain given one
  // after it was declared, has none either. The root's description reads
  // both as discovery does. To be watched failing in CI with the nearest
  // default down the chain read: tint's was 'red'.
  test("a domain's default is its own, whatever the domain it is declared over says since", async () => {
    const columns = findObject(probe, DEFAULTS)?.columns
    expect(columns?.find((column) => column.name === 'tint')).toMatchObject({ nullable: false, hasDefault: false, defaultExpression: null })
    expect(columns?.find((column) => column.name === 'plain')).toMatchObject({ hasDefault: false, defaultExpression: null })
    const described = await createPostgresRecords(owner).describe(DEFAULTS)
    if (!described.ok) throw new Error(`expected a description, got ${described.code}`)
    expect(described.described.columns).toEqual(columns?.map(({ access: _access, comment: _comment, ...column }) => column))
    await expect(owner.unsafe('insert into states_probe.defaults (id) values (1)')).rejects.toMatchObject({ code: '23502' })
    const [row] = await owner.unsafe("insert into states_probe.defaults (id, tint) values (2, 'red') returning plain")
    expect(row?.['plain']).toBeNull()
  })

  // A value is cast to an enum by its name, which PostgreSQL resolves only
  // in a schema the role may use (42501): for an account that may not use
  // "Odd States", its enum is unsupported, in discovery and in the root's
  // description, and left out, while an enum in a schema it may use is
  // still one. To be watched failing in CI with the privilege unasked: the
  // reader was offered a select every write of which was refused.
  test('an enum in a schema the account may not use is unsupported for it', async () => {
    const role = decodeURIComponent(new URL(fixture.reader).username)
    await owner.unsafe(`grant usage on schema states_probe to "${role}"; grant select on states_probe.probe to "${role}"`)
    const reader = postgres(fixture.reader, { onnotice: () => {} })
    try {
      await expect(reader.unsafe(`select 'bug'::pg_catalog.text::"Odd States"."Ticket Kind"`)).rejects.toMatchObject({ code: '42501' })
      const seen = await discoverPostgres(reader, { schemas: ['states_probe'] })
      const type = (name: string) => findObject(seen, PROBE)?.columns.find((column) => column.name === name)?.type
      expect(type('kind')).toEqual({ kind: 'unsupported' })
      expect(type('awkward')).toMatchObject({ kind: 'enum' })
      const described = await createPostgresRecords(reader).describe(PROBE)
      if (!described.ok) throw new Error(`expected a description, got ${described.code}`)
      expect(described.described.columns.find((column) => column.name === 'kind')?.type).toEqual({ kind: 'unsupported' })
      const form = generateForm(seen, { connection: 'test', root: PROBE, formId: 'probe', title: 'Probe', lookups: [] })
      expect(fieldOf(form, 'kind')).toBeUndefined()
    } finally {
      await reader.end()
    }
  })
})
