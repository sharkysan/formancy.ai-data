import type { ColumnMeta, DatabaseKind, NormalizedType, ObjectMeta } from '@formancy/data-core'
import { createSnapshot, generateForm } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { DEFAULT_PARITY, DEFAULT_TABLE } from './defaults.js'

/*
 * DEFAULT_PARITY held to data-core without a server (0149): each column's
 * default as `spelled` says its engine's catalog writes the parity suites'
 * DDL, on the table as that engine's discovery types it, generated as the
 * suites generate what discovery returns. The suites hold the spellings,
 * on real servers: a spelling this file has wrong fails there, and one
 * data-core reads otherwise than `started` says fails here, before either
 * suite runs.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }

/** The parity table as each engine's discovery types it: varchar counted in characters on PostgreSQL and in its code page's bytes on SQL Server, the city an nvarchar there. */
function defaultedTable(kind: DatabaseKind): ObjectMeta {
  const spelled: Readonly<Record<string, string>> = DEFAULT_PARITY.spelled[kind]
  const varchar = (length: number, national = false): NormalizedType => ({
    kind: 'text',
    maxLength: length,
    fixedLength: false,
    lengthUnit: kind === 'postgres' ? 'code-points' : national ? 'utf16-code-units' : 'code-page-bytes',
  })
  let ordinal = 0
  const col = (name: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
    name,
    ordinal: (ordinal += 1),
    databaseType: type.kind,
    type,
    nullable: false,
    hasDefault: spelled[name] !== undefined,
    defaultExpression: spelled[name] ?? null,
    generated: 'none',
    comment: null,
    access: { select: true, insert: true, update: true },
    ...extra,
  })
  return {
    ref: { ...DEFAULT_TABLE },
    kind: 'table',
    comment: null,
    columns: [
      col('id', INT32, { generated: 'identity-always' }),
      col('status', varchar(20)),
      col('quoted', varchar(20)),
      col('city', varchar(20, true)),
      col('active', { kind: 'boolean' }),
      col('maybe', { kind: 'boolean' }, { nullable: true }),
      col('quantity', INT32),
      col('below', INT32),
      col('big', INT64),
      col('huge', INT64),
      col('price', { kind: 'decimal', precision: 10, scale: 2 }),
      col('code', varchar(3), { nullable: true }),
      col('made_at', { kind: 'timestamp', withTimeZone: true, precision: kind === 'postgres' ? 6 : 7 }),
      col('version', INT32),
    ],
    primaryKey: { name: `pk_${DEFAULT_TABLE.name}`, columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
    access: { delete: true },
    referencedBy: [],
  }
}

describe.each(['postgres', 'sqlserver'] as const)('DEFAULT_PARITY against data-core, from %s’s spellings', (kind) => {
  // An expectation data-core does not meet would fail both parity suites
  // for a reason that is not the engines'; held here, it fails without
  // one. Watched failing on SQL Server alone with data-core reading
  // ((9007199254740993.)) as no constant: huge started empty.
  test('starts each field at the shared answer, and says what it started and refused', () => {
    const snapshot = createSnapshot({
      kind,
      serverVersion: 'x',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: [DEFAULT_TABLE.schema] },
      objects: [defaultedTable(kind)],
      gaps: [],
    })
    const { form, notes } = generateForm(snapshot, {
      connection: 'test',
      root: DEFAULT_TABLE,
      formId: 'defaulted',
      title: 'Defaulted',
      lookups: [],
      versionColumn: 'version',
    })
    expect(Object.fromEntries(form.model.fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])))).toEqual(
      DEFAULT_PARITY.started.answers,
    )
    expect(notes.filter((note) => note.message.startsWith('Starts')).map(({ subject, message }) => ({ subject, message }))).toEqual(
      DEFAULT_PARITY.started.notes,
    )
  })
})
