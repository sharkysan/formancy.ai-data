import { describe, expect, test } from 'vitest'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { createSnapshot } from '@formancy/data-core'
import { renamedColumn } from './rename.js'

/**
 * What renamedColumn refuses, without a database. That a rename it makes is
 * the one a database reports is each adapter's discovery suite, against a
 * real ALTER (data-postgres and data-sqlserver, discovery-access).
 */
const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const

function column(name: string, ordinal: number): ColumnMeta {
  const access = { select: true, insert: true, update: name !== 'id' }
  return { name, ordinal, databaseType: 'integer', type: INT32, nullable: name !== 'id', hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access }
}

function table(name: string, columns: readonly string[], facts: Partial<ObjectMeta> = {}): ObjectMeta {
  return {
    ref: { schema: 's', name },
    kind: 'table',
    comment: null,
    columns: columns.map((entry, index) => column(entry, index + 1)),
    primaryKey: { name: `pk_${name}`, columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
    ...facts,
  }
}

const reference = (name: string, columns: string[], target: string, targetColumns: string[]) => ({
  name,
  columns,
  references: { table: { schema: 's', name: target }, columns: targetColumns },
  onUpdate: 'no-action' as const,
  onDelete: 'no-action' as const,
  enforced: true,
  validated: true,
})

const check = (name: string, expression: string | null) => ({ name, expression, enforced: true, validated: true })

/** Two tables: `t`, whose `code` is unique, `parent_id` refers to its own `id`, `size` is checked and `note` is named by nothing; and `u`, which refers to `t`'s `code`. */
function snapshot(): MetadataSnapshot {
  return createSnapshot({
    kind: 'postgres',
    serverVersion: '17',
    account: { user: 'owner', login: 'owner' },
    scope: { schemas: ['s'] },
    objects: [
      table('t', ['id', 'code', 'parent_id', 'note', 'size'], {
        uniqueKeys: [{ name: 'uq_t_code', columns: ['code'] }],
        foreignKeys: [reference('fk_t_parent', ['parent_id'], 't', ['id'])],
        checks: [check('ck_t_size', '(size > 0)')],
      }),
      table('u', ['id', 't_code'], { foreignKeys: [reference('fk_u_t', ['t_code'], 't', ['code'])] }),
    ],
    gaps: [],
  })
}

const T = { schema: 's', name: 't' }

describe('renamedColumn', () => {
  // The case the refusals below are measured against: a function that threw
  // for every column would pass all of them. Renamed in place, the rest as it
  // was, and the snapshot it was given left alone.
  test('renames a column nothing else names, in place, and leaves its input as it was', () => {
    const before = snapshot()
    const kept = structuredClone(before)
    const [t, u] = before.objects as [ObjectMeta, ObjectMeta]
    const after = renamedColumn(before, T, 'note', 'memo')
    expect(after.objects).toEqual([{ ...t, columns: t.columns.map((entry) => (entry.name === 'note' ? { ...entry, name: 'memo' } : entry)) }, u])
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(before).toEqual(kept)
  })

  // A rename the snapshot cannot place would otherwise return the snapshot
  // unchanged, and a drift test would pass while describing no drift at all.
  test.each([
    ['a table the snapshot does not have', { schema: 's', name: 'v' }, 'note', 's.v is not in the snapshot'],
    ['a column the table does not have', T, 'notes', 's.t has no column notes'],
  ])('refuses %s', (_title, ref, from, message) => {
    expect(() => renamedColumn(snapshot(), ref, from, 'memo')).toThrow(message)
  })

  // A database renames a key's, a foreign key's or a check's reference with
  // the column; this edit does not, and no discovery suite has compared what
  // a catalog reports for those after a rename. Left in, a foreign key of
  // another table would point at a column the table no longer has and the
  // check would read the old name -- a state no database reaches. The whole
  // message is matched: createSnapshot's own refusal of a key naming a
  // missing column contains "key uq_t_code" too, and would pass a shorter
  // match for the wrong reason.
  test.each([
    ['a unique key and another table’s foreign key to it', 'code', 'key uq_t_code, foreign key fk_u_t of s.u'],
    ['the primary key and its own table’s foreign key to it', 'id', 'key pk_t, foreign key fk_t_parent of s.t'],
    ['its table’s own foreign key', 'parent_id', 'foreign key fk_t_parent'],
    ['a check', 'size', 'check ck_t_size'],
  ])('refuses a column named by %s', (_title, from, named) => {
    expect(() => renamedColumn(snapshot(), T, from, 'renamed')).toThrow(`s.t.${from} is named by ${named}; renamedColumn renames only a column nothing else names`)
  })

  // A check is judged by its text, and a check whose text is null might name
  // the column; nothing here can tell, and passed, it could be the stale
  // check the cases above refuse.
  test('refuses a column of a table with a check whose text the account could not read', () => {
    const { fingerprint: _, ...contents } = snapshot()
    const unread = createSnapshot({ ...contents, objects: contents.objects.map((object) => (object.ref.name === 't' ? { ...object, checks: [check('ck_t_size', null)] } : object)) })
    expect(() => renamedColumn(unread, T, 'note', 'memo')).toThrow('s.t.note is named by check ck_t_size, whose text this account could not read;')
  })

  // The name it is given is the table's already: two columns of one name is
  // createSnapshot's refusal, and renamedColumn makes nothing past it.
  test('refuses a name the table already has', () => {
    expect(() => renamedColumn(snapshot(), T, 'note', 'size')).toThrow('s.t: column size is reported twice')
  })
})
