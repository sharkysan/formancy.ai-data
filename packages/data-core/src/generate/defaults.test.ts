import { acceptsDefault, createFormEngine } from '@formancy/core'
import type { FieldDef, FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import type { DatabaseKind } from '../adapter.js'
import type { ColumnMeta, NormalizedType, ObjectMeta } from '../metadata.js'
import { createSnapshot } from '../snapshot.js'
import { readConstant } from './defaults.js'
import { generateForm } from './generate.js'
import type { GenerationRequest } from './types.js'

/*
 * A new record starts with its column's constant default (0149). Discovery
 * spells a default as each engine's catalog deparses it -- PostgreSQL's
 * pg_get_expr, SQL Server's object_definition -- and the generator reads a
 * constant out of that spelling per engine, puts it through the column's
 * codec as a stored value is read, and makes it the field's `default` only
 * where the field the create writes would take it. The spellings below are
 * the ones the captured snapshots hold and the ones each catalog writes for
 * the other constants, as the record names them; anything not read with
 * certainty is no default.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT16: NormalizedType = { kind: 'integer', min: '-32768', max: '32767' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const varchar = (maxLength: number, lengthUnit: 'utf16-code-units' | 'code-points' | 'code-page-bytes' = 'utf16-code-units'): NormalizedType => ({
  kind: 'text',
  maxLength,
  lengthUnit,
  fixedLength: false,
})

let ordinal = 0
function col(name: string, type: NormalizedType, defaultExpression: string | null, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  ordinal += 1
  return {
    name,
    ordinal,
    databaseType: type.kind,
    type,
    nullable: false,
    hasDefault: defaultExpression !== null,
    defaultExpression,
    generated: 'none',
    comment: null,
    access: { select: true, insert: true, update: true },
    ...extra,
  }
}

function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return {
    ref: { schema: 'sales', name },
    kind: 'table',
    comment: null,
    columns,
    primaryKey: { name: `pk_${name}`, columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
    ...extra,
  }
}

/**
 * The form over `root`, held to what publishing it asks: the released
 * validator accepts it -- spec 5 refuses an empty default, among others --
 * and the engine opens it, which it refuses where a default is one its
 * field would refuse (formancy.ai 0197). Every case below goes through
 * here, so no default this file holds is one the server would not publish.
 */
function generated(kind: DatabaseKind, objects: ObjectMeta[], root: string, extra: Partial<GenerationRequest> = {}) {
  const snapshot = createSnapshot({ kind, serverVersion: 'x', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['sales'] }, objects, gaps: [] })
  const result = generateForm(snapshot, { connection: 'erp', root: { schema: 'sales', name: root }, formId: root, title: root, lookups: [], ...extra })
  const checked = validateSchema(result.form)
  expect(checked.valid ? [] : checked.errors).toEqual([])
  createFormEngine({ schema: result.form, capabilities: { now: () => 0, today: () => '2026-11-11', random: () => 0.5 } })
  return result
}

const field = (form: FormSchema, key: string): FieldDef => {
  const found = form.model.fields.find((candidate) => candidate.key === key)
  if (found === undefined) throw new Error(`no field ${key}`)
  return found
}

/** An identity key, so the root has an address and nothing about it is the person's. */
const ID = (): ColumnMeta => col('id', INT32, null, { generated: 'identity-always', access: { select: true, insert: false, update: false } })

