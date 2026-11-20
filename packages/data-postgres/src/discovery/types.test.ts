import { describe, expect, test } from 'vitest'
import { columnOf } from './columns.js'
import type { ColumnRow } from './columns.js'
import { domainsOf, labelsOf } from './domains.js'
import { normalizeType } from './types.js'

/*
 * What a column of an enum or of a domain is read as (0170), from the
 * facts `DOMAIN_CHAIN` reads, as a function: the catalog's answers for each
 * are held against a real server in states.integration.test.ts, which runs
 * first in CI; this holds the reading of them, which no server is needed
 * to decide.
 */

const pg = (name: string, modifier = -1) => ({ name, schema: 'pg_catalog', modifier, labels: null, domain: false })

describe('normalizeType', () => {
  // An enum is read from its labels wherever it lives, in the order given,
  // and so is a domain over one. Watched failing with the labels left
  // unread: every enum was unsupported, as before 0170.
  test('an enum, and a domain over one, is its labels in the order the catalog gave them', () => {
    const labels = ['low', 'high', 'urgent']
    expect(normalizeType({ name: 'priority', schema: 'states', modifier: -1, labels, domain: false }, 'code-points')).toEqual({
      kind: 'enum',
      name: { schema: 'states', name: 'priority' },
      labels: ['low', 'high', 'urgent'],
    })
    expect(normalizeType({ name: 'priority', schema: 'states', modifier: -1, labels, domain: true }, 'code-points')).toMatchObject({ kind: 'enum' })
    expect(normalizeType({ name: 'nothing', schema: 'states', modifier: -1, labels: [], domain: false }, 'code-points')).toMatchObject({
      kind: 'enum',
      labels: [],
    })
  })

  // A domain over text or a whole number is its base type, with the
  // innermost domain's modifier; over anything else it is unsupported,
  // though the type itself is not -- nothing has proved an operation over
  // one. Watched failing with every domain base read: a domain over
  // numeric was a decimal.
  test('a domain over text or a whole number is its base, and over any other type unsupported', () => {
    expect(normalizeType({ ...pg('varchar', 14), domain: true }, 'code-points')).toEqual({
      kind: 'text',
      maxLength: 10,
      lengthUnit: 'code-points',
      fixedLength: false,
    })
    expect(normalizeType({ ...pg('int4'), domain: true }, 'code-points')).toEqual({ kind: 'integer', min: '-2147483648', max: '2147483647' })
    expect(normalizeType({ ...pg('text'), domain: true }, 'code-points')).toMatchObject({ kind: 'text', maxLength: null })
    expect(normalizeType({ ...pg('bpchar', 7), domain: true }, 'code-points')).toMatchObject({ kind: 'text', maxLength: 3, fixedLength: true })
    for (const name of ['numeric', 'date', 'uuid', 'bool', 'timestamptz', 'float8', 'bytea', '_text'])
      expect(normalizeType({ ...pg(name), domain: true }, 'code-points'), name).toEqual({ kind: 'unsupported' })
    expect(normalizeType(pg('numeric', 655366), 'code-points')).toEqual({ kind: 'decimal', precision: 10, scale: 2 })
  })

  // An array of an enum is an array: its typtype is no enum's, its name
  // `_order_state` in the enum's schema, and it is unsupported as every
  // array is; a composite named like a built-in is not one.
  test('an array of an enum, and a composite named int4, are unsupported', () => {
    expect(normalizeType({ name: '_order_state', schema: 'states', modifier: -1, labels: null, domain: false }, 'code-points')).toEqual({ kind: 'unsupported' })
    expect(normalizeType({ name: 'int4', schema: 'states', modifier: -1, labels: null, domain: false }, 'code-points')).toEqual({ kind: 'unsupported' })
  })
})

describe('columnOf', () => {
  const row = (extra: Partial<ColumnRow> = {}): Omit<ColumnRow, 'oid'> => ({
    name: 'title',
    ordinal: 2,
    database_type: 'text',
    type_name: 'text',
    type_schema: 'pg_catalog',
    type_modifier: -1,
    labels: null,
    is_domain: false,
    not_null: false,
    identity: '',
    generated: '',
    default_expression: null,
    ...extra,
  })

  // A column of no domain carries no `domains` at all -- not an empty list,
  // not undefined -- so a snapshot of a catalog with no domain is, to the
  // byte, the one discovery made before 0170, and every captured snapshot
  // still fingerprints as it was taken. Watched failing with `domains`
  // written as undefined on every column: the key was there.
  test('a column of no domain has no domains', () => {
    const column = columnOf(row(), 'code-points')
    expect(Object.hasOwn(column, 'domains')).toBe(false)
    expect(column).toEqual({
      name: 'title',
      ordinal: 2,
      databaseType: 'text',
      type: { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false },
      nullable: true,
      hasDefault: false,
      defaultExpression: null,
      generated: 'none',
    })
  })

  test("a column of a domain carries the chain discovery read, and an enum's labels its type", () => {
    const domains = domainsOf(
      JSON.stringify([
        { schema: 'states', name: 'tone', checks: [] },
        {
          schema: 'states',
          name: 'colour',
          checks: [{ name: 'colour_check', expression: '(VALUE <> ALL (ARRAY[]::text[]))', enforced: true, validated: false }],
        },
      ]),
    )
    const column = columnOf(
      row({ name: 'tone', database_type: 'states.tone', type_name: 'varchar', type_modifier: 14, is_domain: true, not_null: true }),
      'code-points',
      domains,
    )
    expect(column).toMatchObject({ type: { kind: 'text', maxLength: 10 }, nullable: false })
    expect(column.domains?.map((domain) => domain.ref.name)).toEqual(['tone', 'colour'])
    expect(column.domains?.[1]?.checks).toEqual([{ name: 'colour_check', expression: '(VALUE <> ALL (ARRAY[]::text[]))', enforced: true, validated: false }])
    const state = columnOf(row({ name: 'state', type_name: 'order_state', type_schema: 'states', labels: '["draft","placed"]' }), 'code-points')
    expect(state.type).toEqual({ kind: 'enum', name: { schema: 'states', name: 'order_state' }, labels: ['draft', 'placed'] })
  })

  // pg_enum's labels are names, read as JSON text: anything else is not
  // what LABELS reads, and is refused rather than read as some labels.
  test('labels that are not a list of text are refused', () => {
    expect(labelsOf(null)).toBeNull()
    expect(() => labelsOf('{"a":1}')).toThrow(/list of text/)
    expect(() => labelsOf('[1]')).toThrow(/list of text/)
  })
})
