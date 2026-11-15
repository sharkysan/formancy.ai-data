import type { CheckMeta, ColumnMeta, DatabaseKind, NormalizedType, ObjectMeta } from '@formancy/data-core'
import { createSnapshot, generateForm } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { CHECK_LIST_PARITY, checkListOf, LISTED_TABLE } from './check-lists.js'

/*
 * CHECK_LIST_PARITY held to data-core without a server (0152): each check
 * as its engine's catalog spells the parity suites' DDL -- ruleutils.c's
 * deparse on PostgreSQL, SQL Server's definition written again from its
 * parse -- read and generated as the suites read and generate what
 * discovery returns. ck_listed_status's spellings are the ones the
 * captured snapshots hold for ck_order_status, the same DDL; the rest are
 * what the parity suites' discovery returned on PostgreSQL 17.11 and SQL
 * Server 2022 (16.0.4295.3) on 2026-11-15. The suites hold the real
 * spellings, on real servers: a spelling this file has wrong fails there,
 * and one data-core reads otherwise than the expectations say fails here.
 */

const SPELLED: Record<DatabaseKind, Record<keyof typeof CHECK_LIST_PARITY.read, string>> = {
  postgres: {
    ck_listed_big: "(big = ANY (ARRAY['9007199254740993'::bigint, (0)::bigint, ('-1'::integer)::bigint]))",
    ck_listed_code: "(code = ANY (ARRAY['A'::bpchar, 'BB'::bpchar]))",
    ck_listed_flavour: "((flavour)::text = ANY ((ARRAY['a'::character varying, NULL::character varying])::text[]))",
    ck_listed_group: '((("group")::text = \'A\'::text) OR (("group")::text = \'B\'::text))',
    ck_listed_kind: "((kind)::text <> ALL ((ARRAY['x'::character varying, 'y'::character varying])::text[]))",
    ck_listed_label:
      "((label)::text = ANY ((ARRAY['it''s'::character varying, 'a, b'::character varying, ' spaced '::character varying, 'Zürich'::character varying])::text[]))",
    ck_listed_level: '((level >= 1) AND (level <= 3))',
    ck_listed_mark: "((mark)::text = ANY ((ARRAY[''::character varying, 'x'::character varying])::text[]))",
    ck_listed_priority: "(priority = ANY (ARRAY[10, 2, '-1'::integer]))",
    ck_listed_ref: "((ref)::text ~~ 'R%'::text)",
    ck_listed_shout: "(upper((shout)::text) = ANY (ARRAY['A'::text, 'B'::text]))",
    ck_listed_stage: "((stage)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))",
    ck_listed_status: "((status)::text = ANY ((ARRAY['draft'::character varying, 'placed'::character varying, 'shipped'::character varying])::text[]))",
    ck_listed_tier: "((tier)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying, 'c'::character varying])::text[]))",
    ck_listed_tier_again: "((tier)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))",
  },
  sqlserver: {
    ck_listed_big: '([big]=(-1) OR [big]=(0) OR [big]=(9007199254740993.))',
    ck_listed_code: "([code]='BB' OR [code]='A')",
    ck_listed_flavour: "([flavour]=NULL OR [flavour]='a')",
    ck_listed_group: "([group]='A' OR [group]='B')",
    ck_listed_kind: "(NOT ([kind]='y' OR [kind]='x'))",
    ck_listed_label: "([label]=N'Zürich' OR [label]=N' spaced ' OR [label]=N'a, b' OR [label]=N'it''s')",
    ck_listed_level: '([level]>=(1) AND [level]<=(3))',
    ck_listed_mark: "([mark]='x' OR [mark]='')",
    ck_listed_priority: '([priority]=(-1) OR [priority]=(2) OR [priority]=(10))',
    ck_listed_ref: "([ref] like 'R%')",
    ck_listed_shout: "(upper([shout])='B' OR upper([shout])='A')",
    ck_listed_stage: "([stage]='b' OR [stage]='a')",
    ck_listed_status: "([status]='shipped' OR [status]='placed' OR [status]='draft')",
    ck_listed_tier: "([tier]='c' OR [tier]='b' OR [tier]='a')",
    ck_listed_tier_again: "([tier]='b' OR [tier]='a')",
  },
}

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }

/** The parity table as each engine's discovery types it: varchar counted in characters on PostgreSQL and in its code page's bytes on SQL Server, the label an nvarchar there. */
function listedTable(kind: DatabaseKind): ObjectMeta {
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
    nullable: true,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
    access: { select: true, insert: true, update: true },
    ...extra,
  })
  const enforced = (name: keyof typeof CHECK_LIST_PARITY.read): CheckMeta => ({
    name,
    expression: SPELLED[kind][name],
    enforced: true,
    validated: name !== 'ck_listed_stage',
  })
  return {
    ref: { ...LISTED_TABLE },
    kind: 'table',
    comment: null,
    columns: [
      col('id', INT32, { nullable: false, generated: 'identity-always' }),
      col('status', varchar(20), { nullable: false, hasDefault: true, defaultExpression: kind === 'postgres' ? "'draft'::character varying" : "('draft')" }),
      col('label', varchar(40, true)),
      col('priority', INT32, { nullable: false }),
      col('group', varchar(10)),
      col('code', { kind: 'text', maxLength: 2, fixedLength: true, lengthUnit: kind === 'postgres' ? 'code-points' : 'code-page-bytes' }, { nullable: false }),
      col('big', INT64),
      col('stage', varchar(10)),
      col('mark', varchar(5)),
      col('tier', varchar(10)),
      col('level', INT32),
      col('kind', varchar(10)),
      col('ref', varchar(10)),
      col('shout', varchar(10)),
      col('flavour', varchar(10)),
      col('version', INT32, { nullable: false, hasDefault: true, defaultExpression: kind === 'postgres' ? '1' : '((1))' }),
    ],
    primaryKey: { name: 'pk_listed', columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks: (Object.keys(SPELLED[kind]) as Array<keyof typeof CHECK_LIST_PARITY.read>).map(enforced),
    rowSecurity: 'none',
    access: { delete: true },
    referencedBy: [],
  }
}

describe.each(['postgres', 'sqlserver'] as const)('CHECK_LIST_PARITY against data-core, from %s’s documented spellings', (kind) => {
  // An expectation data-core does not meet would fail both parity suites
  // for a reason that is not the engines'; held here, it fails without one.
  test('reads each check as the shared reading says', () => {
    expect(Object.fromEntries(listedTable(kind).checks.map((check) => [check.name, checkListOf(kind, check)]))).toEqual(CHECK_LIST_PARITY.read)
  })

  test('generates the shared form: the selects and the notes of the lists not drawn', () => {
    const snapshot = createSnapshot({
      kind,
      serverVersion: 'x',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: ['listed'] },
      objects: [listedTable(kind)],
      gaps: [],
    })
    const { form, notes } = generateForm(snapshot, {
      connection: 'test',
      root: LISTED_TABLE,
      formId: 'listed',
      title: 'Listed',
      lookups: [],
      versionColumn: 'version',
    })
    const selects = Object.fromEntries(
      form.model.fields.flatMap((field) => (field.type === 'select' ? [[field.key, (field.options ?? []).map((option) => option.value)]] : [])),
    )
    expect(selects).toEqual(CHECK_LIST_PARITY.generated.selects)
    expect(notes.filter((note) => note.message.startsWith('Not a select')).map(({ subject, message }) => ({ subject, message }))).toEqual(
      CHECK_LIST_PARITY.generated.notes,
    )
  })
})
