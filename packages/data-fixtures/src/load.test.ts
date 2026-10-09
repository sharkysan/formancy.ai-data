import { describe, expect, test } from 'vitest'
import { READER, WRITER } from './containers.js'
import { readFixture, splitBatches } from './load.js'

describe('splitBatches', () => {
  // A driver sends GO as text and SQL Server answers with a syntax error. It
  // has to be split out, on its own line only.
  test('splits at GO alone on a line, in any case, and drops empty batches', () => {
    expect(splitBatches('create schema a;\nGO\ncreate view v as select 1;\r\n  go  \n\nGO\n')).toEqual([
      'create schema a;',
      'create view v as select 1;',
    ])
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
  // CREATE TRIGGER too, which the parity file uses.
  test('each SQL Server file opens a batch with each CREATE SCHEMA, VIEW, FUNCTION and TRIGGER', () => {
    const sales = splitBatches(readFixture('sqlserver.sql'))
    const parity = splitBatches(readFixture('sqlserver.parity.sql'))
    expect(sales.some((batch) => /\bcreate function\b/i.test(batch))).toBe(true)
    expect(parity.some((batch) => /\bcreate trigger\b/i.test(batch))).toBe(true)
    for (const batch of [...sales, ...parity]) {
      const body = batch.replaceAll(/--.*$/gm, '').trim().toLowerCase()
      const opensWith = /^create (schema|view|function|trigger)\b/.test(body)
      const contains = /\bcreate (schema|view|function|trigger)\b/.test(body)
      expect(contains ? opensWith : true, `a batch contains CREATE SCHEMA, VIEW, FUNCTION or TRIGGER after its first statement:\n${batch.slice(0, 120)}`).toBe(true)
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
    const names = (text: string) =>
      [...new Set([...text.replaceAll(/--.*$/gm, '').matchAll(/constraint\s+(\w+)/gi)].map((match) => match[1]))].sort()
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

  // The parity files are one schema in two dialects (0028): a table or a
  // constraint in one only would make a parity case compare two datasets.
  // Derived from the statements, as for the sales files; SQL Server names its
  // defaults (df_) where PostgreSQL leaves them unnamed.
  test('both parity editions create the same tables and name the same constraints', () => {
    const strip = (text: string) => text.replaceAll(/--.*$/gm, '')
    const tables = (text: string) => [...strip(text).matchAll(/create\s+table\s+parity\.(\w+)/gi)].map((match) => match[1]).sort()
    const names = (text: string) => [...new Set([...strip(text).matchAll(/constraint\s+(\w+)/gi)].map((match) => match[1]))].filter((name) => !name?.startsWith('df_')).sort()
    const postgres = readFixture('postgres.parity.sql')
    const sqlServer = readFixture('sqlserver.parity.sql')
    expect(tables(postgres)).toEqual(['contended', 'declined', 'display_kinds', 'display_use', 'generated', 'guarded', 'item_use', 'tenant_item'])
    expect(tables(sqlServer)).toEqual(tables(postgres))
    expect(names(sqlServer)).toEqual(names(postgres))
  })
})