describe('readConstant (0149)', () => {
  // Each engine's catalog spells a constant its own way, and one engine's
  // spelling read as the other's would be read wrong: PostgreSQL's `true`
  // is no T-SQL, and SQL Server's ('draft') no PostgreSQL. Watched failing
  // with every spelling read alike (('draft') read on PostgreSQL), and with
  // the reader left out (no default anywhere).
  test.each([
    ['postgres', "'draft'::character varying", { kind: 'text', text: 'draft', national: false }],
    ['postgres', "'draft'::text", { kind: 'text', text: 'draft', national: false }],
    ['postgres', "'AB'::bpchar", { kind: 'text', text: 'AB', national: false }],
    ['postgres', "'it''s'::character varying", { kind: 'text', text: "it's", national: false }],
    ['postgres', "''::text", { kind: 'text', text: '', national: false }],
    ['postgres', "'Zürich'::character varying", { kind: 'text', text: 'Zürich', national: false }],
    // A control character is read as spelled: whether the field's box draws it is the field's to say (0150).
    ['postgres', "'a\nb'::text", { kind: 'text', text: 'a\nb', national: false }],
    ['postgres', 'true', { kind: 'boolean', value: true }],
    ['postgres', 'false', { kind: 'boolean', value: false }],
    ['postgres', '1', { kind: 'number', text: '1' }],
    ['postgres', '9.5', { kind: 'number', text: '9.5' }],
    ['postgres', "'-1'::integer", { kind: 'number', text: '-1' }],
    ['postgres', "'9007199254740993'::bigint", { kind: 'number', text: '9007199254740993' }],
    ['postgres', "'-1.5'::numeric", { kind: 'number', text: '-1.5' }],
    ['postgres', "'7'::smallint", { kind: 'number', text: '7' }],
    ['sqlserver', "('draft')", { kind: 'text', text: 'draft', national: false }],
    ['sqlserver', "('a\tb')", { kind: 'text', text: 'a\tb', national: false }],
    ['sqlserver', "(N'Zürich')", { kind: 'text', text: 'Zürich', national: true }],
    ['sqlserver', "('it''s')", { kind: 'text', text: "it's", national: false }],
    ['sqlserver', "('')", { kind: 'text', text: '', national: false }],
    ['sqlserver', '((1))', { kind: 'number', text: '1' }],
    ['sqlserver', '((0))', { kind: 'number', text: '0' }],
    ['sqlserver', '((-1))', { kind: 'number', text: '-1' }],
    ['sqlserver', '((9.5))', { kind: 'number', text: '9.5' }],
    ['sqlserver', '((9007199254740993))', { kind: 'number', text: '9007199254740993' }],
  ] as const)('%s reads %s as a constant', (kind, expression, constant) => {
    expect(readConstant(kind, expression)).toEqual(constant)
  })

  // What no constant is, or no constant this release reads with certainty,
  // is no default: a function the database calls on every create, a
  // sequence, NULL, an expression, another type's literal, and the other
  // engine's spellings. A backslash in a PostgreSQL literal means one thing
  // under standard_conforming_strings and another without it, which the
  // snapshot does not record. Watched failing with the text pattern
  // unanchored: 'a'::text || 'b'::text was read as a.
  test.each([
    ['postgres', 'now()'],
    ['postgres', 'gen_random_uuid()'],
    ['postgres', "nextval('sales.shipment_id_seq'::regclass)"],
    ['postgres', 'CURRENT_TIMESTAMP'],
    ['postgres', 'NULL::character varying'],
    ['postgres', "'a'::text || 'b'::text"],
    ['postgres', "'2026-01-01'::date"],
    ['postgres', "'1.5'::double precision"],
    ['postgres', "'x'::character varying(10)"],
    ['postgres', "'{}'::text[]"],
    ['postgres', "'NaN'::numeric"],
    ['postgres', "'a\\b'::text"],
    ['postgres', '(1 + 1)'],
    ['postgres', "('draft')"],
    ['postgres', '((1))'],
    ['sqlserver', '(sysdatetimeoffset())'],
    ['sqlserver', '(NEXT VALUE FOR [sales].[shipment_id])'],
    ['sqlserver', '(newsequentialid())'],
    ['sqlserver', '(NULL)'],
    ['sqlserver', '((1)+(1))'],
    ['sqlserver', '((1.5E3))'],
    ['sqlserver', "(('draft'))"],
    ['sqlserver', "'draft'::character varying"],
    ['sqlserver', 'true'],
    ['sqlserver', '1'],
  ] as const)('%s reads %s as no constant', (kind, expression) => {
    expect(readConstant(kind, expression)).toBeNull()
  })
})

