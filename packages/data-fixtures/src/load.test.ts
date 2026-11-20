import { readdirSync } from 'node:fs'
import { DATABASE_KINDS } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { ACTION_ON_NULL } from './actions.js'
import { READER, WRITER } from './containers.js'
import { type FixtureFile, readFixture, splitBatches } from './load.js'
import { FIXTURE_ROUTINES } from './model.js'

describe('splitBatches', () => {
  // A driver sends GO as text and SQL Server answers with a syntax error. It
  // has to be split out, on its own line only.
  test('splits at GO alone on a line, in any case, and drops empty batches', () => {
    expect(splitBatches('create schema a;\nGO\ncreate view v as select 1;\r\n  go  \n\nGO\n')).toEqual(['create schema a;', 'create view v as select 1;'])
  })

  // A column called go_live, or a comment saying "go", is not a separator.
  // Splitting there would send half a statement.
  test('does not split on GO inside a line', () => {
    expect(splitBatches('select go_live from t -- go\nGO')).toEqual(['select go_live from t -- go'])
  })

  // A batch of only comments is nothing to send, and some drivers reject it.
  test('drops a batch that is only comments', () => {
    expect(splitBatches('-- header\nGO\nselect 1')).toEqual(['select 1'])
  })
})

describe('the fixture files', () => {
  // CREATE SCHEMA, CREATE VIEW and CREATE FUNCTION must each open a batch on
  // SQL Server; a GO lost in an edit fails there with an error about the
  // batch, far from here.
  // CREATE TRIGGER too, which the parity file uses, and CREATE PROCEDURE,
  // which the routine the model names is on SQL Server (0158).
  test('each SQL Server file opens a batch with each CREATE SCHEMA, VIEW, FUNCTION, PROCEDURE and TRIGGER', () => {
    const sales = splitBatches(readFixture('sqlserver.sql'))
    const parity = splitBatches(readFixture('sqlserver.parity.sql'))
    expect(sales.some((batch) => /\bcreate function\b/i.test(batch))).toBe(true)
    expect(sales.some((batch) => /\bcreate procedure\b/i.test(batch))).toBe(true)
    expect(parity.some((batch) => /\bcreate trigger\b/i.test(batch))).toBe(true)
    for (const batch of [...sales, ...parity]) {
      const body = batch.replaceAll(/--.*$/gm, '').trim().toLowerCase()
      const opensWith = /^create (schema|view|function|procedure|trigger)\b/.test(body)
      const contains = /\bcreate (schema|view|function|procedure|trigger)\b/.test(body)
      expect(
        contains ? opensWith : true,
        `a batch contains CREATE SCHEMA, VIEW, FUNCTION, PROCEDURE or TRIGGER after its first statement:\n${batch.slice(0, 120)}`,
      ).toBe(true)
    }
  })

  // A PostgreSQL routine's body is a dollar-quoted string, `$$` or `$tag$`,
  // closed by the same quote. One `$` lost in an edit leaves a dollar sign
  // PostgreSQL's lexer reads as a stray character, and the file, sent as
  // one simple query, is a syntax error before any of it runs: every start
  // of the PostgreSQL fixture fails, every suite over it with it, and only
  // where Docker runs. Comments stripped first, since a positional `$1` in
  // one is prose; each quoted body taken out by its own tag; no dollar
  // sign may be left. The files are listed from the directory, so one
  // added is held too. Watched failing on 2026-11-19 with weigh_order's
  // body quoted by a single `$`: "expected [ …(2) ] to deeply equal []",
  // naming its opening and closing lines.
  test('each PostgreSQL file closes every dollar quote it opens, and has no dollar sign outside one', () => {
    const files = readdirSync(new URL('../fixtures/', import.meta.url)).filter((name) => /^postgres\b.*\.sql$/.test(name)) as FixtureFile[]
    expect(files).toContain('postgres.actions.sql')
    for (const file of files) {
      const unquoted = readFixture(file)
        .replaceAll(/--.*$/gm, '')
        .replaceAll(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '')
      expect(unquoted.match(/^.*\$.*$/gm) ?? [], file).toEqual([])
    }
  })

  // The restricted principals' passwords live twice: in the PostgreSQL file
  // that creates the roles and in src/containers.ts, which connects as them.
  // Drifted apart, every restricted suite fails to connect, with an
  // authentication error that names neither file. SQL Server's logins are
  // created by containers.ts in master, from the constants themselves, so
  // its file holds no password and is checked for the users it maps.
  test('the restricted files create the principals containers.ts connects as, with its passwords', () => {
    const postgres = readFixture('postgres.restricted.sql')
    for (const { user, postgresPassword } of [READER, WRITER]) {
      const created = new RegExp(`^create role ${user} login password '([^']*)'`, 'm').exec(postgres)
      expect(created?.[1], user).toBe(postgresPassword)
    }
    const sqlServer = readFixture('sqlserver.restricted.sql')
    for (const { user } of [READER, WRITER]) expect(sqlServer, user).toMatch(new RegExp(`^create user ${user} for login ${user};`, 'm'))
  })

  // The two files are one model. A constraint named in one and not the other
  // is a conformance failure on one engine; catching it here names the file.
  test('both editions name the same constraints', () => {
    // Comments stripped first: "every constraint is named" in a header is prose, not a constraint called "is".
    // A set, because SQL Server's file names ck_shipment_reference twice — once
    // to add it and once to disable it (NOCHECK CONSTRAINT), which PostgreSQL 17
    // cannot do — and a constraint named twice is still one constraint.
    const names = (text: string) => [...new Set([...text.replaceAll(/--.*$/gm, '').matchAll(/constraint\s+(\w+)/gi)].map((match) => match[1]))].sort()
    expect(names(readFixture('sqlserver.sql')).filter((name) => !name?.startsWith('df_'))).toEqual(names(readFixture('postgres.sql')))
  })

  // A table created in one file only is a conformance failure on one engine,
  // reported as a missing object far from the edit that caused it. Derived
  // from the CREATE TABLE statements, with each dialect's quoting stripped.
  test('both editions create the same tables', () => {
    const tables = (text: string) =>
      [...text.replaceAll(/--.*$/gm, '').matchAll(/create\s+table\s+sales\.([^\s(]+)/gi)].map((match) => (match[1] ?? '').replaceAll(/["[\]]/g, '')).sort()
    const postgres = tables(readFixture('postgres.sql'))
    expect(postgres).toContain('shipment')
    expect(tables(readFixture('sqlserver.sql'))).toEqual(postgres)
  })

  // The routines are one model too (0158): a routine one file creates and
  // the other does not is a conformance failure on one engine, unless the
  // model writes the difference down. Derived from the CREATE FUNCTION and
  // CREATE PROCEDURE statements, held to the engines FIXTURE_ROUTINES gives
  // each routine.
  test('each edition creates the routines the model gives its engine', () => {
    const routines = (text: string) =>
      [...text.replaceAll(/--.*$/gm, '').matchAll(/create\s+(?:function|procedure)\s+sales\.(\w+)/gi)].map((match) => match[1] ?? '').sort()
    for (const kind of DATABASE_KINDS) {
      const modelled = FIXTURE_ROUTINES.filter((routine) => routine.byKind[kind] !== undefined).map((routine) => routine.ref.name)
      expect(routines(readFixture(`${kind}.sql`)), kind).toEqual(modelled.sort())
    }
    expect(routines(readFixture('postgres.sql'))).toContain('ship_order')
  })

  // The parity files are one schema in two dialects (0028): a table or a
  // constraint in one only would make a parity case compare two datasets.
  // Derived from the statements, as for the sales files; SQL Server names its
  // defaults (df_) where PostgreSQL leaves them unnamed.
  test('both parity editions create the same tables and name the same constraints', () => {
    const strip = (text: string) => text.replaceAll(/--.*$/gm, '')
    const tables = (text: string) => [...strip(text).matchAll(/create\s+table\s+parity\.(\w+)/gi)].map((match) => match[1]).sort()
    const names = (text: string) =>
      [...new Set([...strip(text).matchAll(/constraint\s+(\w+)/gi)].map((match) => match[1]))].filter((name) => !name?.startsWith('df_')).sort()
    const postgres = readFixture('postgres.parity.sql')
    const sqlServer = readFixture('sqlserver.parity.sql')
    expect(tables(postgres)).toEqual([
      'audited',
      'audited_price',
      'contended',
      'declined',
      'display_kinds',
      'display_use',
      'generated',
      'guarded',
      'item_use',
      'keyed',
      'party',
      'party_company',
      'price',
      'price_declined',
      'removable',
      'removable_cascade',
      'removable_child',
      'removable_declined',
      'removable_grandchild',
      'removable_log',
      'removable_null',
      'removable_parent',
      'removable_restrict',
      'removable_ruled',
      'removable_self',
      'removable_triggered',
      'saved_account',
      'saved_entry',
      'saved_line',
      'saved_mark',
      'saved_order',
      'tenant_item',
    ])
    expect(tables(sqlServer)).toEqual(tables(postgres))
    expect(names(sqlServer)).toEqual(names(postgres))
  })

  // The actions files are one schema in two dialects (0160), as the parity
  // files are: a table, a constraint, a routine or the sequence the routines
  // count their calls by in one only would make a shared case run over two
  // things. SQL Server's edition adds what only it has, the rowversion forms
  // and their routines -- the ticket, and the tag keyed by text under a
  // case-insensitive collation (0165) -- which no shared case reads.
  // Watched failing on 2026-11-16 with reprice renamed in the T-SQL file:
  // "expected [ 'broken_order', 'close_order', …(1) ] to deeply equal [
  // 'broken_order', 'close_order', …(1) ]"; and with the sequence renamed
  // there: "expected [ 'counted' ] to deeply equal [ 'called' ]".
  test('both actions editions create the same tables, constraints and routines, and SQL Server its own ticket and tag', () => {
    const strip = (text: string) => text.replaceAll(/--.*$/gm, '')
    const of = (kind: RegExp, text: string) => [...strip(text).matchAll(kind)].map((match) => match[1] as string).sort()
    const tables = /create\s+table\s+actions\.["[]?(\w+)/gi
    const routines = /create\s+(?:function|procedure)\s+actions\.(\w+)/gi
    const sequences = /create\s+sequence\s+actions\.(\w+)/gi
    const names = (text: string) => [...new Set(of(/constraint\s+(\w+)/gi, text))].filter((name) => !name.startsWith('df_'))
    const postgres = readFixture('postgres.actions.sql')
    const sqlServer = readFixture('sqlserver.actions.sql')
    expect(of(tables, postgres)).toEqual(['call', 'customer', 'order', 'price'])
    expect(of(tables, sqlServer)).toEqual(['call', 'customer', 'order', 'price', 'tag', 'ticket'])
    expect(of(routines, sqlServer).filter((name) => name !== 'label_ticket' && name !== 'touch_tag')).toEqual(of(routines, postgres))
    expect(of(sequences, sqlServer)).toEqual(of(sequences, postgres))
    expect(of(sequences, postgres)).toEqual(['called'])
    expect(names(sqlServer).filter((name) => name !== 'pk_ticket' && name !== 'pk_tag')).toEqual(names(postgres))
  })

  // ACTION_ON_NULL is one expectation for both engines over the routines
  // both actions editions create (0167), each STRICT or declared RETURNS
  // NULL ON NULL INPUT where it says not called: a routine added to both
  // and left out of it would be one whose fact no shared case reads, and
  // one it says is not called but whose file does not declare it so, a
  // case that fails for a reason far from the edit. Watched failing on
  // 2026-11-19 with weigh_order left out of ACTION_ON_NULL: "expected [
  // 'broken_order', 'close_order', …(1) ] to deeply equal [ 'broken_order',
  // 'close_order', …(2) ]"; and with STRICT taken out of the PostgreSQL file:
  // "expected [] to deeply equal [ 'weigh_order' ]".
  test('ACTION_ON_NULL names each routine both actions editions create, and only those it says are not called are declared so', () => {
    const strip = (text: string) => text.replaceAll(/--.*$/gm, '')
    const created = (text: string) => [...strip(text).matchAll(/create\s+(?:function|procedure)\s+actions\.(\w+)([^\n]*)/gi)]
    const postgres = created(readFixture('postgres.actions.sql'))
    const sqlServer = created(readFixture('sqlserver.actions.sql'))
    const shared = postgres.map((match) => match[1] as string).filter((name) => sqlServer.some((other) => other[1] === name))
    expect(Object.keys(ACTION_ON_NULL).sort()).toEqual(shared.sort())
    const declared = (matches: RegExpMatchArray[], option: RegExp) =>
      matches
        .filter((match) => option.test(match[2] ?? ''))
        .map((match) => match[1] as string)
        .sort()
    const skipped = Object.entries(ACTION_ON_NULL)
      .filter(([, onNull]) => onNull === 'not-called')
      .map(([name]) => name)
      .sort()
    expect(declared(postgres, /\bstrict\b/i)).toEqual(skipped)
    expect(declared(sqlServer, /\breturns\s+null\s+on\s+null\s+input\b/i)).toEqual(skipped)
  })
})
