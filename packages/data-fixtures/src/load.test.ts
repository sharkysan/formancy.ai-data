import { describe, expect, test } from 'vitest'
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
  // CREATE SCHEMA and CREATE VIEW must each open a batch on SQL Server; a GO
  // lost in an edit fails there with an error about the batch, far from here.
  test('the SQL Server file opens a batch with each CREATE SCHEMA and CREATE VIEW', () => {
    for (const batch of splitBatches(readFixture('sqlserver.sql'))) {
      const body = batch.replaceAll(/--.*$/gm, '').trim().toLowerCase()
      const opensWith = body.startsWith('create schema') || body.startsWith('create view')
      const contains = /\bcreate (schema|view)\b/.test(body)
      expect(contains ? opensWith : true, `a batch contains CREATE SCHEMA or CREATE VIEW after its first statement:\n${batch.slice(0, 120)}`).toBe(true)
    }
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
})