describe('a new record starts with its column’s constant default (0149)', () => {
  /** A table of every column kind a default is read for, each spelled as `kind`'s catalog spells it. */
  const shop = (kind: DatabaseKind): ObjectMeta[] => {
    ordinal = 0
    const pg = kind === 'postgres'
    return [
      table('shop', [
        ID(),
        col('status', varchar(20), pg ? "'draft'::character varying" : "('draft')"),
        col('quoted', varchar(20), pg ? "'it''s'::character varying" : "('it''s')"),
        col('city', varchar(20, pg ? 'code-points' : 'utf16-code-units'), pg ? "'Zürich'::character varying" : "(N'Zürich')"),
        col('active', { kind: 'boolean' }, pg ? 'true' : '((1))'),
        col('maybe', { kind: 'boolean' }, pg ? 'false' : '((0))', { nullable: true }),
        col('quantity', INT32, pg ? '1' : '((1))'),
        col('below', INT32, pg ? "'-1'::integer" : '((-1))'),
        col('big', INT64, pg ? "'9007199254740993'::bigint" : '((9007199254740993))'),
        col('price', { kind: 'decimal', precision: 10, scale: 2 }, pg ? '9.5' : '((9.5))'),
        col('created_at', { kind: 'timestamp', withTimeZone: true, precision: 6 }, pg ? 'now()' : '(sysdatetimeoffset())'),
        col('row_version', INT64, pg ? '1' : '((1))'),
      ]),
    ]
  }
  const STARTS = {
    status: 'draft',
    quoted: "it's",
    city: 'Zürich',
    active: true,
    maybe: 'false',
    quantity: 1,
    below: -1,
    big: '9007199254740993',
    price: '9.50',
  }

  // The answers a fresh form starts with, of each field's own answer type,
  // the same on both engines: text as written, a checkbox ticked, a
  // nullable yes/no its option, a whole number a number, one past 2^53 and
  // an exact decimal text in their canonical spelling -- the value a record
  // holding the default is read back as. Nothing for a function, and the
  // version column is no field. Watched failing with the codec skipped (the
  // price started at 9.5, which the record reads back as 9.50) and with
  // formValue skipped (quantity started at the text '1', and the nullable
  // yes/no at false, which its select does not offer).
  test.each(['postgres', 'sqlserver'] as const)('%s: each field starts with its default, as its record would read it back', (kind) => {
    const { form, notes } = generated(kind, shop(kind), 'shop', { versionColumn: 'row_version' })
    const starts = Object.fromEntries(form.model.fields.flatMap((entry) => (entry.default === undefined ? [] : [[entry.key, entry.default]])))
    expect(starts).toEqual(STARTS)
    expect(notes.filter((note) => note.message.startsWith('Starts with'))).toEqual(
      Object.entries(STARTS).map(([key, value]) => ({ subject: key, kind: 'inferred', message: `Starts with the column's default, “${String(value)}”.` })),
    )
    expect(notes.some((note) => note.subject === 'created_at' && note.message.startsWith('Starts'))).toBe(false)
  })

  // The engine refuses to open a document whose default its field would
  // refuse (formancy.ai 0197), so a default the generator wrote wrongly
  // would stop every page that draws the form, not one save. Every default
  // above is one the released spec and engine take, and a fresh engine
  // starts with each; an opened record -- an engine given its answers --
  // starts as handed in. Watched failing with formValue skipped: the
  // validator refused the text '1' and '-1' in number fields and false in
  // a select; and with the codec skipped: a fresh form started the price
  // at 9.5.
  test.each(['postgres', 'sqlserver'] as const)('%s: the released spec and engine take every default, and a fresh form starts with each', (kind) => {
    const { form } = generated(kind, shop(kind), 'shop', { versionColumn: 'row_version' })
    const checked = validateSchema(form)
    expect(checked.valid ? [] : checked.errors).toEqual([])
    for (const entry of form.model.fields) expect([entry.key, acceptsDefault(entry)]).toEqual([entry.key, true])
    const capabilities = { now: () => 0, today: () => '2026-11-11', random: () => 0.5 }
    expect(createFormEngine({ schema: form, capabilities }).value()).toEqual(STARTS)
    expect(createFormEngine({ schema: form, capabilities, initialValue: { status: 'placed' } }).value()).toEqual({ status: 'placed' })
  })

  /** One column of a table of its own, with the identity beside it. */
  const single = (kind: DatabaseKind, column: ColumnMeta) => {
    ordinal = 0
    return generated(kind, [table('one', [ID(), column])], 'one')
  }

  // A constant the column itself would refuse -- too long, out of range, a
  // fraction for a whole number or past the decimal's scale -- is no
  // default: the database refuses it at the insert, or rounds it, and a
  // form that started with it would show a value the record never holds.
  // The note says why, in the codec's words, and that the database still
  // fills it when the field is left out. Watched failing with the codec's
  // refusal ignored: each field started with the constant, and no note.
  test.each([
    ['postgres', col('code', varchar(3, 'code-points'), "'toolong'::character varying"), 'toolong', 'at most 3 characters'],
    ['sqlserver', col('code', varchar(3, 'code-page-bytes'), "('toolong')"), 'toolong', 'at most 3 characters'],
    ['postgres', col('code', INT16, '40000'), '40000', 'enter a whole number from -32768 to 32767'],
    ['sqlserver', col('code', INT32, '((1.5))'), '1.5', 'enter a whole number, without spaces, a plus sign, leading zeros or a decimal point'],
    ['postgres', col('code', { kind: 'decimal', precision: 10, scale: 2 }, '1.555'), '1.555', 'at most 2 digits after the decimal point'],
    ['sqlserver', col('code', { kind: 'decimal', precision: 4, scale: 2 }, '((123.5))'), '123.5', 'at most 2 digits before the decimal point'],
  ] as const)('%s: a constant the codec refuses is no default, and said', (kind, column, shown, reason) => {
    const { form, notes } = single(kind, column)
    expect(field(form, 'code')).not.toHaveProperty('default')
    expect(notes).toContainEqual({
      subject: 'code',
      kind: 'inferred',
      message: `Starts empty: the column's default, “${shown}”, is not an answer the field takes (${reason}), so the database fills it when a create leaves the field out.`,
    })
  })

  // PostgreSQL's varchar(3) counts characters, and holds two emoji; the
  // form's box counts UTF-16 code units, four, and its engine refuses them
  // as a default. The field decides, after the codec. Watched failing with
  // the codec alone asked: the field started with both emoji, which
  // acceptsDefault, the engine's own check, refuses.
  test('a constant the column holds and the field refuses is no default, and said', () => {
    const { form, notes } = single('postgres', col('code', varchar(3, 'code-points'), "'😀😀'::character varying"))
    expect(field(form, 'code')).not.toHaveProperty('default')
    expect(acceptsDefault({ ...field(form, 'code'), default: '😀😀' })).toBe(false)
    expect(notes).toContainEqual(
      expect.objectContaining({ subject: 'code', message: expect.stringMatching(/^Starts empty: .*\(longer than the 3 UTF-16 code units the field holds\)/) }),
    )
  })

  // A one-line box draws a line break or a tab otherwise than the column
  // holds it, and no box draws another control character as it is: the
  // field refuses such a constant, as it refuses an administrator's
  // starting value (0150), one reading, and says so; a multi-line box
  // starts at a line feed. Watched failing with the reading left to the
  // constant's reader: the tab was no default and no note, and the multi-
  // line field's line feed was no default either.
  test('a constant a one-line box draws otherwise is no default, and said; a line feed starts a multi-line field', () => {
    // PostgreSQL's: SQL Server's ('a\tb') is past printable ASCII, which its code page decides, and no default already.
    const { form, notes } = single('postgres', col('code', varchar(20), "'a\tb'::character varying"))
    expect(field(form, 'code')).not.toHaveProperty('default')
    expect(notes).toContainEqual(
      expect.objectContaining({
        subject: 'code',
        message: expect.stringMatching(/^Starts empty: .*\(it holds a line break, a tab or another control character, which a one-line box draws otherwise\)/),
      }),
    )
    const multi = single('postgres', col('remark', { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }, "'a\nb'::text"))
    expect(field(multi.form, 'remark').default).toBe('a\nb')
    const other = single('postgres', col('remark', { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }, "'a\rb'::text"))
    expect(field(other.form, 'remark')).not.toHaveProperty('default')
  })

  // A non-N literal in T-SQL is read in the database's code page, and an
  // N literal written to a varchar column is converted to the column's: a
  // character outside either is stored as something else, and nothing in
  // the snapshot says which page. Only what every code page holds the same
  // -- ASCII -- or an N literal on an nvarchar column is read. Watched
  // failing with the N prefix ignored: café started an nvarchar field from
  // a code-page literal.
  test.each([
    ["('café')", 'an nvarchar', undefined, varchar(20, 'utf16-code-units')],
    ["(N'café')", 'a varchar', undefined, varchar(20, 'code-page-bytes')],
    ["(N'café')", 'an nvarchar', 'café', varchar(20, 'utf16-code-units')],
    ["('cafe')", 'a varchar', 'cafe', varchar(20, 'code-page-bytes')],
  ] as const)('sqlserver: %s on %s column starts with %s', (expression, _spelled, starts, type) => {
    expect(field(single('sqlserver', col('code', type, expression)).form, 'code').default).toBe(starts)
  })

  // A constant of another kind than the column's is no default: SQL
  // Server's ('5') on an int is converted by the database, a bit's ((2))
  // is stored as 1, and an empty string is the field as it starts anyway,
  // which spec 5 refuses as a default -- so is a char(1)'s blank, which
  // reads back without its padding as an empty answer. A date, an instant, a float and a
  // uuid are not read: their text is the session's, or rounds otherwise
  // than a page would. Read as nothing, never as a guess, and nothing is
  // said, as of a function. Watched failing with a number taken on a text
  // column, with every number taken on a bit, with the empty string taken,
  // and with every kind asked: SQL Server's date, the float and the uuid
  // started with their constants; and with the empty answer looked for
  // only before the codec: the validator refused each char(1)'s blank as
  // a default, "Must not be empty."
  test.each([
    ['sqlserver', 'text on an int', col('code', INT32, "('5')")],
    ['sqlserver', 'a number on a varchar', col('code', varchar(10), '((5))')],
    ['sqlserver', '2 on a bit', col('code', { kind: 'boolean' }, '((2))')],
    ['postgres', 'an empty string', col('code', varchar(10), "''::character varying")],
    ['sqlserver', 'an empty string', col('code', varchar(10), "('')")],
    ['postgres', "a char(1)'s blank", col('code', { kind: 'text', maxLength: 1, lengthUnit: 'code-points', fixedLength: true }, "' '::bpchar")],
    ['sqlserver', "a char(1)'s blank", col('code', { kind: 'text', maxLength: 1, lengthUnit: 'code-page-bytes', fixedLength: true }, "(' ')")],
    ['postgres', 'a date', col('code', { kind: 'date' }, "'2026-01-01'::date")],
    ['sqlserver', 'a date', col('code', { kind: 'date' }, "('2026-01-01')")],
    ['postgres', 'a float', col('code', { kind: 'float', bits: 64 }, '1.5')],
    ['sqlserver', 'a uuid', col('code', { kind: 'uuid' }, "('2b7e1516-28ae-4d2a-a6f7-15880945cf4f')")],
  ] as const)('%s: %s starts empty, and says nothing', (kind, _what, column) => {
    const { form, notes } = single(kind, column)
    expect(field(form, 'code')).not.toHaveProperty('default')
    expect(notes.filter((note) => note.message.startsWith('Starts'))).toEqual([])
  })

  // Every answer the codec gives is one spec 5 and the field's own checks
  // take, at their edges: a decimal canonical to its scale, whatever its
  // sign or a scale as wide as its precision -- which its pattern must
  // match; a fixed-length column's padding gone, as it reads back; and
  // text of blanks alone on a varchar, which is not empty. `generated`
  // holds each to the validator and the engine. Watched failing with the
  // codec skipped: the decimals started as spelled, and the char(3) with
  // its padding.
  test.each([
    ['postgres', 'numeric(3,3)', col('code', { kind: 'decimal', precision: 3, scale: 3 }, '0.5'), '0.500'],
    ['postgres', 'numeric(5,2)', col('code', { kind: 'decimal', precision: 5, scale: 2 }, "'-0.5'::numeric"), '-0.50'],
    ['sqlserver', 'decimal(19,4)', col('code', { kind: 'decimal', precision: 19, scale: 4 }, '((0))'), '0.0000'],
    ['postgres', 'char(3)', col('code', { kind: 'text', maxLength: 3, lengthUnit: 'code-points', fixedLength: true }, "'ab '::bpchar"), 'ab'],
    ['sqlserver', 'varchar(3)', col('code', varchar(3, 'code-page-bytes'), "(' ')"), ' '],
  ] as const)('%s: a %s default starts at the answer its record reads back', (kind, _type, column, starts) => {
    expect(field(single(kind, column).form, 'code').default).toBe(starts)
  })

  // A note quotes the answer, so an administrator sees what a default of
  // blanks starts with, and where a value ends before the sentence goes
  // on. Watched failing with the value printed bare: "default,  ."
  test('the note quotes the answer a field starts with, and the constant it refuses', () => {
    const blank = single('sqlserver', col('code', varchar(3, 'code-page-bytes'), "(' ')")).notes
    expect(blank).toContainEqual({ subject: 'code', kind: 'inferred', message: "Starts with the column's default, “ ”." })
    const refused = single('sqlserver', col('code', varchar(3, 'code-page-bytes'), "('a, b.')")).notes
    expect(refused).toContainEqual(
      expect.objectContaining({ subject: 'code', message: expect.stringMatching(/^Starts empty: the column's default, “a, b\.”, is not/) }),
    )
  })

  // A whole number's default is its value, whatever zeros or sign spell
  // it: the codec takes a whole number's text in its canonical spelling
  // only, and 007 is 7 in both engines. Watched failing with the digits
  // handed on as spelled: the codec refused both, and the note said so.
  test.each([
    ['((007))', 7],
    ['((-0))', 0],
  ] as const)('sqlserver: %s on an int starts at %s', (expression, starts) => {
    expect(field(single('sqlserver', col('code', INT32, expression)).form, 'code').default).toBe(starts)
  })

  // Only a field the create writes starts with a default: one the create
  // never sends has nothing to start, and a default shown there would be a
  // value the person cannot give. A pinned column is the context's, a
  // key the database fills its own (0056), a column the account may not
  // insert stays the database's, and a view writes nothing. Watched failing
  // with every field given its default: the pinned tenant started at 1.
  test('a field the create does not write starts empty, whatever its column’s default', () => {
    ordinal = 0
    const objects = [
      table('item', [
        col('id', INT32, '((1))'),
        col('tenant_id', INT32, '((1))'),
        col('label', varchar(20), "('kept')", { access: { select: true, insert: false, update: true } }),
        col('note', varchar(20), "('new')"),
      ]),
      table('item_view', [col('id', INT32, null), col('note', varchar(20), "('new')")], { kind: 'view' }),
    ]
    const item = generated('sqlserver', objects, 'item', { pinned: ['tenant_id'] })
    expect(item.form.model.fields.map((entry) => [entry.key, entry.default])).toEqual([
      ['id', undefined],
      ['tenant_id', undefined],
      ['label', undefined],
      ['note', 'new'],
    ])
    expect(generated('sqlserver', objects, 'item_view').form.model.fields.map((entry) => entry.default)).toEqual([undefined, undefined])
  })

  // A lookup's answer is a record's token, and the record a default names
  // may be one this person may not choose -- another tenant's, or none
  // the lookup's filter offers. It starts empty, and the database fills
  // the column when the create leaves it out, which the note says.
  // Watched failing with the lookup left unasked: no note was written.
  test('a lookup starts empty, and its note leaves the default to the database', () => {
    ordinal = 0
    const objects = [
      table('country', [col('id', varchar(2), null), col('name', varchar(40), null)]),
      table('site', [ID(), col('country_id', varchar(2), "'CH'::character varying"), col('opened_at', { kind: 'date' }, 'now()')], {
        foreignKeys: [
          {
            name: 'fk_site_country',
            columns: ['country_id'],
            references: { table: { schema: 'sales', name: 'country' }, columns: ['id'] },
            onUpdate: 'no-action',
            onDelete: 'no-action',
            enforced: true,
            validated: true,
          },
        ],
      }),
    ]
    const { form, notes } = generated('postgres', objects, 'site', { lookups: [{ foreignKey: 'fk_site_country', display: ['name'] }] })
    expect(field(form, 'country')).not.toHaveProperty('default')
    expect(notes).toContainEqual({
      subject: 'country',
      kind: 'inferred',
      message:
        "Starts empty: the default of country_id, “CH”, is left to the database, which fills it when a create leaves the field out: a lookup's answer is a record, and the one a default names may be one this person may not choose.",
    })
  })
})
